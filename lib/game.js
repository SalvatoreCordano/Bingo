// Reglas de los juegos y API de las salas. No sabe dónde se guardan las salas:
// eso lo resuelve el "store" (memoria en local, Redis en Vercel).
const crypto = require('crypto');

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
const MAX_EVENTS = 30; // avisos recientes que se guardan para quien consulta la sala

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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
  return Array.from({ length: 4 }, () => letters[randInt(letters.length)]).join('');
}

function newId() {
  return crypto.randomBytes(12).toString('hex');
}

function cleanName(name) {
  const clean = String(name || '').trim().slice(0, 20);
  if (!clean) throw new HttpError(400, 'Escribe tu nombre');
  return clean;
}

function addPlayer(room, name) {
  const player = { id: newId(), name };
  if (room.game === 'bingo') player.card = generateCard();
  room.players.push(player);
  return player;
}

function pushEvent(room, event) {
  room.eventSeq = (room.eventSeq || 0) + 1;
  room.events.push({ id: room.eventSeq, ...event });
  if (room.events.length > MAX_EVENTS) room.events.shift();
}

// La ruleta termina de girar sola: se calcula al leer, sin temporizadores.
function settle(room, now) {
  if (room.game === 'tutti' && room.phase === 'girando' && now >= room.spinEndsAt) {
    room.phase = 'jugando';
    return true;
  }
  return false;
}

function publicState(room, playerId, now) {
  settle(room, now);
  const player = room.players.find((p) => p.id === playerId);
  const state = {
    game: room.game,
    code: room.code,
    round: room.round,
    phase: room.phase,
    hostId: room.hostId,
    now,
    me: player ? { id: player.id, name: player.name } : null,
    players: room.players.map((p) => ({ id: p.id, name: p.name })),
    events: room.events,
  };
  if (room.game === 'bingo') {
    // phase: 'linea' | 'bingo' | 'terminado'
    if (player) state.me.card = player.card;
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

function newRoom(game, now) {
  const room = {
    game,
    code: newRoomCode(),
    round: game === 'bingo' ? 1 : 0,
    phase: game === 'bingo' ? 'linea' : 'esperando',
    hostId: null,
    players: [],
    events: [],
    eventSeq: 0,
    createdAt: now,
  };
  if (game === 'bingo') room.claims = [];
  else Object.assign(room, { letter: null, usedLetters: [], spinEndsAt: null, bastaBy: null });
  return room;
}

// Acciones que cambian la sala. Cada una recibe la sala ya bloqueada.
const actions = {
  join(room, body) {
    const player = addPlayer(room, cleanName(body.name));
    pushEvent(room, { type: 'join', playerName: player.name });
    return { code: room.code, playerId: player.id };
  },

  claim(room, body, player) {
    if (room.game !== 'bingo') throw new HttpError(404, 'No encontrado');
    const expected = room.phase;
    if (expected === 'terminado') throw new HttpError(409, 'La partida ya terminó');
    if (body.type !== expected) {
      throw new HttpError(409, `Alguien ya cantó ${body.type === 'linea' ? 'línea' : 'bingo'}`);
    }
    const claim = { type: expected, playerId: player.id, playerName: player.name, at: Date.now() };
    room.claims.push(claim);
    room.phase = expected === 'linea' ? 'bingo' : 'terminado';
    pushEvent(room, { type: 'claim', claim });
    return { ok: true };
  },

  basta(room, body, player) {
    if (room.game !== 'tutti') throw new HttpError(404, 'No encontrado');
    if (room.phase !== 'jugando') {
      throw new HttpError(409, room.phase === 'basta' ? 'Alguien ya cantó basta' : 'Todavía no hay letra');
    }
    room.phase = 'basta';
    room.bastaBy = { playerId: player.id, playerName: player.name };
    pushEvent(room, { type: 'basta', claim: room.bastaBy });
    return { ok: true };
  },

  // ----- Solo quien creó la sala -----
  spin(room, body, player, now) {
    hostOnly(room, player);
    if (room.game !== 'tutti') throw new HttpError(404, 'No encontrado');
    if (room.phase === 'girando') throw new HttpError(409, 'La ruleta ya está girando');
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
    room.spinEndsAt = now + SPIN_MS;
    pushEvent(room, { type: 'spin' });
    return { ok: true };
  },

  undo(room, body, player) {
    hostOnly(room, player);
    if (room.game !== 'bingo') throw new HttpError(404, 'No encontrado');
    const last = room.claims.pop();
    if (!last) throw new HttpError(409, 'No hay nada que anular');
    room.phase = last.type;
    pushEvent(room, { type: 'undo', claim: last });
    return { ok: true };
  },

  reset(room, body, player) {
    hostOnly(room, player);
    if (room.game === 'bingo') {
      room.round++;
      room.phase = 'linea';
      room.claims = [];
      room.players.forEach((p) => { p.card = generateCard(); });
    } else {
      Object.assign(room, { round: 0, phase: 'esperando', letter: null, usedLetters: [], spinEndsAt: null, bastaBy: null });
    }
    pushEvent(room, { type: 'reset' });
    return { ok: true };
  },
};

function hostOnly(room, player) {
  if (player.id !== room.hostId) throw new HttpError(403, 'Solo quien creó la sala puede hacer esto');
}

// Punto de entrada común para el servidor local y para Vercel.
// parts: ['rooms'] o ['rooms', CODE, accion]
async function handleApi(store, { method, parts, query, body }) {
  const now = Date.now();
  try {
    if (parts[0] !== 'rooms') throw new HttpError(404, 'No encontrado');

    // POST /api/rooms -> crear sala
    if (parts.length === 1) {
      if (method !== 'POST') throw new HttpError(405, 'Método no permitido');
      const name = cleanName(body.name);
      const game = body.game === 'tutti' ? 'tutti' : 'bingo';
      for (let attempt = 0; attempt < 10; attempt++) {
        const room = newRoom(game, now);
        const host = addPlayer(room, name);
        room.hostId = host.id;
        if (await store.create(room)) return { status: 201, data: { code: room.code, playerId: host.id } };
      }
      throw new HttpError(503, 'No pudimos crear la sala, intenta de nuevo');
    }

    const code = String(parts[1]).toUpperCase();
    const action = parts[2];

    // GET /api/rooms/:code/state?playerId=... -> estado de la sala (lo consultan los celulares)
    if (method === 'GET' && action === 'state') {
      const room = await store.get(code);
      if (!room) throw new HttpError(404, 'Esa sala no existe o ya expiró');
      if (!room.players.some((p) => p.id === query.playerId)) throw new HttpError(404, 'No eres parte de esta sala');
      return { status: 200, data: publicState(room, query.playerId, now) };
    }

    if (method !== 'POST' || !actions[action]) throw new HttpError(404, 'No encontrado');

    const data = await store.update(code, (room) => {
      settle(room, now);
      if (action === 'join') return actions.join(room, body);
      const player = room.players.find((p) => p.id === body.playerId);
      if (!player) throw new HttpError(403, 'No eres parte de esta sala');
      return actions[action](room, body, player, now);
    });
    return { status: action === 'join' ? 201 : 200, data };
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, data: { error: err.message } };
    console.error(err);
    return { status: 500, data: { error: 'Algo salió mal, intenta de nuevo' } };
  }
}

module.exports = { generateCard, handleApi, HttpError, LETTERS };
