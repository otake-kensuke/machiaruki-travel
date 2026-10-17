import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    // The alias exercises GitHub Pages-style project subdirectories in local QA.
    if (pathname.startsWith('/machiaruki-travel/')) pathname = pathname.slice('/machiaruki-travel'.length);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filename = path.resolve(root, `.${pathname}`);
    const relative = path.relative(root, filename);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !['index.html', 'manifest.webmanifest', 'sw.js'].includes(relative) && !['src', 'assets', 'samples'].includes(relative.split(path.sep)[0])) { response.writeHead(404); response.end('Not found'); return; }
    const resolved = await realpath(filename);
    if (path.relative(root, resolved).startsWith('..')) { response.writeHead(404); response.end(); return; }
    const bytes = await readFile(resolved);
    response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}/`));
