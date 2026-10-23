import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.argv[2] || 'dist';
const version = '20261022-responsive-v1';
const htmlPath = path.join(root,'library/index.html');
const swPath = path.join(root,'library/sw.js');
let html = fs.readFileSync(htmlPath,'utf8');
let sw = fs.readFileSync(swPath,'utf8');
if(!html.includes('id="akiva-responsive-ui"')){
  assert.equal(html.split('<span class="mark">AP</span>').length,2,'Expected exactly one original AP mark');
  html=html.replace('<span class="mark">AP</span>','<span class="mark"><img src="icons/icon.svg" alt="Akiva Publishing logo" width="46" height="46"></span>');
  html=html.replace('<a href="../">Our editions</a>','<a href="../">Our books</a>').replace('<a href="../#method">Approach</a>','<a href="../#method">About</a>');
  assert.equal(html.split('</head>').length,2);
  html=html.replace('</head>',`<link id="akiva-responsive-ui" rel="stylesheet" href="responsive-ui.css?v=${version}">\n<script defer src="responsive-ui.js?v=${version}"></script>\n</head>`);
}
if(!sw.includes('-reader-ui-'+version)){
  const shell=/const SHELL = `([^`]+)`;/;
  assert(shell.test(sw),'Expected existing cache shell declaration');
  sw=sw.replace(shell,(_,value)=>'const SHELL = `'+value+'-reader-ui-'+version+'`;');
  assert(sw.includes('const SHELL_FILES = ['));
  sw=sw.replace('const SHELL_FILES = [',`const SHELL_FILES = [\n  './responsive-ui.css?v=${version}', './responsive-ui.js?v=${version}',`);
}
fs.writeFileSync(htmlPath,html);fs.writeFileSync(swPath,sw);
for(const name of ['responsive-ui.css','responsive-ui.js']){
  const source=path.resolve('dist/library',name),destination=path.resolve(root,'library',name);
  if(source!==destination) fs.copyFileSync(source,destination);
}
if(process.argv.includes('--source')){
  const file='.github/workflows/pages.yml';let yml=fs.readFileSync(file,'utf8');
  if(!yml.includes('[reader-ui-release]')){
    const token="!contains(github.event.head_commit.message, '[divrei-media-release]')";
    assert.equal(yml.split(token).length-1,2,'Expected exactly two full publisher routing guards');
    yml=yml.split(token).join(token+" && !contains(github.event.head_commit.message, '[reader-ui-release]')");
    fs.writeFileSync(file,yml);
  }
}
console.log('Applied responsive UI; no sefer, annotation, source, media or download files were edited.');
