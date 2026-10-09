import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { DEMO_PASSWORD } from '../server/seed.js';

let server, base;
before(async () => {
  ({ server } = createApp({ dbPath: ':memory:', seedData: true }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

async function call(cookie, method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data, cookie: res.headers.getSetCookie?.()[0]?.split(';')[0] };
}
async function login(name) {
  const r = await call(null, 'POST', '/api/auth/login', { email: `${name}@ajaia.test`, password: DEMO_PASSWORD });
  assert.equal(r.status, 200);
  return r.cookie;
}

test('auth: rejects bad credentials and unauthenticated access', async () => {
  const bad = await call(null, 'POST', '/api/auth/login', { email: 'alice@ajaia.test', password: 'wrong-password' });
  assert.equal(bad.status, 401);
  assert.equal((await call(null, 'GET', '/api/docs')).status, 401);
});

test('auth: signup validates input and creates a working session', async () => {
  assert.equal((await call(null, 'POST', '/api/auth/signup', { name: 'X', email: 'nope', password: 'longenough1' })).status, 400);
  assert.equal((await call(null, 'POST', '/api/auth/signup', { name: 'X', email: 'x@y.co', password: 'short' })).status, 400);
  const ok = await call(null, 'POST', '/api/auth/signup', { name: 'Dana', email: 'dana@ajaia.test', password: 'longenough1' });
  assert.equal(ok.status, 200);
  const me = await call(ok.cookie, 'GET', '/api/me');
  assert.equal(me.data.user.email, 'dana@ajaia.test');
  assert.equal((await call(null, 'POST', '/api/auth/signup', { name: 'D', email: 'dana@ajaia.test', password: 'longenough1' })).status, 409);
});

test('sharing: owned vs shared lists and role enforcement', async () => {
  const [alice, ben, chloe] = [await login('alice'), await login('ben'), await login('chloe')];
  const aliceDocs = (await call(alice, 'GET', '/api/docs')).data;
  const launch = aliceDocs.owned.find((d) => d.title === 'Q4 launch plan');
  assert.ok(launch && launch.sharedCount === 2);
  assert.ok(aliceDocs.shared.some((d) => d.title.startsWith('New hire')));

  const chloeDocs = (await call(chloe, 'GET', '/api/docs')).data;
  const asViewer = chloeDocs.shared.find((d) => d.id === launch.id);
  assert.equal(asViewer.role, 'viewer');
  assert.equal(asViewer.owner.name, 'Alice Moreno');

  assert.equal((await call(chloe, 'PATCH', `/api/docs/${launch.id}`, { content: '<p>hack</p>' })).status, 403);
  assert.equal((await call(chloe, 'DELETE', `/api/docs/${launch.id}`)).status, 403);
  assert.equal((await call(ben, 'PATCH', `/api/docs/${launch.id}`, { content: '<p>edited by ben</p>' })).status, 200);
  assert.equal((await call(ben, 'GET', `/api/docs/${launch.id}/shares`)).status, 403);

  const seen = (await call(alice, 'GET', `/api/docs/${launch.id}`)).data;
  assert.equal(seen.content, '<p>edited by ben</p>');
  assert.equal(seen.updatedBy, 'Ben Okafor');
});

test('sharing: unshared documents are invisible; owner can grant and revoke', async () => {
  const [alice, ben, chloe] = [await login('alice'), await login('ben'), await login('chloe')];
  const priv = (await call(chloe, 'GET', '/api/docs')).data.owned.find((d) => d.title === 'Interview notes');
  assert.equal((await call(ben, 'GET', `/api/docs/${priv.id}`)).status, 404);

  assert.equal((await call(chloe, 'POST', `/api/docs/${priv.id}/shares`, { email: 'nobody@ajaia.test' })).status, 404);
  assert.equal((await call(chloe, 'POST', `/api/docs/${priv.id}/shares`, { email: 'chloe@ajaia.test' })).status, 400);
  assert.equal((await call(chloe, 'POST', `/api/docs/${priv.id}/shares`, { email: 'ben@ajaia.test', role: 'admin' })).status, 400);
  assert.equal((await call(chloe, 'POST', `/api/docs/${priv.id}/shares`, { email: 'ben@ajaia.test', role: 'viewer' })).status, 200);
  assert.equal((await call(ben, 'GET', `/api/docs/${priv.id}`)).data.role, 'viewer');
  assert.equal((await call(ben, 'PATCH', `/api/docs/${priv.id}`, { title: 'x' })).status, 403);

  const people = (await call(chloe, 'GET', `/api/docs/${priv.id}/shares`)).data.people;
  assert.equal((await call(chloe, 'DELETE', `/api/docs/${priv.id}/shares/${people[0].userId}`)).status, 200);
  assert.equal((await call(ben, 'GET', `/api/docs/${priv.id}`)).status, 404);
  void alice;
});

test('documents: create, rename, persist formatting, sanitize, validate, stale-write conflict', async () => {
  const alice = await login('alice');
  const { data: { id } } = await call(alice, 'POST', '/api/docs', {});
  const html = '<h1>Hi</h1><p><b>bold</b> <i>it</i> <u>un</u></p><ul><li>x</li></ul><script>alert(1)</script>';
  const saved = await call(alice, 'PATCH', `/api/docs/${id}`, { title: 'My plan', content: html });
  assert.equal(saved.status, 200);
  const doc = (await call(alice, 'GET', `/api/docs/${id}`)).data;
  assert.equal(doc.title, 'My plan');
  assert.equal(doc.content, '<h1>Hi</h1><p><b>bold</b> <i>it</i> <u>un</u></p><ul><li>x</li></ul>');

  assert.equal((await call(alice, 'PATCH', `/api/docs/${id}`, { title: '   ' })).status, 400);
  const stale = await call(alice, 'PATCH', `/api/docs/${id}`, { content: '<p>late</p>', baseUpdatedAt: '2000-01-01T00:00:00.000Z' });
  assert.equal(stale.status, 409);
  assert.ok(stale.data.current.updatedAt);
});

test('import: markdown becomes an editable owned document; bad types are rejected', async () => {
  const alice = await login('alice');
  const md = new TextEncoder().encode('# Imported\n\n- a\n- b\n\nHello **world**');
  const r = await call(alice, 'POST', '/api/import', md, { 'x-filename': encodeURIComponent('meeting-notes.md'), 'Content-Type': 'application/octet-stream' });
  assert.equal(r.status, 201);
  const doc = (await call(alice, 'GET', `/api/docs/${r.data.id}`)).data;
  assert.equal(doc.title, 'meeting notes');
  assert.equal(doc.role, 'owner');
  assert.equal(doc.content, '<h1>Imported</h1><ul><li>a</li><li>b</li></ul><p>Hello <b>world</b></p>');

  const bad = await call(alice, 'POST', '/api/import', md, { 'x-filename': 'x.exe', 'Content-Type': 'application/octet-stream' });
  assert.equal(bad.status, 422);
});
