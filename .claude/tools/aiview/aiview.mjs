#!/usr/bin/env node
// aiview — local document viewer with a central index: Markdown (GFM + mermaid) and HTML mockups.
//
//   node aiview.mjs serve [file.md] [--port 4321] [--open] [--kind k] [--tag t]...   start the viewer (registers file if given)
//   node aiview.mjs add <file.md> [--kind k] [--tag t]... [--started ISO]              register a document (agent-set kind + tags + start time)
//   node aiview.mjs list [--kind k] [--tag t]...                                     documents in the index
//   node aiview.mjs remove <file.md|#id>...                                          drop from the index (files are untouched)
//
// Every document has one mandatory KIND (brainstorm, mockup, pr-analysis, ...) — from the filename
// `<name>.<kind>.md` or --kind — plus free tags, and a start date-time (created_at, first
// registration). Pure Node >= 22.5 (node:sqlite), no npm install, Windows + macOS.
// The index is `aiview.sqlite` NEXT TO THIS FILE, versioned with the repo that vendors the tool;
// document paths are stored relative to the repo root (nearest .git above the tool), so the same
// index works on every machine that checks the repo out. Files are the truth; the index only points.

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`aiview needs Node >= 22.5 (node:sqlite); you have ${process.versions.node}`);
  process.exit(1);
}
// node:sqlite prints an ExperimentalWarning on import; drop the default printer and re-add a filtered one.
process.removeAllListeners("warning");
process.on("warning", (w) => { if (w.name !== "ExperimentalWarning") console.warn(w); });
const { DatabaseSync } = await import("node:sqlite");

const here = path.dirname(fileURLToPath(import.meta.url));
/** Nearest ancestor holding a .git (the repo that vendors the tool), else the tool folder. */
function repoRootOf(start) {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}
const ROOT = repoRootOf(here);
const db = new DatabaseSync(path.join(here, "aiview.sqlite"));
db.exec(`
  PRAGMA journal_mode = DELETE;
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY,
    file_path TEXT NOT NULL UNIQUE,
    project TEXT NOT NULL,
    title TEXT,
    kind TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
`);
// Schema upkeep for indexes created by earlier versions.
const cols = db.prepare("PRAGMA table_info(documents)").all().map((c) => c.name);
if (!cols.includes("tags")) db.exec("ALTER TABLE documents ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
if (!cols.includes("kind")) db.exec("ALTER TABLE documents ADD COLUMN kind TEXT NOT NULL DEFAULT ''");
db.exec("DROP TABLE IF EXISTS revisions");

// ---------- helpers ----------
const now = () => new Date().toISOString();
/** Stored form of a path: posix-relative to ROOT when inside it, absolute otherwise. */
const toStored = (abs) => {
  const rel = path.relative(ROOT, abs);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : abs;
};
/** Absolute path for a stored one, on this machine. */
const toAbs = (stored) => (path.isAbsolute(stored) ? stored : path.resolve(ROOT, ...stored.split("/")));
const readDoc = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const isHtml = (file) => /\.html?$/i.test(file);
const titleOf = (text, file) => {
  const m = isHtml(file)
    ? (text.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? text.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1])
    : text.match(/^#\s+(.+)$/m)?.[1];
  return (m ?? path.basename(file)).trim();
};

const projectRoot = (file) => path.basename(repoRootOf(path.dirname(file)));
/** `<name>.<kind>.md` / `<name>.<kind>.html` -> "kind"; anything else -> "" */
function kindFromName(file) {
  const parts = path.basename(file).split(".");
  return parts.length >= 3 ? parts[parts.length - 2].toLowerCase() : "";
}
const parseTags = (row) => (row ? { ...row, tags: JSON.parse(row.tags), abs_path: toAbs(row.file_path) } : row);

function registerDocument(absFile, { kind = "", tags: extraTags = [], started = "" } = {}) {
  if (!fs.existsSync(absFile)) throw new Error(`no such file: ${absFile}`);
  const file = toStored(absFile);
  const content = readDoc(absFile);
  const existing = db.prepare("SELECT * FROM documents WHERE file_path = ?").get(file);
  const finalKind = (kind || existing?.kind || kindFromName(file)).toLowerCase();
  if (!finalKind)
    throw new Error("kind is mandatory: name the file <name>.<kind>.md or pass --kind <kind> (e.g. brainstorm, mockup, pr-analysis)");
  const tags = [...new Set([...(existing ? JSON.parse(existing.tags) : []), ...extraTags])].filter((t) => t !== finalKind);
  const t = now();
  // created_at = start of the work on this document: first registration, or an explicit --started ISO date-time.
  const startedAt = started ? new Date(started).toISOString() : (existing?.created_at ?? t);
  db.prepare(
    `INSERT INTO documents (file_path, project, title, kind, tags, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET last_seen_at = excluded.last_seen_at, title = excluded.title, kind = excluded.kind, tags = excluded.tags, created_at = excluded.created_at`,
  ).run(file, projectRoot(absFile), titleOf(content, absFile), finalKind, JSON.stringify(tags), startedAt, t);
  return parseTags(db.prepare("SELECT * FROM documents WHERE file_path = ?").get(file));
}
const getDoc = (id) => parseTags(db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(id)));
const allDocs = () =>
  db.prepare("SELECT * FROM documents ORDER BY created_at DESC, id DESC").all().map(parseTags)
    .map((d) => ({ ...d, exists: fs.existsSync(d.abs_path), format: isHtml(d.file_path) ? "html" : "markdown" }));
const touch = (id) => db.prepare("UPDATE documents SET last_seen_at = ? WHERE id = ?").run(now(), id);

// ---------- CLI ----------
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, def) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : def; };
const flags = (name) => rest.flatMap((a, i) => (a === name && rest[i + 1] ? [rest[i + 1]] : []));
const VALUE_FLAGS = new Set(["--port", "--tag", "--kind", "--started"]);
const opts = () => ({ kind: flag("--kind", ""), tags: flags("--tag"), started: flag("--started", "") });
const positional = rest.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(rest[i - 1]));

if (cmd === "list") {
  const want = flags("--tag"), wantKind = flag("--kind", "");
  for (const d of allDocs()) {
    if (wantKind && d.kind !== wantKind) continue;
    if (want.length && !want.every((t) => d.tags.includes(t))) continue;
    console.log(`started ${d.created_at}  ${d.kind.padEnd(12)} [${d.tags.join(", ")}]  ${d.title}${d.exists ? "" : "  (missing)"}\n    ${d.file_path}`);
  }
  process.exit(0);
}
if (cmd === "add") {
  if (!positional[0]) { console.error("usage: aiview add <file.md> [--kind k] [--tag t]..."); process.exit(1); }
  const d = registerDocument(path.resolve(positional[0]), opts());
  console.log(`#${d.id}  ${d.kind} [${d.tags.join(", ")}]  started ${d.created_at}  ${d.title}`);
  process.exit(0);
}
if (cmd === "remove") {
  if (!positional.length) { console.error("usage: aiview remove <file|#id>..."); process.exit(1); }
  for (const ref of positional) {
    const row = /^#?\d+$/.test(ref)
      ? db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(ref.replace("#", "")))
      : db.prepare("SELECT * FROM documents WHERE file_path = ?").get(toStored(path.resolve(ref)));
    if (!row) { console.error(`not in index: ${ref}`); continue; }
    db.prepare("DELETE FROM documents WHERE id = ?").run(row.id);
    console.log(`removed #${row.id}  ${row.title}  (file untouched)`);
  }
  process.exit(0);
}
if (cmd !== "serve") {
  console.error("usage: aiview serve [file.md] [--port 4321] [--open] [--kind k] [--tag t]... | add <file.md> [--kind k] [--tag t]... | list [--kind k] [--tag t]... | remove <file|#id>...");
  process.exit(1);
}

// ---------- serve ----------
const port = Number(flag("--port", process.env.AIVIEW_PORT ?? 4321));
const wantOpen = rest.includes("--open");
const startDoc = positional[0] ? registerDocument(path.resolve(positional[0]), opts()) : null;

// One directory watcher per document folder; broadcast {type:"changed", id} to SSE clients.
const clients = new Set();
const broadcast = (event) => { for (const res of clients) res.write(`data: ${JSON.stringify(event)}\n\n`); };
const watched = new Map(); // dir → fs.FSWatcher
const timers = new Map();
function ensureWatch(doc) {
  const dir = path.dirname(doc.abs_path);
  if (watched.has(dir)) return;
  try {
    const w = fs.watch(dir, (_e, name) => {
      if (!name) return;
      const hit = allDocs().find((d) => path.dirname(d.abs_path) === dir && path.basename(d.abs_path) === String(name));
      if (!hit) return;
      clearTimeout(timers.get(hit.id));
      timers.set(hit.id, setTimeout(() => { touch(hit.id); broadcast({ type: "changed", id: hit.id }); }, 150));
    });
    watched.set(dir, w);
  } catch (e) { console.error(`watch failed for ${dir}: ${e.message}`); }
}
for (const d of allDocs()) if (d.exists) ensureWatch(d);

// Vendored viewer libs. Fetched once from jsdelivr when missing (a repo copy can gitignore vendor/).
const VENDOR = {
  "marked.min.js": "https://cdn.jsdelivr.net/npm/marked@15/marked.min.js",
  "mermaid.min.js": "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js",
};
async function ensureVendor() {
  const dir = path.join(here, "vendor");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, url] of Object.entries(VENDOR)) {
    const f = path.join(dir, name);
    if (fs.existsSync(f) && fs.statSync(f).size > 1000) continue;
    process.stdout.write(`fetching ${name} … `);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`could not fetch ${url}: ${r.status}`);
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    console.log("ok");
  }
}
await ensureVendor();

const send = (res, status, body, type = "application/json; charset=utf-8") => {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
};
const json = (res, obj, status = 200) => send(res, status, JSON.stringify(obj));
const ui = fs.readFileSync(path.join(here, "ui.html"), "utf8");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/" || p === "/index.html") return send(res, 200, ui, "text/html; charset=utf-8");
  if (p.startsWith("/vendor/")) {
    const f = path.join(here, "vendor", path.basename(p));
    if (!fs.existsSync(f)) return send(res, 404, "not found", "text/plain");
    return send(res, 200, fs.readFileSync(f), "text/javascript; charset=utf-8");
  }
  if (p === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ type: "hello" })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (p === "/api/documents") return json(res, { documents: allDocs(), start: startDoc?.id ?? null });
  const m = p.match(/^\/api\/document\/(\d+)$/);
  if (m) {
    const doc = getDoc(m[1]);
    if (!doc) return json(res, { error: "not found" }, 404);
    if (!fs.existsSync(doc.abs_path)) return json(res, { document: doc, content: null });
    ensureWatch(doc);
    return json(res, { document: doc, format: isHtml(doc.file_path) ? "html" : "markdown", content: readDoc(doc.abs_path) });
  }
  send(res, 404, "not found", "text/plain");
});

function openBrowser(url) {
  const [c, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]]
    : ["xdg-open", [url]];
  try { spawn(c, args, { detached: true, stdio: "ignore" }).unref(); }
  catch (e) { console.error(`could not open browser: ${e.message}`); }
}

server.listen(port, "127.0.0.1", () => {
  const url = `http://localhost:${port}/${startDoc ? `#doc=${startDoc.id}` : ""}`;
  console.log(`aiview  ${startDoc ? startDoc.title : "(index)"}\n  url   ${url}`);
  if (wantOpen) openBrowser(url);
});
