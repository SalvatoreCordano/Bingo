// Dónde viven las salas.
// - Sin variables de Redis: en memoria (para jugar en local con `npm start`).
// - Con Upstash Redis (Vercel): en Redis, así todas las funciones ven la misma sala.
const { HttpError } = require('./game');

const ROOM_TTL_S = 12 * 60 * 60; // una sala sin actividad se borra a las 12 h

function memoryStore() {
  const rooms = new Map();
  const answers = new Map(); // `${code}:${round}` -> { playerId: [respuestas] }
  const expired = (code) => {
    const entry = rooms.get(code);
    if (entry && Date.now() > entry.expiresAt) rooms.delete(code);
  };
  const save = (room) => {
    rooms.set(room.code, { json: JSON.stringify(room), expiresAt: Date.now() + ROOM_TTL_S * 1000 });
  };
  return {
    async get(code) {
      expired(code);
      const entry = rooms.get(code);
      return entry ? JSON.parse(entry.json) : null;
    },
    async create(room) {
      expired(room.code);
      if (rooms.has(room.code)) return false;
      save(room);
      return true;
    },
    async saveAnswers(code, round, playerId, list) {
      const k = `${code}:${round}`;
      if (!answers.has(k)) answers.set(k, {});
      answers.get(k)[playerId] = list;
    },
    async getAnswers(code, round) {
      return { ...(answers.get(`${code}:${round}`) || {}) };
    },
    // Node atiende una petición a la vez dentro de esta función: no hace falta bloqueo.
    async update(code, fn) {
      const room = await this.get(code);
      if (!room) throw new HttpError(404, 'Esa sala no existe o ya expiró');
      const result = fn(room);
      save(room);
      return result;
    },
  };
}

function redisStore(url, token) {
  async function cmd(...args) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(`Redis: ${data.error || res.status}`);
    return data.result;
  }

  const key = (code) => `room:${code}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  return {
    async get(code) {
      const json = await cmd('GET', key(code));
      return json ? JSON.parse(json) : null;
    },
    async create(room) {
      const ok = await cmd('SET', key(room.code), JSON.stringify(room), 'NX', 'EX', ROOM_TTL_S);
      return ok === 'OK';
    },
    // Cada jugador guarda sus respuestas en su propio campo: escribir no bloquea la sala.
    async saveAnswers(code, round, playerId, list) {
      const k = `answers:${code}:${round}`;
      await cmd('HSET', k, playerId, JSON.stringify(list));
      await cmd('EXPIRE', k, ROOM_TTL_S);
    },
    async getAnswers(code, round) {
      const flat = (await cmd('HGETALL', `answers:${code}:${round}`)) || [];
      const out = {};
      for (let i = 0; i < flat.length; i += 2) out[flat[i]] = JSON.parse(flat[i + 1]);
      return out;
    },
    // Bloqueo corto por sala para que dos cantos simultáneos no se pisen:
    // el primero que llega gana y el segundo ve la sala ya actualizada.
    async update(code, fn) {
      const lockKey = `lock:${code}`;
      const lockId = Math.random().toString(36).slice(2);
      let locked = false;
      for (let i = 0; i < 40 && !locked; i++) {
        locked = (await cmd('SET', lockKey, lockId, 'NX', 'PX', 3000)) === 'OK';
        if (!locked) await sleep(50);
      }
      if (!locked) throw new HttpError(503, 'La sala está ocupada, intenta de nuevo');
      try {
        const room = await this.get(code);
        if (!room) throw new HttpError(404, 'Esa sala no existe o ya expiró');
        const result = fn(room);
        await cmd('SET', key(code), JSON.stringify(room), 'EX', ROOM_TTL_S);
        return result;
      } finally {
        await cmd('DEL', lockKey).catch(() => {});
      }
    },
  };
}

function createStore() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? redisStore(url, token) : memoryStore();
}

module.exports = { createStore };
