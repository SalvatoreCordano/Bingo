// Cliente del Bingo: crea/une salas, dibuja el cartón y escucha los avisos en vivo.
const $ = (id) => document.getElementById(id);

const LABELS = { linea: 'LÍNEA', bingo: 'BINGO' };

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
const urlCode = new URLSearchParams(location.search).get('sala');
if (urlCode) $('code').value = urlCode.toUpperCase();

$('create').addEventListener('click', async () => {
  const name = $('name').value.trim();
  if (!name) return homeError('Escribe tu nombre primero');
  try {
    const data = await api('/api/rooms', { name });
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
    showToast('¡Nueva partida! Tienes un cartón nuevo.');
  } else if (ev.type === 'join') {
    showToast(`${ev.playerName} entró a la sala`);
  }
}

// ---------- Dibujo ----------
function render() {
  const isHost = state.me.id === state.hostId;
  $('room-code').textContent = state.code;
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
  renderPlayers();
  renderClaims();
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
  const text = `¡Únete a mi bingo! Sala ${session.code}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Bingo', text, url: link });
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
