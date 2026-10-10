// SikaGest — processus principal Electron
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { createStore, checkFile, AppError } = require('./db');
const { createBackups } = require('./backup');
const { createCloud } = require('./cloud');
const updater = require('./updater');
const register = require('./register');

// Version portable (clé USB) : un fichier « portable.flag » à côté du .exe.
// Les données restent alors dans le dossier du logiciel, sur la clé.
const EXE_DIR = path.dirname(process.execPath);
const PORTABLE_DIR = process.env.PORTABLE_EXECUTABLE_DIR
  || (app.isPackaged && fs.existsSync(path.join(EXE_DIR, 'portable.flag')) ? EXE_DIR : null);
// Moteur SQLite précompilé pour Windows, livré avec le logiciel
const NATIVE = path.join(__dirname, '..', 'native', `better_sqlite3-${process.platform}-${process.arch}.node`);
const storeOpts = fs.existsSync(NATIVE) ? { nativeBinding: NATIVE } : {};
const DATA_DIR = PORTABLE_DIR ? path.join(PORTABLE_DIR, 'SikaGest-donnees') : path.join(app.getPath('userData'), 'donnees');
const DB_FILE = path.join(DATA_DIR, 'sikagest.db');

let store;
let win;
let backups;
let cloud;
// Actions qui ne modifient rien (pas besoin d'envoyer une nouvelle sauvegarde en ligne)
const READ_ONLY = /^(auth\.(status|login|logout)|license\.status|recovery\.request|settings\.get|reports\.\w+|\w+\.(list|get|moves))$/;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1024, minHeight: 640,
    title: 'SikaGest', backgroundColor: '#f6f4f0', show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  updater.init(win, { portable: !!PORTABLE_DIR });
}

// Ouvre la base ; prévient la sauvegarde en ligne quand un administrateur saisit son mot de passe
const openStore = () => createStore(DB_FILE, { ...storeOpts, onAdminPassword: (u, p) => cloud && cloud.onAdminPassword(u, p) });

// Remplace les données par un fichier déjà vérifié. Revient en arrière si quelque chose se passe mal.
function replaceDatabase(candidate) {
  backups.run('avant-restauration');
  store.checkpoint();
  const previous = DB_FILE + '.avant-restauration';
  fs.copyFileSync(DB_FILE, previous);
  store.close();
  for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + ext); } catch (e) { /* absent */ } }
  try {
    fs.copyFileSync(candidate, DB_FILE);
    store = openStore();
    store.call('settings.get');
    return { ok: true };
  } catch (e) {
    try { store && store.close(); } catch (x) { /* rien */ }
    for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + ext); } catch (x) { /* absent */ } }
    fs.copyFileSync(previous, DB_FILE);
    store = openStore();
    return { ok: false, error: `La restauration a échoué (${e.message}). Vos données précédentes ont été remises en place.` };
  } finally {
    try { fs.unlinkSync(candidate); } catch (e) { /* rien */ }
  }
}

// Vérifie un fichier récupéré (clé USB ou en ligne) puis remplace les données
function restoreFromFile(file) {
  const chk = checkFile(file, storeOpts.nativeBinding);
  if (!chk.ok) { try { fs.unlinkSync(file); } catch (e) { /* rien */ } return { ok: false, error: `Restauration impossible : ${chk.error}. Vos données actuelles n'ont pas été modifiées.` }; }
  return { ok: true, chk };
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  store = openStore();

  ipcMain.handle('api', (_e, method, args) => {
    try {
      const data = store.call(method, args);
      if (cloud && !READ_ONLY.test(method)) cloud.markDirty(); // modification : à envoyer en ligne
      if (method === 'settings.save' && cloud) cloud.sync().catch(() => {});
      return { ok: true, data };
    }
    catch (e) { return { ok: false, error: e instanceof AppError ? e.message : `Erreur interne : ${e.message}` }; }
  });

  ipcMain.handle('app.info', () => ({ vendor: mergeVendor(), version: app.getVersion(), portable: !!PORTABLE_DIR, dataDir: DATA_DIR, engine: store.driver }));
  ipcMain.handle('app.openDataDir', () => shell.openPath(DATA_DIR));
  ipcMain.handle('register.sync', () => register.sync());

  // Sauvegarde : copie du fichier de base de données
  ipcMain.handle('backup.export', async () => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const res = await dialog.showSaveDialog(win, {
      title: 'Enregistrer la sauvegarde', defaultPath: `SikaGest-sauvegarde-${stamp}.sikagest`,
      filters: [{ name: 'Sauvegarde SikaGest', extensions: ['sikagest'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false };
    try { backups.exportTo(res.filePath); }
    catch (e) { return { ok: false, error: `La sauvegarde n'a pas pu être créée : ${/ENOSPC/.test(e.code || e.message) ? 'le support est plein' : e.message}` }; }
    return { ok: true, path: res.filePath };
  });
  ipcMain.handle('backup.status', () => backups.status());
  ipcMain.handle('backup.openAutoDir', () => { fs.mkdirSync(backups.dir, { recursive: true }); return shell.openPath(backups.dir); });
  ipcMain.handle('backup.import', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Restaurer une sauvegarde', properties: ['openFile'], defaultPath: backups.dir,
      filters: [{ name: 'Sauvegarde SikaGest', extensions: ['sikagest', 'db'] }],
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false };
    // 1. Vérifier le fichier choisi (sur une copie, pour ne jamais toucher l'original)
    const candidate = DB_FILE + '.a-restaurer';
    try { fs.copyFileSync(res.filePaths[0], candidate); } catch (e) { return { ok: false, error: `Fichier illisible : ${e.message}` }; }
    const v = restoreFromFile(candidate);
    if (!v.ok) return v;
    const confirm = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Annuler', 'Restaurer'], defaultId: 0, cancelId: 0, title: 'Restaurer',
      message: 'Toutes les données actuelles seront remplacées par celles de la sauvegarde. Continuer ?',
      detail: `Sauvegarde vérifiée : ${v.chk.sales} vente(s), ${v.chk.products} produit(s).\nUne copie de vos données actuelles est gardée dans les sauvegardes automatiques.`,
    });
    if (confirm.response !== 1) { try { fs.unlinkSync(candidate); } catch (e) { /* rien */ } return { ok: false }; }
    // 2. Remplacer (une copie des données actuelles est gardée, retour en arrière si échec)
    return replaceDatabase(candidate);
  });

  // Sauvegardes automatiques : au démarrage, toutes les 3 heures et à la fermeture
  backups = createBackups({ dataDir: DATA_DIR, getStore: () => store, nativeBinding: storeOpts.nativeBinding });
  try { backups.start(); } catch (e) { /* non bloquant : l'état signale l'échec */ }

  // Sauvegarde en ligne chiffrée (dès qu'Internet est disponible)
  cloud = createCloud({
    getStore: () => store, fetchImpl: (...a) => net.fetch(...a), workDir: DATA_DIR,
    serverConfig: () => ({ ...(require('../package.json').server || {}), ...(process.env.SIKAGEST_SERVER_URL ? { url: process.env.SIKAGEST_SERVER_URL } : {}) }),
  });
  cloud.start();
  const cloudCall = (fn) => async (_e, args) => {
    try { return { ok: true, data: await fn(args || {}) }; }
    catch (e) { return { ok: false, error: e.message || String(e) }; }
  };
  ipcMain.handle('cloud.status', () => cloud.status());
  ipcMain.handle('cloud.sync', cloudCall(() => cloud.sync({ forceUpload: true })));
  // Récupération avec identifiant + mot de passe
  // Montre ce que contient la copie en ligne et demande confirmation avant de remplacer quoi que ce soit
  const confirmCloud = async (file, chk, backupAt) => {
    const when = backupAt ? new Date(backupAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'inconnue';
    const lastSale = chk.lastSale ? String(chk.lastSale).slice(0, 16).replace('T', ' ') : 'aucune';
    const empty = chk.users === 0 || (chk.sales === 0 && chk.products === 0);
    const res = await dialog.showMessageBox(win, {
      type: empty ? 'warning' : 'question', buttons: ['Annuler', 'Récupérer ces données'], defaultId: empty ? 0 : 1, cancelId: 0,
      title: 'Récupérer mes données en ligne',
      message: empty ? 'Attention : cette sauvegarde en ligne est presque vide.' : 'Voici la sauvegarde trouvée en ligne :',
      detail: `Entreprise : ${chk.shop || '—'}\nSauvegarde du : ${when}\n${chk.sales} vente(s), ${chk.products} produit(s), ${chk.users} utilisateur(s)\nDernière vente : ${lastSale}\n\nLes données actuelles de cet ordinateur seront remplacées (une copie est gardée dans les sauvegardes automatiques).`,
    });
    if (res.response !== 1) { try { fs.unlinkSync(file); } catch (e) { /* rien */ } return false; }
    return true;
  };
  ipcMain.handle('cloud.restore', cloudCall(async (a) => {
    const r = await cloud.restore(a);
    const v = restoreFromFile(r.file);
    if (!v.ok) throw new Error(v.error);
    if (!(await confirmCloud(r.file, v.chk, r.backupAt))) return { cancelled: true };
    const done = replaceDatabase(r.file);
    if (!done.ok) throw new Error(done.error);
    return { shop: r.shop, backupAt: r.backupAt, sales: v.chk.sales, products: v.chk.products };
  }));
  // Mot de passe oublié : code de demande, puis code du vendeur
  ipcMain.handle('cloud.rescueStart', cloudCall((a) => cloud.rescueStart(a)));
  ipcMain.handle('cloud.rescueFinish', cloudCall(async (a) => {
    const r = await cloud.rescueFinish(a);
    const v = restoreFromFile(r.file);
    if (!v.ok) throw new Error(v.error);
    if (!(await confirmCloud(r.file, v.chk, r.backupAt))) return { cancelled: true };
    const done = replaceDatabase(r.file);
    if (!done.ok) throw new Error(done.error);
    return { backupAt: r.backupAt, sales: v.chk.sales, products: v.chk.products, users: store.allowReset() };
  }));

  createWindow();
  ensureDesktopShortcut();
  if (app.isPackaged || process.env.SIKAGEST_REGISTER === '1') {
    register.init(() => store.call('settings.get'), { portable: !!PORTABLE_DIR, licenseFn: () => store.licenseStatus(), onVendor: (v) => store.setVendor(v) });
  }
});

// Au premier lancement, crée le raccourci sur le bureau de l'utilisateur s'il n'existe pas
// (par ex. quand l'installation a été faite avec un autre compte administrateur).
function mergeVendor() {
  const base = { ...(require('../package.json').vendor || {}) };
  const live = store ? store.getVendor() : {};
  for (const [k, v] of Object.entries(live)) if (v) base[k === 'site_url' ? 'site' : k] = v;
  return base;
}

function ensureDesktopShortcut() {
  if (process.platform !== 'win32' || !app.isPackaged || PORTABLE_DIR) return;
  try {
    const marker = path.join(app.getPath('userData'), 'raccourci-bureau.ok');
    if (fs.existsSync(marker)) return;
    const name = 'SikaGest.lnk';
    const userDesk = path.join(app.getPath('desktop'), name);
    const publicDesk = path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop', name);
    if (!fs.existsSync(userDesk) && !fs.existsSync(publicDesk)) {
      const ico = path.join(EXE_DIR, 'SikaGest.ico');
      shell.writeShortcutLink(userDesk, 'create', {
        target: process.execPath, cwd: EXE_DIR, description: 'SikaGest — gestion commerciale',
        ...(fs.existsSync(ico) ? { icon: ico, iconIndex: 0 } : {}),
      });
    }
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, new Date().toISOString());
  } catch (e) { /* non bloquant */ }
}

app.on('window-all-closed', async () => {
  if (backups) { try { backups.onClose(); } catch (e) { /* rien */ } }
  // Dernières modifications envoyées en ligne avant de fermer (15 secondes au plus)
  if (cloud) { try { await cloud.flush(15000); } catch (e) { /* rien */ } }
  if (store) { store.checkpoint(); store.close(); }
  app.quit();
});
