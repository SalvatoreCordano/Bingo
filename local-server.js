// Servidor para jugar en local (misma red WiFi): `npm start`.
// Sirve la carpeta public/ y la misma API que usa Vercel, con las salas en memoria.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleApi } = require('./lib/game');
const { createStore } = require('./lib/store');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const store = createStore();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveStatic(res, pathname) {
  const file = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, file));
  const target = filePath.startsWith(PUBLIC_DIR) ? filePath : path.join(PUBLIC_DIR, 'index.html');
  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 10_000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
  const { status, data } = await handleApi(store, {
    method: req.method,
    parts: url.pathname.split('/').filter(Boolean).slice(1),
    query: Object.fromEntries(url.searchParams),
    body: req.method === 'POST' ? await readBody(req) : {},
  });
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
});

server.listen(PORT, () => console.log(`Juegos listos en http://localhost:${PORT}`));
