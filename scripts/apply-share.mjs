import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const SHARE_REVISION = '20261022-share-v1';
export const ADDED_FILES = ['library/share.js', 'library/share.css', 'library/open/index.html'];
export const SHELL_FILES = ['index.html', 'library/index.html', 'library/sw.js'];

export function transformShell(relativePath, content) {
  if (!SHELL_FILES.includes(relativePath)) throw new Error('Unapproved share shell: ' + relativePath);
  if (relativePath.endsWith('.html')) {
    if (content.includes('<!-- akiva-share-start -->')) return content;
    if (!content.includes('</head>')) throw new Error('Missing HTML head: ' + relativePath);
    const prefix = relativePath === 'index.html' ? 'library/' : '';
    const hook = `<!-- akiva-share-start -->\n<link rel="stylesheet" href="${prefix}share.css?v=${SHARE_REVISION}">\n<script defer src="${prefix}share.js?v=${SHARE_REVISION}"></script>\n<!-- akiva-share-end -->\n`;
    return content.replace('</head>', hook + '</head>');
  }
  if (content.includes('// akiva-share-cache-start')) return content;
  const shell = /const SHELL = `([^`]+)`;/;
  if (!shell.test(content) || !content.includes('const SHELL_FILES = [\n')) throw new Error('Unrecognized service worker shell');
  return content.replace(shell, (_, value) => 'const SHELL = `' + value + '-' + SHARE_REVISION + '`;')
    .replace('const SHELL_FILES = [\n', `const SHELL_FILES = [\n// akiva-share-cache-start\n  './share.css?v=${SHARE_REVISION}', './share.js?v=${SHARE_REVISION}', './open/',\n// akiva-share-cache-end\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || 'dist');
  for (const relative of SHELL_FILES) {
    const filename = path.join(root, relative);
    const before = fs.readFileSync(filename, 'utf8');
    const after = transformShell(relative, before);
    if (after !== before) fs.writeFileSync(filename, after);
  }
  console.log(JSON.stringify({shareRevision: SHARE_REVISION, shells: SHELL_FILES}));
}
