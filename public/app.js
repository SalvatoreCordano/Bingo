// Cliente del Bingo: crea/une salas, dibuja el cartón y escucha los avisos en vivo.
const $ = (id) => document.getElementById(id);

const LABELS = { linea: 'LÍNEA', bingo: 'BINGO', basta: 'BASTA' };
const GAME_NAMES = { bingo: 'Bingo', tutti: 'Tutti Frutti' };

let session = null; // { code, playerId }
let state = null;
let pollTimer = null;
let lastEventId = null; // último aviso ya mostrado
const POLL_MS = 1200;

// ---------- Sesión guardada (para volver si se recarga la página) ----------
function storageGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function storageDel(key) {
  try { localStorage.removeItem(key); } catch {}
}

function marksKey() {
  return `bingo:marks:${session.code}:${session.playerId}:${state.round}`;
}
function getMarks() {
  return new Set(storageGet(marksKey()) || []);
}
function saveMarks(marks) {
  storageSet(marksKey(), [...marks]);
}

// ---------- API ----------
async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Algo salió mal, intenta de nuevo');
  return data;
}

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { t.hidden = true; }, 2800);
}

// ---------- Inicio ----------
function homeError(msg) {
  $('home-error').textContent = msg || '';
}

$('name').value = storageGet('bingo:name') || '';

// El logo cambia según el juego elegido: BINGO o TUTTI
document.querySelectorAll('input[name="game"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const word = radio.value === 'tutti' ? 'TUTTI' : 'BINGO';
    $('logo').querySelectorAll('span').forEach((el, i) => { el.textContent = word[i]; });
  });
});
const urlCode = new URLSearchParams(location.search).get('sala');
if (urlCode) $('code').value = urlCode.toUpperCase();

$('create').addEventListener('click', async () => {
  const name = $('name').value.trim();
  if (!name) return homeError('Escribe tu nombre primero');
  try {
    const game = document.querySelector('input[name="game"]:checked').value;
    const data = await api('/api/rooms', { name, game });
    enterRoom(data, name);
  } catch (e) {
    homeError(e.message);
  }
});

$('join').addEventListener('click', joinRoom);
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });

async function joinRoom() {
  const name = $('name').value.trim();
  const code = $('code').value.trim().toUpperCase();
  if (!name) return homeError('Escribe tu nombre primero');
  if (code.length !== 4) return homeError('El código tiene 4 letras');
  try {
    const data = await api(`/api/rooms/${code}/join`, { name });
    enterRoom(data, name);
  } catch (e) {
    homeError(e.message);
  }
}

function enterRoom({ code, playerId }, name) {
  storageSet('bingo:name', name);
  storageSet('bingo:session', { code, playerId });
  history.replaceState(null, '', `/?sala=${code}`);
  connect({ code, playerId });
}

// ---------- Conexión con la sala ----------
// Cada celular consulta la sala cada poco más de un segundo. Los avisos
// (línea, basta, giro…) vienen en una lista numerada y se muestran una sola vez.
function connect(s) {
  session = s;
  lastEventId = null;
  poll();
}

function schedulePoll(ms = POLL_MS) {
  clearTimeout(pollTimer);
  if (session) pollTimer = setTimeout(poll, ms);
}

async function poll() {
  clearTimeout(pollTimer);
  if (!session) return;
  // Con la app en segundo plano no se consulta; se retoma al volver.
  if (document.hidden) return;
  const current = session;
  try {
    const res = await fetch(`/api/rooms/${current.code}/state?playerId=${current.playerId}`, { cache: 'no-store' });
    if (current !== session) return;
    if (res.status === 404) {
      session = null;
      storageDel('bingo:session');
      $('game').hidden = true;
      $('home').hidden = false;
      homeError('Esa sala ya no existe. Puede que haya expirado.');
      return;
    }
    if (!res.ok) throw new Error('Error de red');
    state = await res.json();
    $('home').hidden = true;
    $('game').hidden = false;
    render();
    const fresh = lastEventId === null ? [] : state.events.filter((ev) => ev.id > lastEventId);
    if (state.events.length) lastEventId = state.events[state.events.length - 1].id;
    else if (lastEventId === null) lastEventId = 0;
    fresh.forEach(handleEvent);
  } catch {
    // Sin conexión por un momento: se reintenta en la próxima vuelta.
  }
  // Si la ruleta está girando, consultar justo cuando se detiene para mostrar la letra al instante
  let delay = POLL_MS;
  if (state && state.phase === 'girando') delay = state.spinEndsAt - state.now + 150;
  if (state && state.phase === 'basta') delay = state.bastaAt + state.graceMs - state.now + 150;
  schedulePoll(Math.min(POLL_MS, Math.max(50, delay)));
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) poll();
});

function handleEvent(ev) {
  const me = state.me && state.me.id;
  if (ev.type === 'claim') {
    announce(ev.claim.type, ev.claim.playerId === me ? '¡Fuiste tú!' : ev.claim.playerName);
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  } else if (ev.type === 'undo') {
    closeAnnounce();
    showToast(`Se anuló el canto de ${ev.claim.playerName}. Seguimos jugando.`);
  } else if (ev.type === 'reset') {
    closeAnnounce();
    showToast(state.game === 'bingo' ? '¡Nueva partida! Tienes un cartón nuevo.' : '¡Nueva partida! Puntos a cero.');
  } else if (ev.type === 'confirm') {
    showToast('¡Puntos sumados a la tabla!');
  } else if (ev.type === 'spin') {
    closeAnnounce();
  } else if (ev.type === 'letter') {
    if (navigator.vibrate) navigator.vibrate(150);
  } else if (ev.type === 'basta') {
    announce('basta', ev.claim.playerId === me ? '¡Fuiste tú!' : ev.claim.playerName);
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  } else if (ev.type === 'join') {
    showToast(`${ev.playerName} entró a la sala`);
  }
}

// ---------- Dibujo ----------
function render() {
  $('room-code').textContent = state.code;
  $('game-name').textContent = GAME_NAMES[state.game];
  $('bingo-view').hidden = state.game !== 'bingo';
  $('claims-panel').hidden = state.game !== 'bingo';
  $('tutti-view').hidden = state.game !== 'tutti';
  if (state.game === 'bingo') renderBingo();
  else renderTutti();
  renderPlayers();
}

function renderBingo() {
  const isHost = state.me.id === state.hostId;
  $('player-name').textContent = state.me.name;
  $('round').textContent = `Partida ${state.round}`;
  $('phase').textContent =
    state.phase === 'linea' ? 'Se juega por línea'
    : state.phase === 'bingo' ? 'Se juega por bingo'
    : 'Partida terminada';
  $('host-tools').hidden = !isHost;
  $('undo').disabled = state.claims.length === 0;

  renderCard();
  renderClaimButton();
  renderClaims();
}

// ---------- Tutti Frutti: ruleta ----------
const WHEEL_COLORS = ['#e4572e', '#f3a712', '#2a9d8f', '#3d5a80', '#8e5572'];
let wheelRotation = 0; // grados acumulados, para que siempre gire hacia adelante
let wheelRound = null; // ronda que la ruleta ya mostró o está animando
let revealTimer = null;

function buildWheel() {
  const svg = $('wheel');
  if (svg.childElementCount) return;
  const seg = 360 / state.letters.length;
  const point = (r, deg) => {
    const rad = (deg * Math.PI) / 180;
    return `${(r * Math.sin(rad)).toFixed(2)} ${(-r * Math.cos(rad)).toFixed(2)}`;
  };
  let html = '';
  state.letters.forEach((letter, i) => {
    const a0 = i * seg;
    const mid = a0 + seg / 2;
    html += `<path d="M0 0 L${point(96, a0)} A96 96 0 0 1 ${point(96, a0 + seg)} Z" fill="${WHEEL_COLORS[i % WHEEL_COLORS.length]}" stroke="#fff" stroke-width="1"/>`;
    html += `<text transform="rotate(${mid}) translate(0 -80)">${letter}</text>`;
  });
  svg.innerHTML = html;
}

// Gira la ruleta para que la letra quede bajo el indicador de arriba.
function turnWheelTo(letter, durationMs) {
  const svg = $('wheel');
  const seg = 360 / state.letters.length;
  const mid = state.letters.indexOf(letter) * seg + seg / 2;
  const jitter = (Math.random() - 0.5) * seg * 0.6;
  const spins = durationMs > 0 ? 360 * 5 : 0;
  const base = wheelRotation + spins;
  const offset = ((((-mid + jitter - base) % 360) + 360) % 360);
  wheelRotation = base + offset;
  svg.style.transition = durationMs > 0
    ? `transform ${durationMs}ms cubic-bezier(0.15, 0.7, 0.1, 1)`
    : 'none';
  svg.style.transform = `rotate(${wheelRotation}deg)`;
}

// ---------- Tutti Frutti: respuestas ----------
// Igual que en el servidor: sin tildes, sin mayúsculas, espacios simples.
function normalize(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

let answersRound = null; // ronda para la que está armado el formulario
let saveTimer = null;
let lastSent = null;

function answersKey(round) {
  return `tutti:answers:${session.code}:${session.playerId}:${round}`;
}
function myAnswers() {
  return [...document.querySelectorAll('#answers input')].map((i) => i.value);
}

function buildAnswers() {
  const list = $('answers');
  const round = state.round;
  if (answersRound === round && list.childElementCount) return;
  answersRound = round;
  lastSent = null;
  const saved = (round && storageGet(answersKey(round))) || [];
  list.innerHTML = '';
  state.categories.forEach((c, i) => {
    const li = document.createElement('li');
    const label = document.createElement('label');
    label.htmlFor = `ans-${i}`;
    label.textContent = c;
    const input = document.createElement('input');
    input.id = `ans-${i}`;
    input.type = 'text';
    input.maxLength = 40;
    input.autocomplete = 'off';
    input.autocapitalize = 'sentences';
    input.enterKeyHint = i === state.categories.length - 1 ? 'done' : 'next';
    input.value = saved[i] || '';
    input.addEventListener('input', onAnswerInput);
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const next = $(`ans-${i + 1}`);
      if (next) next.focus(); else input.blur();
    });
    li.append(label, input);
    list.appendChild(li);
  });
}

function onAnswerInput() {
  storageSet(answersKey(state.round), myAnswers());
  updateAnswerHints();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(sendAnswers, 700);
}

// Guarda mis respuestas en el servidor (solo si cambiaron)
async function sendAnswers() {
  clearTimeout(saveTimer);
  if (!state || state.game !== 'tutti' || !answersRound) return;
  const answers = myAnswers();
  const payload = JSON.stringify(answers);
  if (payload === lastSent) return;
  try {
    await api(`/api/rooms/${session.code}/answers`, { playerId: session.playerId, round: answersRound, answers });
    lastSent = payload;
  } catch {
    // La ronda ya se cerró o no hubo conexión: se ignora
  }
}

function updateAnswerHints() {
  const initial = normalize(state.letter);
  document.querySelectorAll('#answers input').forEach((input) => {
    const v = normalize(input.value);
    input.classList.toggle('bad', Boolean(v && initial && !v.startsWith(initial)));
  });
  const isHost = state.me.id === state.hostId;
  const complete = myAnswers().every((a) => normalize(a));
  const playing = state.phase === 'jugando';
  $('basta').disabled = !playing || (!complete && !isHost);
  $('basta').textContent = playing && isHost && !complete ? 'Cortar ronda' : '¡BASTA!';
  const missing = myAnswers().filter((a) => !normalize(a)).length;
  $('basta-hint').textContent = !playing ? ''
    : complete ? '¡Listo! Canta basta antes que los demás'
    : isHost ? `Te faltan ${missing}. Como anfitrión puedes cortar la ronda igual`
    : `Te faltan ${missing} para poder cantar basta`;
}

// ---------- Tutti Frutti: revisión y puntos ----------
const STATUS_LABEL = { vacia: 'vacía', letra: 'no empieza con la letra', anulada: 'anulada' };

function renderReview() {
  const review = state.review;
  const isHost = state.me.id === state.hostId;
  $('review').hidden = !review;
  $('confirm').hidden = !(review && !review.confirmed && isHost);
  if (!review) return;
  $('review-title').textContent = `Ronda ${review.round} · Letra ${review.letter}`;
  $('review-note').textContent = review.confirmed
    ? 'Puntos sumados a la tabla.'
    : isHost ? 'Revisa las respuestas: toca "Anular" si alguna no vale. Después confirma los puntos.'
    : 'El anfitrión está revisando. Puede anular respuestas que no valen.';

  const list = $('review-list');
  list.innerHTML = '';
  state.categories.forEach((cat, ci) => {
    const block = document.createElement('div');
    block.className = 'review-cat';
    const h = document.createElement('h3');
    h.textContent = `${ci + 1}. ${cat}`;
    block.appendChild(h);
    state.players.forEach((p) => {
      const r = review.result[p.id];
      if (!r) return;
      const answer = (review.answers[p.id] || [])[ci] || '';
      const status = r.status[ci];
      const row = document.createElement('div');
      row.className = `review-row status-${status}`;
      const name = document.createElement('span');
      name.className = 'review-name';
      name.textContent = p.name;
      const ans = document.createElement('span');
      ans.className = 'review-answer';
      ans.textContent = answer.trim() || '—';
      if (status !== 'ok' && status !== 'vacia') {
        const why = document.createElement('small');
        why.textContent = STATUS_LABEL[status];
        ans.appendChild(why);
      }
      const pts = document.createElement('span');
      pts.className = `pts pts-${r.points[ci]}`;
      pts.textContent = r.points[ci];
      row.append(name, ans, pts);
      if (isHost && !review.confirmed && (status === 'ok' || status === 'anulada')) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-ghost btn-mini';
        btn.textContent = status === 'anulada' ? 'Validar' : 'Anular';
        btn.addEventListener('click', () => toggleReject(p.id, ci));
        row.appendChild(btn);
      }
      block.appendChild(row);
    });
    list.appendChild(block);
  });
}

async function toggleReject(target, cat) {
  try {
    await api(`/api/rooms/${session.code}/reject`, { playerId: session.playerId, target, cat });
    poll();
  } catch (e) {
    showToast(e.message);
  }
}

function renderScoreboard() {
  const review = state.review;
  const pending = review && !review.confirmed ? review.result : null;
  const rows = state.players.map((p) => ({
    name: p.name,
    me: p.id === state.me.id,
    total: (state.scores[p.id] || 0) + (pending && pending[p.id] ? pending[p.id].total : 0),
    round: review && review.result[p.id] ? review.result[p.id].total : null,
  })).sort((a, b) => b.total - a.total);
  const board = $('scoreboard');
  board.innerHTML = '';
  rows.forEach((r) => {
    const li = document.createElement('li');
    if (r.me) li.className = 'me';
    const name = document.createElement('span');
    name.className = 'sb-name';
    name.textContent = r.name;
    const delta = document.createElement('span');
    delta.className = 'sb-delta';
    delta.textContent = r.round !== null ? `+${r.round}` : '';
    const total = document.createElement('span');
    total.className = 'sb-total';
    total.textContent = r.total;
    li.append(name, delta, total);
    board.appendChild(li);
  });
}

function renderTutti() {
  const isHost = state.me.id === state.hostId;
  const host = state.players.find((p) => p.id === state.hostId);
  const phase = state.phase;
  buildWheel();

  $('round').textContent = state.round ? `Ronda ${state.round}` : 'Sin rondas aún';
  $('phase').textContent = {
    esperando: 'Esperando la ruleta',
    girando: 'Girando…',
    jugando: `Letra ${state.letter}`,
    basta: '¡Basta!',
    revision: 'Revisando respuestas',
    resultados: 'Puntos sumados',
  }[phase];

  // Animación: solo la primera vez que vemos cada ronda
  const center = $('wheel-center');
  if (state.letter && wheelRound !== state.round) {
    wheelRound = state.round;
    clearTimeout(revealTimer);
    if (phase === 'girando') {
      const remaining = Math.min(state.spinMs, Math.max(800, state.spinEndsAt - state.now));
      turnWheelTo(state.letter, remaining);
    } else {
      turnWheelTo(state.letter, 0);
    }
  }
  if (!state.letter) {
    wheelRound = null;
    center.textContent = '?';
  } else if (phase === 'girando') {
    center.textContent = '?';
  } else if (center.textContent !== state.letter) {
    center.textContent = state.letter;
    center.classList.remove('reveal');
    void center.offsetWidth; // reinicia la animación
    center.classList.add('reveal');
  }

  // Qué se ve en cada momento
  const writing = phase === 'jugando' || phase === 'basta';
  const reviewing = phase === 'revision' || phase === 'resultados';
  $('wheel-wrap').hidden = writing || phase === 'revision';
  $('letter-banner').hidden = !writing;
  $('answers-panel').hidden = reviewing;
  $('basta-wrap').hidden = reviewing;
  $('scoreboard-panel').hidden = !reviewing && !Object.keys(state.scores).length;

  $('wheel-status').textContent = {
    esperando: isHost ? 'Gira la ruleta para sacar la primera letra' : `Esperando que ${host ? host.name : 'el anfitrión'} gire la ruleta`,
    girando: '¡Girando!',
    resultados: isHost ? 'Cuando estén listos, gira para la siguiente ronda' : `Esperando que ${host ? host.name : 'el anfitrión'} gire la siguiente ronda`,
  }[phase] || '';

  if (writing) {
    const banner = $('banner-letter');
    if (banner.textContent !== state.letter) {
      banner.textContent = state.letter;
      banner.classList.remove('reveal');
      void banner.offsetWidth;
      banner.classList.add('reveal');
    }
    $('banner-status').textContent = phase === 'jugando'
      ? `¡A escribir! Todas deben empezar con ${state.letter}`
      : `${state.bastaBy ? state.bastaBy.playerName : 'Alguien'} cantó basta. ¡Se acabó el tiempo!`;
  }

  // Formulario de respuestas: visible desde antes para que todos conozcan las categorías
  buildAnswers();
  const canWrite = phase === 'jugando';
  document.querySelectorAll('#answers input').forEach((input) => { input.disabled = !canWrite; });
  $('answers-title').textContent = writing ? `Tus respuestas con la ${state.letter}` : 'Categorías';
  // Al cantarse basta, mandar lo último que escribí
  if (phase === 'basta') sendAnswers();
  updateAnswerHints();

  renderReview();
  renderScoreboard();

  $('spin').hidden = !isHost || !(phase === 'esperando' || phase === 'resultados');
  $('spin').textContent = state.round ? 'Girar para la siguiente ronda' : 'Girar la ruleta';
  $('tutti-host-tools').hidden = !isHost;
  $('tutti-reset').disabled = !state.round || phase === 'girando';

  const used = $('used-letters');
  used.innerHTML = '';
  // La letra que está girando no se muestra hasta que la ruleta se detenga
  const visible = phase === 'girando' ? state.usedLetters.slice(0, -1) : state.usedLetters;
  if (visible.length === 0) {
    used.innerHTML = '<span class="empty-msg">Ninguna todavía</span>';
  }
  visible.forEach((l, i) => {
    const el = document.createElement('span');
    el.textContent = l;
    if (i === visible.length - 1 && phase !== 'girando') el.className = 'current';
    used.appendChild(el);
  });
}

let renderedCardKey = null;

function renderCard() {
  // Solo se redibuja si cambió el cartón (nueva partida); así no se pierden toques
  const key = `${session.code}:${state.round}:${JSON.stringify(state.me.card)}`;
  if (key === renderedCardKey) return;
  renderedCardKey = key;
  const marks = getMarks();
  const card = $('card');
  card.innerHTML = '';
  let total = 0;
  state.me.card.forEach((row) => {
    row.forEach((n) => {
      if (n === null) {
        const empty = document.createElement('div');
        empty.className = 'cell empty';
        card.appendChild(empty);
        return;
      }
      total++;
      const cell = document.createElement('button');
      cell.className = 'cell' + (marks.has(n) ? ' marked' : '');
      cell.innerHTML = `<span>${n}</span>`;
      cell.setAttribute('aria-pressed', marks.has(n));
      cell.addEventListener('click', () => toggleMark(n, cell));
      card.appendChild(cell);
    });
  });
  $('marked-count').textContent = `${marks.size} de ${total} marcados`;
}

function toggleMark(n, cell) {
  const marks = getMarks();
  if (marks.has(n)) marks.delete(n); else marks.add(n);
  saveMarks(marks);
  cell.classList.toggle('marked', marks.has(n));
  cell.setAttribute('aria-pressed', marks.has(n));
  $('marked-count').textContent = `${marks.size} de 15 marcados`;
}

function renderClaimButton() {
  const btn = $('claim');
  btn.classList.toggle('is-bingo', state.phase === 'bingo');
  if (state.phase === 'terminado') {
    btn.textContent = 'Partida terminada';
    btn.disabled = true;
  } else {
    btn.textContent = `¡${LABELS[state.phase]}!`;
    btn.disabled = false;
  }
}

function renderPlayers() {
  const list = $('players');
  list.innerHTML = '';
  state.players.forEach((p) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = p.name;
    li.appendChild(name);
    if (p.id === state.hostId) li.insertAdjacentHTML('beforeend', '<span class="tag">anfitrión</span>');
    if (p.id === state.me.id) li.insertAdjacentHTML('beforeend', '<span class="tag">tú</span>');
    list.appendChild(li);
  });
}

function renderClaims() {
  const list = $('claims');
  list.innerHTML = '';
  if (state.claims.length === 0) {
    list.innerHTML = '<li class="empty-msg">Nadie ha cantado todavía</li>';
    return;
  }
  state.claims.forEach((c) => {
    const li = document.createElement('li');
    li.textContent = `${c.type === 'linea' ? '🟠 Línea' : '🟢 Bingo'}: ${c.playerName}`;
    list.appendChild(li);
  });
}

// ---------- Aviso grande ----------
let announceTimer = null;

function announce(type, name) {
  clearTimeout(announceTimer);
  // El basta se cierra solo cuando termina la gracia y empieza la revisión
  if (type === 'basta') announceTimer = setTimeout(closeAnnounce, 3000);
  $('announce-type').textContent = `¡${LABELS[type]}!`;
  $('announce-type').classList.toggle('is-bingo', type === 'bingo');
  $('announce-name').textContent = name;
  $('announce').hidden = false;
}
function closeAnnounce() {
  $('announce').hidden = true;
}
$('announce-close').addEventListener('click', closeAnnounce);

// ---------- Acciones del juego ----------
$('claim').addEventListener('click', async () => {
  const type = state.phase;
  if (!confirm(`¿Seguro que quieres cantar ${LABELS[type]}?`)) return;
  try {
    await api(`/api/rooms/${session.code}/claim`, { playerId: session.playerId, type });
    poll();
  } catch (e) {
    showToast(e.message);
  }
});

$('spin').addEventListener('click', async () => {
  try {
    await api(`/api/rooms/${session.code}/spin`, { playerId: session.playerId });
    poll();
  } catch (e) {
    showToast(e.message);
  }
});

$('basta').addEventListener('click', async () => {
  try {
    await api(`/api/rooms/${session.code}/basta`, { playerId: session.playerId, round: answersRound, answers: myAnswers() });
    poll();
  } catch (e) {
    showToast(e.message);
  }
});

$('confirm').addEventListener('click', async () => {
  try {
    await api(`/api/rooms/${session.code}/confirm`, { playerId: session.playerId });
    poll();
  } catch (e) {
    showToast(e.message);
  }
});

$('tutti-reset').addEventListener('click', async () => {
  if (!confirm('¿Empezar una nueva partida? Los puntos vuelven a cero y todas las letras a la ruleta.')) return;
  try {
    await api(`/api/rooms/${session.code}/reset`, { playerId: session.playerId });
    poll();
  } catch (e) {
    showToast(e.message);
  }
});

$('undo').addEventListener('click', async () => {
  if (!confirm('¿Anular el último canto? La partida sigue desde ahí.')) return;
  try {
    await api(`/api/rooms/${session.code}/undo`, { playerId: session.playerId });
    poll();
  } catch (e) {
    showToast(e.message);
  }
});

$('reset').addEventListener('click', async () => {
  if (!confirm('¿Empezar una nueva partida? Todos reciben un cartón nuevo.')) return;
  try {
    await api(`/api/rooms/${session.code}/reset`, { playerId: session.playerId });
    poll();
  } catch (e) {
    showToast(e.message);
  }
});

$('share').addEventListener('click', async () => {
  const link = `${location.origin}/?sala=${session.code}`;
  const text = `¡Únete a mi ${GAME_NAMES[state.game]}! Sala ${session.code}`;
  try {
    if (navigator.share) await navigator.share({ title: GAME_NAMES[state.game], text, url: link });
    else {
      await navigator.clipboard.writeText(link);
      showToast('Enlace copiado');
    }
  } catch {}
});

$('leave').addEventListener('click', () => {
  if (!confirm('¿Salir de la sala?')) return;
  session = null;
  clearTimeout(pollTimer);
  storageDel('bingo:session');
  location.href = '/';
});

// ---------- Arranque: si ya estabas en una sala, volvemos a ella ----------
const saved = storageGet('bingo:session');
if (saved && (!urlCode || urlCode.toUpperCase() === saved.code)) connect(saved);
