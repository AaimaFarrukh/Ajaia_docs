import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import {
  createUser, createSession, destroySession, userFromToken, verifyPassword, fakeVerify, parseCookies,
} from './auth.js';
import { sanitizeHtml, htmlToText } from './sanitize.js';
import { importFile, ImportError, MAX_IMPORT_BYTES } from './importers.js';
import { seed } from './seed.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MAX_JSON = 2 * 1024 * 1024;
const MAX_CONTENT = 1_500_000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
};

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = (e) => String(e ?? '').trim().toLowerCase();

function validateTitle(t) {
  const title = String(t ?? '').replace(/\s+/g, ' ').trim();
  if (!title) throw new HttpError(400, 'Give the document a title.');
  if (title.length > 120) throw new HttpError(400, 'Titles can be at most 120 characters.');
  return title;
}

export function createApp({ dbPath = ':memory:', seedData = false, cookieSecure = false } = {}) {
  const db = openDb(dbPath);
  if (seedData) seed(db);
  const loginAttempts = new Map();

  /* ---------- helpers ---------- */
  const q = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email=?'),
    doc: db.prepare(
      `SELECT d.*, o.name AS owner_name, o.email AS owner_email, ub.name AS updated_by_name
       FROM documents d JOIN users o ON o.id=d.owner_id LEFT JOIN users ub ON ub.id=d.updated_by WHERE d.id=?`),
    share: db.prepare('SELECT role FROM shares WHERE doc_id=? AND user_id=?'),
  };

  function access(docId, userId) {
    const doc = q.doc.get(docId);
    if (!doc) return {};
    if (doc.owner_id === userId) return { doc, role: 'owner' };
    const s = q.share.get(docId, userId);
    return s ? { doc, role: s.role } : {};
  }
  /** Not-found and no-access look identical so ids can't be probed. */
  function requireDoc(docId, user, minimum = 'viewer') {
    const { doc, role } = access(docId, user.id);
    if (!doc) throw new HttpError(404, 'Document not found.');
    if (minimum === 'owner' && role !== 'owner') throw new HttpError(403, 'Only the owner can do that.');
    if (minimum === 'editor' && role === 'viewer') throw new HttpError(403, 'You have view-only access to this document.');
    return { doc, role };
  }
  const docJson = (doc, role) => ({
    id: doc.id, title: doc.title, content: doc.content, role,
    owner: { id: doc.owner_id, name: doc.owner_name, email: doc.owner_email },
    updatedAt: doc.updated_at, updatedBy: doc.updated_by_name || null,
  });

  async function readBody(req, limit) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw new HttpError(413, `That's too large. The limit is ${Math.round(limit / 1048576)} MB.`);
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  }
  async function readJson(req) {
    if (!(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Expected JSON.');
    const buf = await readBody(req, MAX_JSON);
    try { const v = JSON.parse(buf.toString('utf8') || '{}'); return v && typeof v === 'object' ? v : {}; }
    catch { throw new HttpError(400, 'Request body is not valid JSON.'); }
  }

  /* ---------- routes ---------- */
  const routes = [];
  const route = (method, path, opts, handler) => {
    if (typeof opts === 'function') { handler = opts; opts = {}; }
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, public: !!opts.public, handler });
  };

  route('GET', '/api/health', { public: true }, () => ({ ok: true }));

  route('POST', '/api/auth/signup', { public: true }, async (ctx) => {
    const b = await readJson(ctx.req);
    const email = normEmail(b.email);
    const name = String(b.name ?? '').trim();
    const password = String(b.password ?? '');
    if (!name || name.length > 80) throw new HttpError(400, 'Enter your name (up to 80 characters).');
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Use a password with at least 8 characters.');
    if (q.userByEmail.get(email)) throw new HttpError(409, 'An account with that email already exists. Sign in instead.');
    const id = createUser(db, { email, name, password });
    ctx.startSession(id);
    return { user: { id, email, name } };
  });

  route('POST', '/api/auth/login', { public: true }, async (ctx) => {
    const b = await readJson(ctx.req);
    const email = normEmail(b.email);
    const password = String(b.password ?? '');
    const key = `${ctx.req.socket.remoteAddress}|${email}`;
    const now = Date.now();
    const recent = (loginAttempts.get(key) || []).filter((t) => now - t < 15 * 60e3);
    if (recent.length >= 10) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
    const user = q.userByEmail.get(email);
    const ok = user ? verifyPassword(password, user.password_hash) : (fakeVerify(password), false);
    if (!ok) {
      recent.push(now); loginAttempts.set(key, recent);
      throw new HttpError(401, 'Email or password is incorrect.');
    }
    loginAttempts.delete(key);
    ctx.startSession(user.id);
    return { user: { id: user.id, email: user.email, name: user.name } };
  });

  route('POST', '/api/auth/logout', { public: true }, (ctx) => {
    destroySession(db, ctx.token);
    ctx.clearSession();
    return { ok: true };
  });

  route('GET', '/api/me', { public: true }, (ctx) => ({ user: ctx.user }));

  route('GET', '/api/docs', (ctx) => {
    const preview = (c) => htmlToText(c.replace(/^\s*<h1>[\s\S]*?<\/h1>/, '')).slice(0, 140);
    const owned = db.prepare(
      `SELECT d.id,d.title,d.content,d.updated_at,
        (SELECT COUNT(*) FROM shares s WHERE s.doc_id=d.id) AS shared_count
       FROM documents d WHERE d.owner_id=? ORDER BY d.updated_at DESC`).all(ctx.user.id)
      .map((d) => ({ id: d.id, title: d.title, preview: preview(d.content), updatedAt: d.updated_at, sharedCount: d.shared_count }));
    const shared = db.prepare(
      `SELECT d.id,d.title,d.content,d.updated_at,s.role,o.name AS owner_name,o.email AS owner_email
       FROM shares s JOIN documents d ON d.id=s.doc_id JOIN users o ON o.id=d.owner_id
       WHERE s.user_id=? ORDER BY d.updated_at DESC`).all(ctx.user.id)
      .map((d) => ({
        id: d.id, title: d.title, preview: preview(d.content), updatedAt: d.updated_at, role: d.role,
        owner: { name: d.owner_name, email: d.owner_email },
      }));
    return { owned, shared };
  });

  route('POST', '/api/docs', async (ctx) => {
    const b = await readJson(ctx.req);
    const title = b.title === undefined ? 'Untitled document' : validateTitle(b.title);
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO documents (id,owner_id,title,content,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,?)')
      .run(id, ctx.user.id, title, '<p><br></p>', now, now, ctx.user.id);
    ctx.status = 201;
    return { id };
  });

  route('GET', '/api/docs/:id', (ctx) => {
    const { doc, role } = requireDoc(ctx.params.id, ctx.user);
    return docJson(doc, role);
  });

  route('PATCH', '/api/docs/:id', async (ctx) => {
    const { doc } = requireDoc(ctx.params.id, ctx.user, 'editor');
    const b = await readJson(ctx.req);
    if (b.baseUpdatedAt && b.baseUpdatedAt !== doc.updated_at) {
      throw new HttpError(409, 'Someone else saved a newer version of this document.', {
        current: { updatedAt: doc.updated_at, updatedBy: doc.updated_by_name || null },
      });
    }
    const title = b.title !== undefined ? validateTitle(b.title) : doc.title;
    let content = doc.content;
    if (b.content !== undefined) {
      if (typeof b.content !== 'string') throw new HttpError(400, 'Content must be a string.');
      if (b.content.length > MAX_CONTENT) throw new HttpError(413, 'This document is too large to save.');
      content = sanitizeHtml(b.content);
    }
    const now = new Date().toISOString();
    db.prepare('UPDATE documents SET title=?,content=?,updated_at=?,updated_by=? WHERE id=?')
      .run(title, content, now, ctx.user.id, doc.id);
    return { updatedAt: now, updatedBy: ctx.user.name };
  });

  route('DELETE', '/api/docs/:id', (ctx) => {
    const { doc } = requireDoc(ctx.params.id, ctx.user, 'owner');
    db.prepare('DELETE FROM documents WHERE id=?').run(doc.id);
    return { ok: true };
  });

  route('GET', '/api/docs/:id/shares', (ctx) => {
    const { doc } = requireDoc(ctx.params.id, ctx.user, 'owner');
    const people = db.prepare(
      `SELECT u.id AS userId,u.name,u.email,s.role FROM shares s JOIN users u ON u.id=s.user_id
       WHERE s.doc_id=? ORDER BY s.created_at`).all(doc.id).map((r) => ({ ...r }));
    return { owner: { id: doc.owner_id, name: doc.owner_name, email: doc.owner_email }, people };
  });

  route('POST', '/api/docs/:id/shares', async (ctx) => {
    const { doc } = requireDoc(ctx.params.id, ctx.user, 'owner');
    const b = await readJson(ctx.req);
    const email = normEmail(b.email);
    const role = b.role === undefined ? 'editor' : b.role;
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
    if (!['editor', 'viewer'].includes(role)) throw new HttpError(400, 'Role must be editor or viewer.');
    const target = q.userByEmail.get(email);
    if (!target) throw new HttpError(404, 'No one has an account with that email yet. Ask them to sign up first.');
    if (target.id === ctx.user.id) throw new HttpError(400, 'You already own this document.');
    db.prepare(
      `INSERT INTO shares (doc_id,user_id,role,created_at) VALUES (?,?,?,?)
       ON CONFLICT(doc_id,user_id) DO UPDATE SET role=excluded.role`).run(doc.id, target.id, role, new Date().toISOString());
    return { userId: target.id, name: target.name, email: target.email, role };
  });

  route('DELETE', '/api/docs/:id/shares/:userId', (ctx) => {
    const { doc, role } = requireDoc(ctx.params.id, ctx.user);
    if (role !== 'owner' && ctx.params.userId !== ctx.user.id) throw new HttpError(403, 'Only the owner can remove people.');
    db.prepare('DELETE FROM shares WHERE doc_id=? AND user_id=?').run(doc.id, ctx.params.userId);
    return { ok: true };
  });

  route('POST', '/api/import', async (ctx) => {
    let filename;
    try { filename = decodeURIComponent(String(ctx.req.headers['x-filename'] || '')); } catch { filename = ''; }
    if (!filename) throw new HttpError(400, 'Choose a file to import.');
    const buf = await readBody(ctx.req, MAX_IMPORT_BYTES);
    let result;
    try { result = importFile(filename, buf); }
    catch (e) { if (e instanceof ImportError) throw new HttpError(422, e.message); throw e; }
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO documents (id,owner_id,title,content,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,?)')
      .run(id, ctx.user.id, result.title, result.html, now, now, ctx.user.id);
    ctx.status = 201;
    return { id, title: result.title };
  });

  /* ---------- static files ---------- */
  async function serveStatic(req, res) {
    const url = new URL(req.url, 'http://x');
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (rel.includes('..')) rel = '';
    let file = join(PUBLIC_DIR, rel || 'index.html');
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = join(file, 'index.html');
    } catch { file = join(PUBLIC_DIR, 'index.html'); }
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  /* ---------- server ---------- */
  const secure = cookieSecure || process.env.COOKIE_SECURE === '1';
  const server = http.createServer(async (req, res) => {
    const headers = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy':
        "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'",
    };
    const setCookies = [];
    const send = (status, body) => {
      const data = JSON.stringify(body);
      res.writeHead(status, {
        ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        ...(setCookies.length ? { 'Set-Cookie': setCookies } : {}),
      });
      res.end(data);
    };
    try {
      const path = req.url.split('?')[0];
      if (!path.startsWith('/api/')) {
        for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
        return await serveStatic(req, res);
      }
      const token = parseCookies(req.headers.cookie).sid;
      const user = userFromToken(db, token);
      const cookieBase = `sid=; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
      const ctx = {
        req, token, user, params: {}, status: 200,
        startSession(userId) {
          const s = createSession(db, userId);
          setCookies.push(`sid=${s.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${s.maxAge}${secure ? '; Secure' : ''}`);
        },
        clearSession() { setCookies.push(`${cookieBase}; Max-Age=0`); },
      };
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = path.match(r.re);
        if (!m) continue;
        r.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });
        if (!r.public && !user) throw new HttpError(401, 'Sign in to continue.');
        const result = await r.handler(ctx);
        return send(ctx.status, result);
      }
      throw new HttpError(404, 'Not found.');
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message, ...(e.extra || {}) });
      console.error(e);
      return send(500, { error: 'Something went wrong on our side. Try again.' });
    }
  });
  server.on('close', () => db.close());
  return { server, db };
}
