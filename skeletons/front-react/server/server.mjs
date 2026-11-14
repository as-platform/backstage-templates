import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const baseHeaders = { 'X-Content-Type-Options': 'nosniff' };
const immutable = 'public, max-age=31536000, immutable';

const respond = (res, status, headers = {}, body) => {
  res.writeHead(status, { ...baseHeaders, ...headers });
  res.end(body);
};

const resolveInside = (root, pathname) => {
  const candidate = path.resolve(root, `.${pathname}`);
  return candidate === root || candidate.startsWith(root + path.sep) ? candidate : null;
};

const statFile = async (file) => {
  try {
    const info = await stat(file);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
};

const sendFile = (req, res, file, size, cacheControl) => {
  res.writeHead(200, {
    ...baseHeaders,
    'Content-Type': contentTypes[path.extname(file)] ?? 'application/octet-stream',
    'Content-Length': size,
    'Cache-Control': cacheControl,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
};

export const createHandler = (root) => async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    respond(res, 405, { Allow: 'GET, HEAD' });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(`http://localhost${req.url}`).pathname);
  } catch {
    respond(res, 400);
    return;
  }

  if (pathname === '/healthz' || pathname === '/readyz') {
    respond(res, 200, { 'Content-Type': 'text/plain; charset=utf-8' }, req.method === 'HEAD' ? undefined : 'ok\n');
    return;
  }

  const target = resolveInside(root, pathname);
  if (target === null) {
    respond(res, 404);
    return;
  }

  const size = await statFile(target);
  if (size !== null) {
    sendFile(req, res, target, size, pathname.startsWith('/assets/') ? immutable : 'no-cache');
    return;
  }

  const index = path.join(root, 'index.html');
  const indexSize = path.extname(pathname) === '' ? await statFile(index) : null;
  if (indexSize === null) {
    respond(res, 404);
    return;
  }
  sendFile(req, res, index, indexSize, 'no-cache');
};

export const shutdown = (server) => {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => server.closeAllConnections(), 5000).unref();
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  const port = Number(process.env.PORT ?? 8080);
  const server = createServer(createHandler(root));
  server.listen(port, () => {
    console.log(JSON.stringify({ msg: 'listening', port }));
  });
  process.on('SIGTERM', () => shutdown(server));
  process.on('SIGINT', () => shutdown(server));
}
