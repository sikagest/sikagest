/* SikaGest — noyau de l'interface */
'use strict';

// ---------- Accès aux données ----------
const API = {
  async call(method, args) {
    if (window.sika) return window.sika.call(method, args);
    // Mode navigateur (aperçu / tests) : serveur de développement
    const r = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    return j.data;
  },
};

const S = { user: null, settings: {}, info: { version: '1.0.0', portable: false, vendor: {} }, update: null, lowStock: 0, license: null, backup: null, backupSnooze: false };

// ---------- Utilitaires ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const money = (v) => `${nf.format(Math.round(Number(v) || 0))} ${S.settings.currency || 'FCFA'}`;
const qtyf = (v) => nf2.format(Number(v) || 0);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fdate = (s, withTime = true) => {
  if (!s) return '';
  const [d, t] = String(s).split(' ');
  const [y, m, j] = d.split('-');
  return `${j}/${m}/${y}${withTime && t ? ' ' + t.slice(0, 5) : ''}`;
};
const isAdmin = () => S.user && S.user.role === 'admin';
const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function statusTag(doc) {
  if (doc.cancelled) return '<span class="tag mute">Annulée</span>';
  if (doc.status === 'payee') return '<span class="tag ok">Payée</span>';
  if (doc.status === 'partielle') return '<span class="tag warn">Partielle</span>';
  return '<span class="tag bad">Impayée</span>';
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'err' ? 5000 : 2800);
}
async function run(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg, 'ok'); return r; }
  catch (e) {
    const m = e.message || String(e);
    if (m.startsWith('LICENCE:')) licenseModal(m.slice(8).trim()); else toast(m, 'err');
    throw e;
  }
}

// ---------- Icônes (traits simples) ----------
const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
  pos: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  sale: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  purchase: '<path d="M3 4h2l2.4 11h11.2L21 7H7"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="18" cy="19.5" r="1.5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  stock: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.7-3.6 3.3-5.5 6.5-5.5s5.8 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.8 3 2.5 3.5 5.2"/>',
  contacts: '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M7.5 17.5c.8-2 2.4-3 4.5-3s3.7 1 4.5 3"/>',
  expense: '<rect x="2.5" y="6" width="19" height="13" rx="2"/><path d="M2.5 10h19M7 15h3"/>',
  report: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12 20 3M17 6l3 3M14 9l2 2"/>',
  whatsapp: '<path d="M3 21l1.6-4.6A8.5 8.5 0 1 1 8 19.7z"/><path d="M9 9.5c.3 2 2.2 4.2 4.6 4.8l1.2-1.2 2 1-.4 1.6c-3.6.4-7.6-3.4-7.4-7l1.6-.4 1 2z"/>',
  wallet: '<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7l12-4v4M16 13.5h2"/>',
};
const icon = (n, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;

// ---------- Modales ----------
function modal({ title, body, foot = '', wide = false, onMount }) {
  const root = $('#modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'overlay';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog">
    <div class="modal-h"><h2>${esc(title)}</h2><button class="close-x" data-close aria-label="Fermer">×</button></div>
    <div class="modal-b">${body}</div>${foot ? `<div class="modal-f">${foot}</div>` : ''}</div>`;
  root.appendChild(wrap);
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape' && root.lastElementChild === wrap) close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  $$('[data-close]', wrap).forEach((b) => b.addEventListener('click', close));
  const m = { el: wrap, close };
  if (onMount) onMount(wrap, close);
  const first = $('input:not([type=hidden]), select, textarea', wrap);
  if (first) setTimeout(() => first.focus(), 30);
  return m;
}
function confirmBox(message, okLabel = 'Confirmer', danger = true) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title: 'Confirmation', body: `<p style="margin:0">${esc(message)}</p>`,
      foot: `<button class="btn" data-close>Annuler</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button>`,
      onMount: (el, close) => {
        $('[data-ok]', el).addEventListener('click', () => { done = true; close(); resolve(true); });
        new MutationObserver((_, obs) => { if (!el.isConnected) { obs.disconnect(); if (!done) resolve(false); } }).observe($('#modal-root'), { childList: true });
      },
    });
  });
}
function formData(root) {
  const o = {};
  $$('[name]', root).forEach((el) => {
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'number') o[el.name] = el.value === '' ? '' : Number(el.value);
    else o[el.name] = el.value;
  });
  return o;
}

// ---------- Navigation ----------
const NAV = [
  { group: 'Principal' },
  { id: 'dashboard', label: 'Tableau de bord', icon: 'home' },
  { id: 'pos', label: 'Caisse (POS)', icon: 'pos' },
  { group: 'Commercial' },
  { id: 'sales', label: 'Ventes', icon: 'sale' },
  { id: 'purchases', label: 'Achats', icon: 'purchase' },
  { id: 'contacts', label: 'Clients & fournisseurs', icon: 'contacts' },
  { group: 'Stock' },
  { id: 'products', label: 'Produits', icon: 'box', badge: () => S.lowStock },
  { id: 'stock', label: 'Mouvements de stock', icon: 'stock' },
  { group: 'Gestion' },
  { id: 'expenses', label: 'Dépenses', icon: 'expense' },
  { id: 'reports', label: 'Rapports', icon: 'report' },
  { id: 'users', label: 'Utilisateurs', icon: 'users', admin: true },
  { id: 'license', label: 'Licence', icon: 'key', badge: () => (S.license && S.license.state === 'expired' ? '!' : 0) },
  { id: 'settings', label: 'Paramètres', icon: 'settings' },
];
const VIEWS = {}; // rempli par views.js

function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [id, ...rest] = h.split('/');
  return { id: id || 'dashboard', params: rest };
}
function go(id) { location.hash = `#/${id}`; }

function renderShell() {
  const { id } = currentRoute();
  const initials = (S.user.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  $('#app').innerHTML = `
  <div class="shell">
    <aside class="side">
      <div class="brand"><div class="brand-mark">S</div><div><div class="brand-name">SikaGest</div><div class="brand-sub">${esc(S.settings.company_name)}</div></div></div>
      <nav class="nav">${NAV.filter((n) => !n.admin || isAdmin()).map((n) => n.group ? `<div class="nav-group">${n.group}</div>` :
        `<a href="#/${n.id}" class="${n.id === id ? 'active' : ''}">${icon(n.icon)}<span>${n.label}</span>${n.badge && n.badge() ? `<span class="badge">${n.badge()}</span>` : ''}</a>`).join('')}</nav>
      <div class="side-foot"><div class="avatar">${esc(initials)}</div>
        <div class="who"><b>${esc(S.user.name)}</b><span>${S.user.role === 'admin' ? 'Administrateur' : 'Vendeur'}</span></div>
        <button class="icon-btn" id="logout" title="Se déconnecter">${icon('logout')}</button></div>
    </aside>
    <main class="main">
      <header class="topbar"><h1 id="page-title"></h1><span class="crumb" id="page-crumb"></span><div class="spacer"></div>
        <span id="update-slot"></span><div id="page-actions" class="toolbar" style="margin:0"></div></header>
      <div id="lic-banner"></div>
      <div id="bk-banner"></div>
      <section class="content" id="content"></section>
    </main>
  </div>`;
  $('#logout').addEventListener('click', async () => { await API.call('auth.logout'); S.user = null; boot(); });
  renderUpdatePill();
}

function setPage(title, crumb = '', actions = '') {
  $('#page-title').textContent = title;
  $('#page-crumb').textContent = crumb;
  $('#page-actions').innerHTML = actions;
  document.title = `${title} — SikaGest`;
}

async function refreshLowStock() {
  try { S.lowStock = (await API.call('reports.summary', { from: today(), to: today() })).lowStock; } catch (e) { S.lowStock = 0; }
}

async function route() {
  if (!S.user) return;
  const { id, params } = currentRoute();
  const view = VIEWS[id] || VIEWS.dashboard;
  if (NAV.find((n) => n.id === id && n.admin) && !isAdmin()) return go('dashboard');
  await refreshLowStock();
  try { S.license = await API.call('license.status'); } catch (e) { S.license = null; }
  if (window.sika) { try { S.info = await window.sika.info(); } catch (e) { /* rien */ } }
  $('#modal-root').innerHTML = '';
  if (window.sika && window.sika.backupStatus) { try { S.backup = await window.sika.backupStatus(); } catch (e) { S.backup = null; } }
  if (window.sika && window.sika.cloudStatus) { try { S.cloud = await window.sika.cloudStatus(); } catch (e) { S.cloud = null; } }
  renderShell();
  renderLicenseBanner();
  renderBackupBanner();
  const c = $('#content');
  c.innerHTML = '';
  c.style.padding = id === 'pos' ? '16px 20px 20px' : '';
  try { await view(c, params); } catch (e) { c.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', route);

// ---------- Licence ----------
const vendor = () => S.info.vendor || {};
const fdays = (n) => `${n} jour${Math.abs(n) > 1 ? 's' : ''}`;
function waUrl(text) {
  let n = String(vendor().whatsapp || '').replace(/[^0-9]/g, '');
  if (!n) return null;
  if (n.length === 10) n = '225' + n;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
function licenseRequestText() {
  const L = S.license || {};
  return `Bonjour, je souhaite activer SikaGest.\nEntreprise : ${S.settings.company_name || ''}\nTéléphone : ${S.settings.company_phone || ''}\nCode d'installation : ${L.installCode || ''}\nFormule souhaitée : `;
}
function renderLicenseBanner() {
  const el = $('#lic-banner');
  const L = S.license;
  if (!el || !L) return;
  let html = '';
  if (L.state === 'expired') {
    html = `<div class="lic-bar bad">${icon('alert')}<span><b>${L.reason === 'licence' ? 'Votre licence a expiré' : 'Votre essai gratuit est terminé'}.</b> Vous pouvez consulter vos données, mais plus enregistrer de ventes ni d'achats.</span><a class="btn sm primary" href="#/license">Activer SikaGest</a></div>`;
  } else if (L.state === 'trial') {
    html = `<div class="lic-bar ${L.daysLeft <= 3 ? 'warn' : 'info'}">${icon('key')}<span>${L.plan === 'Essai gratuit' ? 'Essai gratuit' : esc(L.plan)} : <b>${L.daysLeft === 0 ? 'dernier jour' : fdays(L.daysLeft) + ' restant' + (L.daysLeft > 1 ? 's' : '')}</b>.</span><a class="btn sm" href="#/license">Acheter une licence</a></div>`;
  } else if (L.state === 'active' && !L.lifetime && L.daysLeft <= 7) {
    html = `<div class="lic-bar warn">${icon('key')}<span>Votre licence ${esc(L.plan)} expire dans <b>${fdays(L.daysLeft)}</b>.</span><a class="btn sm" href="#/license">Renouveler</a></div>`;
  }
  el.innerHTML = html;
}
// ---------- Sauvegardes : rappel et alertes ----------
function backupAgo(iso) {
  if (!iso) return 'jamais';
  const d = Math.floor((Date.now() - new Date(iso)) / 86400000);
  if (d <= 0) return `aujourd'hui à ${new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  return d === 1 ? 'hier' : `il y a ${fdays(d)}`;
}
async function exportBackup() {
  if (!window.sika) return toast('Disponible dans le logiciel installé', 'err');
  const r = await window.sika.backupExport();
  if (r.ok) { toast('Sauvegarde créée et vérifiée. Gardez ce support hors de la boutique.', 'ok'); S.backupSnooze = false; route(); }
  else if (r.error) toast(r.error, 'err');
}
function renderBackupBanner() {
  const el = $('#bk-banner');
  const b = S.backup;
  if (!el || !b) return;
  let html = '';
  if (!b.dbHealthy) {
    html = `<div class="lic-bar bad">${icon('alert')}<span><b>Un problème a été détecté dans vos données.</b> Les sauvegardes automatiques sont arrêtées pour protéger les bonnes copies. Contactez le support SikaGest.</span></div>`;
  } else if (b.lastError) {
    html = `<div class="lic-bar bad">${icon('alert')}<span><b>La sauvegarde automatique a échoué</b> (${esc(b.lastError)}). Faites une copie sur une clé USB dès maintenant.</span><button class="btn sm primary" data-bk-exp>Créer une sauvegarde</button></div>`;
  } else if (isAdmin() && !S.backupSnooze && b.daysSinceExternal >= 7) {
    html = `<div class="lic-bar warn">${icon('alert')}<span>Dernière copie sur clé USB : <b>${b.lastExternal ? backupAgo(b.lastExternal) : 'jamais'}</b>. Si l'ordinateur tombe en panne ou est volé, une copie hors du PC est le seul moyen de retrouver vos ventes.</span><button class="btn sm primary" data-bk-exp>Sauvegarder maintenant</button><button class="btn sm ghost" data-bk-later>Plus tard</button></div>`;
  }
  el.innerHTML = html;
  const exp = $('[data-bk-exp]', el);
  if (exp) exp.addEventListener('click', exportBackup);
  const later = $('[data-bk-later]', el);
  if (later) later.addEventListener('click', () => { S.backupSnooze = true; el.innerHTML = ''; });
}

function licenseModal(message) {
  const wa = waUrl(licenseRequestText());
  modal({
    title: 'Activation nécessaire',
    body: `<p style="margin-top:0">${esc(message)}</p><p style="color:var(--ink-2)">Votre code d'installation : <b style="font-family:ui-monospace,Consolas,monospace">${esc((S.license || {}).installCode || '')}</b></p>`,
    foot: `<button class="btn" data-close>Fermer</button>${wa ? `<a class="btn" href="${wa}" target="_blank" rel="noopener">${icon('whatsapp')} Acheter par WhatsApp</a>` : ''}<a class="btn primary" href="#/license" data-close>J'ai une clé d'activation</a>`,
  });
}

// ---------- Mises à jour ----------
function renderUpdatePill() {
  const slot = $('#update-slot');
  if (!slot) return;
  const u = S.update;
  if (!u) { slot.innerHTML = ''; return; }
  if (u.state === 'downloading') slot.innerHTML = `<span class="update-pill">Téléchargement de la mise à jour ${u.version || ''}… ${u.percent || 0} %</span>`;
  else if (u.state === 'downloaded') slot.innerHTML = `<button class="update-pill ready" id="upd-go">Mise à jour ${esc(u.version)} prête — redémarrer</button>`;
  else if (u.state === 'available-portable') slot.innerHTML = `<button class="update-pill ready" id="upd-go">Nouvelle version ${esc(u.version)} disponible</button>`;
  else slot.innerHTML = '';
  const b = $('#upd-go');
  if (b) b.addEventListener('click', () => window.sika && window.sika.installUpdate());
}

// ---------- Connexion / premier lancement ----------
function authLayout(inner) {
  $('#app').innerHTML = `<div class="auth">
    <div class="auth-art"><div class="brand" style="padding:0"><div class="brand-mark">S</div><div class="brand-name" style="font-size:20px">SikaGest</div></div>
      <div><h2>Gérez votre commerce <em>comme un pro.</em></h2>
      <p>Caisse, ventes, achats, stock, clients et rapports : tout au même endroit, même sans connexion Internet.</p></div>
      <div style="color:var(--side-ink-2);font-size:12.5px">Version ${esc(S.info.version)}${S.info.portable ? ' · portable' : ''}</div><div class="rings"></div></div>
    <div class="auth-form"><form class="auth-box" id="auth-form" autocomplete="off">${inner}</form></div></div>`;
}
const ACTIVITIES = ['Boutique / alimentation', 'Supermarché', 'Pharmacie', 'Quincaillerie', 'Restaurant / maquis', 'Boulangerie', 'Cosmétiques', 'Vêtements / mode', 'Téléphonie / électronique', 'Pièces auto / moto', 'Librairie / papeterie', 'Grossiste / distribution', 'Autre'];
const activityOptions = (sel = '') => `<option value="">— Choisir —</option>` + ACTIVITIES.map((a) => `<option ${a === sel ? 'selected' : ''}>${a}</option>`).join('');
const PRIVACY_NOTE = 'Ces coordonnées sont transmises à votre fournisseur SikaGest uniquement pour vous assister. Vos ventes, produits et clients sont sauvegardés en ligne sous forme chiffrée : ni votre fournisseur ni personne d\'autre ne peut les lire.';

function showSetup() {
  authLayout(`<h1>Bienvenue 👋</h1><p class="hint">Présentez votre entreprise et créez le compte administrateur.</p>
    <div class="field"><label>Nom de votre entreprise *</label><input class="input" name="company_name" placeholder="Ex. : Boutique Awa" required></div>
    <div class="grid-form"><div class="field"><label>Votre nom *</label><input class="input" name="name" required></div>
    <div class="field"><label>Téléphone / WhatsApp *</label><input class="input" name="company_phone" placeholder="07 07 00 00 00" required></div>
    <div class="field"><label>Ville *</label><input class="input" name="company_city" placeholder="Ex. : Abidjan" required></div>
    <div class="field"><label>Quartier / commune</label><input class="input" name="company_district" placeholder="Ex. : Cocody"></div>
    <div class="field"><label>Activité</label><select class="input" name="company_activity">${activityOptions()}</select></div>
    <div class="field"><label>E-mail (facultatif)</label><input class="input" type="email" name="company_email"></div>
    <div class="field"><label>Identifiant de connexion *</label><input class="input" name="username" value="admin" required></div>
    <div class="field"><label>Mot de passe * (4 caractères min.)</label><input class="input" type="password" name="password" required></div></div>
    <p class="hint" style="margin:0;font-size:12.5px">${PRIVACY_NOTE}</p>
    <div id="auth-err"></div><button class="btn primary lg" type="submit">Créer et commencer</button>
    ${window.sika && window.sika.cloudRestore ? '<div class="cloud-link">Vous utilisiez déjà SikaGest sur un autre ordinateur ? <button class="btn ghost" type="button" id="has-account">Récupérer mes données</button></div>' : ''}`);
  $('.auth-box').style.width = 'min(560px, 100%)';
  if ($('#has-account')) $('#has-account').addEventListener('click', () => cloudRestoreModal());
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { S.user = await API.call('auth.setup', formData(e.target)); if (window.sika) window.sika.syncNow(); start(); }
    catch (err) { $('#auth-err').innerHTML = `<div class="err-box">${esc(err.message)}</div>`; }
  });
}

// Pour les installations existantes : compléter les coordonnées une fois
function askProfile() {
  const st = S.settings;
  if (!isAdmin() || (st.company_phone && st.company_city)) return;
  try { if (sessionStorage.getItem('profile-later')) return; } catch (e) { /* rien */ }
  modal({
    title: 'Complétez vos coordonnées',
    body: `<p style="margin-top:0;color:var(--ink-2)">Pour que votre fournisseur puisse vous aider rapidement en cas de besoin.</p>
      <div class="grid-form"><div class="field"><label>Entreprise *</label><input class="input" name="company_name" value="${esc(st.company_name)}"></div>
      <div class="field"><label>Votre nom *</label><input class="input" name="owner_name" value="${esc(st.owner_name || S.user.name)}"></div>
      <div class="field"><label>Téléphone / WhatsApp *</label><input class="input" name="company_phone" value="${esc(st.company_phone)}"></div>
      <div class="field"><label>Ville *</label><input class="input" name="company_city" value="${esc(st.company_city)}"></div>
      <div class="field"><label>Quartier / commune</label><input class="input" name="company_district" value="${esc(st.company_district)}"></div>
      <div class="field"><label>Activité</label><select class="input" name="company_activity">${activityOptions(st.company_activity)}</select></div></div>
      <p style="color:var(--ink-3);font-size:12.5px;margin-bottom:0">${PRIVACY_NOTE}</p>`,
    foot: '<button class="btn" data-close id="pf-later">Plus tard</button><button class="btn primary" id="pf-save">Enregistrer</button>',
    onMount: (el, close) => {
      $('#pf-later', el).addEventListener('click', () => { try { sessionStorage.setItem('profile-later', '1'); } catch (e) { /* rien */ } });
      $('#pf-save', el).addEventListener('click', async () => {
        const f = formData(el);
        if (!f.company_name.trim() || !f.company_phone.trim() || !f.company_city.trim()) return toast('Entreprise, téléphone et ville sont obligatoires.', 'err');
        S.settings = await run(() => API.call('settings.save', f), 'Coordonnées enregistrées');
        if (window.sika) window.sika.syncNow();
        close(); route();
      });
    },
  });
}

function showLogin() {
  authLayout(`<h1>Connexion</h1><p class="hint">${esc(S.settings.company_name)}</p>
    <div class="field"><label>Identifiant</label><input class="input" name="username" required></div>
    <div class="field"><label>Mot de passe</label><input class="input" type="password" name="password" required></div>
    <div id="auth-err"></div><button class="btn primary lg" type="submit">Se connecter</button>
    <button class="btn ghost" type="button" id="forgot">Mot de passe oublié ?</button>`);
  $('#forgot').addEventListener('click', showRecovery);
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { S.user = await API.call('auth.login', formData(e.target)); start(); }
    catch (err) { $('#auth-err').innerHTML = `<div class="err-box">${esc(err.message)}</div>`; }
  });
}
// ---------- Mot de passe oublié ----------
async function showRecovery() {
  let req;
  try { req = await API.call('recovery.request'); } catch (e) { return toast(e.message, 'err'); }
  const msg = `Bonjour, j'ai perdu l'accès à SikaGest (${req.company}). Code de demande : ${req.code}`;
  modal({
    title: 'Mot de passe oublié',
    body: `<ol style="margin:0 0 14px;padding-left:20px;color:var(--ink-2)">
        <li>Envoyez ce <b>code de demande</b> à votre fournisseur SikaGest (WhatsApp, SMS, appel).</li>
        <li>Il vous renvoie un <b>code de déblocage</b>.</li><li>Collez-le ci-dessous, puis choisissez un nouveau mot de passe.</li></ol>
      <div class="field"><label>Code de demande</label>
        <div style="display:flex;gap:8px"><input class="input" id="rq" value="${esc(req.code)}" readonly style="flex:1;font:600 16px/1 ui-monospace,Consolas,monospace;letter-spacing:1px">
        <button class="btn" id="rq-copy">Copier</button></div></div>
      <div class="field" style="margin-top:14px"><label>Code de déblocage</label>
        <textarea class="input" id="ul" rows="3" placeholder="Collez ici le code reçu" style="font-family:ui-monospace,Consolas,monospace;resize:vertical"></textarea></div>
      <div id="rc-err" style="margin-top:10px"></div>`,
    foot: '<button class="btn" data-close>Fermer</button><button class="btn primary" id="ul-ok">Débloquer</button>',
    onMount: (el, close) => {
      $('#rq-copy', el).addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(msg); toast('Code copié. Collez-le dans WhatsApp ou un SMS.', 'ok'); }
        catch (e) { $('#rq', el).select(); document.execCommand('copy'); toast('Code copié', 'ok'); }
      });
      $('#ul-ok', el).addEventListener('click', async () => {
        let users;
        try { users = await API.call('recovery.unlock', { code: $('#ul', el).value }); }
        catch (e) { $('#rc-err', el).innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
        close();
        newPasswordModal(users);
      });
    },
  });
}

// Choix d'un nouveau mot de passe après un déblocage validé par le fournisseur
function newPasswordModal(users, intro = '<b>Déblocage réussi.</b> Choisissez le compte et son nouveau mot de passe.') {
  modal({
    title: 'Nouveau mot de passe',
    body: `<p style="margin-top:0;color:var(--ok)">${intro}</p>
      <div class="grid-form"><div class="field full"><label>Compte</label><select class="input" id="ru">${users.map((u) => `<option value="${u.id}">${esc(u.name)} — ${esc(u.username)} (${u.role === 'admin' ? 'Administrateur' : 'Vendeur'}${u.active ? '' : ', désactivé'})</option>`).join('')}</select></div>
      <div class="field"><label>Nouveau mot de passe</label><input class="input" type="password" id="rp1"></div>
      <div class="field"><label>Confirmer</label><input class="input" type="password" id="rp2"></div></div><div id="rc2-err" style="margin-top:10px"></div>`,
    foot: '<button class="btn primary" id="rp-ok">Enregistrer</button>',
    onMount: (el2, close2) => $('#rp-ok', el2).addEventListener('click', async () => {
      if ($('#rp1', el2).value !== $('#rp2', el2).value) { $('#rc2-err', el2).innerHTML = '<div class="err-box">Les deux mots de passe ne sont pas identiques.</div>'; return; }
      try {
        const r = await API.call('recovery.reset', { user_id: Number($('#ru', el2).value), password: $('#rp1', el2).value });
        close2(); toast(`Mot de passe changé. Connectez-vous avec « ${r.username} ».`, 'ok');
        const f = $('[name=username]'); if (f) f.value = r.username;
      } catch (e) { $('#rc2-err', el2).innerHTML = `<div class="err-box">${esc(e.message)}</div>`; }
    }),
  });
}

// ---------- Sauvegarde en ligne : récupérer ses données sur un nouvel ordinateur ----------
const cloudErr = (el, m) => { $('[data-err]', el).innerHTML = m ? `<div class="err-box">${esc(m)}</div>` : ''; };
const busy = (btn, on, label) => { btn.disabled = on; if (label) btn.textContent = label; };
const sinceText = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'inconnue');
async function afterCloudRestore(r, message) {
  toast(message || `Données récupérées : ${r.sales} vente(s), ${r.products} produit(s).`, 'ok');
  S.user = null; S.backup = null;
  await boot();
}
function cloudRestoreModal({ replacing = false, phone = '' } = {}) {
  modal({
    title: 'Récupérer mes données en ligne',
    body: `<p style="margin-top:0;color:var(--ink-2)">Entrez le <b>téléphone de l'entreprise</b> et l'<b>identifiant / mot de passe d'un administrateur</b>, comme sur votre ancien ordinateur. Internet est nécessaire.</p>
      ${replacing ? '<div class="err-box" style="margin-bottom:12px">Les données actuelles de cet ordinateur seront remplacées par celles en ligne. Une copie des données actuelles est gardée dans les sauvegardes automatiques.</div>' : ''}
      <div class="grid-form"><div class="field full"><label>Téléphone de l'entreprise</label><input class="input" id="cr-phone" value="${esc(phone)}" placeholder="07 07 00 00 00"></div>
      <div class="field"><label>Identifiant</label><input class="input" id="cr-user" value="admin"></div>
      <div class="field"><label>Mot de passe</label><input class="input" type="password" id="cr-pw"></div></div>
      <div data-err style="margin-top:10px"></div>`,
    foot: '<button class="btn ghost" id="cr-forgot">Mot de passe oublié ?</button><span style="flex:1"></span><button class="btn" data-close>Annuler</button><button class="btn primary" id="cr-ok">Récupérer mes données</button>',
    onMount: (el, close) => {
      $('#cr-forgot', el).addEventListener('click', () => { const p = $('#cr-phone', el).value; close(); cloudRescueModal(p); });
      const go = async () => {
        const btn = $('#cr-ok', el); cloudErr(el, '');
        busy(btn, true, 'Récupération en cours…');
        const r = await window.sika.cloudRestore({ phone: $('#cr-phone', el).value, username: $('#cr-user', el).value, password: $('#cr-pw', el).value });
        if (!r.ok) { busy(btn, false, 'Récupérer mes données'); return cloudErr(el, r.error); }
        if (r.data.cancelled) { busy(btn, false, 'Récupérer mes données'); return cloudErr(el, 'Récupération annulée : vos données actuelles n\'ont pas été modifiées.'); }
        close();
        await afterCloudRestore(r.data, `Bienvenue ${r.data.shop || ''} ! ${r.data.sales} vente(s) et ${r.data.products} produit(s) récupérés. Connectez-vous avec votre identifiant habituel.`);
      };
      $('#cr-ok', el).addEventListener('click', go);
      $('#cr-pw', el).addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    },
  });
}
// Mot de passe oublié ET nouvel ordinateur : le fournisseur débloque la sauvegarde avec sa clé de secours
function cloudRescueModal(phone = '') {
  modal({
    title: 'Mot de passe oublié',
    body: `<p style="margin-top:0;color:var(--ink-2)">Votre fournisseur SikaGest peut débloquer votre sauvegarde en ligne. Il ne voit jamais vos ventes.</p>
      <div class="field"><label>Téléphone de l'entreprise</label><div style="display:flex;gap:8px"><input class="input" id="rs-phone" value="${esc(phone)}" style="flex:1"><button class="btn primary" id="rs-start">Obtenir mon code de demande</button></div></div>
      <div id="rs-step2" hidden>
        <ol style="margin:14px 0;padding-left:20px;color:var(--ink-2)"><li>Envoyez ce <b>code de demande</b> à votre fournisseur, <b>depuis le numéro de l'entreprise</b>.</li><li>Il vous renvoie un <b>code de secours</b> : collez-le ci-dessous.</li></ol>
        <div class="field"><label>Code de demande</label><textarea class="input" id="rs-req" rows="3" readonly style="font:600 14px/1.4 ui-monospace,Consolas,monospace;resize:none"></textarea>
          <div style="display:flex;gap:8px;margin-top:8px"><button class="btn" id="rs-copy">Copier</button><a class="btn" id="rs-wa" target="_blank" rel="noopener" hidden>Envoyer par WhatsApp</a></div></div>
        <div class="field" style="margin-top:14px"><label>Code de secours reçu</label><textarea class="input" id="rs-ans" rows="2" placeholder="Collez ici le code reçu" style="font-family:ui-monospace,Consolas,monospace;resize:vertical"></textarea></div>
      </div>
      <p class="hint" id="rs-info" style="margin:10px 0 0"></p><div data-err style="margin-top:10px"></div>`,
    foot: '<button class="btn" data-close>Fermer</button><button class="btn primary" id="rs-ok" hidden>Récupérer mes données</button>',
    onMount: (el, close) => {
      let msg = '';
      $('#rs-start', el).addEventListener('click', async () => {
        cloudErr(el, ''); const btn = $('#rs-start', el); busy(btn, true);
        const r = await window.sika.cloudRescueStart({ phone: $('#rs-phone', el).value });
        busy(btn, false);
        if (!r.ok) return cloudErr(el, r.error);
        msg = `Bonjour, j'ai oublié mon mot de passe SikaGest et je dois récupérer ma sauvegarde en ligne (${r.data.shop || ''}). Code de demande :\n${r.data.code}`;
        $('#rs-req', el).value = r.data.code;
        $('#rs-info', el).textContent = `Compte trouvé : ${r.data.shop || '—'} · dernière sauvegarde en ligne : ${sinceText(r.data.backupAt)}`;
        $('#rs-step2', el).hidden = false; $('#rs-ok', el).hidden = false;
        const w = waUrl ? waUrl(msg) : ''; if (w) { $('#rs-wa', el).href = w; $('#rs-wa', el).hidden = false; }
      });
      $('#rs-copy', el).addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(msg); toast('Code copié. Collez-le dans WhatsApp ou un SMS.', 'ok'); }
        catch (e) { $('#rs-req', el).select(); document.execCommand('copy'); toast('Code copié', 'ok'); }
      });
      $('#rs-ok', el).addEventListener('click', async () => {
        cloudErr(el, ''); const btn = $('#rs-ok', el); busy(btn, true, 'Récupération en cours…');
        const r = await window.sika.cloudRescueFinish({ code: $('#rs-ans', el).value });
        if (!r.ok) { busy(btn, false, 'Récupérer mes données'); return cloudErr(el, r.error); }
        if (r.data.cancelled) { busy(btn, false, 'Récupérer mes données'); return cloudErr(el, 'Récupération annulée : vos données actuelles n\'ont pas été modifiées.'); }
        close(); S.user = null; await boot();
        newPasswordModal(r.data.users, `<b>Vos données sont récupérées</b> (${r.data.sales} vente(s), ${r.data.products} produit(s)). Choisissez maintenant un nouveau mot de passe.`);
      });
    },
  });
}

async function start() {
  S.settings = await API.call('settings.get');
  if (!location.hash) location.hash = '#/dashboard';
  await route();
  askProfile();
}
async function boot() {
  if (window.sika) {
    S.info = await window.sika.info();
    window.sika.onUpdate((u) => { S.update = u; renderUpdatePill(); });
  }
  S.settings = await API.call('settings.get');
  const st = await API.call('auth.status');
  if (st.needsSetup) return showSetup();
  if (st.user) { S.user = st.user; return start(); }
  showLogin();
}

// ---------- Impression : facture A4 et ticket de caisse ----------
function printHtml(html, format) {
  let style = $('#page-style');
  if (!style) { style = document.createElement('style'); style.id = 'page-style'; document.head.appendChild(style); }
  style.textContent = format === 'ticket' ? '@page { size: 80mm auto; margin: 3mm; }' : '@page { size: A4; margin: 14mm; }';
  $('#print-area').innerHTML = html;
  setTimeout(() => window.print(), 50);
}
function printDoc(doc, kind = 'vente', format = null) {
  const s = S.settings;
  format = format || (kind === 'vente' && doc.source === 'pos' ? (s.ticket_format || 'ticket') : 'a4');
  const partner = kind === 'vente' ? (doc.client || 'Client comptoir') : (doc.supplier || '—');
  const lines = doc.items.map((i) => ({ name: i.name, qty: i.qty, price: kind === 'vente' ? i.price : i.cost }));
  const net = doc.total - (doc.returned || 0);
  if (format === 'ticket') {
    printHtml(`<div class="ticket"><div class="c"><b style="font-size:14px">${esc(s.company_name)}</b><br>${esc(s.company_address)}<br>${esc(s.company_phone)}</div><hr>
      <div>${esc(doc.ref)} — ${fdate(doc.date)}<br>Caissier : ${esc(doc.user || '')}<br>Client : ${esc(partner)}</div><hr>
      <table>${lines.map((l) => `<tr><td colspan="2">${esc(l.name)}</td></tr><tr><td>${qtyf(l.qty)} x ${nf.format(l.price)}</td><td class="r">${nf.format(l.qty * l.price)}</td></tr>`).join('')}</table><hr>
      <table>${doc.discount ? `<tr><td>Sous-total</td><td class="r">${nf.format(doc.subtotal)}</td></tr><tr><td>Remise</td><td class="r">-${nf.format(doc.discount)}</td></tr>` : ''}
      <tr><td><b>TOTAL</b></td><td class="r"><b>${money(doc.total)}</b></td></tr>
      ${doc.returned ? `<tr><td>Retours</td><td class="r">-${nf.format(doc.returned)}</td></tr>` : ''}
      <tr><td>Payé</td><td class="r">${nf.format(doc.paid)}</td></tr>
      ${doc.received ? `<tr><td>Reçu</td><td class="r">${nf.format(doc.received)}</td></tr><tr><td>Monnaie rendue</td><td class="r">${nf.format(Math.max(0, doc.received - doc.paid))}</td></tr>` : ''}
      ${net - doc.paid > 0.5 ? `<tr><td>Reste à payer</td><td class="r">${nf.format(net - doc.paid)}</td></tr>` : ''}</table><hr>
      <div class="c">${esc(s.invoice_footer)}</div></div>`, 'ticket');
    return;
  }
  const title = kind === 'vente' ? 'FACTURE' : 'BON D\'ACHAT';
  printHtml(`<div class="inv"><div class="head"><div><h1>${esc(s.company_name)}</h1>${esc(s.company_address)}<br>${esc(s.company_phone)}<br>${esc(s.company_email)}</div>
    <div style="text-align:right"><h1>${title}</h1>N° ${esc(doc.ref)}<br>Date : ${fdate(doc.date, false)}</div></div>
    <div style="margin-bottom:16px"><b>${kind === 'vente' ? 'Client' : 'Fournisseur'} :</b> ${esc(partner)}${doc.client_phone ? ' — ' + esc(doc.client_phone) : ''}${doc.client_address ? '<br>' + esc(doc.client_address) : ''}</div>
    <table><thead><tr><th>Désignation</th><th class="r">Qté</th><th class="r">Prix unitaire</th><th class="r">Montant</th></tr></thead>
    <tbody>${lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="r">${qtyf(l.qty)}</td><td class="r">${nf.format(l.price)}</td><td class="r">${nf.format(l.qty * l.price)}</td></tr>`).join('')}</tbody></table>
    <div class="tot">${doc.discount ? `<div><span>Sous-total</span><span>${money(doc.subtotal)}</span></div><div><span>Remise</span><span>-${money(doc.discount)}</span></div>` : ''}
      <div class="g"><span>Total</span><span>${money(doc.total)}</span></div>
      ${doc.returned ? `<div><span>Retours</span><span>-${money(doc.returned)}</span></div>` : ''}
      <div><span>Déjà payé</span><span>${money(doc.paid)}</span></div><div><span>Reste à payer</span><span>${money(Math.max(0, net - doc.paid))}</span></div></div>
    ${doc.note ? `<p><b>Note :</b> ${esc(doc.note)}</p>` : ''}
    <p style="margin-top:40px;text-align:center;color:#555">${esc(s.invoice_footer)}</p></div>`, 'a4');
}

document.addEventListener('DOMContentLoaded', () => boot().catch((e) => { document.body.innerHTML = `<pre style="padding:20px">${esc(e.message)}</pre>`; }));
