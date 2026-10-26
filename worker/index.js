// API de respaldo: guarda todo lo de la app en una base D1 de Cloudflare.
//
//   GET  /api/sync   -> { at, keys } con lo último respaldado (keys: null si todavía no hay nada)
//   PUT  /api/sync   -> guarda { at, keys }; solo reemplaza si es más nuevo que lo guardado
//
// Dos formas de identificarse (ambas guardan en la misma tabla, así un respaldo viejo no se pierde):
//   - cuenta: usuario + contraseña (/api/auth/*), con una cookie de sesión HttpOnly
//   - código secreto del dispositivo:  Authorization: Bearer <código>  (de él solo se guarda la huella SHA-256)
//
// El inicio de sesión sigue el mismo enfoque que la app Pololos: PBKDF2-SHA256 con sal propia, sesiones con token
// al azar guardado solo como huella, cookie __Host-, límite de intentos reservado antes de revisar y respuestas
// iguales exista o no el usuario.

const MAX_BYTES = 2 * 1024 * 1024;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

async function digest(code) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// la tabla se crea sola la primera vez, no hace falta correr migraciones a mano
let ready = null;
function ensureTable(db) {
  ready ||= db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS backups (id TEXT PRIMARY KEY, at INTEGER NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL)"),
    // red de seguridad: copia de la versión anterior, por si un teléfono sube algo malo
    db.prepare("CREATE TABLE IF NOT EXISTS backups_prev (id TEXT PRIMARY KEY, at INTEGER NOT NULL, data TEXT NOT NULL, saved INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)"),
    db.prepare("CREATE TABLE IF NOT EXISTS attempts (key TEXT NOT NULL, at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS attempts_key ON attempts(key, at)")
  ]).catch((e) => { ready = null; throw e; });
  return ready;
}


// ---------- cuentas ----------

const COOKIE = "__Host-stillfit";
const SESSION_MS = 90 * 86400000;
const RENEW_BELOW_MS = 30 * 86400000;
const PW_ITERATIONS = 100000; // el máximo que permite Cloudflare Workers
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60000;
const DEFAULT_MAX_USERS = 5; // la app es personal: tope de cuentas (cambiable con la variable MAX_USERS)
const DUMMY_SALT = "AAAAAAAAAAAAAAAAAAAAAA==";
const enc = new TextEncoder();

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const randomToken = (n = 32) => b64(crypto.getRandomValues(new Uint8Array(n))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]);
const sha256b64 = async (t) => b64(await crypto.subtle.digest("SHA-256", enc.encode(t)));

async function hashPassword(password, saltB64) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
  return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations: PW_ITERATIONS }, base, 256));
}
// comparación en tiempo constante (se comparan huellas para que el largo no filtre nada)
async function safeEqual(a, b) {
  const [x, y] = (await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))))).map((h) => new Uint8Array(h));
  let diff = 0; for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function readCookie(req) {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim() || null;
  }
  return null;
}
const cookieHeader = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

async function createSession(env, userId) {
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256b64(token), userId, Date.now() + SESSION_MS).run();
  return cookieHeader(token, SESSION_MS / 1000);
}

// devuelve { user: {id, username}, token, renew? } o null
async function sessionUser(env, req) {
  const token = readCookie(req);
  if (!token || token.length > 100 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const hash = await sha256b64(token);
  const row = await env.DB.prepare("SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?").bind(hash).first();
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at <= now) { await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(hash).run(); return null; }
  const out = { user: { id: row.id, username: row.username }, token };
  if (row.expires_at - now < RENEW_BELOW_MS) {
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").bind(now + SESSION_MS, hash).run();
    out.renew = cookieHeader(token, SESSION_MS / 1000);
  }
  return out;
}

// El intento se anota ANTES de revisar la contraseña, así ni pedidos en paralelo superan el límite.
async function reserveAttempt(env, keys) {
  const now = Date.now();
  const ins = await env.DB.batch(keys.map((k) => env.DB.prepare("INSERT INTO attempts (key, at) VALUES (?, ?) RETURNING rowid AS id").bind(k, now)));
  const ids = ins.map((r) => r.results[0].id);
  const cnt = await env.DB.batch(keys.map((k) => env.DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND at > ?").bind(k, now - WINDOW_MS)));
  if (cnt.some((r) => (r.results[0]?.n ?? 0) > MAX_ATTEMPTS)) {
    await releaseAttempt(env, ids);
    throw new HttpError(429, "Demasiados intentos. Espera 15 minutos e intenta de nuevo.");
  }
  return ids;
}
async function releaseAttempt(env, ids) {
  if (ids.length) await env.DB.prepare(`DELETE FROM attempts WHERE rowid IN (${ids.map(() => "?").join(",")})`).bind(...ids).run();
}

const clientIp = (req) => req.headers.get("cf-connecting-ip") || "local";

// Defensa contra pedidos de otros sitios: además de SameSite=Strict, los pedidos que cambian algo deben venir de esta misma página.
function checkOrigin(req, url) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "Origen no permitido");
  if (!site && req.headers.get("origin") !== url.origin) throw new HttpError(403, "Origen no permitido");
}

async function readJson(req, max = 4096) {
  if (!(req.headers.get("content-type") || "").includes("application/json")) throw new HttpError(415, "Se esperaba JSON");
  if (+req.headers.get("content-length") > max) throw new HttpError(413, "Demasiado grande");
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, "Demasiado grande");
  let d; try { d = JSON.parse(text); } catch { throw new HttpError(400, "JSON inválido"); }
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new HttpError(400, "JSON inválido");
  return d;
}

function readUsername(v) {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!/^[a-z0-9._-]{3,24}$/.test(s)) throw new HttpError(400, "El usuario debe tener entre 3 y 24 letras, números, punto, guion o guion bajo");
  return s;
}
function readPassword(v) {
  if (typeof v !== "string" || v.length < 8 || v.length > 200) throw new HttpError(400, "La contraseña debe tener entre 8 y 200 caracteres");
  return v;
}

async function handleAuth(request, env, url) {
  const route = url.pathname.slice("/api/auth/".length);
  await ensureTable(env.DB);
  // las huellas de intentos viejas se limpian solas
  if (request.method === "POST" && Math.random() < 0.1) await env.DB.prepare("DELETE FROM attempts WHERE at < ?").bind(Date.now() - 86400000).run();

  if (route === "me" && request.method === "GET") {
    const s = await sessionUser(env, request);
    return json({ user: s ? s.user.username : null }, 200, s && s.renew ? { "set-cookie": s.renew } : {});
  }
  if (request.method !== "POST") return json({ error: "método no permitido" }, 405);

  if (route === "signup") {
    const body = await readJson(request);
    const username = readUsername(body.username), password = readPassword(body.password);
    await reserveAttempt(env, [`signup:ip:${clientIp(request)}`, "signup:todos"]); // cada registro cuenta, salga bien o mal
    const max = Math.max(1, +env.MAX_USERS || DEFAULT_MAX_USERS);
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await hashPassword(password, salt);
    // la condición va dentro del INSERT: ni dos pedidos a la vez pasan del tope de cuentas
    const res = await env.DB.prepare("INSERT INTO users (username, pw_hash, pw_salt, created_at) SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM users) < ?")
      .bind(username, hash, salt, Date.now(), max).run().catch((e) => {
        if (/UNIQUE/i.test(e.message)) throw new HttpError(409, "Ese usuario no está disponible");
        throw e;
      });
    if (!res.meta.changes) throw new HttpError(403, "No se pueden crear más cuentas");
    return json({ user: username }, 201, { "set-cookie": await createSession(env, Number(res.meta.last_row_id)) });
  }

  if (route === "login") {
    const body = await readJson(request);
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase().slice(0, 40) : "";
    const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";
    const keys = [`login:ip:${clientIp(request)}`, `login:user:${username}`];
    const reserved = await reserveAttempt(env, keys);
    const row = await env.DB.prepare("SELECT id, username, pw_hash, pw_salt FROM users WHERE username = ?").bind(username).first();
    // siempre se calcula un hash: la respuesta tarda lo mismo exista o no el usuario
    const hash = await hashPassword(password, row ? row.pw_salt : DUMMY_SALT);
    if (!row || !(await safeEqual(hash, row.pw_hash))) throw new HttpError(401, "Usuario o contraseña incorrectos");
    await releaseAttempt(env, reserved);
    await env.DB.prepare("DELETE FROM attempts WHERE key = ?").bind(keys[1]).run();
    return json({ user: row.username }, 200, { "set-cookie": await createSession(env, row.id) });
  }

  if (route === "logout") {
    const token = readCookie(request);
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256b64(token)).run();
    return json({ ok: true }, 200, { "set-cookie": cookieHeader("", 0) });
  }

  return json({ error: "no existe" }, 404);
}

async function handleSync(request, env) {
  await ensureTable(env.DB);
  const bearer = request.headers.get("authorization");
  let id, renew;
  if (bearer) {
    const m = /^Bearer\s+([A-Za-z0-9_-]{16,128})$/.exec(bearer);
    if (!m) return json({ error: "código inválido" }, 401);
    id = await digest(m[1]);
  } else {
    const s = await sessionUser(env, request);
    if (!s) return json({ error: "sin sesión" }, 401);
    id = "user:" + s.user.id; renew = s.renew;
  }

  const cookie = renew ? { "set-cookie": renew } : {};

  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT at, data FROM backups WHERE id = ?").bind(id).first();
    if (!row) return json({ at: 0, keys: null }, 200, cookie); // todavía no hay respaldo (200 para no ensuciar la consola del navegador)
    return json({ at: row.at, keys: JSON.parse(row.data) }, 200, cookie);
  }

  if (request.method === "PUT") {
    if (+request.headers.get("content-length") > MAX_BYTES) return json({ error: "demasiado grande" }, 413); // antes de leer el cuerpo
    const text = await request.text();
    if (text.length > MAX_BYTES) return json({ error: "demasiado grande" }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "JSON inválido" }, 400); }
    if (!body || typeof body.keys !== "object" || body.keys === null || Array.isArray(body.keys)) return json({ error: "datos inválidos" }, 400);
    const keys = {};
    const entries = Object.entries(body.keys);
    if (entries.length > 500) return json({ error: "demasiados datos" }, 400);
    for (const [k, v] of entries) if (typeof v === "string" && /^[\w:.-]{1,80}$/.test(k) && k !== "_at" && k !== "active") keys[k] = v;
    // nunca se guarda un respaldo vacío: un teléfono recién instalado no puede borrar lo que ya hay
    if (!Object.keys(keys).length) return json({ error: "sin datos" }, 400);
    // una fecha en el futuro bloquearía todos los respaldos siguientes ("gana lo más nuevo"), así que se limita a ahora
    const now = Date.now();
    const at = Math.min(Math.max(0, Math.floor(+body.at || 0)) || now, now + 60000);
    // antes de reemplazar, se guarda la versión anterior (como mucho una cada 6 horas) para poder recuperarla
    const cur = await env.DB.prepare("SELECT at, data FROM backups WHERE id = ?").bind(id).first();
    if (cur && cur.data !== JSON.stringify(keys)) {
      await env.DB.prepare(
        "INSERT INTO backups_prev (id, at, data, saved) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET at = ?2, data = ?3, saved = ?4 WHERE backups_prev.saved < ?4 - 21600000"
      ).bind(id, cur.at, cur.data, Date.now()).run();
    }
    // solo gana lo más nuevo: un teléfono con datos viejos no pisa un respaldo reciente
    const res = await env.DB.prepare(
      "INSERT INTO backups (id, at, data, updated) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET at = ?2, data = ?3, updated = ?4 WHERE excluded.at >= backups.at"
    ).bind(id, at, JSON.stringify(keys), Date.now()).run();
    if (!res.meta.changes) {
      const row = await env.DB.prepare("SELECT at, data FROM backups WHERE id = ?").bind(id).first();
      return json({ ok: false, newer: { at: row.at, keys: JSON.parse(row.data) } }, 409, cookie);
    }
    return json({ ok: true, at }, 200, cookie);
  }

  return json({ error: "método no permitido" }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/sync" || url.pathname.startsWith("/api/auth/")) {
      try {
        checkOrigin(request, url);
        return url.pathname === "/api/sync" ? await handleSync(request, env) : await handleAuth(request, env, url);
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message }, e.status);
        return json({ error: "error del servidor" }, 500);
      }
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "no existe" }, 404);
    return env.ASSETS.fetch(request);
  }
};
