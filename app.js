/* ═══════════════════════════════════════════════════════
   Caelestia — Web Pairer · app.js
   Dev: ҲЄƝ
═══════════════════════════════════════════════════════ */

const GATE_KEY      = 'caelestia_gate_v1';
const PHONES_KEY    = 'caelestia_phones_v1';
const ADMIN_KEY     = 'caelestia_admin_v1';
const SEL_SRV_KEY   = 'caelestia_server_v1';
const ADMIN_SRVS    = 'caelestia_admin_srvs';
const ADMIN_PASS    = 'zedxandromeda';
const TIER_MAX      = { high: 20, mid: 16, low: 5 };

// ── State ─────────────────────────────────────────────
let servers        = [];
let selectedServer = null;
let currentPhone   = null;
let pollTimer      = null;
let sseSource      = null;
let adminChannels  = [];

// ── DOM ───────────────────────────────────────────────
const $  = id => document.getElementById(id);
const show = id => { const e = $(id); if (e) e.classList.remove('hidden'); };
const hide = id => { const e = $(id); if (e) e.classList.add('hidden'); };

// ── API helper ────────────────────────────────────────
async function api(server, path, method = 'GET', body = null, adminPwd = null) {
  const url = server.url.replace(/\/$/, '') + '/api' + path;
  const headers = { 'Content-Type': 'application/json' };
  if (adminPwd) headers['X-Admin-Password'] = adminPwd;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  return res.json();
}
const getAdminPwd = () => localStorage.getItem(ADMIN_KEY) || null;

// ── SERVERS ───────────────────────────────────────────
async function loadServers() {
  let config;
  try { config = await (await fetch('./servers.json')).json(); }
  catch { config = { servers: [] }; }

  const adminAdded = JSON.parse(localStorage.getItem(ADMIN_SRVS) || '[]');
  const all = [...config.servers, ...adminAdded];

  servers = await Promise.all(all.map(async srv => {
    try {
      const d = await Promise.race([
        api(srv, '/capacity'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))
      ]);
      return { ...srv, connected: d.connected ?? 0, available: d.available ?? srv.maxUsers, online: true };
    } catch {
      return { ...srv, connected: 0, available: srv.maxUsers, online: false };
    }
  }));

  renderServerGrid();
  updateHeroStats();
  loadNavLinks();
  loadGateChannels();
  loadContentCards();
}

async function refreshServers() {
  const btn = $('refreshServersBtn');
  if (btn) btn.disabled = true;
  $('serverGrid').innerHTML = '<div class="sessions-empty"><i data-lucide="loader-2" class="spinner"></i><span>Refreshing…</span></div>';
  lucide.createIcons();
  await loadServers();
  if (btn) btn.disabled = false;
}

function renderServerGrid() {
  const grid = $('serverGrid');
  if (!grid) return;
  if (!servers.length) {
    grid.innerHTML = '<div class="sessions-empty"><i data-lucide="server-off"></i><span>No servers configured</span></div>';
    lucide.createIcons(); return;
  }

  grid.innerHTML = servers.map(srv => {
    const max = TIER_MAX[srv.tier] || srv.maxUsers || 20;
    const con = srv.connected || 0;
    const pct = Math.min(100, Math.round((con / max) * 100));
    const isFull = con >= max;
    const isWarn = pct >= 75;
    const dotCls = !srv.online ? '' : isFull ? 'full' : isWarn ? 'warn' : 'online';
    const barCls = isFull ? 'full' : isWarn ? 'warn' : 'good';
    const selected = selectedServer?.id === srv.id;
    const label = srv.label ? `<span style="color:var(--text-3);font-size:0.72rem;font-weight:400;margin-left:4px">${srv.label}</span>` : '';
    const offline = !srv.online ? '<span style="font-size:0.65rem;color:#ef4444;margin-left:6px">Offline</span>' : '';
    const full = isFull ? '<span style="font-size:0.65rem;color:#ef4444;margin-left:6px">Full</span>' : '';

    return `<div class="server-card${selected ? ' selected' : ''}${isFull ? ' full' : ''}" onclick="selectServer('${srv.id}')" id="srv-${srv.id}">
      <div class="server-card-top">
        <span class="server-dot ${dotCls}"></span>
        <span class="server-card-name">${esc(srv.name)}${label}${offline}${full}</span>
        <span class="tier-badge ${srv.tier || 'high'}">${srv.tier}</span>
        <div class="server-card-selected-indicator">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
      </div>
      <div class="cap-row">
        <div class="cap-bar-wrap"><div class="cap-bar ${barCls}" style="width:${pct}%"></div></div>
        <span class="cap-label">${con}/${max}</span>
      </div>
      <div class="server-card-url">${esc(srv.url)}</div>
    </div>`;
  }).join('');

  lucide.createIcons();

  // Restore or auto-select
  const savedId = localStorage.getItem(SEL_SRV_KEY);
  const saved = savedId && servers.find(s => s.id === savedId && s.online && !isFull(s));
  if (saved) { selectedServer = saved; highlightSelected(); }
  else if (!selectedServer || !servers.find(s => s.id === selectedServer.id)) autoSelect();

  updateAfterSelect();
  renderAnalyticsTiles();
}

function isFull(srv) { return (srv.connected || 0) >= (TIER_MAX[srv.tier] || srv.maxUsers || 20); }

function autoSelect() {
  const avail = servers.filter(s => s.online && !isFull(s));
  if (!avail.length) return;
  const order = { high: 0, mid: 1, low: 2 };
  avail.sort((a, b) => (order[a.tier] ?? 9) - (order[b.tier] ?? 9) || (b.available || 0) - (a.available || 0));
  selectedServer = avail[0];
  highlightSelected();
}

function highlightSelected() {
  document.querySelectorAll('.server-card').forEach(el => el.classList.remove('selected'));
  if (selectedServer) {
    const el = $(`srv-${selectedServer.id}`);
    if (el) el.classList.add('selected');
    localStorage.setItem(SEL_SRV_KEY, selectedServer.id);
  }
}

function selectServer(id) {
  const srv = servers.find(s => s.id === id);
  if (!srv || isFull(srv)) return;
  selectedServer = srv;
  highlightSelected();
  updateAfterSelect();
  // Reload content for this server
  loadNavLinks();
  loadGateChannels();
  loadContentCards();
}

function updateAfterSelect() {
  const lbl = $('selectedServerLabel');
  if (lbl && selectedServer) {
    lbl.innerHTML = `Selected: <strong style="color:var(--text)">${esc(selectedServer.name)}</strong> <span class="tier-badge ${selectedServer.tier}" style="margin-left:4px">${selectedServer.tier}</span>`;
  }
  // Show gate or pair form
  const gateFollowed = localStorage.getItem(GATE_KEY) === '1';
  if (selectedServer) {
    if (gateFollowed) { hide('channelGateCard'); show('pairForm'); }
    else               { show('channelGateCard'); hide('pairForm'); }
  }
}

function renderAnalyticsTiles() {
  const total     = servers.length;
  const online    = servers.filter(s => s.online).length;
  const connected = servers.reduce((s, srv) => s + (srv.connected || 0), 0);
  const capacity  = servers.filter(s => s.online).reduce((s, srv) => s + (TIER_MAX[srv.tier] || srv.maxUsers || 20), 0);
  const available = Math.max(0, capacity - connected);

  setText('tileTotalSrv',  total);
  setText('tileOnline',    online);
  setText('tileConnected', connected);
  setText('tileAvailable', available);
}

function updateHeroStats() {
  const online    = servers.filter(s => s.online).length;
  const capacity  = servers.filter(s => s.online).reduce((s, srv) => s + (TIER_MAX[srv.tier] || srv.maxUsers || 20), 0);
  const connected = servers.reduce((s, srv) => s + (srv.connected || 0), 0);
  setText('heroOnline',    online);
  setText('heroCapacity',  capacity);
  const el = $('heroConnected');
  if (el) el.innerHTML = `${connected}<span>sessions</span>`;
}

// ── Nav Links ─────────────────────────────────────────
async function loadNavLinks() {
  if (!selectedServer) return;
  try {
    const data = await api(selectedServer, '/links');
    const links = data.links || [];
    const icMap = { send: 'send', users: 'users', 'message-circle': 'message-circle', link: 'link' };
    const desktopHtml = links.map(l =>
      `<a href="${esc(l.url)}" target="_blank" class="nav-link"><i data-lucide="${icMap[l.icon]||'link'}"></i><span>${esc(l.label)}</span></a>`
    ).join('');
    const mobileHtml = links.map(l =>
      `<a href="${esc(l.url)}" target="_blank" class="mobile-drop-link" onclick="closeDrop()"><i data-lucide="${icMap[l.icon]||'link'}"></i><span>${esc(l.label)}</span></a>`
    ).join('');
    const nl = $('navLinks'), ml = $('mobileLinks');
    if (nl) { nl.innerHTML = desktopHtml; lucide.createIcons(); }
    if (ml) { ml.innerHTML = mobileHtml; lucide.createIcons(); }
  } catch {}
}

// ── Channel Gate ──────────────────────────────────────
async function loadGateChannels() {
  if (!selectedServer) return;
  try {
    const data = await api(selectedServer, '/channels');
    const chs  = data.channels || [];
    const el   = $('gateChannels');
    if (!el || !chs.length) return;
    const icMap = { tg: 'send', 'tg-group': 'users', wa: 'message-circle' };
    el.innerHTML = chs.map(ch =>
      `<a href="${esc(ch.url)}" target="_blank" class="gate-ch-btn ${esc(ch.type||'')}">
        <i data-lucide="${icMap[ch.type]||'link'}"></i>
        <div><strong>${esc(ch.label)}</strong><span>${esc(ch.handle||'')}</span></div>
        <i data-lucide="external-link" class="gate-ext"></i>
      </a>`
    ).join('');
    lucide.createIcons();
  } catch {}
}

function confirmChannelFollow() {
  localStorage.setItem(GATE_KEY, '1');
  hide('channelGateCard');
  const pf = $('pairForm');
  if (!pf) return;
  pf.classList.remove('hidden');
  pf.style.opacity = '0'; pf.style.transform = 'translateY(6px)'; pf.style.transition = 'opacity 0.24s ease, transform 0.24s ease';
  requestAnimationFrame(() => requestAnimationFrame(() => { pf.style.opacity = '1'; pf.style.transform = ''; }));
}

// ── Content Cards ─────────────────────────────────────
async function loadContentCards() {
  if (!selectedServer) return;
  let has = false;
  try {
    const [a, c, p] = await Promise.all([
      api(selectedServer, '/announcements').catch(() => ({ items: [] })),
      api(selectedServer, '/changelogs').catch(()   => ({ items: [] })),
      api(selectedServer, '/polls').catch(()         => ({ items: [] }))
    ]);
    if ((a.items||[]).length || (c.items||[]).length || (p.items||[]).length) has = true;
    renderAnns(a.items || []);
    renderCls(c.items || []);
    renderPolls(p.items || []);
  } catch {}
  const sec = $('contentSection');
  if (sec) sec.style.display = has ? '' : 'none';
}

function renderAnns(items) {
  const el = $('panel-ann');
  if (!el) return;
  el.innerHTML = !items.length ? emptyState('megaphone', 'No announcements yet')
    : items.map(a => `<div class="ann-item">
        <div class="ann-title">${esc(a.title||'')}</div>
        <div class="ann-body">${esc(a.body||a.message||'')}</div>
        <div class="ann-date">${fmtDate(a.createdAt)}</div>
      </div>`).join('');
  lucide.createIcons();
}
function renderCls(items) {
  const el = $('panel-cl');
  if (!el) return;
  el.innerHTML = !items.length ? emptyState('git-commit-horizontal', 'No changelogs yet')
    : items.map(c => `<div class="cl-item">
        ${c.tag ? `<div class="cl-tag">${esc(c.tag)}</div>` : ''}
        <div class="cl-version">${esc(c.version||'v?')}</div>
        <div class="cl-body">${esc(c.body||c.changes||'')}</div>
        <div class="cl-date">${fmtDate(c.createdAt)}</div>
      </div>`).join('');
  lucide.createIcons();
}
function renderPolls(items) {
  const el = $('panel-poll');
  if (!el) return;
  el.innerHTML = !items.length ? emptyState('bar-chart-2', 'No active polls')
    : items.map(p => {
        const total = (p.options||[]).reduce((s,o)=>s+(o.votes||0),0);
        const opts = (p.options||[]).map(o => {
          const pct = total ? Math.round((o.votes||0)/total*100) : 0;
          return `<div class="poll-opt" onclick="vote('${p.id}','${o.id}')">
            <div class="poll-bar" style="width:${pct}%"></div>
            <span class="poll-opt-text">${esc(o.text)}</span>
            <span class="poll-opt-votes">${o.votes||0} · ${pct}%</span></div>`;
        }).join('');
        return `<div class="poll-item"><div class="poll-q">${esc(p.question)}</div><div class="poll-options">${opts}</div></div>`;
      }).join('');
}
async function vote(pollId, optionId) {
  if (!selectedServer) return;
  try { const d = await api(selectedServer, `/polls/${pollId}/vote`, 'POST', { optionId }); if (d.poll) renderPolls([d.poll]); } catch {}
}

function switchTab(tab) {
  document.querySelectorAll('.content-tab').forEach((t, i) => t.classList.toggle('active', ['ann','cl','poll'][i] === tab));
  document.querySelectorAll('.content-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
}

// ── Pairing ───────────────────────────────────────────
const getPhones = () => { try { return JSON.parse(localStorage.getItem(PHONES_KEY)||'[]'); } catch { return []; } };
const addPhone  = p  => { const arr = getPhones(); if (!arr.includes(p)) { arr.push(p); localStorage.setItem(PHONES_KEY, JSON.stringify(arr)); } };
const rmPhone   = p  => localStorage.setItem(PHONES_KEY, JSON.stringify(getPhones().filter(x => x !== p)));

function showStatus(msg, type = 'info') {
  const el = $('pairStatus');
  if (!el) return;
  el.className = `pair-status ${type}`;
  el.textContent = msg;
  el.classList.remove('hidden');
}
const hideStatus = () => { const e = $('pairStatus'); if (e) e.classList.add('hidden'); };

function setBtnLoading(on) {
  const btn = $('pairBtn');
  if (!btn) return;
  btn.disabled = on;
  const txt = btn.querySelector('.btn-text'), icon = btn.querySelector('.btn-icon'), spin = btn.querySelector('.btn-spinner');
  if (txt)  txt.textContent = on ? 'Connecting…' : 'Get Code';
  if (icon) icon.classList.toggle('hidden', on);
  if (spin) spin.classList.toggle('hidden', !on);
}

async function startPairing() {
  if (!selectedServer) { showStatus('Select a server first.', 'error'); return; }
  const raw = ($('phoneInput')?.value || '').replace(/\D/g, '');
  if (!raw || raw.length < 7) { showStatus('Enter a valid number — e.g. 2348012345678', 'error'); return; }
  setBtnLoading(true); hideStatus(); hide('codeBlock'); hide('connectedBlock');
  try {
    const data = await api(selectedServer, '/pair', 'POST', { phone: raw });
    if (!data.ok) { showStatus(data.error || 'Failed to start pairing', 'error'); setBtnLoading(false); return; }
    currentPhone = data.phone;
    addPhone(currentPhone);
    showStatus('Requesting pairing code from WhatsApp…', 'info');
    startSSE(currentPhone);
    startPoll(currentPhone);
  } catch { showStatus('Network error — try again', 'error'); setBtnLoading(false); }
}

function startSSE(phone) {
  if (sseSource) { sseSource.close(); sseSource = null; }
  if (!selectedServer) return;
  try {
    sseSource = new EventSource(selectedServer.url.replace(/\/$/, '') + `/api/events/${phone}`);
    sseSource.addEventListener('code',        e => { try { const d=JSON.parse(e.data); applyStatus({ status:'code_ready', code:d.code, phone }); } catch {} });
    sseSource.addEventListener('connected',   () => applyStatus({ status:'connected', phone }));
    sseSource.addEventListener('disconnected',() => applyStatus({ status:'disconnected', phone }));
    sseSource.addEventListener('error',       e => { try { const d=JSON.parse(e.data); applyStatus({ status:'error', error:d.message, phone }); } catch {} });
  } catch {}
}
function stopSSE() { if (sseSource) { sseSource.close(); sseSource = null; } }

function startPoll(phone) { stopPoll(); pollTimer = setInterval(() => pollStatus(phone), 3500); }
function stopPoll()       { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
async function pollStatus(phone) {
  if (!selectedServer) return;
  try { const d = await api(selectedServer, `/session/${phone}`); if (d.ok) applyStatus({ ...d, phone }); } catch {}
}

function applyStatus({ status, code, error, phone }) {
  if (status === 'code_ready') {
    setBtnLoading(false); hideStatus();
    const cv = $('codeValue'); if (cv) cv.textContent = code || '————————';
    show('codeBlock'); lucide.createIcons();
  } else if (status === 'connected') {
    stopPoll(); stopSSE(); setBtnLoading(false); hideStatus(); hide('codeBlock');
    const cp = $('connectedPhone'); if (cp) cp.textContent = fmtPhone(phone || currentPhone);
    show('connectedBlock'); addPhone(phone || currentPhone); loadSessions(); lucide.createIcons();
  } else if (status === 'error') {
    stopPoll(); stopSSE(); setBtnLoading(false); showStatus(error || 'Something went wrong — try again.', 'error');
  } else if (status === 'disconnected') {
    stopPoll(); stopSSE();
  }
}

function resetPairForm() {
  stopPoll(); stopSSE(); currentPhone = null;
  const pi = $('phoneInput'); if (pi) pi.value = '';
  hide('codeBlock'); hide('connectedBlock'); hideStatus(); setBtnLoading(false);
}

const phoneInputEl = $('phoneInput');
if (phoneInputEl) phoneInputEl.addEventListener('keydown', e => { if (e.key === 'Enter') startPairing(); });

// ── Copy code ─────────────────────────────────────────
function copyCode() {
  const code = $('codeValue')?.textContent?.trim();
  if (!code || code.includes('—')) return;
  const write = t => navigator.clipboard?.writeText(t) || fallbackCopy(t);
  write(code).then(() => {
    const btn = $('copyBtn'), icon = $('copyIcon'), chk = $('copyCheck');
    btn?.classList.add('copied'); icon?.classList.add('hidden'); chk?.classList.remove('hidden');
    setTimeout(() => { btn?.classList.remove('copied'); icon?.classList.remove('hidden'); chk?.classList.add('hidden'); }, 2000);
  }).catch(() => {});
}
function fallbackCopy(t) {
  const ta = Object.assign(document.createElement('textarea'), { value: t, style: 'position:fixed;opacity:0' });
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch {}
  document.body.removeChild(ta);
  return Promise.resolve();
}

// ── Sessions ──────────────────────────────────────────
let _sessInFlight = false;
async function loadSessions() {
  if (_sessInFlight || !selectedServer) return;
  _sessInFlight = true;
  const myPhones = getPhones();
  if (!myPhones.length) { renderSessions([]); updateNavStatus([]); _sessInFlight = false; return; }
  try {
    const data = await api(selectedServer, '/sessions');
    if (!data.ok) { _sessInFlight = false; return; }
    const mine = data.sessions.filter(s => myPhones.includes(s.phone));
    mine.filter(s => s.status === 'disconnected').forEach(s => rmPhone(s.phone));
    const active = mine.filter(s => s.status !== 'disconnected');
    renderSessions(active);
    updateNavStatus(data.sessions);
  } catch {} finally { _sessInFlight = false; }
}

function renderSessions(sessions) {
  const el = $('sessionsList');
  if (!el) return;
  if (!sessions.length) {
    el.innerHTML = '<div class="sessions-empty"><i data-lucide="radio-tower"></i><span>No sessions yet — pair a number above</span></div>';
    lucide.createIcons(); return;
  }
  el.innerHTML = sessions.map(s => `
    <div class="session-item">
      <span class="sess-dot ${s.status}"></span>
      <span class="session-phone">${fmtPhone(s.phone)}</span>
      <span class="session-badge ${s.status}">${labelStatus(s.status)}</span>
      <button class="btn-danger" onclick="disconnectSession('${s.phone}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:9px;height:9px"><path d="M18 6 6 18M6 6l12 12"/></svg>
        Disconnect
      </button>
    </div>`).join('');
}

function updateNavStatus(allSessions) {
  const connected = (allSessions || []).filter(s => s.status === 'connected').length;
  const dot = $('statusDot'), stat = $('statSessions');
  if (dot) dot.className = `status-dot${connected > 0 ? ' online' : ''}`;
  if (stat) stat.textContent = `${connected} session${connected !== 1 ? 's' : ''}`;
}

async function disconnectSession(phone) {
  if (!selectedServer || !confirm(`Disconnect ${fmtPhone(phone)}?`)) return;
  try { await api(selectedServer, `/disconnect/${phone}`, 'POST'); } catch {}
  rmPhone(phone);
  if (phone === currentPhone) resetPairForm();
  loadSessions();
}

// ── Typewriter ────────────────────────────────────────
(function typewriter() {
  const LINES = [
    'Out of this world. In your chats.',
    'Because replying manually is so... Stone Age.',
    'Zero gravity, zero effort.',
    'Built different. Runs different.',
    'Autonomy at scale. One number at a time.'
  ];
  const el = $('typewriterText');
  if (!el) return;
  let qi = 0, ci = 0, erasing = false, pauseAt = 0;
  const shuffle = a => { const b=[...a]; for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]]}; return b; };
  let queue = shuffle(LINES);
  function tick() {
    const now = Date.now();
    if (now < pauseAt) { setTimeout(tick, pauseAt - now); return; }
    const line = queue[qi % queue.length];
    if (!erasing) {
      if (ci < line.length) { el.textContent = line.slice(0, ++ci); setTimeout(tick, 50 + Math.random() * 30); }
      else { pauseAt = Date.now() + 2400; erasing = true; setTimeout(tick, 2400); }
    } else {
      if (ci > 0) { el.textContent = line.slice(0, --ci); setTimeout(tick, 28 + Math.random() * 16); }
      else { erasing = false; qi++; if (qi % queue.length === 0) queue = shuffle(LINES); pauseAt = Date.now() + 400; setTimeout(tick, 400); }
    }
  }
  setTimeout(tick, 800);
})();

// ── ADMIN ─────────────────────────────────────────────
function openAdmin() {
  show('adminOverlay');
  if (localStorage.getItem(ADMIN_KEY) === ADMIN_PASS) showAdminBody();
  else { show('adminLogin'); hide('adminBody'); }
  $('adminNavBtn')?.classList.add('active');
}
function closeAdmin() {
  hide('adminOverlay');
  $('adminNavBtn')?.classList.remove('active');
}
function handleOverlayClick(e) { if (e.target === $('adminOverlay')) closeAdmin(); }

function doAdminLogin() {
  const pw = $('adminPwInput')?.value?.trim();
  const err = $('adminLoginErr');
  if (pw === ADMIN_PASS) {
    localStorage.setItem(ADMIN_KEY, ADMIN_PASS);
    if (err) err.textContent = '';
    showAdminBody();
  } else {
    if (err) err.textContent = 'Incorrect password.';
    const wrap = document.querySelector('.admin-pw-wrap');
    if (wrap) { wrap.style.borderColor='rgba(239,68,68,0.55)'; setTimeout(()=>wrap.style.borderColor='',1000); }
  }
}
function showAdminBody() { hide('adminLogin'); show('adminBody'); loadAdminData(); }
function switchAdminTab(tab) {
  const tabs = ['servers','announcements','changelogs','polls','channels'];
  document.querySelectorAll('.admin-tab').forEach((t,i) => t.classList.toggle('active', tabs[i]===tab));
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.toggle('active', p.id===`apanel-${tab}`));
}

async function loadAdminData() {
  renderAdminServers();
  if (!selectedServer) return;
  try {
    const [a, c, p, ch] = await Promise.all([
      api(selectedServer, '/announcements').catch(() => ({ items: [] })),
      api(selectedServer, '/changelogs').catch(()   => ({ items: [] })),
      api(selectedServer, '/polls').catch(()         => ({ items: [] })),
      api(selectedServer, '/channels').catch(()      => ({ channels: [] }))
    ]);
    renderAdminAnns(a.items || []);
    renderAdminCls(c.items || []);
    renderAdminPolls(p.items || []);
    adminChannels = ch.channels || [];
    renderAdminChannels();
  } catch {}
}

// ── Admin Servers ─────────────────────────────────────
function renderAdminServers() {
  const el = $('adminServerList');
  if (!el) return;
  if (!servers.length) { el.innerHTML = emptyState('server-off', 'No servers'); lucide.createIcons(); return; }
  el.innerHTML = servers.map(s => {
    const max = TIER_MAX[s.tier] || s.maxUsers || 20;
    return `<div class="admin-item">
      <div class="admin-item-body">
        <div class="admin-item-title">${esc(s.name)} <span class="tier-badge ${s.tier}">${s.tier}</span></div>
        <div class="admin-item-text" style="font-family:var(--mono);font-size:0.72rem">${esc(s.url)}</div>
        <div class="admin-item-meta">${s.connected||0}/${max} · ${s.online?'Online':'Offline'}</div>
      </div>
      ${s._adminAdded ? `<button class="admin-item-del" onclick="removeAdminServer('${s.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : ''}
    </div>`;
  }).join('');
}
async function addServer() {
  const name = $('srvName')?.value?.trim(), url = $('srvUrl')?.value?.trim(), tier = $('srvTier')?.value;
  if (!name || !url) return alert('Fill in name and URL');
  const added = JSON.parse(localStorage.getItem(ADMIN_SRVS)||'[]');
  added.push({ id:'admin_'+Date.now(), name, url, tier, maxUsers:TIER_MAX[tier]||20, _adminAdded:true });
  localStorage.setItem(ADMIN_SRVS, JSON.stringify(added));
  $('srvName').value = ''; $('srvUrl').value = '';
  await refreshServers(); renderAdminServers();
}
function removeAdminServer(id) {
  const added = JSON.parse(localStorage.getItem(ADMIN_SRVS)||'[]').filter(s=>s.id!==id);
  localStorage.setItem(ADMIN_SRVS, JSON.stringify(added));
  if (selectedServer?.id===id) { selectedServer=null; localStorage.removeItem(SEL_SRV_KEY); }
  servers = servers.filter(s=>s.id!==id);
  renderServerGrid(); renderAdminServers();
}

// ── Admin Announcements ───────────────────────────────
function renderAdminAnns(items) {
  const el = $('adminAnnList'); if (!el) return;
  el.innerHTML = !items.length ? emptyState('megaphone', 'No announcements yet')
    : items.map(a=>`<div class="admin-item">
        <div class="admin-item-body">
          <div class="admin-item-title">${esc(a.title||'')}</div>
          <div class="admin-item-text">${esc(a.body||a.message||'')}</div>
          <div class="admin-item-meta">${fmtDate(a.createdAt)}</div>
        </div>
        <button class="admin-item-del" onclick="deleteAnn('${a.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
      </div>`).join('');
  lucide.createIcons();
}
async function postAnnouncement() {
  if (!selectedServer) return alert('Select a server first');
  const title=$('annTitle')?.value?.trim(), body=$('annBody')?.value?.trim();
  if (!title||!body) return alert('Fill in title and message');
  const d = await api(selectedServer,'/announcements','POST',{title,body},getAdminPwd());
  if (!d.ok) return alert(d.error||'Failed');
  $('annTitle').value=''; $('annBody').value='';
  const d2=await api(selectedServer,'/announcements'); renderAdminAnns(d2.items||[]); loadContentCards();
}
async function deleteAnn(id) {
  if (!selectedServer||!confirm('Delete?')) return;
  await api(selectedServer,`/announcements/${id}`,'DELETE',null,getAdminPwd()).catch(()=>{});
  const d=await api(selectedServer,'/announcements').catch(()=>({items:[]})); renderAdminAnns(d.items||[]); loadContentCards();
}

// ── Admin Changelogs ──────────────────────────────────
function renderAdminCls(items) {
  const el=$('adminClList'); if (!el) return;
  el.innerHTML = !items.length ? emptyState('git-commit-horizontal','No changelogs yet')
    : items.map(c=>`<div class="admin-item">
        <div class="admin-item-body">
          <div class="admin-item-title">${esc(c.version||'')}${c.tag?` <span class="cl-tag">${esc(c.tag)}</span>`:''}</div>
          <div class="admin-item-text">${esc(c.body||c.changes||'')}</div>
          <div class="admin-item-meta">${fmtDate(c.createdAt)}</div>
        </div>
        <button class="admin-item-del" onclick="deleteCl('${c.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
      </div>`).join('');
  lucide.createIcons();
}
async function postChangelog() {
  if (!selectedServer) return alert('Select a server first');
  const version=$('clVersion')?.value?.trim(), body=$('clBody')?.value?.trim(), tag=$('clTag')?.value?.trim();
  if (!version||!body) return alert('Fill in version and changes');
  const d=await api(selectedServer,'/changelogs','POST',{version,body,tag},getAdminPwd());
  if (!d.ok) return alert(d.error||'Failed');
  $('clVersion').value=''; $('clBody').value=''; $('clTag').value='';
  const d2=await api(selectedServer,'/changelogs'); renderAdminCls(d2.items||[]); loadContentCards();
}
async function deleteCl(id) {
  if (!selectedServer||!confirm('Delete?')) return;
  await api(selectedServer,`/changelogs/${id}`,'DELETE',null,getAdminPwd()).catch(()=>{});
  const d=await api(selectedServer,'/changelogs').catch(()=>({items:[]})); renderAdminCls(d.items||[]); loadContentCards();
}

// ── Admin Polls ───────────────────────────────────────
function renderAdminPolls(items) {
  const el=$('adminPollList'); if (!el) return;
  el.innerHTML = !items.length ? emptyState('bar-chart-2','No polls yet')
    : items.map(p=>{
        const tot=(p.options||[]).reduce((s,o)=>s+(o.votes||0),0);
        const opts=(p.options||[]).map(o=>`<div style="font-size:0.76rem;color:var(--text-2);display:flex;gap:8px;margin-top:3px"><span style="flex:1">${esc(o.text)}</span><span style="font-family:var(--mono);font-size:0.7rem;color:var(--lime-text)">${o.votes||0}</span></div>`).join('');
        return `<div class="admin-item">
          <div class="admin-item-body">
            <div class="admin-item-title">${esc(p.question)}</div>
            ${opts}
            <div class="admin-item-meta">${tot} total votes · ${fmtDate(p.createdAt)}</div>
          </div>
          <button class="admin-item-del" onclick="deletePoll('${p.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </div>`;
      }).join('');
  lucide.createIcons();
}
async function postPoll() {
  if (!selectedServer) return alert('Select a server first');
  const question=$('pollQ')?.value?.trim(), optsRaw=$('pollOpts')?.value?.trim();
  if (!question||!optsRaw) return alert('Fill in question and options');
  const options=optsRaw.split('\n').map(s=>s.trim()).filter(Boolean);
  if (options.length<2) return alert('Need at least 2 options');
  const d=await api(selectedServer,'/polls','POST',{question,options},getAdminPwd());
  if (!d.ok) return alert(d.error||'Failed');
  $('pollQ').value=''; $('pollOpts').value='';
  const d2=await api(selectedServer,'/polls'); renderAdminPolls(d2.items||[]); loadContentCards();
}
async function deletePoll(id) {
  if (!selectedServer||!confirm('Delete?')) return;
  await api(selectedServer,`/polls/${id}`,'DELETE',null,getAdminPwd()).catch(()=>{});
  const d=await api(selectedServer,'/polls').catch(()=>({items:[]})); renderAdminPolls(d.items||[]); loadContentCards();
}

// ── Admin Channels ────────────────────────────────────
function renderAdminChannels() {
  const el=$('adminChannelList'); if (!el) return;
  if (!adminChannels.length) { el.innerHTML=emptyState('link','No channels yet'); lucide.createIcons(); return; }
  el.innerHTML=adminChannels.map((ch,i)=>`<div class="admin-item">
    <div class="admin-item-body">
      <div class="admin-item-title">${esc(ch.label)} <span class="tier-badge" style="margin-left:4px">${esc(ch.type||'')}</span></div>
      <div class="admin-item-text" style="font-family:var(--mono);font-size:0.7rem">${esc(ch.url)}</div>
    </div>
    <button class="admin-item-del" onclick="removeCh(${i})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
  </div>`).join('');
}
function addChannel() {
  const label=$('chLabel')?.value?.trim(), url=$('chUrl')?.value?.trim(), handle=$('chHandle')?.value?.trim(), type=$('chType')?.value;
  if (!label||!url) return alert('Fill in label and URL');
  adminChannels.push({ id:Date.now().toString(), label, url, handle, type });
  $('chLabel').value=''; $('chUrl').value=''; $('chHandle').value='';
  renderAdminChannels();
}
function removeCh(i) { adminChannels.splice(i,1); renderAdminChannels(); }
async function saveChannels() {
  if (!selectedServer) return alert('Select a server first');
  const d=await api(selectedServer,'/channels','POST',{channels:adminChannels},getAdminPwd()).catch(()=>({ok:false}));
  if (!d.ok) return alert('Failed to save');
  alert('Channel gate saved!');
  loadGateChannels();
}

// ── Utility ───────────────────────────────────────────
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtPhone(p) { return String(p||'').replace(/(\d{3})(?=\d)/g,'$1 ').trim(); }
function fmtDate(iso) { if (!iso) return ''; try { return new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); } catch { return ''; } }
function labelStatus(s) { return {pending:'Pending',code_ready:'Code Ready',connected:'Connected',disconnected:'Offline',error:'Error'}[s]||s; }
function setText(id, val) { const e=$(id); if (e) e.textContent=val; }
function emptyState(icon, msg) { return `<div class="empty-state"><i data-lucide="${icon}"></i><span>${esc(msg)}</span></div>`; }

// ── Boot ──────────────────────────────────────────────
loadServers();
setInterval(loadSessions, 10000);
