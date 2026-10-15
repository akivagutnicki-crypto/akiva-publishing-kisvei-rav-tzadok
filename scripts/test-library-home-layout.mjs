// Regression checks for the public reader homepage (book grouping + donation UI).
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html=fs.readFileSync('dist/library/index.html','utf8');
const home=html.slice(html.indexOf('async function renderHome()'),html.indexOf('async function renderBook('));
assert.ok(home.length>7000,'Could not isolate the reader homepage');
const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .map(x=>x[1]).find(Boolean);
assert.ok(script?.length>50000,'Missing main reader JavaScript');
new vm.Script(script); // A malformed template/string would break the entire reader.

// The erroneous Sefaria category must not create a trailing Rav Tzadok group.
const matching=home.match(/CATALOG\.map\(b => \(\{([^\n]+)\}\)\)/);
assert.ok(matching,'Catalog-to-card mapping absent');
const canon=vm.runInNewContext('(b,GROUPS) => ({'+matching[1]+'})');
const group="R' Tzadok HaKohen";
const books=[
 {title:'Machshavot Charutz',group:'Rav Tzadok HaKohen'},
 {title:'Tzidkat HaTzadik',group}
].map(b=>canon(b,[{id:group}]));
assert.equal(books[0].group,group,'Machshavot Charutz is outside Rav Tzadok group');
assert.equal(books[1].group,group,'Other Rav Tzadok books moved accidentally');
assert.ok(home.includes('books.filter(b => b.group === g.id)'),'Homepage grouping method changed');

// Only remove the oversized donation box. Keep the sidebar and the nav button.
assert.ok(!home.includes('<section class="akiva-donate-home"'), 'Oversized homepage donation section returned');
assert.ok(home.includes('class="akiva-mini-support"'), 'Small right-sidebar donation card missing');
assert.ok(html.includes('class="btn donate-nav"'), 'Navbar Donate button missing');
assert.ok(html.includes('function renderSupport()'), 'Support destination missing');
assert.ok(home.includes('<div class="books">'), 'Book list missing');

console.log('PASS: Machshavot Charutz sits with Rav Tzadok works, oversized donation removed, navbar and small sidebar donation retained; reader JavaScript parses.');
