// Función de Vercel: atiende todo /api/* (ver vercel.json).
const { handleApi } = require('../lib/game');
const { createStore } = require('../lib/store');

const store = createStore();

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.searchParams.get('path') || url.pathname.replace(/^\/api\/?/, '');
  const parts = path.split('/').filter(Boolean);
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { status, data } = await handleApi(store, {
    method: req.method,
    parts,
    query: Object.fromEntries(url.searchParams),
    body,
  });
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(data);
};
