import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = process.argv[2] || 'dist/library';
const listing = JSON.parse(fs.readFileSync(`${root}/downloads/halacha/index.json`, 'utf8'));
const release = 'https://github.com/akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok/releases/download/';
assert.deepEqual(listing.packs.map(p => p.id), ['halakhah-with-meforshim', 'torahlm-halakhah', 'halachipedia-torahlm']);
for (const pack of listing.packs) {
  assert(pack.url.startsWith(release + listing.release + '/'), 'Unexpected download location ' + pack.url);
  assert(pack.url.endsWith('/' + pack.file) && pack.file.endsWith('.zip'));
  assert(pack.bytes > 100000 && /^[0-9a-f]{64}$/.test(pack.sha256));
}
assert(listing.packs[0].works >= 2000 && listing.packs[0].commentaries > 0 && listing.packs[0].versions > listing.packs[0].works);
assert(listing.packs[1].files >= 2000 && listing.packs[2].files >= 1);

const html = fs.readFileSync(`${root}/index.html`, 'utf8');
assert.equal((html.match(/id="halachaZips"/g) || []).length, 1, 'One Halacha ZIP section');
assert.equal((html.match(/<script src="halacha-zips\.js\?v=20261101-halacha-zips-v1"><\/script>/g) || []).length, 1);
assert(html.includes("window.AkivaHalachaZips?.render(document.getElementById('halachaZips'));"));
for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (script[1].trim()) new vm.Script(script[1]);
assert(fs.readFileSync(`${root}/sw.js`, 'utf8').includes('-20261101-halacha-zips-v1'));

const box = {innerHTML: '', isConnected: true};
const context = {window: {}, fetch: async () => ({ok: true, json: async () => listing})};
vm.createContext(context);
vm.runInContext(fs.readFileSync(`${root}/halacha-zips.js`, 'utf8'), context);
await context.window.AkivaHalachaZips.render(box);
assert.equal((box.innerHTML.match(/class="pack" data-id=/g) || []).length, 3);
for (const pack of listing.packs) assert(box.innerHTML.includes(`href="${pack.url}"`));
assert(box.innerHTML.includes('meforshim') && box.innerHTML.includes(' MB'));
console.log('PASS: three Halacha ZIPs (Sefaria, TorahLM, Halachipedia) listed with release links, sizes and counts.');
