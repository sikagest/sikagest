// SikaGest — sauvegarde en ligne chiffrée
//
// Principe :
// - Les données sont chiffrées sur le PC du client avec une « clé des données » (AES-256-GCM) avant d'être envoyées.
//   Le serveur ne reçoit que des fichiers illisibles.
// - La clé des données est elle-même chiffrée deux fois :
//     1. avec le mot de passe de chaque administrateur (scrypt) : pour se reconnecter sur un nouveau PC ;
//     2. avec la clé publique du vendeur (ECDH P-256) : clé de secours si le client a oublié son mot de passe.
//       Seul le fichier SikaGest-Admin.html du vendeur peut l'ouvrir, et il ne voit jamais les données.
// - Le compte en ligne est identifié par le téléphone de l'entreprise.
'use strict';
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const recovery = require('./recovery');

const MIN_GAP_MIN = 10;        // au plus un envoi toutes les 10 minutes quand des données changent
const SAFETY_EVERY_H = 24;     // et au moins un envoi par jour, même sans changement
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MAGIC = Buffer.from('SKG1');

// ---------- Outils de chiffrement ----------
function normPhone(p) {
  let d = String(p || '').replace(/[^0-9]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 13 && d.startsWith('225')) d = d.slice(3);
  return d.length >= 6 && d.length <= 15 ? d : '';
}
function gcmEncrypt(key, plain, aad, iv = crypto.randomBytes(12)) {
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) c.setAAD(aad);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
function gcmDecrypt(key, buf, aad) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  if (aad) d.setAAD(aad);
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
}
function deriveLogin(password, saltHex) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password).normalize('NFC'), Buffer.from(saltHex, 'hex'), 64, SCRYPT, (err, k) => {
      if (err) return reject(err);
      resolve({ encKey: k.subarray(0, 32), authKey: k.subarray(32).toString('hex') });
    });
  });
}
const vendorKey = () => crypto.createPublicKey(recovery.PUBLIC_KEY);
const rawPub = (keyObj) => {
  const j = keyObj.export({ format: 'jwk' });
  return Buffer.concat([Buffer.from([4]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')]);
};
const pubFromRaw = (raw) => crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33, 65).toString('base64url') }, format: 'jwk' });
const hkdf = (shared, info) => Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.from(info), 32));

// Clé des données chiffrée pour le vendeur : clé éphémère publique (65) + AES-GCM(clé des données)
function vendorWrap(dk) {
  const eph = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const k = hkdf(crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: vendorKey() }), 'SIKAGEST-CLOUD-VENDOR');
  return Buffer.concat([rawPub(eph.publicKey), gcmEncrypt(k, dk)]).toString('base64');
}
function encryptBackup(dk, sqliteBuf) {
  return Buffer.concat([MAGIC, gcmEncrypt(dk, zlib.gzipSync(sqliteBuf, { level: 9 }), MAGIC)]);
}
function decryptBackup(dk, buf) {
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('fichier en ligne non reconnu');
  return zlib.gunzipSync(gcmDecrypt(dk, buf.subarray(4), MAGIC));
}
// Code de demande (mot de passe oublié) : version(1) + compte(16) + clé publique éphémère(65)
function rescueRequestCode(accountId, rPub) {
  const buf = Buffer.concat([Buffer.from([1]), Buffer.from(accountId.replace(/-/g, ''), 'hex'), rawPub(rPub)]);
  return recovery.b32encode(buf).match(/.{1,4}/g).join('-');
}
// Code de réponse du vendeur : AES-GCM(clé ECDH vendeur/éphémère, clé des données), lié au compte
function openRescueAnswer(answer, accountId, rPriv) {
  const raw = recovery.b32decode(answer);
  if (!raw || raw.length !== 48) throw new Error('Code incomplet ou mal copié.');
  const k = hkdf(crypto.diffieHellman({ privateKey: rPriv, publicKey: vendorKey() }), 'SIKAGEST-CLOUD-RESCUE');
  try {
    return gcmDecrypt(k, Buffer.concat([Buffer.alloc(12), raw.subarray(32), raw.subarray(0, 32)]), Buffer.from(accountId));
  } catch (e) { throw new Error('Code incorrect. Vérifiez qu\'il a été copié en entier.'); }
}

// ---------- Module ----------
function createCloud({ getStore, serverConfig, fetchImpl, workDir, now = () => new Date() }) {
  let running = null;
  let timer = null;
  let rescue = null; // demande de secours en cours (en mémoire seulement)
  // Des données ont changé depuis le dernier envoi. Vrai au démarrage : un envoi frais par lancement.
  let dirty = true;
  const markDirty = () => { dirty = true; };

  const get = (k) => getStore().getPrivate(k);
  const set = (k, v) => getStore().setPrivate(k, v);
  const getJson = (k, def) => { try { return JSON.parse(get(k) || '') ?? def; } catch (e) { return def; } };
  const setJson = (k, v) => set(k, JSON.stringify(v));

  async function call(action, body, { binary = null, account = null, secret = null, timeoutMs = 60000 } = {}) {
    const { url, key } = serverConfig();
    if (!url || !key) throw Object.assign(new Error('Serveur non configuré'), { offline: true });
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${url}/functions/v1/cloud`, {
        method: 'POST', signal: ctl.signal,
        headers: { apikey: key, 'x-action': action, 'Content-Type': binary ? 'application/octet-stream' : 'application/json',
          ...(account ? { 'x-account': account, 'x-secret': secret } : {}) },
        body: binary || JSON.stringify(body || {}),
      });
    } catch (e) {
      throw Object.assign(new Error('Pas de connexion Internet. Réessayez quand Internet est disponible.'), { offline: true });
    } finally { clearTimeout(t); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j.error || `Erreur du serveur (${res.status})`), { status: res.status });
    return j;
  }
  async function download(url) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10 * 60000);
    try {
      const r = await fetchImpl(url, { signal: ctl.signal });
      if (!r.ok) throw new Error(`téléchargement impossible (${r.status})`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      throw Object.assign(new Error(e.name === 'AbortError' || /fetch|network/i.test(e.message) ? 'Pas de connexion Internet. Réessayez quand Internet est disponible.' : e.message), { offline: true });
    } finally { clearTimeout(t); }
  }
  const setError = (code, message) => { set('cloud_error', code ? JSON.stringify({ code, message, at: now().toISOString() }) : ''); };

  // Appelé à chaque connexion / changement de mot de passe d'un administrateur
  async function onAdminPassword(username, password) {
    username = String(username || '').trim().toLowerCase();
    if (!username || !password) return;
    const logins = getJson('cloud_logins', {});
    const known = logins[username];
    if (known) {
      const { authKey } = await deriveLogin(password, known.salt);
      if (sha(authKey) === known.fp && known.synced) return;
    }
    if (!get('cloud_dk')) {
      set('cloud_dk', crypto.randomBytes(32).toString('hex'));
      set('cloud_secret', crypto.randomBytes(32).toString('hex'));
      set('cloud_vendor_wrap', vendorWrap(Buffer.from(get('cloud_dk'), 'hex')));
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const { encKey, authKey } = await deriveLogin(password, salt);
    const login = { username, salt, auth_key: authKey, pw_wrap: gcmEncrypt(encKey, Buffer.from(get('cloud_dk'), 'hex')).toString('base64') };
    const pending = getJson('cloud_pending_logins', {});
    pending[username] = login;
    setJson('cloud_pending_logins', pending);
    logins[username] = { salt, fp: sha(authKey), synced: false };
    setJson('cloud_logins', logins);
    sync().catch(() => {});
  }
  const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

  function markSynced(username) {
    const pending = getJson('cloud_pending_logins', {});
    delete pending[username];
    setJson('cloud_pending_logins', pending);
    const logins = getJson('cloud_logins', {});
    if (logins[username]) { logins[username].synced = true; setJson('cloud_logins', logins); }
  }

  async function doSync({ forceUpload = false } = {}) {
    if (!get('cloud_dk')) return status();
    const settings = getStore().call('settings.get');
    const phone = normPhone(settings.company_phone);
    if (!phone) { setError('no_phone', 'Ajoutez le téléphone de l\'entreprise dans Paramètres pour activer la sauvegarde en ligne.'); return status(); }
    const secret = get('cloud_secret');
    try {
      // 1. Création du compte en ligne
      if (!get('cloud_account')) {
        const pending = getJson('cloud_pending_logins', {});
        const first = Object.values(pending)[0];
        if (!first) return status();
        const r = await call('create', { ...first, phone, shop: settings.company_name || '', install_id: settings.install_id, secret, vendor_wrap: get('cloud_vendor_wrap') });
        set('cloud_account', r.account_id);
        set('cloud_phone', r.phone);
        markSynced(first.username);
      }
      const account = get('cloud_account');
      // 2. Identifiants en attente (nouveau mot de passe, autre administrateur)
      for (const login of Object.values(getJson('cloud_pending_logins', {}))) {
        await call('login_set', { ...login, account_id: account, secret });
        markSynced(login.username);
      }
      // 3. Téléphone ou nom de boutique modifiés
      if (get('cloud_phone') !== phone || get('cloud_shop') !== (settings.company_name || '')) {
        const r = await call('update', { account_id: account, secret, phone, shop: settings.company_name || '', install_id: settings.install_id });
        set('cloud_phone', r.phone);
        set('cloud_shop', settings.company_name || '');
      }
      // 4. Envoi de la sauvegarde chiffrée : toujours une copie FRAÎCHE de la base, jamais une ancienne copie
      const last = get('cloud_last_upload');
      const age = last ? now() - new Date(last) : Infinity;
      if (forceUpload || (dirty && age >= MIN_GAP_MIN * 60000) || age >= SAFETY_EVERY_H * 3600 * 1000) {
        dirty = false; // les modifications faites pendant l'envoi seront envoyées la prochaine fois
        const tmp = path.join(workDir, `envoi-en-ligne-${process.pid}.tmp`);
        let plain;
        try { getStore().snapshot(tmp); plain = fs.readFileSync(tmp); }
        finally { try { fs.unlinkSync(tmp); } catch (e) { /* absent */ } }
        const blob = encryptBackup(Buffer.from(get('cloud_dk'), 'hex'), plain);
        try {
          await call('put', null, { binary: blob, account, secret, timeoutMs: 10 * 60000 });
        } catch (e) { dirty = true; throw e; }
        set('cloud_last_upload', now().toISOString());
        set('cloud_last_size', String(blob.length));
        dirty = false; // l'écriture de la date ci-dessus n'est pas une modification à envoyer
      }
      setError(null);
    } catch (e) {
      if (e.offline) set('cloud_offline_since', get('cloud_offline_since') || now().toISOString());
      else if (e.message === 'PHONE_TAKEN') setError('phone_taken', 'Ce numéro de téléphone est déjà utilisé par un autre compte SikaGest en ligne. Si ce sont vos anciennes données, utilisez « Récupérer mes données en ligne ». Sinon, contactez le support.');
      else setError('server', e.message);
      return status();
    }
    set('cloud_offline_since', '');
    return status();
  }
  function sync(opts) {
    if (!running) running = doSync(opts).finally(() => { running = null; });
    return running;
  }

  function status() {
    let err = null;
    try { err = JSON.parse(get('cloud_error') || 'null'); } catch (e) { err = null; }
    const pending = Object.keys(getJson('cloud_pending_logins', {}));
    return {
      enabled: !!get('cloud_dk'), active: !!get('cloud_account'), phone: get('cloud_phone') || null, unsent: dirty,
      lastUpload: get('cloud_last_upload') || null, offlineSince: get('cloud_offline_since') || null,
      error: err, pendingLogins: pending.length,
    };
  }

  // ---------- Récupération sur un nouveau PC ----------
  async function decryptToFile(dk, url) {
    const plain = decryptBackup(dk, await download(url));
    const out = path.join(workDir, `recuperation-en-ligne-${process.pid}.sikagest`);
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(out, plain);
    return out;
  }
  async function restore({ phone, username, password }) {
    const p = normPhone(phone);
    if (!p) throw new Error('Numéro de téléphone invalide.');
    const { salt } = await call('salt', { phone: p, username });
    const { encKey, authKey } = await deriveLogin(password, salt);
    const r = await call('fetch', { phone: p, username, auth_key: authKey });
    let dk;
    try { dk = gcmDecrypt(encKey, Buffer.from(r.pw_wrap, 'base64')); } catch (e) { throw new Error('Identifiant ou mot de passe incorrect.'); }
    return { file: await decryptToFile(dk, r.url), shop: r.shop, backupAt: r.backup_at };
  }
  async function rescueStart({ phone }) {
    const p = normPhone(phone);
    if (!p) throw new Error('Numéro de téléphone invalide.');
    const info = await call('rescue_info', { phone: p });
    const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    rescue = { phone: p, accountId: info.account_id, priv: kp.privateKey };
    return { code: rescueRequestCode(info.account_id, kp.publicKey), shop: info.shop, backupAt: info.backup_at };
  }
  async function rescueFinish({ code }) {
    if (!rescue) throw new Error('Aucune demande en cours. Recommencez depuis le début.');
    const dk = openRescueAnswer(code, rescue.accountId, rescue.priv);
    const r = await call('rescue_fetch', { phone: rescue.phone, account_id: rescue.accountId });
    const file = await decryptToFile(dk, r.url);
    rescue = null;
    return { file, backupAt: r.backup_at };
  }

  function start() {
    setTimeout(() => sync().catch(() => {}), 20000);
    timer = setInterval(() => sync().catch(() => {}), 2 * 60 * 1000);
    if (timer.unref) timer.unref();
  }
  // À la fermeture : envoie les dernières modifications (attend au plus « maxMs »)
  function flush(maxMs = 15000) {
    if (!dirty || !get('cloud_account')) return Promise.resolve();
    return Promise.race([sync({ forceUpload: true }).catch(() => {}), new Promise((r) => setTimeout(r, maxMs))]);
  }

  return { start, sync, status, onAdminPassword, restore, rescueStart, rescueFinish, markDirty, flush, isDirty: () => dirty };
}

module.exports = { createCloud, normPhone, deriveLogin, gcmEncrypt, gcmDecrypt, vendorWrap, encryptBackup, decryptBackup, rescueRequestCode, openRescueAnswer, rawPub, pubFromRaw, hkdf };
