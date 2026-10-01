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
  'Apodo o chapa',
];
const GRACE_MS = 3000; // después del basta, tiempo para que lleguen las últimas respuestas
const MAX_ANSWER = 40;
const MAX_EVENTS = 30; // avisos recientes que se guardan para quien consulta la sala

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code; // para que el celular sepa qué hacer (ej: 'name_taken')
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

// Identifica al navegador de cada jugador, para que entrar dos veces no cree dos jugadores
function cleanClientId(id) {
  return typeof id === 'string' ? id.slice(0, 40) : null;
}

function addPlayer(room, name, clientId) {
  const player = { id: newId(), name, clientId: cleanClientId(clientId) };
  if (room.game === 'bingo') player.card = generateCard();
  room.players.push(player);
  return player;
}

function pushEvent(room, event) {
  room.eventSeq = (room.eventSeq || 0) + 1;
  room.events.push({ id: room.eventSeq, ...event });
  if (room.events.length > MAX_EVENTS) room.events.shift();
}

// Los cambios por tiempo se calculan al leer, sin temporizadores:
// la ruleta se detiene sola y, tras el basta y unos segundos de gracia, empieza la revisión.
function settle(room, now) {
  if (room.game !== 'tutti') return;
  if (room.phase === 'girando' && now >= room.spinEndsAt) room.phase = 'jugando';
  if (room.phase === 'basta' && now >= room.bastaAt + GRACE_MS) room.phase = 'revision';
}

// ---------- Puntaje del Tutti Frutti ----------
// Sin tildes, sin mayúsculas y con espacios simples: "Ámsterdam" = "amsterdam".
function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanAnswers(list) {
  const arr = Array.isArray(list) ? list : [];
  return CATEGORIES.map((_, i) => String(arr[i] || '').slice(0, MAX_ANSWER));
}

// 20 si eres el único con respuesta válida en la categoría, 10 si es distinta, 5 si se repite.
// Vacía, que no empieza con la letra o anulada por el anfitrión: 0.
function scoreRound(letter, players, answers, rejected) {
  const initial = normalize(letter);
  const result = {}; // playerId -> { points: [por categoría], total, status: [...] }
  players.forEach((p) => {
    result[p.id] = { points: CATEGORIES.map(() => 0), status: CATEGORIES.map(() => 'vacia'), total: 0 };
  });
  CATEGORIES.forEach((_, cat) => {
    const valid = [];
    players.forEach((p) => {
      const raw = (answers[p.id] || [])[cat] || '';
      const norm = normalize(raw);
      const r = result[p.id];
      if (!norm) r.status[cat] = 'vacia';
      else if (!norm.startsWith(initial)) r.status[cat] = 'letra';
      else if (rejected[`${p.id}:${cat}`]) r.status[cat] = 'anulada';
      else valid.push({ id: p.id, norm });
    });
    valid.forEach(({ id, norm }) => {
      const repeated = valid.some((v) => v.id !== id && v.norm === norm);
      const points = valid.length === 1 ? 20 : repeated ? 5 : 10;
      result[id].points[cat] = points;
      result[id].status[cat] = 'ok';
    });
  });
  Object.values(result).forEach((r) => { r.total = r.points.reduce((a, b) => a + b, 0); });
  return result;
}

function publicState(room, playerId, now, answers) {
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
    state.bastaAt = room.bastaAt;
    state.graceMs = GRACE_MS;
    state.scores = room.scores;
    // Las respuestas de todos se ven recién en la revisión
    if (room.phase === 'revision' && answers) {
      state.review = {
        round: room.round,
        letter: room.letter,
        answers: Object.fromEntries(room.players.map((p) => [p.id, cleanAnswers(answers[p.id])])),
        rejected: room.rejected,
        result: scoreRound(room.letter, room.players, answers, room.rejected),
        confirmed: false,
      };
    } else if (room.phase === 'resultados' && room.lastRound) {
      state.review = { ...room.lastRound, confirmed: true };
    }
  }
  return state;
}

function freshTutti() {
  return {
    letter: null, usedLetters: [], spinEndsAt: null, bastaBy: null, bastaAt: null,
    rejected: {}, scores: {}, lastRound: null,
  };
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
  else Object.assign(room, freshTutti());
  return room;
}

// Acciones que cambian la sala. Cada una recibe la sala ya bloqueada.
const actions = {
  join(room, body) {
    const name = cleanName(body.name);
    const clientId = cleanClientId(body.clientId);
    // Mismo navegador (doble toque, volver a abrir el enlace): es el mismo jugador
    const same = clientId && room.players.find((p) => p.clientId === clientId);
    if (same) {
      same.name = name;
      return { code: room.code, playerId: same.id };
    }
    // Mismo nombre desde otro navegador: se pregunta si es la misma persona
    const namesake = room.players.find((p) => normalize(p.name) === normalize(name));
    if (namesake) {
      if (!body.reclaim) {
        throw new HttpError(409, `Ya hay alguien llamado ${namesake.name} en la sala`, 'name_taken');
      }
      namesake.clientId = clientId;
      return { code: room.code, playerId: namesake.id };
    }
    const player = addPlayer(room, name, clientId);
    pushEvent(room, { type: 'join', playerName: player.name });
    return { code: room.code, playerId: player.id };
  },

  // El anfitrión puede sacar a un jugador (por ejemplo, uno duplicado que quedó de fantasma)
  kick(room, body, player) {
    hostOnly(room, player);
    const target = room.players.find((p) => p.id === body.target);
    if (!target) throw new HttpError(404, 'Ese jugador ya no está en la sala');
    if (target.id === room.hostId) throw new HttpError(409, 'No puedes quitarte a ti mismo');
    room.players = room.players.filter((p) => p.id !== target.id);
    if (room.scores) delete room.scores[target.id];
    pushEvent(room, { type: 'kick', playerName: target.name });
    return { ok: true };
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

  // Las respuestas se guardan aparte (store.saveAnswers) antes de llegar aquí.
  basta(room, body, player, now) {
    if (room.game !== 'tutti') throw new HttpError(404, 'No encontrado');
    if (room.phase !== 'jugando') {
      throw new HttpError(409, room.phase === 'girando' || room.phase === 'esperando' ? 'Todavía no hay letra' : 'Alguien ya cantó basta');
    }
    const complete = cleanAnswers(body.answers).every((a) => normalize(a));
    if (!complete && player.id !== room.hostId) {
      throw new HttpError(409, 'Completa todas las categorías para cantar basta');
    }
    room.phase = 'basta';
    room.bastaAt = now;
    room.bastaBy = { playerId: player.id, playerName: player.name };
    pushEvent(room, { type: 'basta', claim: room.bastaBy });
    return { ok: true };
  },

  // ----- Solo quien creó la sala -----
  spin(room, body, player, now) {
    hostOnly(room, player);
    if (room.game !== 'tutti') throw new HttpError(404, 'No encontrado');
    if (room.phase === 'girando') throw new HttpError(409, 'La ruleta ya está girando');
    if (room.phase === 'jugando' || room.phase === 'basta') throw new HttpError(409, 'Primero hay que terminar la ronda');
    if (room.phase === 'revision') throw new HttpError(409, 'Primero confirma los puntos de esta ronda');
    let available = LETTERS.filter((l) => !room.usedLetters.includes(l));
    if (available.length === 0) {
      room.usedLetters = [];
      available = LETTERS;
    }
    const letter = available[randInt(available.length)];
    room.round++;
    room.roundId = newId(); // identifica las respuestas de esta ronda aunque se reinicie la partida
    room.letter = letter;
    room.usedLetters.push(letter);
    room.phase = 'girando';
    room.bastaBy = null;
    room.bastaAt = null;
    room.rejected = {};
    room.spinEndsAt = now + SPIN_MS;
    pushEvent(room, { type: 'spin' });
    return { ok: true };
  },

  reject(room, body, player) {
    hostOnly(room, player);
    if (room.game !== 'tutti' || room.phase !== 'revision') throw new HttpError(409, 'Solo se puede anular durante la revisión');
    const cat = Number(body.cat);
    if (!room.players.some((p) => p.id === body.target) || !(cat >= 0 && cat < CATEGORIES.length)) {
      throw new HttpError(400, 'Respuesta no válida');
    }
    const key = `${body.target}:${cat}`;
    if (room.rejected[key]) delete room.rejected[key];
    else room.rejected[key] = true;
    return { ok: true };
  },

  confirm(room, body, player, now, answers) {
    hostOnly(room, player);
    if (room.game !== 'tutti' || room.phase !== 'revision') throw new HttpError(409, 'No hay puntos que confirmar');
    const result = scoreRound(room.letter, room.players, answers, room.rejected);
    Object.entries(result).forEach(([id, r]) => { room.scores[id] = (room.scores[id] || 0) + r.total; });
    room.lastRound = {
      round: room.round,
      letter: room.letter,
      answers: Object.fromEntries(room.players.map((p) => [p.id, cleanAnswers(answers[p.id])])),
      rejected: room.rejected,
      result,
    };
    room.phase = 'resultados';
    pushEvent(room, { type: 'confirm' });
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
      Object.assign(room, { round: 0, phase: 'esperando' }, freshTutti());
    }
    pushEvent(room, { type: 'reset' });
    return { ok: true };
  },
};

// Se aceptan respuestas mientras se juega y durante los segundos de gracia después del basta.
async function saveAnswersIfOpen(store, room, body, now) {
  settle(room, now);
  if (room.game !== 'tutti') throw new HttpError(404, 'No encontrado');
  const open = room.phase === 'jugando' || room.phase === 'basta';
  if (!open || Number(body.round) !== room.round) throw new HttpError(409, 'La ronda ya se cerró');
  await store.saveAnswers(room.code, room.roundId, body.playerId, cleanAnswers(body.answers));
}

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
        const host = addPlayer(room, name, body.clientId);
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
      if (!room.players.some((p) => p.id === query.playerId)) throw new HttpError(404, 'Ya no eres parte de esta sala', 'not_member');
      settle(room, now);
      const answers = room.phase === 'revision' ? await store.getAnswers(code, room.roundId) : null;
      return { status: 200, data: publicState(room, query.playerId, now, answers) };
    }

    // POST /api/rooms/:code/answers -> guardar mis respuestas mientras escribo (sin bloquear la sala)
    if (method === 'POST' && action === 'answers') {
      const room = await store.get(code);
      if (!room) throw new HttpError(404, 'Esa sala no existe o ya expiró');
      if (!room.players.some((p) => p.id === body.playerId)) throw new HttpError(403, 'No eres parte de esta sala');
      await saveAnswersIfOpen(store, room, body, now);
      return { status: 200, data: { ok: true } };
    }

    if (method !== 'POST' || !actions[action]) throw new HttpError(404, 'No encontrado');

    // Quien canta basta manda sus respuestas: se guardan primero
    if (action === 'basta') {
      const room = await store.get(code);
      if (room && room.players.some((p) => p.id === body.playerId)) await saveAnswersIfOpen(store, room, body, now);
    }

    let answers = null;
    if (action === 'confirm') {
      const room = await store.get(code);
      answers = room ? await store.getAnswers(code, room.roundId) : {};
    }

    const data = await store.update(code, (room) => {
      settle(room, now);
      if (action === 'join') return actions.join(room, body);
      const player = room.players.find((p) => p.id === body.playerId);
      if (!player) throw new HttpError(403, 'No eres parte de esta sala');
      return actions[action](room, body, player, now, answers);
    });
    return { status: action === 'join' ? 201 : 200, data };
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, data: { error: err.message, code: err.code } };
    console.error(err);
    return { status: 500, data: { error: 'Algo salió mal, intenta de nuevo' } };
  }
}

module.exports = { generateCard, handleApi, HttpError, LETTERS, CATEGORIES, scoreRound, normalize };
