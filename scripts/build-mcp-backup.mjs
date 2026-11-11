// Builds the local backup MCP server as an MCP Bundle (dist/kisvei-library-local.mcpb): open it in the Claude desktop
// app to install. It carries the current cloudflare/mcp.mjs, so rebuild after server changes.
// Usage: node scripts/build-mcp-backup.mjs   (needs network once for npx @anthropic-ai/mcpb)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
fs.copyFileSync('cloudflare/mcp.mjs', 'mcp-backup/server/mcp.mjs');
const m = JSON.parse(fs.readFileSync('mcp-backup/manifest.json', 'utf8'));
fs.mkdirSync('dist', { recursive: true });
execFileSync('npx', ['-y', '@anthropic-ai/mcpb@2.1.2', 'validate', 'mcp-backup/manifest.json'], { stdio: 'inherit' });
execFileSync('npx', ['-y', '@anthropic-ai/mcpb@2.1.2', 'pack', 'mcp-backup', 'dist/kisvei-library-local.mcpb'], { stdio: 'inherit' });
console.log(`Built dist/kisvei-library-local.mcpb (version ${m.version})`);
