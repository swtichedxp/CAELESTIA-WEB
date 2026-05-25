/* ═══════════════════════════════════════════════════════════════════
   Caelestia — Frontend Web-Pairer
   Dev: ҲЄƝ | Vanish UI
═══════════════════════════════════════════════════════════════════ */

// ── Constants ────────────────────────────────────────────────────────────────
const GATE_KEY        = 'caelestia_channel_followed';
const MY_PHONES_KEY   = 'caelestia_my_phones';
const ADMIN_KEY       = 'caelestia_admin_auth';
const SELECTED_SRV    = 'caelestia_selected_server';
const ADMIN_PASSWORD  = 'zedxandromeda';

// Tier caps
const TIER_MAX = { high: 20, mid: 16, low: 5 };

// ── State ─────────────────────────────────────────────────────────────────────
let servers         = [];   // loaded from servers.json + live stats
let selectedServer  = null; // { id, url, name, tier, maxUsers }
let currentPhone    = null;
let pollTimer       = null;
let sseSource       = null;
let adminChannels   = [];   // working copy of channels in admin panel
let adminServers    = [];   // working copy of servers in admin panel

// ── DOM helpers ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
function show(id)  { const el = $(id); if (el) el.classList.remove('hidden'); }
function hide(id)  { const el = $(id); if (el) el.classList.add('hidden'); }
function isHidden(id) { return $(id)?.classList.contains('hidden'); }

// ── API helper ────────────────────────────────────────────────────────────────
async function api(server, path, method = 'GET', body = null, adminPwd = null) {
  const url = server.url.replace(/\/$/, '') + '/api' + path;
  const headers = { 'Content-Type': 'application/json' };
  if (adminPwd) headers['X-Admin-Password'] = adminPwd;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  return res.json();
}

function getAdminPassword() {
  return localStorage.getItem(ADMIN_KEY) || null;
}

// ── Server Management ─────────────────────────────────────────────────────────
async function loadServers() {
  // Load server config from servers.json
  let config;
  try {
    const r = await fetch('./servers.json');
    config = await r.json();
  } catch {
    config = { servers: [] };
  }

  // Merge with any admin-added servers stored in localStorage
  const adminAdded = JSON.parse(localStorage.getItem('caelestia_admin_servers') || '[]');
  const allServers = [...config.servers, ...adminAdded];

  // Fetch live capacity for each server in parallel
  servers = await Promise.all(allServers.map(async srv => {
    try {
      const data = await api(srv, '/capacity');
      return { ...srv, connected: data.connected ?? 0, available: data.available ?? srv.maxUsers, online: true };
    } catch {
      return { ...srv, connected: 0, available: srv.maxUsers, online: false };
    }
  }));

  renderServerGrid();
  loadNavLinks();
  loadGateChannels();
  loadContentCards();
}

async function refreshServers() {
  const btn = $('refreshServersBtn');
  if (btn) { btn.disabled = true; }
  const grid = $('serverGrid');
  if (grid) grid.innerHTML = '<div class="sessions-empty"><i data-lucide="loader-2" class="spinner"></i><span>Refreshing…</span></div>';
  lucide.createIcons();
  await loadServers();
  if (btn) btn.disabled = false;
}

function renderServerGrid() {
  const grid = $('serverGrid');
  if (!grid) return;

  if (!servers.length) {
    grid.innerHTML = '<div class="sessions-empty"><i data-lucide="server-off"></i><span>No servers configured</span></div>';
    lucide.createIcons();
    return;
  }

  grid.innerHTML = servers.map(srv => {
    const max = TIER_MAX[srv.tier] || srv.maxUsers || 20;
    const connected = srv.connected || 0;
    const pct = Math.min(100, Math.round((connected / max) * 100));
    const isFull = connected >= max;
    const isWarn = pct >= 75;
    const dotClass = !srv.online ? '' : isFull ? 'full' : isWarn ? 'warn' : 'online';
    const barClass = isFull ? 'full' : isWarn ? 'warn' : '';
    const isSelected = selectedServer?.id === srv.id;
    const tierLabel = { high: 'High', mid: 'Mid', low: 'Low' }[srv.tier] || srv.tier;
    const tierClass = `tier-${srv.tier || 'high'}`;

    return `
      <div class="server-item${isSelected ? ' selected' : ''}${isFull ? ' full' : ''}"
           onclick="selectServer('${srv.id}')" id="srv-${srv.id}">
        <span class="server-dot ${dotClass}"></span>
        <div class="server-info">
          <span class="server-name">${srv.name}${srv.label ? ` <em style="color:var(--text3);font-style:normal;font-size:0.75rem">${srv.label}</em>` : ''}</span>
          <span class="server-tier-badge ${tierClass}">${tierLabel}</span>
          ${!srv.online ? '<span style="font-size:0.68rem;color:#ef4444;margin-left:4px">Offline</span>' : ''}
          ${isFull ? '<span style="font-size:0.68rem;color:#ef4444;margin-left:4px">Full</span>' : ''}
        </div>
        <div class="server-cap">
          <span class="server-cap-text">${connected}/${max}</span>
          <div class="cap-bar-wrap">
            <div class="cap-bar ${barClass}" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="server-selected-check">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
      </div>`;
  }).join('');

  lucide.createIcons();

  // Restore previously selected server
  const savedId = localStorage.getItem(SELECTED_SRV);
  if (savedId) {
    const srv = servers.find(s => s.id === savedId);
    if (srv && !isServerFull(srv)) { selectedServer = srv; highlightSelected(); }
  }
  // Auto-select best available server if nothing selected
  if (!selectedServer) autoSelectServer();

  updateAfterServerSelect();
}

function isServerFull(srv) {
  const max = TIER_MAX[srv.tier] || srv.maxUsers || 20;
  return (srv.connected || 0) >= max;
}

function autoSelectServer() {
  // Pick server with most availability, prioritize high tier
  const available = servers.filter(s => s.online && !isServerFull(s));
  if (!available.length) return;
  // Sort: high > mid > low, then by most available slots
  const tierOrder = { high: 0, mid: 1, low: 2 };
  available.sort((a, b) => {
    const ta = tierOrder[a.tier] ?? 3, tb = tierOrder[b.tier] ?? 3;
    if (ta !== tb) return ta - tb;
    return (b.available || 0) - (a.available || 0);
  });
  selectedServer = available[0];
  highlightSelected();
}

function highlightSelected() {
  document.querySelectorAll('.server-item').forEach(el => el.classList.remove('selected'));
  if (selectedServer) {
    const el = $(`srv-${selectedServer.id}`);
    if (el) el.classList.add('selected');
    localStorage.setItem(SELECTED_SRV, selectedServer.id);
  }
}

function selectServer(id) {
  const srv = servers.find(s => s.id === id);
  if (!srv || isServerFull(srv)) return;
  selectedServer = srv;
  highlightSelected();
  updateAfterServerSelect();
}

function updateAfterServerSelect() {
  if (!selectedServer) return;
  const badge = $('selectedServerBadge');
  if (badge) badge.innerHTML = `<span style="color:var(--text3)">Connected to:</span> <span style="color:var(--lime);font-family:var(--mono)">${selectedServer.name}</span> <span class="server-tier-badge tier-${selectedServer.tier}" style="margin-left:4px">${selectedServer.tier}</span>`;

  // Show gate/pair cards now that a server is selected
  const gateFollowed = localStorage.getItem(GATE_KEY) === '1';
  if (gateFollowed) {
    hide('channelGateCard');
    show('pairCard');
  } else {
    show('channelGateCard');
    hide('pairCard');
  }
}

// ── Nav Links ─────────────────────────────────────────────────────────────────
async function loadNavLinks() {
  if (!selectedServer) return;
  try {
    const data = await api(selectedServer, '/links');
    const links = data.links || [];
    const iconMap = { send: 'send', users: 'users', 'message-circle': 'message-circle' };
    const html = links.map(l =>
      `<a href="${l.url}" target="_blank" class="nav-pill${l.accent ? ' accent' : ''}">
        <i data-lucide="${iconMap[l.icon] || 'link'}"></i><span>${l.label}</span></a>`
    ).join('');
    const mobileHtml = links.map(l =>
      `<a href="${l.url}" target="_blank" class="mobile-nav-link${l.accent ? ' accent' : ''}" onclick="closeMenu()">
        <i data-lucide="${iconMap[l.icon] || 'link'}"></i><span>${l.label}</span></a>`
    ).join('');
    const nav = $('navLinks');
    const mNav = $('mobileNavLinks');
    if (nav) { nav.innerHTML = html; lucide.createIcons(); }
    if (mNav) { mNav.innerHTML = mobileHtml; lucide.createIcons(); }
  } catch {}
}

// ── Channel Gate ──────────────────────────────────────────────────────────────
async function loadGateChannels() {
  if (!selectedServer) return;
  try {
    const data = await api(selectedServer, '/channels');
    const channels = data.channels || [];
    const gateEl = $('gateChannels');
    if (!gateEl) return;
    gateEl.innerHTML = channels.map(ch => {
      const icons = { tg: 'send', 'tg-group': 'users', wa: 'message-circle' };
      return `<a href="${ch.url}" target="_blank" class="gate-channel-btn ${ch.type || ''}">
        <i data-lucide="${icons[ch.type] || 'link'}"></i>
        <div><strong>${ch.label}</strong><span>${ch.handle || ''}</span></div>
        <i data-lucide="external-link" class="gate-ext"></i></a>`;
    }).join('');
    lucide.createIcons();
  } catch {}
}

function confirmChannelFollow() {
  localStorage.setItem(GATE_KEY, '1');
  hide('channelGateCard');
  const pair = $('pairCard');
  if (pair) {
    pair.classList.remove('hidden');
    pair.style.opacity = '0';
    pair.style.transform = 'translateY(8px)';
    pair.style.transition = 'opacity 0.28s ease, transform 0.28s ease';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pair.style.opacity = '1';
      pair.style.transform = 'translateY(0)';
    }));
  }
}

// ── Content Cards (Announcements / Changelogs / Polls) ────────────────────────
async function loadContentCards() {
  if (!selectedServer) return;
  let hasContent = false;
  try {
    const [annData, clData, pollData] = await Promise.all([
      api(selectedServer, '/announcements').catch(() => ({ items: [] })),
      api(selectedServer, '/changelogs').catch(()   => ({ items: [] })),
      api(selectedServer, '/polls').catch(()         => ({ items: [] }))
    ]);
    const anns  = annData.items  || [];
    const cls   = clData.items   || [];
    const polls = pollData.items || [];

    if (anns.length || cls.length || polls.length) hasContent = true;

    renderAnnouncements(anns);
    renderChangelogs(cls);
    renderPolls(polls);
  } catch {}

  const contentCard = $('contentCard');
  if (contentCard) contentCard.style.display = hasContent ? '' : 'none';
}

function renderAnnouncements(items) {
  const el = $('panel-ann');
  if (!el) return;
  if (!items.length) { el.innerHTML = '<div class="empty-state"><i data-lucide="megaphone"></i><span>No announcements yet</span></div>'; lucide.createIcons(); return; }
  el.innerHTML = items.map(a => `
    <div class="ann-item">
      <div class="ann-title">${escHtml(a.title || '')}</div>
      <div class="ann-body">${escHtml(a.body || a.message || '')}</div>
      <div class="ann-date">${formatDate(a.createdAt)}</div>
    </div>`).join('');
}

function renderChangelogs(items) {
  const el = $('panel-cl');
  if (!el) return;
  if (!items.length) { el.innerHTML = '<div class="empty-state"><i data-lucide="git-commit-horizontal"></i><span>No changelogs yet</span></div>'; lucide.createIcons(); return; }
  el.innerHTML = items.map(c => `
    <div class="cl-item">
      ${c.tag ? `<div class="cl-tag">${escHtml(c.tag)}</div>` : ''}
      <div class="cl-version">${escHtml(c.version || 'v?')}</div>
      <div class="cl-body">${escHtml(c.body || c.changes || '')}</div>
      <div class="cl-date">${formatDate(c.createdAt)}</div>
    </div>`).join('');
}

function renderPolls(items) {
  const el = $('panel-poll');
  if (!el) return;
  if (!items.length) { el.innerHTML = '<div class="empty-state"><i data-lucide="bar-chart-2"></i><span>No active polls</span></div>'; lucide.createIcons(); return; }
  el.innerHTML = items.map(p => {
    const totalVotes = (p.options || []).reduce((s, o) => s + (o.votes || 0), 0);
    const opts = (p.options || []).map(o => {
      const pct = totalVotes ? Math.round(((o.votes||0)/totalVotes)*100) : 0;
      return `<div class="poll-opt" onclick="vote('${p.id}','${o.id}',this)">
        <div class="poll-bar" style="width:${pct}%"></div>
        <span class="poll-opt-text">${escHtml(o.text)}</span>
        <span class="poll-opt-votes">${o.votes||0} · ${pct}%</span></div>`;
    }).join('');
    return `<div class="poll-item">
      <div class="poll-q">${escHtml(p.question)}</div>
      <div class="poll-options" id="poll-${p.id}">${opts}</div></div>`;
  }).join('');
}

async function vote(pollId, optionId, el) {
  if (!selectedServer) return;
  try {
    const data = await api(selectedServer, `/polls/${pollId}/vote`, 'POST', { optionId });
    if (data.poll) renderPolls([data.poll]);
  } catch {}
}

function switchTab(tab) {
  document.querySelectorAll('.content-tab').forEach((t, i) => {
    const tabs = ['ann','cl','poll'];
    t.classList.toggle('active', tabs[i] === tab);
  });
  document.querySelectorAll('.content-panel').forEach(p => {
    p.classList.toggle('active', p.id === `panel-${tab}`);
  });
}

// ── Pairing Flow ──────────────────────────────────────────────────────────────
function getMyPhones() {
  try { return JSON.parse(localStorage.getItem(MY_PHONES_KEY) || '[]'); } catch { return []; }
}
function addMyPhone(phone) {
  const phones = getMyPhones();
  if (!phones.includes(phone)) { phones.push(phone); localStorage.setItem(MY_PHONES_KEY, JSON.stringify(phones)); }
}
function removeMyPhone(phone) {
  localStorage.setItem(MY_PHONES_KEY, JSON.stringify(getMyPhones().filter(p => p !== phone)));
}

function showStatus(msg, type = 'info') {
  const el = $('pairStatus');
  if (!el) return;
  el.className = `pair-status ${type}`;
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideStatus() { const el = $('pairStatus'); if (el) el.classList.add('hidden'); }

function setBtnLoading(loading) {
  const btn = $('pairBtn');
  if (!btn) return;
  btn.disabled = loading;
  const txt  = btn.querySelector('.btn-text');
  const icon = btn.querySelector('.btn-icon');
  const spin = btn.querySelector('.btn-spinner');
  if (txt)  txt.textContent = loading ? 'Connecting…' : 'Get Code';
  if (icon) icon.classList.toggle('hidden', loading);
  if (spin) spin.classList.toggle('hidden', !loading);
}

async function startPairing() {
  if (!selectedServer) { showStatus('Please select a server first.', 'error'); return; }
  const raw = ($('phoneInput')?.value || '').trim().replace(/\D/g, '');
  if (!raw || raw.length < 7) { showStatus('Enter a valid number — e.g. 2348012345678', 'error'); return; }

  setBtnLoading(true);
  hideStatus();
  hide('codeBlock');
  hide('connectedBlock');

  try {
    const data = await api(selectedServer, '/pair', 'POST', { phone: raw });
    if (!data.ok) {
      showStatus(data.error || 'Failed to start pairing', 'error');
      setBtnLoading(false);
      return;
    }
    currentPhone = data.phone;
    addMyPhone(currentPhone);
    showStatus('Requesting pairing code from WhatsApp…', 'info');
    startSSE(currentPhone);
    startPolling(currentPhone);
  } catch {
    showStatus('Network error — please try again', 'error');
    setBtnLoading(false);
  }
}

// ── SSE ───────────────────────────────────────────────────────────────────────
function startSSE(phone) {
  if (sseSource) { sseSource.close(); sseSource = null; }
  if (!selectedServer) return;
  try {
    const url = selectedServer.url.replace(/\/$/, '') + `/api/events/${phone}`;
    sseSource = new EventSource(url);
    sseSource.addEventListener('code', e => {
      try { const d = JSON.parse(e.data); applyStatus({ status: 'code_ready', code: d.code, phone }); } catch {}
    });
    sseSource.addEventListener('connected', e => {
      try { applyStatus({ status: 'connected', phone }); } catch {}
    });
    sseSource.addEventListener('disconnected', () => {
      applyStatus({ status: 'disconnected', phone });
    });
    sseSource.addEventListener('error', e => {
      try { const d = JSON.parse(e.data); applyStatus({ status: 'error', error: d.message, phone }); } catch {}
    });
    sseSource.onerror = () => { /* SSE reconnects automatically */ };
  } catch {}
}

function stopSSE() {
  if (sseSource) { sseSource.close(); sseSource = null; }
}

// ── Polling (fallback alongside SSE) ─────────────────────────────────────────
function startPolling(phone) {
  stopPolling();
  pollTimer = setInterval(() => pollStatus(phone), 3000);
}
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

async function pollStatus(phone) {
  if (!selectedServer) return;
  try {
    const data = await api(selectedServer, `/session/${phone}`);
    if (data.ok) applyStatus({ ...data, phone });
  } catch {}
}

function applyStatus({ status, code, error, phone }) {
  if (status === 'code_ready') {
    setBtnLoading(false);
    hideStatus();
    const cv = $('codeValue');
    if (cv) cv.textContent = code || '————————';
    show('codeBlock');
    lucide.createIcons();

  } else if (status === 'connected') {
    stopPolling();
    stopSSE();
    setBtnLoading(false);
    hideStatus();
    hide('codeBlock');
    const cp = $('connectedPhone');
    if (cp) cp.textContent = formatPhone(phone || currentPhone);
    show('connectedBlock');
    addMyPhone(phone || currentPhone);
    loadSessions();
    lucide.createIcons();

  } else if (status === 'error') {
    stopPolling();
    stopSSE();
    setBtnLoading(false);
    showStatus(error || 'Something went wrong — try again.', 'error');

  } else if (status === 'disconnected') {
    stopPolling();
    stopSSE();
  }
}

function resetPairForm() {
  stopPolling();
  stopSSE();
  currentPhone = null;
  const pi = $('phoneInput');
  if (pi) pi.value = '';
  hide('codeBlock');
  hide('connectedBlock');
  hideStatus();
  setBtnLoading(false);
}

const phoneInputEl = $('phoneInput');
if (phoneInputEl) phoneInputEl.addEventListener('keydown', e => { if (e.key === 'Enter') startPairing(); });

// ── Copy Code ─────────────────────────────────────────────────────────────────
function copyCode() {
  const cv = $('codeValue');
  if (!cv) return;
  const code = cv.textContent.trim();
  if (!code || code.includes('—')) return;
  function doCopy(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand('copy'); } catch(_) {}
    document.body.removeChild(ta);
    return Promise.resolve();
  }
  doCopy(code).then(() => {
    const btn   = $('copyBtn');
    const icon  = $('copyIcon');
    const check = $('copyCheck');
    if (btn)   btn.classList.add('copied');
    if (icon)  icon.classList.add('hidden');
    if (check) check.classList.remove('hidden');
    setTimeout(() => {
      if (btn)   btn.classList.remove('copied');
      if (icon)  icon.classList.remove('hidden');
      if (check) check.classList.add('hidden');
    }, 2200);
  }).catch(() => {});
}

// ── Sessions ──────────────────────────────────────────────────────────────────
let _sessInFlight = false;
async function loadSessions() {
  if (_sessInFlight || !selectedServer) return;
  const myPhones = getMyPhones();
  if (!myPhones.length) { renderSessions([]); updateNavStatus([]); return; }
  _sessInFlight = true;
  try {
    const data = await api(selectedServer, '/sessions');
    if (!data.ok) return;
    const mine = data.sessions.filter(s => myPhones.includes(s.phone));
    mine.forEach(s => { if (s.status === 'disconnected') removeMyPhone(s.phone); });
    renderSessions(mine.filter(s => s.status !== 'disconnected'));
    updateNavStatus(data.sessions);
  } catch {} finally {
    _sessInFlight = false;
  }
}

function renderSessions(sessions) {
  const list = $('sessionsList');
  if (!list) return;
  if (!sessions.length) {
    list.innerHTML = '<div class="sessions-empty"><i data-lucide="radio-tower"></i><span>No sessions yet — pair a number above</span></div>';
    lucide.createIcons();
    return;
  }
  list.innerHTML = sessions.map(s => `
    <div class="session-item">
      <span class="session-dot ${s.status}"></span>
      <span class="session-phone">${formatPhone(s.phone)}</span>
      <span class="session-badge ${s.status}">${labelStatus(s.status)}</span>
      <button class="btn-danger" onclick="disconnectSession('${s.phone}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:10px;height:10px"><path d="M18 6 6 18M6 6l12 12"/></svg>
        Disconnect
      </button>
    </div>`).join('');
}

function updateNavStatus(allSessions) {
  const connected = allSessions.filter(s => s.status === 'connected').length;
  const dot  = $('statusDot');
  const stat = $('statSessions');
  const mDot  = $('mobileStatusDot');
  const mStat = $('mobileStatSessions');
  if (dot)   dot.className  = `status-dot${connected > 0 ? ' online' : ''}`;
  if (stat)  stat.textContent = `${connected} session${connected !== 1 ? 's' : ''}`;
  if (mDot)  mDot.className  = `status-dot${connected > 0 ? ' online' : ''}`;
  if (mStat) mStat.textContent = `${connected} session${connected !== 1 ? 's' : ''} active`;
}

async function disconnectSession(phone) {
  if (!selectedServer) return;
  if (!confirm(`Disconnect ${formatPhone(phone)}?`)) return;
  try {
    await api(selectedServer, `/disconnect/${phone}`, 'POST');
    removeMyPhone(phone);
    if (phone === currentPhone) resetPairForm();
    loadSessions();
  } catch {}
}

// ── Typewriter ────────────────────────────────────────────────────────────────
(function initTypewriter() {
  const TAGLINES = [
    'Out of this world{.} In your chats{.}',
    'Because replying manually is so{.}{.}{.} Stone Age{.}',
    'Zero gravity, zero effort{.}{.}{.}',
    'Built different{.} Runs different{.}',
    'Autonomy at scale{.} One number at a time{.}'
  ];
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
    return a;
  }
  const el = $('typewriterText');
  if (!el) return;
  let queue = shuffle(TAGLINES), qIdx = 0, charIdx = 0, erasing = false, pauseEnd = 0;
  function getHtml(raw, upTo) {
    const plain = raw.replace(/\{\.}/g, '.');
    const chars = plain.slice(0, upTo);
    let result = '', rawIdx = 0;
    for (let ci = 0; ci < chars.length; ci++) {
      while (rawIdx < raw.length) {
        if (raw.slice(rawIdx, rawIdx+3) === '{.}') {
          if (chars[ci] === '.') { result += '<span class="lime-dot">.</span>'; rawIdx += 3; break; }
        } else { result += raw[rawIdx++]; break; }
      }
    }
    return result;
  }
  function tick() {
    const now = Date.now();
    if (now < pauseEnd) { setTimeout(tick, pauseEnd-now); return; }
    const raw   = queue[qIdx % queue.length];
    const plain = raw.replace(/\{\.}/g, '.');
    if (!erasing) {
      if (charIdx < plain.length) { el.innerHTML = getHtml(raw, ++charIdx); setTimeout(tick, 48+Math.random()*28); }
      else { pauseEnd = Date.now()+2600; erasing = true; setTimeout(tick, 2600); }
    } else {
      if (charIdx > 0) { el.innerHTML = getHtml(raw, --charIdx); setTimeout(tick, 26+Math.random()*14); }
      else {
        erasing = false; qIdx++;
        if (qIdx % queue.length === 0) queue = shuffle(TAGLINES);
        pauseEnd = Date.now()+500; setTimeout(tick, 500);
      }
    }
  }
  setTimeout(tick, 900);
})();

// ── Utility ───────────────────────────────────────────────────────────────────
function formatPhone(phone) { return String(phone).replace(/(\d{3})(?=\d)/g, '$1 ').trim(); }
function labelStatus(s) { return { pending:'Pending', code_ready:'Code Ready', connected:'Connected', disconnected:'Offline', error:'Error' }[s] || s; }
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── ADMIN PANEL ───────────────────────────────────────────────────────────────
function openAdmin() {
  show('adminOverlay');
  const savedAuth = localStorage.getItem(ADMIN_KEY);
  if (savedAuth === ADMIN_PASSWORD) {
    showAdminBody();
  } else {
    show('adminLogin');
    hide('adminBody');
  }
  const adminNavBtn = $('adminNavBtn');
  if (adminNavBtn) adminNavBtn.classList.add('active');
}

function closeAdmin() {
  hide('adminOverlay');
  const adminNavBtn = $('adminNavBtn');
  if (adminNavBtn) adminNavBtn.classList.remove('active');
}

function handleOverlayClick(e) {
  if (e.target === $('adminOverlay')) closeAdmin();
}

function doAdminLogin() {
  const pw = $('adminPwInput')?.value?.trim();
  const err = $('adminLoginErr');
  if (pw === ADMIN_PASSWORD) {
    localStorage.setItem(ADMIN_KEY, ADMIN_PASSWORD);
    if (err) err.textContent = '';
    showAdminBody();
  } else {
    if (err) err.textContent = 'Incorrect password.';
    const wrap = document.querySelector('.admin-pw-wrap');
    if (wrap) { wrap.style.borderColor = 'rgba(255,55,55,0.55)'; setTimeout(() => wrap.style.borderColor = '', 1000); }
  }
}

function showAdminBody() {
  hide('adminLogin');
  show('adminBody');
  loadAdminData();
}

function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach((t, i) => {
    const tabs = ['servers','announcements','changelogs','polls','channels'];
    t.classList.toggle('active', tabs[i] === tab);
  });
  document.querySelectorAll('.admin-panel').forEach(p => {
    p.classList.toggle('active', p.id === `apanel-${tab}`);
  });
}

// ── Admin: load all data from selected server ──────────────────────────────────
async function loadAdminData() {
  renderAdminServers();
  if (!selectedServer) return;
  const pwd = getAdminPassword();
  try {
    const [annD, clD, pollD, chD] = await Promise.all([
      api(selectedServer, '/announcements').catch(() => ({ items: [] })),
      api(selectedServer, '/changelogs').catch(() =>   ({ items: [] })),
      api(selectedServer, '/polls').catch(() =>         ({ items: [] })),
      api(selectedServer, '/channels').catch(() =>      ({ channels: [] }))
    ]);
    renderAdminAnns(annD.items || []);
    renderAdminCls(clD.items || []);
    renderAdminPolls(pollD.items || []);
    adminChannels = chD.channels || [];
    renderAdminChannels();
  } catch {}
}

// ── Admin: Servers tab ────────────────────────────────────────────────────────
function renderAdminServers() {
  const el = $('adminServerList');
  if (!el) return;
  const allServers = [...servers];
  if (!allServers.length) {
    el.innerHTML = '<div class="empty-state"><i data-lucide="server-off"></i><span>No servers configured</span></div>';
    lucide.createIcons(); return;
  }
  el.innerHTML = allServers.map(srv => {
    const max = TIER_MAX[srv.tier] || srv.maxUsers || 20;
    const connected = srv.connected || 0;
    return `
      <div class="server-manage-item">
        <div class="server-manage-info">
          <div class="server-manage-name">${escHtml(srv.name)} <span class="server-tier-badge tier-${srv.tier}">${srv.tier}</span></div>
          <div class="server-manage-url">${escHtml(srv.url)}</div>
        </div>
        <div class="server-manage-stats">
          <span style="font-family:var(--mono);font-size:0.72rem;color:var(--lime)">${connected}/${max}</span>
          <span style="font-size:0.65rem;color:${srv.online?'var(--lime)':'#ef4444'}">${srv.online?'Online':'Offline'}</span>
        </div>
        ${srv._adminAdded ? `<button class="admin-item-del" onclick="removeAdminServer('${srv.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : ''}
      </div>`;
  }).join('');
  lucide.createIcons();
}

async function addServer() {
  const name = $('srvName')?.value?.trim();
  const url  = $('srvUrl')?.value?.trim();
  const tier = $('srvTier')?.value;
  if (!name || !url) return alert('Fill in server name and URL');
  if (!url.startsWith('http')) return alert('URL must start with http:// or https://');
  const newSrv = { id: 'admin_' + Date.now(), name, url, tier, maxUsers: TIER_MAX[tier] || 20, label: '', _adminAdded: true };
  const adminAdded = JSON.parse(localStorage.getItem('caelestia_admin_servers') || '[]');
  adminAdded.push(newSrv);
  localStorage.setItem('caelestia_admin_servers', JSON.stringify(adminAdded));
  // Clear inputs
  $('srvName').value = '';
  $('srvUrl').value  = '';
  await refreshServers();
  renderAdminServers();
}

function removeAdminServer(id) {
  const adminAdded = JSON.parse(localStorage.getItem('caelestia_admin_servers') || '[]').filter(s => s.id !== id);
  localStorage.setItem('caelestia_admin_servers', JSON.stringify(adminAdded));
  servers = servers.filter(s => s.id !== id);
  if (selectedServer?.id === id) { selectedServer = null; localStorage.removeItem(SELECTED_SRV); }
  renderServerGrid();
  renderAdminServers();
}

// ── Admin: Announcements ──────────────────────────────────────────────────────
function renderAdminAnns(items) {
  const el = $('adminAnnList');
  if (!el) return;
  if (!items.length) { el.innerHTML = '<div class="empty-state"><i data-lucide="megaphone"></i><span>No announcements yet</span></div>'; lucide.createIcons(); return; }
  el.innerHTML = items.map(a => `
    <div class="admin-item">
      <div class="admin-item-body">
        <div class="admin-item-title">${escHtml(a.title||'')}</div>
        <div class="admin-item-text">${escHtml(a.body||a.message||'')}</div>
        <div class="admin-item-meta">${formatDate(a.createdAt)}</div>
      </div>
      <button class="admin-item-del" onclick="deleteAnn('${a.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>`).join('');
}

async function postAnnouncement() {
  if (!selectedServer) return alert('Select a server first');
  const title = $('annTitle')?.value?.trim();
  const body  = $('annBody')?.value?.trim();
  if (!title || !body) return alert('Fill in title and message');
  const pwd = getAdminPassword();
  try {
    const data = await api(selectedServer, '/announcements', 'POST', { title, body }, pwd);
    if (!data.ok) return alert(data.error || 'Failed');
    $('annTitle').value = '';
    $('annBody').value  = '';
    const d2 = await api(selectedServer, '/announcements');
    renderAdminAnns(d2.items || []);
    loadContentCards();
  } catch { alert('Network error'); }
}

async function deleteAnn(id) {
  if (!selectedServer || !confirm('Delete this announcement?')) return;
  const pwd = getAdminPassword();
  await api(selectedServer, `/announcements/${id}`, 'DELETE', null, pwd).catch(() => {});
  const d = await api(selectedServer, '/announcements').catch(() => ({ items: [] }));
  renderAdminAnns(d.items || []);
  loadContentCards();
}

// ── Admin: Changelogs ─────────────────────────────────────────────────────────
function renderAdminCls(items) {
  const el = $('adminClList');
  if (!el) return;
  if (!items.length) { el.innerHTML = '<div class="empty-state"><i data-lucide="git-commit-horizontal"></i><span>No changelogs yet</span></div>'; lucide.createIcons(); return; }
  el.innerHTML = items.map(c => `
    <div class="admin-item">
      <div class="admin-item-body">
        <div class="admin-item-title">${escHtml(c.version||'')}${c.tag?` <span class="cl-tag">${escHtml(c.tag)}</span>`:''}</div>
        <div class="admin-item-text">${escHtml(c.body||c.changes||'')}</div>
        <div class="admin-item-meta">${formatDate(c.createdAt)}</div>
      </div>
      <button class="admin-item-del" onclick="deleteCl('${c.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>`).join('');
}

async function postChangelog() {
  if (!selectedServer) return alert('Select a server first');
  const version = $('clVersion')?.value?.trim();
  const body    = $('clBody')?.value?.trim();
  const tag     = $('clTag')?.value?.trim();
  if (!version || !body) return alert('Fill in version and changes');
  const pwd = getAdminPassword();
  try {
    const data = await api(selectedServer, '/changelogs', 'POST', { version, body, tag }, pwd);
    if (!data.ok) return alert(data.error || 'Failed');
    $('clVersion').value = '';
    $('clBody').value    = '';
    $('clTag').value     = '';
    const d2 = await api(selectedServer, '/changelogs');
    renderAdminCls(d2.items || []);
    loadContentCards();
  } catch { alert('Network error'); }
}

async function deleteCl(id) {
  if (!selectedServer || !confirm('Delete this changelog?')) return;
  const pwd = getAdminPassword();
  await api(selectedServer, `/changelogs/${id}`, 'DELETE', null, pwd).catch(() => {});
  const d = await api(selectedServer, '/changelogs').catch(() => ({ items: [] }));
  renderAdminCls(d.items || []);
  loadContentCards();
}

// ── Admin: Polls ──────────────────────────────────────────────────────────────
function renderAdminPolls(items) {
  const el = $('adminPollList');
  if (!el) return;
  if (!items.length) { el.innerHTML = '<div class="empty-state"><i data-lucide="bar-chart-2"></i><span>No polls yet</span></div>'; lucide.createIcons(); return; }
  el.innerHTML = items.map(p => {
    const totalVotes = (p.options||[]).reduce((s,o)=>s+(o.votes||0),0);
    const opts = (p.options||[]).map(o => `<div style="display:flex;align-items:center;gap:8px;margin-top:4px;font-size:0.77rem;color:var(--text2)">
      <span style="flex:1">${escHtml(o.text)}</span>
      <span style="font-family:var(--mono);color:var(--lime);font-size:0.72rem">${o.votes||0} vote${(o.votes||0)!==1?'s':''}</span></div>`).join('');
    return `
      <div class="admin-item">
        <div class="admin-item-body">
          <div class="admin-item-title">${escHtml(p.question)}</div>
          ${opts}
          <div class="admin-item-meta">${totalVotes} total vote${totalVotes!==1?'s':''} · ${formatDate(p.createdAt)}</div>
        </div>
        <button class="admin-item-del" onclick="deletePoll('${p.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>`;
  }).join('');
}

async function postPoll() {
  if (!selectedServer) return alert('Select a server first');
  const question = $('pollQ')?.value?.trim();
  const optsRaw  = $('pollOpts')?.value?.trim();
  if (!question || !optsRaw) return alert('Fill in question and options');
  const options = optsRaw.split('\n').map(s => s.trim()).filter(Boolean);
  if (options.length < 2) return alert('Add at least 2 options');
  const pwd = getAdminPassword();
  try {
    const data = await api(selectedServer, '/polls', 'POST', { question, options }, pwd);
    if (!data.ok) return alert(data.error || 'Failed');
    $('pollQ').value    = '';
    $('pollOpts').value = '';
    const d2 = await api(selectedServer, '/polls');
    renderAdminPolls(d2.items || []);
    loadContentCards();
  } catch { alert('Network error'); }
}

async function deletePoll(id) {
  if (!selectedServer || !confirm('Delete this poll?')) return;
  const pwd = getAdminPassword();
  await api(selectedServer, `/polls/${id}`, 'DELETE', null, pwd).catch(() => {});
  const d = await api(selectedServer, '/polls').catch(() => ({ items: [] }));
  renderAdminPolls(d.items || []);
  loadContentCards();
}

// ── Admin: Channels ───────────────────────────────────────────────────────────
function renderAdminChannels() {
  const el = $('adminChannelList');
  if (!el) return;
  if (!adminChannels.length) { el.innerHTML = '<div class="empty-state"><i data-lucide="link"></i><span>No channels yet</span></div>'; lucide.createIcons(); return; }
  el.innerHTML = adminChannels.map((ch, i) => `
    <div class="channel-manage-row">
      <div class="channel-manage-info">
        <div class="channel-manage-label">${escHtml(ch.label)} <span class="server-tier-badge tier-${ch.type==='wa'?'high':ch.type==='tg'?'mid':'low'}">${escHtml(ch.type||'')}</span></div>
        <div class="channel-manage-url">${escHtml(ch.url)}</div>
      </div>
      <button class="admin-item-del" onclick="removeChannel(${i})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>`).join('');
}

function addChannel() {
  const label  = $('chLabel')?.value?.trim();
  const url    = $('chUrl')?.value?.trim();
  const handle = $('chHandle')?.value?.trim();
  const type   = $('chType')?.value;
  if (!label || !url) return alert('Fill in label and URL');
  adminChannels.push({ id: Date.now().toString(), label, url, handle, type });
  $('chLabel').value  = '';
  $('chUrl').value    = '';
  $('chHandle').value = '';
  renderAdminChannels();
}

function removeChannel(index) {
  adminChannels.splice(index, 1);
  renderAdminChannels();
}

async function saveChannels() {
  if (!selectedServer) return alert('Select a server first');
  const pwd = getAdminPassword();
  try {
    const data = await api(selectedServer, '/channels', 'POST', { channels: adminChannels }, pwd);
    if (!data.ok) return alert(data.error || 'Failed to save');
    alert('Channel gate saved!');
    loadGateChannels();
  } catch { alert('Network error'); }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
loadServers();
setInterval(loadSessions, 10000);
