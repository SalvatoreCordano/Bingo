// Cliente del Bingo: crea/une salas, dibuja el cartón y escucha los avisos en vivo.
const $ = (id) => document.getElementById(id);

const LABELS = { linea: 'LÍNEA', bingo: 'BINGO', basta: 'BASTA' };
const GAME_NAMES = { bingo: 'Bingo', tutti: 'Tutti Frutti' };

let session = null; // { code, playerId }
let state = null;
let events = null;

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

// ---------- Conexión en vivo ----------
function connect(s) {
  session = s;
  if (events) events.close();
  events = new EventSource(`/api/rooms/${s.code}/events?playerId=${s.playerId}`);

  events.onmessage = (msg) => {
    const ev = JSON.parse(msg.data);
    state = ev.state;
    $('home').hidden = true;
    $('game').hidden = false;
    render();
    handleEvent(ev);
  };

  events.onerror = () => {
    // Si nunca llegamos a entrar, la sala ya no existe: volvemos al inicio.
    if (!state) {
      events.close();
      storageDel('bingo:session');
      homeError('No pudimos entrar a la sala. Puede que haya expirado.');
    }
    // Si ya estábamos jugando, EventSource reintenta solo.
  };
}

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
    showToast(state.game === 'bingo' ? '¡Nueva partida! Tienes un cartón nuevo.' : 'Todas las letras volvieron a la ruleta.');
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

function renderTutti() {
  const isHost = state.me.id === state.hostId;
  const host = state.players.find((p) => p.id === state.hostId);
  buildWheel();

  $('round').textContent = state.round ? `Ronda ${state.round}` : 'Sin rondas aún';
  $('phase').textContent = {
    esperando: 'Esperando la ruleta',
    girando: 'Girando…',
    jugando: `Letra ${state.letter}`,
    basta: '¡Basta!',
  }[state.phase];

  // Animación: solo la primera vez que vemos cada ronda
  const center = $('wheel-center');
  if (state.letter && wheelRound !== state.round) {
    wheelRound = state.round;
    clearTimeout(revealTimer);
    if (state.phase === 'girando') {
      const remaining = Math.min(state.spinMs, Math.max(800, state.spinEndsAt - Date.now()));
      turnWheelTo(state.letter, remaining);
    } else {
      turnWheelTo(state.letter, 0);
    }
  }
  if (!state.letter) {
    wheelRound = null;
    center.textContent = '?';
  } else if (state.phase === 'girando') {
    center.textContent = '?';
  } else if (center.textContent !== state.letter) {
    center.textContent = state.letter;
    center.classList.remove('reveal');
    void center.offsetWidth; // reinicia la animación
    center.classList.add('reveal');
  }

  $('wheel-status').textContent = {
    esperando: isHost ? 'Gira la ruleta para sacar la primera letra' : `Esperando que ${host ? host.name : 'el anfitrión'} gire la ruleta`,
    girando: '¡Girando!',
    jugando: `¡A escribir con la ${state.letter}!`,
    basta: state.bastaBy ? `${state.bastaBy.playerName} cantó basta. ¡Lápices abajo!` : '¡Basta!',
  }[state.phase];

  $('spin').hidden = !isHost;
  $('spin').disabled = state.phase === 'girando';
  $('spin').textContent = state.round ? 'Girar de nuevo' : 'Girar la ruleta';
  $('basta').disabled = state.phase !== 'jugando';
  $('tutti-host-tools').hidden = !isHost;
  $('tutti-reset').disabled = state.usedLetters.length === 0 || state.phase === 'girando';

  const showLetter = state.letter && state.phase !== 'girando';
  $('categories-title').textContent = showLetter ? `Categorías con la ${state.letter}` : 'Categorías';
  const cats = $('categories');
  cats.innerHTML = '';
  state.categories.forEach((c) => {
    const li = document.createElement('li');
    li.textContent = c;
    if (showLetter) {
      const tag = document.createElement('span');
      tag.className = 'cat-letter';
      tag.textContent = state.letter;
      li.prepend(tag);
    }
    cats.appendChild(li);
  });

  const used = $('used-letters');
  used.innerHTML = '';
  // La letra que está girando no se muestra hasta que la ruleta se detenga
  const visible = state.phase === 'girando' ? state.usedLetters.slice(0, -1) : state.usedLetters;
  if (visible.length === 0) {
    used.innerHTML = '<span class="empty-msg">Ninguna todavía</span>';
  }
  visible.forEach((l, i) => {
    const el = document.createElement('span');
    el.textContent = l;
    if (i === visible.length - 1 && state.phase !== 'girando') el.className = 'current';
    used.appendChild(el);
  });
}

function renderCard() {
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
    li.innerHTML = `<span class="dot ${p.online ? 'on' : ''}"></span>`;
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
function announce(type, name) {
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
  } catch (e) {
    showToast(e.message);
  }
});

$('spin').addEventListener('click', async () => {
  try {
    await api(`/api/rooms/${session.code}/spin`, { playerId: session.playerId });
  } catch (e) {
    showToast(e.message);
  }
});

$('basta').addEventListener('click', async () => {
  try {
    await api(`/api/rooms/${session.code}/basta`, { playerId: session.playerId });
  } catch (e) {
    showToast(e.message);
  }
});

$('tutti-reset').addEventListener('click', async () => {
  if (!confirm('¿Devolver todas las letras a la ruleta?')) return;
  try {
    await api(`/api/rooms/${session.code}/reset`, { playerId: session.playerId });
  } catch (e) {
    showToast(e.message);
  }
});

$('undo').addEventListener('click', async () => {
  if (!confirm('¿Anular el último canto? La partida sigue desde ahí.')) return;
  try {
    await api(`/api/rooms/${session.code}/undo`, { playerId: session.playerId });
  } catch (e) {
    showToast(e.message);
  }
});

$('reset').addEventListener('click', async () => {
  if (!confirm('¿Empezar una nueva partida? Todos reciben un cartón nuevo.')) return;
  try {
    await api(`/api/rooms/${session.code}/reset`, { playerId: session.playerId });
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
  if (events) events.close();
  storageDel('bingo:session');
  location.href = '/';
});

// ---------- Arranque: si ya estabas en una sala, volvemos a ella ----------
const saved = storageGet('bingo:session');
if (saved && (!urlCode || urlCode.toUpperCase() === saved.code)) connect(saved);
