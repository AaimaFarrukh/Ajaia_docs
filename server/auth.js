import { randomBytes, createHash, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';

const SESSION_DAYS = 14;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

const DUMMY = hashPassword('not-a-real-password');

export function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Burn equivalent CPU when the account does not exist, so timing doesn't reveal valid emails. */
export function fakeVerify(password) { verifyPassword(password, DUMMY); }

const sha = (t) => createHash('sha256').update(t).digest('hex');

export function createUser(db, { email, name, password }) {
  const id = randomUUID();
  db.prepare('INSERT INTO users (id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)')
    .run(id, email, name, hashPassword(password), new Date().toISOString());
  return id;
}

export function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400e3).toISOString();
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(sha(token), userId, expires);
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(token));
}

export function userFromToken(db, token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.id,u.email,u.name,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`
  ).get(sha(token));
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) { destroySession(db, token); return null; }
  return { id: row.id, email: row.email, name: row.name };
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
