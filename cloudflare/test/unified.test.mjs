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
