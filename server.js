// Servidor del Bingo: salas en memoria + avisos en tiempo real con Server-Sent Events.
// Sin dependencias externas: solo Node.js (>= 18).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ROOM_TTL_MS = 12 * 60 * 60 * 1000; // una sala sin actividad se borra a las 12 h
const SPIN_MS = 5000; // lo que dura el giro de la ruleta del Tutti Frutti
// Letras de la ruleta: se dejan fuera las que casi no tienen palabras (K, Ñ, Q, W, X, Y, Z)
const LETTERS = 'ABCDEFGHIJLMNOPRSTUV'.split('');
const CATEGORIES = [
  'Nombre',
  'Fruta o verdura',
  'Ciudad o país',
  'Excusa para llegar tarde',
  'Algo que llevarías a una isla desierta',
  'Algo que se encuentra en una cartera',
  'Superhéroe',
];

const rooms = new Map();

// ---------- Cartón de bingo de 90 bolas ----------
// 3 filas x 9 columnas, 15 números, 5 por fila, 1 a 3 por columna.
// Columna 0: 1-9, columna 1: 10-19, ..., columna 8: 80-90.
function randInt(max) {
  return crypto.randomInt(max);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function columnRange(col) {
  const start = col === 0 ? 1 : col * 10;
  const end = col === 8 ? 90 : col * 10 + 9;
  const nums = [];
  for (let n = start; n <= end; n++) nums.push(n);
  return nums;
}

function generateCard() {
  while (true) {
    // Cuántos números lleva cada columna: al menos 1, máximo 3, total 15.
    const counts = Array(9).fill(1);
    let extra = 6;
    while (extra > 0) {
      const c = randInt(9);
      if (counts[c] < 3) {
        counts[c]++;
        extra--;
      }
    }

    // En qué filas va cada columna; se reintenta hasta que cada fila tenga 5.
    const layout = counts.map((count) => shuffle([0, 1, 2]).slice(0, count).sort());
    const perRow = [0, 0, 0];
    layout.forEach((rows) => rows.forEach((r) => perRow[r]++));
    if (perRow.some((n) => n !== 5)) continue;

    const grid = [Array(9).fill(null), Array(9).fill(null), Array(9).fill(null)];
    layout.forEach((rows, col) => {
      const nums = shuffle(columnRange(col)).slice(0, rows.length).sort((a, b) => a - b);
      rows.forEach((r, i) => {
        grid[r][col] = nums[i];
      });
    });
    return grid;
  }
}

// ---------- Salas ----------
function newRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I ni O para no confundir
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[randInt(letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function newId() {
  return crypto.randomBytes(12).toString('hex');
}

function publicState(room, playerId) {
  const player = room.players.get(playerId);
  const state = {
    game: room.game, // 'bingo' | 'tutti'
    code: room.code,
    round: room.round,
    phase: room.phase,
    hostId: room.hostId,
    me: player ? { id: player.id, name: player.name } : null,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      online: p.clients.size > 0,
    })),
  };
  if (room.game === 'bingo') {
    // phase: 'linea' | 'bingo' | 'terminado'
    if (state.me) state.me.card = player.card;
    state.claims = room.claims;
  } else {
    // phase: 'esperando' | 'girando' | 'jugando' | 'basta'
    state.letters = LETTERS;
    state.categories = CATEGORIES;
    state.letter = room.letter;
    state.usedLetters = room.usedLetters;
    state.spinEndsAt = room.spinEndsAt;
    state.spinMs = SPIN_MS;
    state.bastaBy = room.bastaBy;
  }
  return state;
}

function broadcast(room, event) {
  room.updatedAt = Date.now();
  for (const player of room.players.values()) {
    const payload = JSON.stringify({ ...event, state: publicState(room, player.id) });
    for (const res of player.clients) res.write(`data: ${payload}\n\n`);
  }
}

function addPlayer(room, name) {
  const player = { id: newId(), name, clients: new Set() };
  if (room.game === 'bingo') player.card = generateCard();
  room.players.set(player.id, player);
  return player;
}

// Limpieza periódica de salas abandonadas
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.updatedAt > ROOM_TTL_MS) rooms.delete(code);
  }
}, 30 * 60 * 1000).unref();

// ---------- HTTP ----------
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 10_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function cleanName(name) {
  return String(name || '').trim().slice(0, 20);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveStatic(req, res, pathname) {
  const file = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, file));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Prohibido' });
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Cualquier ruta desconocida devuelve la app (ej: /?sala=ABCD)
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, html) => {
        if (err2) return sendJson(res, 404, { error: 'No encontrado' });
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean); // ['api','rooms',CODE,action]

  if (parts[0] !== 'api') return serveStatic(req, res, url.pathname);

  // POST /api/rooms -> crear sala
  if (req.method === 'POST' && parts[1] === 'rooms' && parts.length === 2) {
    const body = await readBody(req);
    const name = cleanName(body.name);
    if (!name) return sendJson(res, 400, { error: 'Escribe tu nombre' });
    const game = body.game === 'tutti' ? 'tutti' : 'bingo';
    const room = {
      game,
      code: newRoomCode(),
      round: game === 'bingo' ? 1 : 0,
      phase: game === 'bingo' ? 'linea' : 'esperando',
      hostId: null,
      players: new Map(),
      updatedAt: Date.now(),
    };
    if (game === 'bingo') room.claims = [];
    else Object.assign(room, { letter: null, usedLetters: [], spinEndsAt: null, bastaBy: null });
    const host = addPlayer(room, name);
    room.hostId = host.id;
    rooms.set(room.code, room);
    return sendJson(res, 201, { code: room.code, playerId: host.id });
  }

  if (parts[1] !== 'rooms' || !parts[2]) return sendJson(res, 404, { error: 'No encontrado' });

  const room = rooms.get(parts[2].toUpperCase());
  if (!room) return sendJson(res, 404, { error: 'Esa sala no existe o ya expiró' });
  const action = parts[3];

  // POST /api/rooms/:code/join -> entrar a la sala
  if (req.method === 'POST' && action === 'join') {
    const body = await readBody(req);
    const name = cleanName(body.name);
    if (!name) return sendJson(res, 400, { error: 'Escribe tu nombre' });
    const player = addPlayer(room, name);
    broadcast(room, { type: 'join', playerName: player.name });
    return sendJson(res, 201, { code: room.code, playerId: player.id });
  }

  // GET /api/rooms/:code/events?playerId=... -> canal en tiempo real
  if (req.method === 'GET' && action === 'events') {
    const player = room.players.get(url.searchParams.get('playerId'));
    if (!player) return sendJson(res, 404, { error: 'No eres parte de esta sala' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const wasOffline = player.clients.size === 0;
    player.clients.add(res);
    res.write(`data: ${JSON.stringify({ type: 'hello', state: publicState(room, player.id) })}\n\n`);
    if (wasOffline) broadcast(room, { type: 'presence' });
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      player.clients.delete(res);
      if (player.clients.size === 0) broadcast(room, { type: 'presence' });
    });
    return;
  }

  if (req.method !== 'POST') return sendJson(res, 404, { error: 'No encontrado' });
  const body = await readBody(req);
  const player = room.players.get(body.playerId);
  if (!player) return sendJson(res, 403, { error: 'No eres parte de esta sala' });

  // POST /api/rooms/:code/claim -> cantar línea o bingo
  if (room.game === 'bingo' && action === 'claim') {
    const expected = room.phase;
    if (expected === 'terminado') return sendJson(res, 409, { error: 'La partida ya terminó' });
    if (body.type !== expected) {
      return sendJson(res, 409, { error: `Alguien ya cantó ${body.type === 'linea' ? 'línea' : 'bingo'}` });
    }
    const claim = { type: expected, playerId: player.id, playerName: player.name, at: Date.now() };
    room.claims.push(claim);
    room.phase = expected === 'linea' ? 'bingo' : 'terminado';
    broadcast(room, { type: 'claim', claim });
    return sendJson(res, 200, { ok: true });
  }

  // POST /api/rooms/:code/basta -> cortar la ronda del Tutti Frutti
  if (room.game === 'tutti' && action === 'basta') {
    if (room.phase !== 'jugando') {
      return sendJson(res, 409, { error: room.phase === 'basta' ? 'Alguien ya cantó basta' : 'Todavía no hay letra' });
    }
    room.phase = 'basta';
    room.bastaBy = { playerId: player.id, playerName: player.name };
    broadcast(room, { type: 'basta', claim: room.bastaBy });
    return sendJson(res, 200, { ok: true });
  }

  // Acciones solo para quien creó la sala
  if (player.id !== room.hostId) return sendJson(res, 403, { error: 'Solo quien creó la sala puede hacer esto' });

  // POST /api/rooms/:code/spin -> girar la ruleta (Tutti Frutti)
  if (room.game === 'tutti' && action === 'spin') {
    if (room.phase === 'girando') return sendJson(res, 409, { error: 'La ruleta ya está girando' });
    let available = LETTERS.filter((l) => !room.usedLetters.includes(l));
    if (available.length === 0) {
      room.usedLetters = [];
      available = LETTERS;
    }
    const letter = available[randInt(available.length)];
    room.round++;
    room.letter = letter;
    room.usedLetters.push(letter);
    room.phase = 'girando';
    room.bastaBy = null;
    room.spinEndsAt = Date.now() + SPIN_MS;
    const round = room.round;
    broadcast(room, { type: 'spin' });
    setTimeout(() => {
      // Solo si nadie reinició la sala mientras giraba
      if (room.round === round && room.phase === 'girando') {
        room.phase = 'jugando';
        broadcast(room, { type: 'letter' });
      }
    }, SPIN_MS);
    return sendJson(res, 200, { ok: true });
  }

  // POST /api/rooms/:code/reset (Tutti Frutti) -> todas las letras vuelven a la ruleta
  if (room.game === 'tutti' && action === 'reset') {
    Object.assign(room, { round: 0, phase: 'esperando', letter: null, usedLetters: [], spinEndsAt: null, bastaBy: null });
    broadcast(room, { type: 'reset' });
    return sendJson(res, 200, { ok: true });
  }

  if (room.game !== 'bingo') return sendJson(res, 404, { error: 'No encontrado' });

  // POST /api/rooms/:code/undo -> anular el último canto (si fue un error)
  if (action === 'undo') {
    const last = room.claims.pop();
    if (!last) return sendJson(res, 409, { error: 'No hay nada que anular' });
    room.phase = last.type;
    broadcast(room, { type: 'undo', claim: last });
    return sendJson(res, 200, { ok: true });
  }

  // POST /api/rooms/:code/reset -> nueva partida con cartones nuevos
  if (action === 'reset') {
    room.round++;
    room.phase = 'linea';
    room.claims = [];
    for (const p of room.players.values()) p.card = generateCard();
    broadcast(room, { type: 'reset' });
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'No encontrado' });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Bingo listo en http://localhost:${PORT}`));
}

module.exports = { generateCard, server };
