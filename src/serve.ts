// A loopback static server: serves a built site under its base path, plus extra files at fixed paths.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain',
};

/**
 * Maps a URL path to a file inside root, or null. Static exports use page.html or page/index.html for /page.
 * Never returns a path outside root.
 */
export function resolveFile(root: string, base: string, urlPath: string): string | null {
  let path: string;
  try { path = decodeURIComponent(urlPath); } catch { return null; }
  if (base && (path === base || path.startsWith(base + '/'))) path = path.slice(base.length) || '/';
  const top = resolve(root);
  for (const candidate of [path, `${path}.html`, `${path.replace(/\/$/, '')}/index.html`]) {
    const file = resolve(top, '.' + candidate);
    // Skip, don't stop: "/" resolves to the root itself, and its index.html candidate is still fine.
    if (file.startsWith(top + sep) && existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

/**
 * Serves root at base; both are read per request, since each commit can move them.
 * `extra` maps exact URL paths to files outside root (the composer page, frames).
 */
export function serve(getRoot: () => string, getBase: () => string, extra: () => Record<string, string> = () => ({})): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const file = extra()[path] ?? resolveFile(getRoot(), getBase(), path);
    if (!file) return void res.writeHead(404).end('Not found');
    res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' })
      .end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    ok({ server, url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}` });
  }));
}
