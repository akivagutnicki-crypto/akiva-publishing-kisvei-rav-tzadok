import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import unified, { SoferKeyStore } from '../unified.mjs';

test('production API fails closed and minted access is revocable', async () => {
  const sql = new DatabaseSync(':memory:');
  const store = new SoferKeyStore({ storage: {
    sql: { exec(query, ...args) {
      const result = sql.prepare(query).all(...args);
      return { toArray: () => result };
    } },
  } });
  const origin = 'https://published.example';
  const admin = 'x'.repeat(40);
  const env = {
    OCR_ALLOWED_ORIGINS: origin, SOFERSTUDIO_ADMIN_KEY: admin,
    STUDIO_RATE_LIMITER: { limit: async () => ({ success: true }) },
    SOFER_KEY_STORE: { idFromName: id => id, get: () => ({ fetch: (url, init) => store.fetch(new Request(url, init)) }) },
  };
  const request = (path, method = 'GET', body, headers = {}) => unified(new Request('https://worker.example' + path, {
    method, headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: body && JSON.stringify(body),
  }), env);
  const closed = await request('/v1/nikkud', 'POST', { text: 'שלום' });
  assert.equal(closed.status, 401);
  const preflight = await request('/v1/nikkud', 'OPTIONS');
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  assert.equal((await request('/v1/admin/keys')).status, 403);
  const adminHeaders = { 'X-Admin-Key': admin };
  const minted = await request('/v1/admin/keys', 'POST', { label: 'Regression test' }, adminHeaders);
  assert.equal(minted.status, 201);
  const { key, id } = await minted.json();
  const access = { Authorization: 'Bearer ' + key };
  const health = await request('/v1/health', 'GET', undefined, access);
  assert.equal((await health.json()).authorized, true);
  assert.equal((await request('/v1/nikkud', 'POST', { text: 'שלום' }, access)).status, 503);
  const listed = await (await request('/v1/admin/keys', 'GET', undefined, adminHeaders)).json();
  assert.equal(listed.keys[0].id, id);
  assert.deepEqual(Object.keys(listed.keys[0]).sort(), ['created','id','label','requests','revoked']);
  assert.equal((await request('/v1/admin/keys/' + id, 'DELETE', undefined, adminHeaders)).status, 200);
  assert.equal((await request('/v1/nikkud', 'POST', { text: 'שלום' }, access)).status, 401);
  assert.equal((await request('/v1/nikkud', 'POST', { text: 'שלום' }, { Origin: 'https://other.example' })).status, 403);
});

test('Sefer Pro pages may mint a key with the admin key; other pages get no browser access', async () => {
  const sql = new DatabaseSync(':memory:');
  const store = new SoferKeyStore({ storage: { sql: { exec(query, ...args) { const result = sql.prepare(query).all(...args); return { toArray: () => result }; } } } });
  const site = 'https://published.example';
  const admin = 'y'.repeat(40);
  const env = {
    OCR_ALLOWED_ORIGINS: site, SOFERSTUDIO_ADMIN_KEY: admin,
    STUDIO_RATE_LIMITER: { limit: async () => ({ success: true }) },
    SOFER_KEY_STORE: { idFromName: id => id, get: () => ({ fetch: (url, init) => store.fetch(new Request(url, init)) }) },
  };
  const call = (path, method, origin, headers = {}, body) => unified(new Request('https://worker.example' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), ...headers }, body: body && JSON.stringify(body),
  }), env);
  const pre = await call('/v1/admin/keys', 'OPTIONS', site, { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-admin-key,content-type' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), site);
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /X-Admin-Key/);
  assert.equal((await call('/v1/admin/keys', 'OPTIONS', 'https://evil.example')).status, 403);
  const wrong = await call('/v1/admin/keys', 'POST', site, { 'X-Admin-Key': 'z'.repeat(40) }, { label: 'x' });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.headers.get('Access-Control-Allow-Origin'), site);
  assert.equal((await wrong.json()).code, 'invalid_admin_key');
  const minted = await call('/v1/admin/keys', 'POST', site, { 'X-Admin-Key': admin }, { label: 'Sefer Pro' });
  assert.equal(minted.status, 201);
  assert.equal(minted.headers.get('Access-Control-Allow-Origin'), site);
  const { key } = await minted.json();
  assert.match(key, /^sfpro_[0-9a-f]{64}$/);
  const health = await call('/v1/health', 'GET', site, { Authorization: 'Bearer ' + key });
  assert.equal((await health.json()).authorized, true);
  assert.equal((await call('/v1/admin/keys', 'POST', 'https://evil.example', { 'X-Admin-Key': admin }, { label: 'x' })).headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await call('/v1/admin/keys', 'GET', site, { 'X-Admin-Key': admin })).headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await call('/v1/admin/keys', 'GET', null, { 'X-Admin-Key': admin })).status, 200);
});
