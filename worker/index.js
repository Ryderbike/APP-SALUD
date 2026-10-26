// API de respaldo: guarda todo lo de la app en una base D1 de Cloudflare.
// No hay cuentas: cada persona tiene un código secreto (se crea solo en la app). Del código se guarda
// solo su huella SHA-256, así que ni la base ni este código permiten adivinar el de otro.
//
//   GET  /api/sync   -> { at, keys } con lo último respaldado (keys: null si todavía no hay nada)
//   PUT  /api/sync   -> guarda { at, keys }; solo reemplaza si es más nuevo que lo guardado
//
// Cada petición lleva el código en la cabecera  Authorization: Bearer <código>.

const MAX_BYTES = 2 * 1024 * 1024;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

async function digest(code) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// la tabla se crea sola la primera vez, no hace falta correr migraciones a mano
let ready = null;
function ensureTable(db) {
  ready ||= db
    .prepare("CREATE TABLE IF NOT EXISTS backups (id TEXT PRIMARY KEY, at INTEGER NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL)")
    .run()
    .catch((e) => { ready = null; throw e; });
  return ready;
}

async function handleSync(request, env) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{16,128})$/.exec(request.headers.get("authorization") || "");
  if (!m) return json({ error: "código inválido" }, 401);
  const id = await digest(m[1]);
  await ensureTable(env.DB);

  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT at, data FROM backups WHERE id = ?").bind(id).first();
    if (!row) return json({ at: 0, keys: null }); // todavía no hay respaldo (200 para no ensuciar la consola del navegador)
    return json({ at: row.at, keys: JSON.parse(row.data) });
  }

  if (request.method === "PUT") {
    const text = await request.text();
    if (text.length > MAX_BYTES) return json({ error: "demasiado grande" }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "JSON inválido" }, 400); }
    if (!body || typeof body.keys !== "object" || body.keys === null || Array.isArray(body.keys)) return json({ error: "datos inválidos" }, 400);
    const keys = {};
    for (const [k, v] of Object.entries(body.keys)) if (typeof v === "string" && k !== "_at" && k !== "active") keys[k] = v;
    const at = Math.max(0, Math.floor(+body.at || 0)) || Date.now();
    // solo gana lo más nuevo: un teléfono con datos viejos no pisa un respaldo reciente
    const res = await env.DB.prepare(
      "INSERT INTO backups (id, at, data, updated) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET at = ?2, data = ?3, updated = ?4 WHERE excluded.at >= backups.at"
    ).bind(id, at, JSON.stringify(keys), Date.now()).run();
    if (!res.meta.changes) {
      const row = await env.DB.prepare("SELECT at, data FROM backups WHERE id = ?").bind(id).first();
      return json({ ok: false, newer: { at: row.at, keys: JSON.parse(row.data) } }, 409);
    }
    return json({ ok: true, at });
  }

  return json({ error: "método no permitido" }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/sync") {
      try { return await handleSync(request, env); }
      catch (e) { return json({ error: "error del servidor" }, 500); }
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "no existe" }, 404);
    return env.ASSETS.fetch(request);
  }
};
