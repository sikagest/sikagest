// SikaGest — fonction serveur de la sauvegarde en ligne (Supabase Edge Function « cloud »)
// Le logiciel envoie des fichiers déjà chiffrés : ce serveur ne peut pas lire les données des clients.
//
// Actions (POST JSON, sauf « put ») :
//   create      : crée le compte en ligne d'une entreprise (téléphone + secret d'écriture + 1er identifiant)
//   login_set   : ajoute / met à jour un identifiant (après un changement de mot de passe)
//   update      : change le téléphone ou le nom de la boutique
//   put         : envoie une sauvegarde chiffrée (corps binaire, en-têtes x-account / x-secret)
//   salt        : renvoie le sel d'un identifiant (étape 1 de la connexion sur un nouveau PC)
//   fetch       : vérifie le mot de passe et renvoie la clé chiffrée + un lien de téléchargement
//   rescue_info : (mot de passe oublié) renvoie l'identifiant du compte pour le code de demande
//   rescue_fetch: (mot de passe oublié) lien de téléchargement du fichier chiffré, inutilisable sans le code du vendeur
import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const BUCKET = 'backups';
const KEEP_LAST = 3;   // les 3 derniers envois
const KEEP_DAYS = 7;   // + le dernier envoi de chacun des 7 derniers jours
const MAX_SIZE = 25 * 1024 * 1024;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, content-type, x-account, x-secret, x-action', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

class Fail extends Error { constructor(public status: number, message: string) { super(message); } }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
export function normPhone(p: unknown) {
  let d = String(p ?? '').replace(/[^0-9]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 13 && d.startsWith('225')) d = d.slice(3);
  if (d.length < 6 || d.length > 15) throw new Fail(400, 'Numéro de téléphone invalide.');
  return d;
}
const str = (v: unknown, max: number, name: string) => {
  const s = String(v ?? '');
  if (!s || s.length > max) throw new Fail(400, `Champ invalide : ${name}`);
  return s;
};
const hexStr = (v: unknown, len: number, name: string) => {
  const s = String(v ?? '');
  if (!new RegExp(`^[0-9a-f]{${len}}$`).test(s)) throw new Fail(400, `Champ invalide : ${name}`);
  return s;
};

async function tooMany(phone: string, kinds: string[], minutes: number, max: number, onlyFailures: boolean) {
  let q = db.from('cloud_attempts').select('id', { count: 'exact', head: true }).eq('phone', phone).in('kind', kinds)
    .gte('at', new Date(Date.now() - minutes * 60000).toISOString());
  if (onlyFailures) q = q.eq('ok', false);
  const { count } = await q;
  if ((count ?? 0) >= max) throw new Fail(429, 'Trop d\'essais. Patientez 15 minutes puis réessayez.');
}
const logAttempt = (phone: string, kind: string, ok: boolean) => db.from('cloud_attempts').insert({ phone, kind, ok });

async function accountBySecret(id: unknown, secret: unknown) {
  const accountId = str(id, 40, 'compte');
  const { data } = await db.from('cloud_accounts').select('*').eq('id', accountId).maybeSingle();
  if (!data || !same(data.secret_hash, await sha256(hexStr(secret, 64, 'secret')))) throw new Fail(403, 'Compte en ligne non reconnu.');
  return data;
}
async function loginRow(b: Record<string, unknown>) {
  return {
    username: str(b.username, 80, 'identifiant').trim().toLowerCase(),
    salt: hexStr(b.salt, 32, 'sel'),
    auth_hash: await sha256(hexStr(b.auth_key, 64, 'preuve')),
    pw_wrap: str(b.pw_wrap, 400, 'clé'),
    updated_at: new Date().toISOString(),
  };
}
async function latestFile(accountId: string) {
  const { data } = await db.storage.from(BUCKET).list(accountId, { limit: 100, sortBy: { column: 'name', order: 'desc' } });
  const files = (data ?? []).filter((f) => f.name.endsWith('.bin')).sort((a, b) => b.name.localeCompare(a.name));
  return files;
}
async function downloadLink(accountId: string) {
  const files = await latestFile(accountId);
  if (!files.length) throw new Fail(404, 'Aucune sauvegarde en ligne pour ce compte pour l\'instant.');
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(`${accountId}/${files[0].name}`, 600);
  if (error || !data) throw new Fail(500, 'Lien de téléchargement indisponible.');
  return { url: data.signedUrl, file: files[0].name };
}

const actions: Record<string, (b: Record<string, unknown>, req: Request) => Promise<unknown>> = {
  async create(b) {
    const phone = normPhone(b.phone);
    const { data: existing } = await db.from('cloud_accounts').select('id').eq('phone', phone).maybeSingle();
    if (existing) throw new Fail(409, 'PHONE_TAKEN');
    const { data, error } = await db.from('cloud_accounts').insert({
      phone, shop: String(b.shop ?? '').slice(0, 120), install_id: String(b.install_id ?? '').slice(0, 32),
      secret_hash: await sha256(hexStr(b.secret, 64, 'secret')), vendor_wrap: str(b.vendor_wrap, 400, 'clé de secours'),
    }).select('id').single();
    if (error) throw new Fail(error.code === '23505' ? 409 : 500, error.code === '23505' ? 'PHONE_TAKEN' : 'Création impossible.');
    await db.from('cloud_logins').insert({ account_id: data.id, ...(await loginRow(b)) });
    return { account_id: data.id, phone };
  },
  async login_set(b) {
    const acc = await accountBySecret(b.account_id, b.secret);
    const { error } = await db.from('cloud_logins').upsert({ account_id: acc.id, ...(await loginRow(b)) });
    if (error) throw new Fail(500, 'Enregistrement impossible.');
    return { ok: true };
  },
  async update(b) {
    const acc = await accountBySecret(b.account_id, b.secret);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.phone != null) patch.phone = normPhone(b.phone);
    if (b.shop != null) patch.shop = String(b.shop).slice(0, 120);
    if (b.install_id != null) patch.install_id = String(b.install_id).slice(0, 32);
    const { error } = await db.from('cloud_accounts').update(patch).eq('id', acc.id);
    if (error) throw new Fail(error.code === '23505' ? 409 : 500, error.code === '23505' ? 'PHONE_TAKEN' : 'Mise à jour impossible.');
    return { ok: true, phone: patch.phone ?? acc.phone };
  },
  async put(_b, req) {
    const acc = await accountBySecret(req.headers.get('x-account'), req.headers.get('x-secret'));
    let body: Uint8Array;
    if ((req.headers.get('content-type') || '').includes('application/json')) {
      // variante JSON (base64), utile pour les tests depuis le serveur
      const j = await req.json().catch(() => ({}));
      body = Uint8Array.from(atob(String(j.data_b64 || '')), (c) => c.charCodeAt(0));
    } else body = new Uint8Array(await req.arrayBuffer());
    if (body.length < 64 || body.length > MAX_SIZE) throw new Fail(413, 'Fichier trop gros ou vide.');
    if (new TextDecoder().decode(body.subarray(0, 4)) !== 'SKG1') throw new Fail(400, 'Fichier non chiffré refusé.');
    // Un fichier par envoi (jamais d'écrasement), nommé par date et heure
    const stamp = new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, '');
    const { error } = await db.storage.from(BUCKET).upload(`${acc.id}/${stamp}.bin`, body, { upsert: true, contentType: 'application/octet-stream' });
    if (error) throw new Fail(500, `Envoi impossible (${error.message}).`);
    const files = await latestFile(acc.id); // du plus récent au plus ancien
    const keep = new Set(files.slice(0, KEEP_LAST).map((f) => f.name));
    const days = new Set<string>();
    for (const f of files) { const d = f.name.slice(0, 10); if (!days.has(d) && days.size < KEEP_DAYS) { days.add(d); keep.add(f.name); } }
    const old = files.filter((f) => !keep.has(f.name)).map((f) => `${acc.id}/${f.name}`);
    if (old.length) await db.storage.from(BUCKET).remove(old);
    const at = new Date().toISOString();
    await db.from('cloud_accounts').update({ last_backup_at: at, last_backup_size: body.length }).eq('id', acc.id);
    return { ok: true, at };
  },
  async salt(b) {
    const phone = normPhone(b.phone);
    await tooMany(phone, ['fetch'], 15, 8, true);
    const { data: acc } = await db.from('cloud_accounts').select('id').eq('phone', phone).maybeSingle();
    if (!acc) throw new Fail(404, 'Aucun compte SikaGest en ligne avec ce numéro.');
    const username = str(b.username, 80, 'identifiant').trim().toLowerCase();
    const { data: login } = await db.from('cloud_logins').select('salt').eq('account_id', acc.id).eq('username', username).maybeSingle();
    if (!login) { await logAttempt(phone, 'fetch', false); throw new Fail(404, 'Identifiant inconnu pour ce compte. Utilisez l\'identifiant d\'un administrateur.'); }
    return { salt: login.salt };
  },
  async fetch(b) {
    const phone = normPhone(b.phone);
    await tooMany(phone, ['fetch'], 15, 8, true);
    const { data: acc } = await db.from('cloud_accounts').select('*').eq('phone', phone).maybeSingle();
    if (!acc) throw new Fail(404, 'Aucun compte SikaGest en ligne avec ce numéro.');
    const username = str(b.username, 80, 'identifiant').trim().toLowerCase();
    const { data: login } = await db.from('cloud_logins').select('*').eq('account_id', acc.id).eq('username', username).maybeSingle();
    const ok = !!login && same(login.auth_hash, await sha256(hexStr(b.auth_key, 64, 'preuve')));
    await logAttempt(phone, 'fetch', ok);
    if (!ok) throw new Fail(403, 'Identifiant ou mot de passe incorrect.');
    return { account_id: acc.id, shop: acc.shop, pw_wrap: login.pw_wrap, backup_at: acc.last_backup_at, ...(await downloadLink(acc.id)) };
  },
  async rescue_info(b) {
    const phone = normPhone(b.phone);
    await tooMany(phone, ['rescue'], 60, 10, false);
    await logAttempt(phone, 'rescue', true);
    const { data: acc } = await db.from('cloud_accounts').select('id, shop, last_backup_at').eq('phone', phone).maybeSingle();
    if (!acc) throw new Fail(404, 'Aucun compte SikaGest en ligne avec ce numéro.');
    return { account_id: acc.id, shop: acc.shop, backup_at: acc.last_backup_at };
  },
  async rescue_fetch(b) {
    const phone = normPhone(b.phone);
    await tooMany(phone, ['rescue'], 60, 10, false);
    await logAttempt(phone, 'rescue', true);
    const { data: acc } = await db.from('cloud_accounts').select('id, last_backup_at').eq('phone', phone).eq('id', str(b.account_id, 40, 'compte')).maybeSingle();
    if (!acc) throw new Fail(404, 'Compte introuvable.');
    return { backup_at: acc.last_backup_at, ...(await downloadLink(acc.id)) };
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
  try {
    const action = req.headers.get('x-action') || '';
    const fn = actions[action];
    if (!fn) throw new Fail(400, 'Action inconnue');
    const body = action === 'put' ? {} : await req.json().catch(() => { throw new Fail(400, 'Requête invalide'); });
    return json(await fn(body, req));
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Erreur du serveur' }, 500);
  }
});
