// ── Save version — bump to wipe all player progress on update ─
const SAVE_VERSION = 'v9';
(function() {
  if (localStorage.getItem('ra_save_version') !== SAVE_VERSION) {
    ['ra_coins','ra_hat','ra_owned_hats','ra_quests','ra_sens','ra_fov_deg','ra_kill_fx','ra_name','ra_color'].forEach(k => localStorage.removeItem(k));
    localStorage.setItem('ra_save_version', SAVE_VERSION);
  }
})();

// ── Settings (persist via localStorage) ──────────────────────
// Sensitivity stored as display number (1–9); actual value = display * 0.001
const _rawSens = parseFloat(localStorage.getItem('ra_sens') || '3');
// Migrate old format (stored as 0.003 etc.) to new (3)
const _senDisplay = _rawSens < 0.1 ? Math.round(_rawSens * 1000 * 10) / 10 : _rawSens;
let SENSITIVITY = _senDisplay * 0.001;
let FOV_DEG     = parseFloat(localStorage.getItem('ra_fov_deg') || '110');
function computeFocal() { return (window.innerWidth / 2) / Math.tan(FOV_DEG * Math.PI / 360); }
let FOCAL       = computeFocal();
function updateSetting(key, val) {
  if (key === 'sens') {
    const display = parseFloat(val);
    SENSITIVITY = display * 0.001;
    localStorage.setItem('ra_sens', String(display));
    document.getElementById('sens-val').textContent = display % 1 === 0 ? display.toFixed(0) : display.toFixed(1);
  }
  if (key === 'fov') {
    FOV_DEG = parseFloat(val); localStorage.setItem('ra_fov_deg', val);
    FOCAL = computeFocal();
    document.getElementById('fov-val').textContent = Math.round(FOV_DEG) + '°';
  }
}
window.updateSetting = updateSetting;

const WORLD_W = 1600, WORLD_H = 1200;
let CW = window.innerWidth, CH = window.innerHeight;
const EYE_H = 58;

function hsla(c, a) { return c.replace('hsl(', 'hsla(').replace(')', `,${a})`); }
function lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ── State ──────────────────────────────────────────────────────
let myId = null, serverState = null;
let obstacles = [], platforms = [], portal = null;
let camX = 800, camY = 600, camZ = 0;
let worldAngle = 0;
let pitchAngle = 0;
let gameActive = false, gameOverFlag = false;
const keys = { up: false, down: false, left: false, right: false };
const hand = { state: 'idle', timer: 0, rockSent: false, dur: { windup: 11, throw: 7, recover: 18 } };
const kame = { held: false, charge: 0, maxCharge: 90, cooldown: 0, maxCooldown: 480, firing: false, fireTimer: 0 };
let dashCooldown = 0, shieldCooldown = 0, shieldActive = false;
let healCooldown = 0, shockwaveCooldown = 0;
let myAmmo = 6, myHP = 75, myKillStreak = 0, sessionKillCount = 0;
const killFeed = [];
let shieldRaise = 0;
let hitFlash = 0;
let healFlash = 0;
let meteorShake = 0;
let prevHP = 75;
let shieldBlockFX = [];
let shockwaveFX = [];   // { x, y, r, maxR, timer, maxTimer }
let meteorWarning = 0;

// ── Mobile detection ───────────────────────────────────────────
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  ('ontouchstart' in window && navigator.maxTouchPoints > 0 && window.innerWidth < 1400);

let killFXType = localStorage.getItem('ra_kill_fx') || 'fire';
let killFXParticles = []; // { wx, wy, wz, vwx, vwy, vwz, timer, maxTimer, type, size }
window.setKillFX = function(type) {
  killFXType = type;
  localStorage.setItem('ra_kill_fx', type);
  document.querySelectorAll('.killfx-btn').forEach(b => b.classList.toggle('active', b.dataset.fx === type));
};

// ── Hats & Coins ───────────────────────────────────────────────
const HATS = {
  crown:     { label: '👑 Crown',          price: 500  },
  cowboy:    { label: '🤠 Cowboy',          price: 350  },
  wizard:    { label: '🧙 Wizard',          price: 650  },
  knight:    { label: '⚔️ Knight Helm',    price: 800  },
  santa:     { label: '🎅 Santa',           price: 250  },
  tophat:    { label: '🎩 Top Hat',         price: 450  },
  party:     { label: '🎉 Party Hat',       price: 200  },
  halo:      { label: '😇 Halo',            price: 900  },
  viking:    { label: '🪖 Viking',          price: 700  },
  pirate:    { label: '🏴‍☠️ Pirate',      price: 550  },
  beanie:    { label: '🧢 Beanie',          price: 225  },
  graduation:{ label: '🎓 Graduation',      price: 400  },
  chef:      { label: '👨‍🍳 Chef',        price: 325  },
  bucket:    { label: '🪣 Bucket Hat',      price: 275  },
  baseball:  { label: '⚾ Baseball Cap',    price: 300  },
  frog:      { label: '🐸 Frog Hat',        price: 425  },
  devil:     { label: '😈 Devil Horns',     price: 500  },
  mohawk:    { label: '🌈 Rainbow Mohawk',  price: 600  },
  space:     { label: '🚀 Space Helmet',    price: 850  },
  jester:    { label: '🃏 Jester',          price: 650  },
};
let myHat      = localStorage.getItem('ra_hat') || null;
let myCoins    = parseInt(localStorage.getItem('ra_coins') || '0');
let myOwnedHats = JSON.parse(localStorage.getItem('ra_owned_hats') || '[]');
let hasAdminKill = false; // set only when code is redeemed this session — NEVER persisted
let myTeam = null, isTeamLobby = false;
let currentTeamKills = { red: 0, blue: 0 }, currentRound = 1;
let isHotPotato = false, currentLobbyId = null;
let escMenuOpen = false;
let roundOverFlash = 0, roundOverWinner = null;

function awardCoins(amount) {
  myCoins += amount;
  localStorage.setItem('ra_coins', String(myCoins));
  updateCoinDisplay();
}
function updateCoinDisplay() {
  document.querySelectorAll('.coin-display').forEach(el => el.textContent = `🪙 ${myCoins}`);
}
window.buyHat = function(id) {
  if (myOwnedHats.includes(id)) { equipHat(id); return; }
  if (myCoins < HATS[id].price) { alert(`Need ${HATS[id].price} coins. You have ${myCoins}.`); return; }
  awardCoins(-HATS[id].price);
  myOwnedHats.push(id);
  localStorage.setItem('ra_owned_hats', JSON.stringify(myOwnedHats));
  equipHat(id);
  buildShop();
};
window.equipHat = function(hatId) {
  myHat = hatId;
  localStorage.setItem('ra_hat', hatId);
  if (socket && myId) socket.emit('set_hat', { hat: hatId });
  buildShop();
};
window.unequipHat = function() {
  myHat = null;
  localStorage.removeItem('ra_hat');
  if (socket && myId) socket.emit('set_hat', { hat: null });
  buildShop();
};
function buildShop() {
  const el = document.getElementById('shop-list');
  if (!el) return;
  el.innerHTML = Object.entries(HATS).map(([id, h]) => {
    const owned = myOwnedHats.includes(id);
    const equipped = myHat === id;
    const affordable = myCoins >= h.price;
    return `<div class="shop-item">
      <span class="shop-label">${h.label}</span>
      <span class="shop-price" style="color:${affordable||owned?'#FFD700':'#666'}">${owned?'Owned':'🪙 '+h.price}</span>
      ${equipped
        ? `<button class="lobby-btn" style="min-width:80px;padding:6px 10px;border-color:#4caf50;color:#4caf50" onclick="unequipHat()">✓ ON</button>`
        : owned
          ? `<button class="lobby-btn" style="min-width:80px;padding:6px 10px" onclick="equipHat('${id}')">Equip</button>`
          : `<button class="lobby-btn" style="min-width:80px;padding:6px 10px;${!affordable?'opacity:0.4;cursor:not-allowed':''}" onclick="buyHat('${id}')" ${!affordable?'disabled':''}>Buy</button>`
      }
    </div>`;
  }).join('');
}
window.buildShop = buildShop;

// ── Quests & daily progress ────────────────────────────────────
const QUEST_DEFS = [
  { id: 'kill15',     label: 'Get 15 kills',              req: 15,  reward: 100, track: 'kills' },
  { id: 'throw100',  label: 'Throw 100 rocks',            req: 100, reward: 50,  track: 'throws' },
  { id: 'survive900',label: 'Survive 15 min in one life', req: 900, reward: 150, track: 'survive' },
];
function getHourKey() { return new Date().toISOString().slice(0, 13); } // YYYY-MM-DDTHH
function loadQuests() {
  try {
    const s = JSON.parse(localStorage.getItem('ra_quests') || '{}');
    if (s.date !== getHourKey()) return { date: getHourKey(), progress: {}, completed: {} };
    return s;
  } catch(e) { return { date: getHourKey(), progress: {}, completed: {} }; }
}
let questState = loadQuests();
let surviveStreak = 0; // continuous alive ticks
let throwCount = 0;
function saveQuests() { localStorage.setItem('ra_quests', JSON.stringify(questState)); }
// Auto-refresh quests each hour
setInterval(() => { questState = loadQuests(); buildQuestList(); }, 60 * 1000);
function incrementQuest(track, amount) {
  QUEST_DEFS.forEach(q => {
    if (q.track !== track || questState.completed[q.id]) return;
    questState.progress[q.id] = (questState.progress[q.id] || 0) + amount;
    if (questState.progress[q.id] >= q.req) {
      questState.completed[q.id] = true;
      awardCoins(q.reward);
      showQuestToast(`Quest done: ${q.label}`, q.reward);
    }
  });
  saveQuests();
  buildQuestList();
}
function showQuestToast(label, reward) {
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:rgba(0,200,100,0.95);color:white;padding:10px 22px;border-radius:10px;font:bold 14px sans-serif;z-index:999;pointer-events:none';
  div.textContent = `✅ ${label} — +${reward} coins!`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}
function buildQuestList() {
  const el = document.getElementById('quest-list');
  if (!el) return;
  el.innerHTML = QUEST_DEFS.map(q => {
    const prog = questState.progress[q.id] || 0;
    const done = questState.completed[q.id];
    const pct = Math.min(1, prog / q.req);
    return `<div class="quest-item">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="color:${done?'#4caf50':'#ccc'};font-size:0.82rem">${done?'✅':' ⬜'} ${q.label}</span>
        <span style="color:#FFD700;font-size:0.8rem">🪙 ${q.reward}</span>
      </div>
      <div style="background:rgba(255,255,255,0.1);border-radius:4px;height:6px">
        <div style="background:${done?'#4caf50':'orange'};width:${Math.round(pct*100)}%;height:100%;border-radius:4px;transition:width 0.3s"></div>
      </div>
      <div style="font-size:0.72rem;color:#666;margin-top:2px">${done?'Complete!':prog+' / '+q.req}</div>
    </div>`;
  }).join('');
}
window.buildQuestList = buildQuestList;

// ── Canvas ─────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let pointerLocked = false;

function resizeCanvas() {
  CW = window.innerWidth; CH = window.innerHeight;
  canvas.width = CW; canvas.height = CH;
  FOCAL = computeFocal();
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ── Sound Effects (Web Audio API) ─────────────────────────────
let _ac = null;
function sfxCtx() {
  if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
  if (_ac.state === 'suspended') _ac.resume();
  return _ac;
}
function _osc(type, freq0, freq1, dur, vol) {
  try {
    const c = sfxCtx(), o = c.createOscillator(), g = c.createGain();
    o.connect(g); g.connect(c.destination); o.type = type;
    o.frequency.setValueAtTime(freq0, c.currentTime);
    if (freq1) o.frequency.exponentialRampToValueAtTime(freq1, c.currentTime + dur);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.start(c.currentTime); o.stop(c.currentTime + dur);
  } catch(e) {}
}
function _noise(dur, vol, cutoff) {
  try {
    const c = sfxCtx(), n = c.sampleRate * dur;
    const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random()*2-1) * (1 - i/n);
    const src = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cutoff || 1200;
    src.buffer = buf; src.connect(f); f.connect(g); g.connect(c.destination);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.start(c.currentTime); src.stop(c.currentTime + dur);
  } catch(e) {}
}
const sfx = {
  throw:    () => _osc('sawtooth', 280, 65,  0.18, 0.25),
  hit:      () => _noise(0.12, 0.45, 900),
  shield:   () => _osc('sine',    700, 1300, 0.18, 0.18),
  heal:     () => { [523,659,784].forEach((f,i) => setTimeout(() => _osc('sine',f,f*1.01,0.18,0.13), i*70)); },
  dash:     () => _osc('sine',    440, 180,  0.14, 0.2),
  shockwave:() => _noise(0.45, 0.55, 200),
  laserCharge: () => _osc('sawtooth', 90, 600, 1.4, 0.12),
  laserFire:   () => _osc('square',  900, 70,  0.5,  0.32),
  kill:     () => { [220,330,440,550].forEach((f,i) => setTimeout(() => _osc('sine',f,f,0.22,0.18), i*55)); },
  meteor:   () => _noise(0.5, 0.4, 180),
};

// ── Title animation ────────────────────────────────────────────
const bgCanvas = document.getElementById('bg');
const bgCtx = bgCanvas.getContext('2d');
let titleRunning = false;
const titleBalls = Array.from({ length: 12 }, () => ({
  x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight,
  vx: (Math.random() - 0.5) * 1.4, vy: (Math.random() - 0.5) * 1.4,
  r: 14 + Math.random() * 14,
  color: `hsl(${Math.floor(Math.random() * 360)},70%,60%)`,
  eyeAngle: Math.random() * Math.PI * 2
}));
const titleRocks = Array.from({ length: 8 }, () => ({
  x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight,
  vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2
}));
function resizeBg() { bgCanvas.width = window.innerWidth; bgCanvas.height = window.innerHeight; }
resizeBg();
window.addEventListener('resize', resizeBg);
function animateTitle() {
  if (!titleRunning) return;
  const W = bgCanvas.width, H = bgCanvas.height;
  bgCtx.fillStyle = '#070714'; bgCtx.fillRect(0, 0, W, H);
  const grd = bgCtx.createRadialGradient(W/2, H/2, 0, W/2, H/2, W * 0.6);
  grd.addColorStop(0, 'rgba(255,100,0,0.06)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  bgCtx.fillStyle = grd; bgCtx.fillRect(0, 0, W, H);
  titleRocks.forEach(r => {
    r.x += r.vx; r.y += r.vy;
    if (r.x < 0) r.x = W; if (r.x > W) r.x = 0;
    if (r.y < 0) r.y = H; if (r.y > H) r.y = 0;
    bgCtx.beginPath(); bgCtx.arc(r.x, r.y, 6, 0, Math.PI * 2);
    bgCtx.fillStyle = 'rgba(140,140,140,0.18)'; bgCtx.fill();
  });
  titleBalls.forEach(b => {
    b.x += b.vx; b.y += b.vy; b.eyeAngle += 0.012;
    if (b.x < b.r || b.x > W - b.r) { b.vx *= -1; b.x = Math.max(b.r, Math.min(W - b.r, b.x)); }
    if (b.y < b.r || b.y > H - b.r) { b.vy *= -1; b.y = Math.max(b.r, Math.min(H - b.r, b.y)); }
    const glow = bgCtx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 2.5);
    glow.addColorStop(0, hsla(b.color, 0.19)); glow.addColorStop(1, 'transparent');
    bgCtx.beginPath(); bgCtx.arc(b.x, b.y, b.r * 2.5, 0, Math.PI * 2); bgCtx.fillStyle = glow; bgCtx.fill();
    bgCtx.beginPath(); bgCtx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    bgCtx.fillStyle = hsla(b.color, 0.16); bgCtx.fill();
    bgCtx.strokeStyle = hsla(b.color, 0.38); bgCtx.lineWidth = 2; bgCtx.stroke();
    const ex = Math.cos(b.eyeAngle), ey = Math.sin(b.eyeAngle);
    const px2 = -Math.sin(b.eyeAngle), py2 = Math.cos(b.eyeAngle);
    bgCtx.fillStyle = hsla(b.color, 0.44);
    [1, -1].forEach(s => {
      bgCtx.beginPath();
      bgCtx.arc(b.x + ex * b.r * 0.5 + px2 * b.r * 0.28 * s, b.y + ey * b.r * 0.5 + py2 * b.r * 0.28 * s, b.r * 0.18, 0, Math.PI * 2);
      bgCtx.fill();
    });
  });
  requestAnimationFrame(animateTitle);
}
function startTitle() { titleRunning = true; animateTitle(); }
function stopTitle() { titleRunning = false; }
startTitle();

// ── Socket ─────────────────────────────────────────────────────
const socket = io();

socket.on('joined', ({ id, obstacles: obs, platforms: plts, portal: por, isTeamLobby: itl, myTeam: mt, isHotPotato: ihp, lobbyId: lid }) => {
  myId = id; obstacles = obs || []; platforms = plts || []; portal = por || null;
  isTeamLobby = !!itl; myTeam = mt || null;
  isHotPotato = !!ihp; currentLobbyId = lid ?? null;
  currentTeamKills = { red: 0, blue: 0 }; currentRound = 1;
  gameActive = true;
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('game').style.display = 'block';
  document.getElementById('bg').style.display = 'none';
  stopTitle(); resizeCanvas();
  if (isMobile) {
    // Wake AudioContext and request fullscreen on game start
    sfxCtx();
    if (!_fullscreenDone) { _fullscreenDone = true; requestFullscreenNow(); }
  } else {
    setTimeout(() => canvas.requestPointerLock(), 100);
  }
});

// Wake AudioContext on any body touch (mobile sound fix)
if (isMobile) {
  document.body.addEventListener('touchstart', () => sfxCtx(), { passive: true });
}
socket.on('lobby_full', () => alert('That lobby is full!'));
socket.on('kill', ({ killer, victim, streak, victimX, victimY }) => {
  let msg = `${killer}  ›  ${victim}`;
  if (streak >= 2) msg += `  [${streak} streak]`;
  killFeed.unshift({ text: msg, timer: 300, isStreak: streak >= 3 });
  if (killFeed.length > 5) killFeed.pop();
  // Track our own kills
  const me = serverState?.players.find(p => p.id === myId);
  if (me && killer === me.name) { sessionKillCount++; sfx.kill(); incrementQuest('kills', 1); }
  // Spawn kill effect at victim position
  if (victimX !== undefined && victimY !== undefined) {
    spawnKillFX(victimX, victimY, killFXType);
  }
});
socket.on('hit_flash', () => { hitFlash = 1.0; sfx.hit(); });
socket.on('healed', () => { healFlash = 1.0; sfx.heal(); });
socket.on('shockwave_fx', ({ x, y, r }) => {
  shockwaveFX.push({ x, y, maxR: r, timer: 40, maxTimer: 40 });
});
socket.on('shield_block', ({ x, y }) => {
  sfx.shield();
  shieldBlockFX.push({ x, y, timer: 30 });
});
socket.on('meteor_shower', ({ shooter }) => {
  meteorShake = 60; meteorWarning = 180; sfx.meteor();
  killFeed.unshift({ text: `☄  ${shooter} called meteor shower!`, timer: 300, isStreak: true });
  if (killFeed.length > 5) killFeed.pop();
});
socket.on('portal_exit', () => returnToLobby());
socket.on('join_error', ({ msg }) => {
  const el = document.getElementById('join-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 4000); }
  else alert(msg);
});
socket.on('code_result', ({ ok, type, coins, ability, msg }) => {
  const el = document.getElementById('code-msg');
  if (el) { el.textContent = msg; el.style.color = ok ? '#4caf50' : '#f44336'; }
  if (ok && type === 'coins') { awardCoins(coins); }
  if (ok && type === 'ability' && ability === 'admin_kill') { hasAdminKill = true; }
});
socket.on('player_left', ({ name }) => {
  killFeed.unshift({ text: `${name} left the arena`, timer: 300, isLeave: true });
  if (killFeed.length > 5) killFeed.pop();
});
socket.on('team_score', ({ red, blue, round }) => {
  currentTeamKills = { red, blue }; currentRound = round;
});
socket.on('round_over', ({ winner, round }) => {
  const label = winner === 'red' ? '🔴 Red Team' : '🔵 Blue Team';
  killFeed.unshift({ text: `🏆 ${label} wins Round ${round}! New round in 5s…`, timer: 420, isStreak: true });
  if (killFeed.length > 5) killFeed.pop();
  roundOverFlash = 200; roundOverWinner = winner;
});
// vote kick removed
socket.on('potato_assigned', ({ name }) => {
  const isMe = serverState?.players.find(p => p.id === myId)?.name === name;
  killFeed.unshift({ text: `🥔 ${name} got the hot potato!${isMe ? ' (YOU)' : ''}`, timer: 240, isStreak: isMe });
  if (killFeed.length > 5) killFeed.pop();
});
socket.on('potato_transferred', ({ name }) => {
  const isMe = serverState?.players.find(p => p.id === myId)?.name === name;
  killFeed.unshift({ text: `🥔 ${name} caught the potato!${isMe ? ' (YOU)' : ''}`, timer: 200, isStreak: isMe });
  if (killFeed.length > 5) killFeed.pop();
});
socket.on('potato_explode', ({ name }) => {
  killFeed.unshift({ text: `💥 ${name} EXPLODED with the potato!`, timer: 320, isStreak: true });
  if (killFeed.length > 5) killFeed.pop();
  hitFlash = name === serverState?.players.find(p => p.id === myId)?.name ? 1.0 : 0;
});

socket.on('state', newState => {
  if (serverState) {
    const oldMap = {};
    serverState.players.forEach(p => oldMap[p.id] = p);
    newState.players.forEach(np => {
      const op = oldMap[np.id];
      if (op) {
        np.rx = lerp(op.rx ?? op.x, np.x, 0.25);
        np.ry = lerp(op.ry ?? op.y, np.y, 0.25);
        np.ra = lerpAngle(op.ra ?? op.angle, np.angle, 0.3);
        np.rz = lerp(op.rz ?? op.z, np.z, 0.3);
      } else { np.rx = np.x; np.ry = np.y; np.ra = np.angle; np.rz = np.z; }
    });
  } else {
    newState.players.forEach(p => { p.rx = p.x; p.ry = p.y; p.ra = p.angle; p.rz = p.z; });
  }
  serverState = newState;
  if (newState.teamKills) { currentTeamKills = newState.teamKills; currentRound = newState.roundNumber || 1; }
  const me = serverState.players.find(p => p.id === myId);
  if (me) {
    prevHP = myHP;
    myAmmo = me.ammo; dashCooldown = me.dashCooldown;
    shieldCooldown = me.shieldCooldown; shieldActive = me.shieldActive;
    healCooldown = me.healCooldown || 0; shockwaveCooldown = me.shockwaveCooldown || 0;
    myHP = me.hp; myKillStreak = me.killStreak;
    camX = me.x; camY = me.y; camZ = me.z || 0;
  }
});

// ── Lobby ──────────────────────────────────────────────────────
function refreshLobbies() {
  fetch('/api/lobbies').then(r => r.json()).then(data => {
    data.forEach(({ id, count, max }) => {
      const btn = document.querySelector(`.lobby-btn[data-lobby="${id}"]`);
      if (!btn) return;
      btn.querySelector('.cnt').textContent = `${count}/${max}`;
      btn.classList.toggle('full', count >= max);
    });
  }).catch(() => {});
}
refreshLobbies();
setInterval(refreshLobbies, 2500);
// Pre-fill saved name and colour
(function() {
  const sn = localStorage.getItem('ra_name'); const sc = localStorage.getItem('ra_color');
  if (sn) { const ni = document.getElementById('name-input'); if (ni) ni.value = sn; }
  if (sc) { const cp = document.getElementById('color-pick'); if (cp) cp.value = sc; }
})();

document.querySelectorAll('.lobby-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('full') || !btn.dataset.lobby) return;
    const name = document.getElementById('name-input').value.trim();
    if (!name) {
      const el = document.getElementById('join-error');
      if (el) { el.textContent = 'Please enter a name before joining!'; el.style.display = 'block'; setTimeout(() => el.style.display='none', 3000); }
      return;
    }
    const color = document.getElementById('color-pick').value;
    localStorage.setItem('ra_name', name);
    localStorage.setItem('ra_color', color);
    socket.emit('join', {
      lobby: parseInt(btn.dataset.lobby),
      name, hat: myHat, color, isPrivate: false
    });
  });
});

// Private lobby functions
function _privErr(msg) {
  const el = document.getElementById('join-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 4000); }
  else alert(msg);
}
window.hostPrivateLobby = async function() {
  const name = document.getElementById('name-input').value.trim();
  const raw  = (document.getElementById('private-code-input')?.value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const mode = document.getElementById('private-mode-select')?.value || 'ffa';
  if (!name) { _privErr('Enter your name first!'); return; }
  if (!raw || raw.length < 2) { _privErr('Enter a code (2+ letters/numbers) for your lobby!'); return; }
  const color = document.getElementById('color-pick').value;
  localStorage.setItem('ra_name', name); localStorage.setItem('ra_color', color);
  try {
    const res = await fetch('/api/private/host', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: raw, mode })
    });
    const data = await res.json();
    if (!data.ok) { _privErr(data.msg); return; }
    const disp = document.getElementById('private-code-display');
    if (disp) { disp.textContent = '✅ Lobby code: ' + data.code; disp.style.display = 'block'; }
    socket.emit('join', { lobby: data.code, name, hat: myHat, color, isPrivate: true });
  } catch(e) { _privErr('Could not create lobby. Try again.'); }
};
window.joinPrivateLobby = function() {
  const name = document.getElementById('name-input').value.trim();
  const code = (document.getElementById('private-join-input')?.value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!name) { _privErr('Enter your name first!'); return; }
  if (!code || code.length < 2) { _privErr('Enter the lobby code to join!'); return; }
  const color = document.getElementById('color-pick').value;
  localStorage.setItem('ra_name', name); localStorage.setItem('ra_color', color);
  socket.emit('join', { lobby: code, name, hat: myHat, color, isPrivate: true });
};

// Code redemption
window.redeemCode = function() {
  const code = (document.getElementById('code-input')?.value || '').trim();
  if (!code) return;
  socket.emit('redeem_code', { code });
};

// ── Esc menu (player list only) ────────────────────────────────
function buildPlayerList() {
  const el = document.getElementById('player-list');
  if (!el || !serverState) return;
  el.innerHTML = serverState.players.map(p => {
    const isMe = p.id === myId;
    const teamTag = p.team ? ` [${p.team}]` : '';
    const nameClr = p.hasPotato ? '#FFD700' : p.team === 'red' ? '#ff6666' : p.team === 'blue' ? '#6699ff' : '#ccc';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
      <span style="color:${nameClr}">${isMe ? '▶ ' : ''}${p.hasPotato ? '🥔 ' : ''}<b>${p.name}</b>${teamTag}${!p.alive ? ' 💀' : ''}</span>
      ${isMe ? '<span style="color:#555;font-size:0.8rem">You</span>' : ''}
    </div>`;
  }).join('');
}
window.buildPlayerList = buildPlayerList;
window.closeEscMenu = function() {
  escMenuOpen = false;
  document.getElementById('esc-menu').style.display = 'none';
  if (!isMobile) setTimeout(() => canvas.requestPointerLock(), 80);
};

// ── Input ──────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && gameActive && !isMobile) {
    escMenuOpen = !escMenuOpen;
    const menu = document.getElementById('esc-menu');
    if (escMenuOpen) {
      document.exitPointerLock();
      buildPlayerList();
      if (menu) menu.style.display = 'flex';
    } else {
      if (menu) menu.style.display = 'none';
      setTimeout(() => canvas.requestPointerLock(), 80);
    }
    return;
  }
  if (!gameActive) return;
  if (e.key === 'w' || e.key === 'ArrowUp')    keys.up    = true;
  if (e.key === 's' || e.key === 'ArrowDown')  keys.down  = true;
  if (e.key === 'a' || e.key === 'ArrowLeft')  keys.left  = true;
  if (e.key === 'd' || e.key === 'ArrowRight') keys.right = true;
  if (e.key === 'f' || e.key === 'F') kame.held = true;
  if (e.key === ' ') { e.preventDefault(); socket.emit('dash'); sfx.dash(); }
  if (e.key === 'q' || e.key === 'Q') { socket.emit('shield'); sfx.shield(); }
  if (e.key === 'e' || e.key === 'E') socket.emit('heal');
  if (e.key === 'r' || e.key === 'R') { socket.emit('shockwave'); sfx.shockwave(); }
});
document.addEventListener('keyup', e => {
  if (!gameActive) return;
  if (e.key === 'w' || e.key === 'ArrowUp')    keys.up    = false;
  if (e.key === 's' || e.key === 'ArrowDown')  keys.down  = false;
  if (e.key === 'a' || e.key === 'ArrowLeft')  keys.left  = false;
  if (e.key === 'd' || e.key === 'ArrowRight') keys.right = false;
  if (e.key === 'f' || e.key === 'F') { kame.held = false; if (!kame.firing) kame.charge = 0; }
});
// Pointer lock handled in mousedown (left click)
document.addEventListener('pointerlockchange', () => { pointerLocked = document.pointerLockElement === canvas; });
document.addEventListener('mousemove', e => {
  if (!gameActive || !pointerLocked) return;
  worldAngle += e.movementX * SENSITIVITY;
  pitchAngle += e.movementY * SENSITIVITY;
  pitchAngle = Math.max(-0.55, Math.min(0.55, pitchAngle));
});
canvas.addEventListener('mousedown', e => {
  if (isMobile || !gameActive || !myId || !serverState) return;
  if (e.button === 0) {
    // Left click: lock pointer, then throw rock once locked
    if (!pointerLocked) { canvas.requestPointerLock(); return; }
    const me = serverState.players.find(p => p.id === myId);
    if (isHotPotato && !me?.hasPotato) return; // only holder can shoot
    if (me && me.alive && me.ready && hand.state === 'idle' && myAmmo > 0) {
      hand.state = 'windup'; hand.timer = 0; hand.rockSent = false;
    }
    return;
  }
  if (e.button === 2) {
    // Right click: admin kill (requires code redemption)
    if (hasAdminKill) {
      let closest = null, closestDist = 350;
      serverState.players.forEach(p => {
        if (p.id === myId || !p.alive) return;
        const proj = project(p.rx, p.ry, p.rz || 0);
        if (!proj) return;
        const dist = Math.hypot(proj.sx - CW / 2, proj.sy - CH / 2);
        if (dist < closestDist) { closestDist = dist; closest = p; }
      });
      if (closest) socket.emit('admin_kill', { targetId: closest.id });
    }
  }
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ── Mobile controls ────────────────────────────────────────────
const mob = {
  joy: { active: false, id: null, baseX: 0, baseY: 0, dx: 0, dy: 0 },
  cam: { active: false, id: null, lx: 0, ly: 0 },
  btns: {},  // id → { pressed, touchId }
};

function getMobBtns() {
  const ms = Math.min(CW, CH);
  // SHOOT: placed further from corner to avoid overlapping DASH
  const sx = CW - ms * 0.22, sy = CH - ms * 0.26;
  const br = ms * 0.12;  // big button radius
  const ar = ms * 0.080; // ability button radius
  const d  = ms * 0.330; // distance from SHOOT to ability buttons
  // Ability buttons spread in a radial arc to the upper-left of SHOOT
  const A = [80, 112, 144, 176].map(deg => deg * Math.PI / 180);
  // DASH sits in the true bottom-right corner, clear of SHOOT
  return [
    { id:'shoot',  label:'SHOOT',  color:[255,80,80],   r:br, x:sx,                          y:sy },
    { id:'heal',   label:'HEAL',   color:[60,220,100],  r:ar, x:sx + d*Math.cos(A[0]),       y:sy - d*Math.sin(A[0]) },
    { id:'laser',  label:'LASER',  color:[80,200,255],  r:ar, x:sx + d*Math.cos(A[1]),       y:sy - d*Math.sin(A[1]) },
    { id:'shield', label:'SHIELD', color:[100,180,255], r:ar, x:sx + d*Math.cos(A[2]),       y:sy - d*Math.sin(A[2]) },
    { id:'shock',  label:'SHOCK',  color:[180,100,255], r:ar, x:sx + d*Math.cos(A[3]),       y:sy - d*Math.sin(A[3]) },
    { id:'dash',   label:'DASH',   color:[255,200,80],  r:ar, x:CW - ms*0.065,              y:CH - ms*0.065 },
  ];
}

function mobBtnDown(id) {
  if (!myId || !serverState) return;
  if (id === 'shoot') {
    const me = serverState.players.find(p => p.id === myId);
    if (isHotPotato && !me?.hasPotato) return; // only holder can shoot in hot potato
    if (me && me.alive && me.ready && hand.state === 'idle' && myAmmo > 0) {
      hand.state = 'windup'; hand.timer = 0; hand.rockSent = false;
    }
  } else if (id === 'laser') {
    if (isHotPotato) return; // no laser in hot potato
    kame.held = true;
  } else if (id === 'heal')   { socket.emit('heal'); }
  else if (id === 'shield') { socket.emit('shield'); sfx.shield(); }
  else if (id === 'shock')  { socket.emit('shockwave'); sfx.shockwave(); }
  else if (id === 'dash')   { socket.emit('dash'); sfx.dash(); }
}
function mobBtnUp(id) {
  if (id === 'laser') { kame.held = false; if (!kame.firing) kame.charge = 0; }
}

function requestFullscreenNow() {
  try {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } catch(_) {}
  try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch(_) {}
}

function onTouchStart(e) {
  e.preventDefault();
  if (!_fullscreenDone) {
    _fullscreenDone = true;
    requestFullscreenNow();
  }
  sfxCtx(); // wake AudioContext on every touch (safe to call multiple times)
  const btns = getMobBtns();
  Array.from(e.changedTouches).forEach(t => {
    const tx = t.clientX, ty = t.clientY, tid = t.identifier;
    // Mobile EXIT button (top-left)
    if (gameActive && checkMobileExitBtn(tx, ty)) {
      returnToLobby();
      return;
    }
    // Check action buttons
    for (const btn of btns) {
      if (Math.hypot(tx - btn.x, ty - btn.y) < btn.r) {
        mob.btns[btn.id] = { pressed: true, touchId: tid };
        mobBtnDown(btn.id);
        return;
      }
    }
    // Joystick zone: left 42% of screen
    if (tx < CW * 0.42 && !mob.joy.active) {
      mob.joy.active = true; mob.joy.id = tid;
      mob.joy.baseX = tx; mob.joy.baseY = ty;
      mob.joy.dx = 0; mob.joy.dy = 0;
      return;
    }
    // Camera rotation
    if (!mob.cam.active) {
      mob.cam.active = true; mob.cam.id = tid;
      mob.cam.lx = tx; mob.cam.ly = ty;
    }
  });
}

function onTouchMove(e) {
  e.preventDefault();
  const ms = Math.min(CW, CH), maxR = ms * 0.14;
  Array.from(e.changedTouches).forEach(t => {
    const tx = t.clientX, ty = t.clientY, tid = t.identifier;
    // Skip button touches
    for (const s of Object.values(mob.btns)) { if (s.touchId === tid) return; }
    // Joystick
    if (mob.joy.active && mob.joy.id === tid) {
      let dx = tx - mob.joy.baseX, dy = ty - mob.joy.baseY;
      const dist = Math.hypot(dx, dy);
      if (dist > maxR) { dx = dx/dist*maxR; dy = dy/dist*maxR; }
      mob.joy.dx = dx; mob.joy.dy = dy;
      const thr = maxR * 0.28;
      keys.up    = dy < -thr; keys.down  = dy > thr;
      keys.left  = dx < -thr; keys.right = dx > thr;
      return;
    }
    // Camera
    if (mob.cam.active && mob.cam.id === tid) {
      worldAngle += (tx - mob.cam.lx) * SENSITIVITY * 0.85;
      pitchAngle  = Math.max(-0.55, Math.min(0.55, pitchAngle + (ty - mob.cam.ly) * SENSITIVITY * 0.85));
      mob.cam.lx = tx; mob.cam.ly = ty;
    }
  });
}

function onTouchEnd(e) {
  e.preventDefault();
  Array.from(e.changedTouches).forEach(t => {
    const tid = t.identifier;
    for (const [id, s] of Object.entries(mob.btns)) {
      if (s.touchId === tid) { mobBtnUp(id); delete mob.btns[id]; return; }
    }
    if (mob.joy.active && mob.joy.id === tid) {
      mob.joy.active = false; mob.joy.dx = 0; mob.joy.dy = 0;
      keys.up = keys.down = keys.left = keys.right = false;
      return;
    }
    if (mob.cam.active && mob.cam.id === tid) mob.cam.active = false;
  });
}

if (isMobile) {
  canvas.addEventListener('touchstart',  onTouchStart,  { passive: false });
  canvas.addEventListener('touchmove',   onTouchMove,   { passive: false });
  canvas.addEventListener('touchend',    onTouchEnd,    { passive: false });
  canvas.addEventListener('touchcancel', onTouchEnd,    { passive: false });
}

function getMobCooldown(id) {
  // Returns [pct 0-1 ready, isReady]
  const me = serverState?.players.find(p => p.id === myId);
  if (!me) return [0, false];
  switch (id) {
    case 'shoot': {
      const rdy = me.ammo > 0 && me.ready && hand.state === 'idle';
      return [rdy ? 1 : me.ammo / 6, rdy];
    }
    case 'heal': {
      const p = me.healCooldown <= 0 ? 1 : 1 - me.healCooldown / 360;
      return [p, me.healCooldown <= 0];
    }
    case 'laser': {
      const p = kame.cooldown <= 0 ? 1 : 1 - kame.cooldown / kame.maxCooldown;
      return [p, kame.cooldown <= 0];
    }
    case 'shield': {
      const p = me.shieldActive ? 1 : me.shieldCooldown <= 0 ? 1 : 1 - me.shieldCooldown / 480;
      return [p, me.shieldCooldown <= 0 && !me.shieldActive];
    }
    case 'shock': {
      const p = me.shockwaveCooldown <= 0 ? 1 : 1 - me.shockwaveCooldown / 720;
      return [p, me.shockwaveCooldown <= 0];
    }
    case 'dash': {
      const p = me.dashCooldown <= 0 ? 1 : 1 - me.dashCooldown / 180;
      return [p, me.dashCooldown <= 0];
    }
    default: return [1, true];
  }
}

// Called from onTouchStart to check if the mobile EXIT button was tapped
function checkMobileExitBtn(tx, ty) {
  const ms = Math.min(CW, CH);
  const bw = ms * 0.13, bh = ms * 0.055;
  const bx = 10, by = 10;
  return tx >= bx && tx <= bx + bw && ty >= by && ty <= by + bh;
}

function drawMobileControls() {
  if (!isMobile || !gameActive) return;
  const ms = Math.min(CW, CH), btns = getMobBtns();
  const maxR = ms * 0.14, knobR = ms * 0.07;

  // Joystick base (always visible, dimly)
  const jbx = mob.joy.active ? mob.joy.baseX : CW * 0.15;
  const jby = mob.joy.active ? mob.joy.baseY : CH * 0.80;
  ctx.save(); ctx.globalAlpha = mob.joy.active ? 0.55 : 0.3;
  ctx.beginPath(); ctx.arc(jbx, jby, maxR, 0, Math.PI*2);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
  if (mob.joy.active) {
    ctx.globalAlpha = 0.75;
    ctx.beginPath(); ctx.arc(jbx + mob.joy.dx, jby + mob.joy.dy, knobR, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.restore();

  // Action buttons with cooldown rings
  btns.forEach(btn => {
    const pressed = mob.btns[btn.id]?.pressed;
    const [cdPct, isReady] = getMobCooldown(btn.id);
    const [r2,g2,b2] = btn.color;
    ctx.save();
    ctx.globalAlpha = pressed ? 0.95 : (isReady ? 0.75 : 0.50);
    ctx.beginPath(); ctx.arc(btn.x, btn.y, btn.r, 0, Math.PI*2);
    ctx.fillStyle = `rgba(${r2},${g2},${b2},${pressed?0.5:0.18})`; ctx.fill();

    // Cooldown sweep (dark overlay filling from 0 as cooldown ticks down)
    if (!isReady && cdPct < 1) {
      const startA = -Math.PI / 2;
      const endA   = startA + (1 - cdPct) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(btn.x, btn.y);
      ctx.arc(btn.x, btn.y, btn.r, startA, endA);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
    }

    // Outer ring — glows when ready
    ctx.strokeStyle = `rgba(${r2},${g2},${b2},${isReady ? 1 : 0.45})`;
    ctx.lineWidth = pressed ? 3.5 : (isReady ? 3 : 1.5);
    if (pressed || isReady) { ctx.shadowColor = `rgba(${r2},${g2},${b2},0.85)`; ctx.shadowBlur = isReady ? 10 : 14; }
    ctx.beginPath(); ctx.arc(btn.x, btn.y, btn.r, 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0;

    // Ready pulse ring
    if (isReady && !pressed) {
      const pulse = 0.5 + Math.abs(Math.sin(Date.now() / 500)) * 0.35;
      ctx.strokeStyle = `rgba(${r2},${g2},${b2},${pulse})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(btn.x, btn.y, btn.r + 4, 0, Math.PI*2); ctx.stroke();
    }

    ctx.fillStyle = `rgba(255,255,255,${isReady ? 1 : 0.55})`;
    ctx.font = `bold ${Math.round(btn.r * 0.38)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(btn.label, btn.x, btn.y);
    ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = 1; ctx.restore();
  });

  // Small EXIT button top-left (replaces ESC menu on mobile)
  const bw = ms * 0.13, bh = ms * 0.055;
  ctx.save();
  ctx.globalAlpha = 0.70;
  ctx.fillStyle = 'rgba(40,0,0,0.75)';
  roundRect(ctx, 10, 10, bw, bh, 6); ctx.fill();
  ctx.strokeStyle = 'rgba(255,80,80,0.7)'; ctx.lineWidth = 1.5;
  roundRect(ctx, 10, 10, bw, bh, 6); ctx.stroke();
  ctx.fillStyle = 'rgba(255,120,120,0.95)';
  ctx.font = `bold ${Math.round(bh * 0.5)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('✕ EXIT', 10 + bw / 2, 10 + bh / 2);
  ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = 1; ctx.restore();
}

// ── Game tick ──────────────────────────────────────────────────
setInterval(() => {
  if (!myId || !gameActive) return;
  socket.emit('input', { keys, angle: worldAngle, kameCharging: kame.charge > 0 });
  if (kame.held && kame.cooldown === 0 && !kame.firing) {
    if (kame.charge === 0) sfx.laserCharge();
    kame.charge++;
    if (kame.charge >= kame.maxCharge) {
      kame.held = false; kame.charge = 0;
      kame.cooldown = kame.maxCooldown; kame.firing = true; kame.fireTimer = 40;
      sfx.laserFire();
      socket.emit('kamehameha', { angle: worldAngle, pitch: pitchAngle });
    }
  }
  if (kame.cooldown > 0) kame.cooldown--;
  if (kame.firing) { kame.fireTimer--; if (kame.fireTimer <= 0) kame.firing = false; }
  if (hand.state !== 'idle') {
    hand.timer++;
    if (hand.state === 'throw' && hand.timer === 4 && !hand.rockSent) {
      hand.rockSent = true; sfx.throw();
      // Aim assist — nudge up to 30% toward nearest on-screen enemy within ~26°
      let throwAngle = worldAngle;
      if (serverState) {
        let bestDiff = 0.45, closestDiff = null;
        serverState.players.forEach(p => {
          if (p.id === myId || !p.alive) return;
          const proj = project(p.rx, p.ry, p.rz || 0);
          if (!proj || proj.zc > 700) return;
          const ta = Math.atan2(p.ry - camY, p.rx - camX);
          let diff = ta - worldAngle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          if (Math.abs(diff) < bestDiff) { bestDiff = Math.abs(diff); closestDiff = diff; }
        });
        if (closestDiff !== null) throwAngle = worldAngle + closestDiff * 0.30;
      }
      socket.emit('throw', { angle: throwAngle });
      // Quest: throw rocks
      throwCount++;
      incrementQuest('throws', 1);
    }
    if (hand.timer >= hand.dur[hand.state]) {
      hand.timer = 0;
      if (hand.state === 'windup') hand.state = 'throw';
      else if (hand.state === 'throw') hand.state = 'recover';
      else hand.state = 'idle';
    }
  }
  shieldRaise += ((shieldActive ? 1 : 0) - shieldRaise) * 0.18;
  if (meteorShake > 0) meteorShake--;
  // Quest: survive tracking
  const _qme = serverState?.players.find(p => p.id === myId);
  if (_qme && _qme.alive) {
    surviveStreak++;
    if (surviveStreak % 60 === 0) incrementQuest('survive', 1); // 1 per second
  } else {
    surviveStreak = 0;
  }
  if (meteorWarning > 0) meteorWarning--;
  shieldBlockFX = shieldBlockFX.filter(fx => { fx.timer--; return fx.timer > 0; });
  shockwaveFX = shockwaveFX.filter(fx => { fx.timer--; return fx.timer > 0; });
  killFXParticles = killFXParticles.filter(p => { p.timer--; return p.timer > 0; });
  if (hitFlash > 0) hitFlash *= 0.82;
  if (healFlash > 0) healFlash *= 0.84;
}, 1000 / 60);

// ── 3D Projection ──────────────────────────────────────────────
function project(wx, wy, wz) {
  wz = wz || 0;
  const dx = wx - camX, dy = wy - camY;
  const zc =  dx * Math.cos(worldAngle) + dy * Math.sin(worldAngle);
  const xc = -dx * Math.sin(worldAngle) + dy * Math.cos(worldAngle);
  if (zc < 2) return null;
  const sc = FOCAL / zc;
  const eyeZ = EYE_H + camZ;
  const pitchOffset = Math.tan(pitchAngle) * FOCAL;
  return { sx: CW / 2 + xc * sc, sy: CH / 2 - pitchOffset + (eyeZ - wz) * sc, scale: sc, zc };
}

// ── Sky & floor — theme varies by lobby ───────────────────────
function drawSkyAndFloor() {
  const hy = CH / 2 - Math.tan(pitchAngle) * FOCAL + camZ * FOCAL / Math.max(1, 200);
  const clampedHy = Math.max(CH * 0.1, Math.min(CH * 0.9, hy));

  // ── LOBBY 2: Lava Cave ──────────────────────────────────────
  if (currentLobbyId === 2) {
    const skyGrad = ctx.createLinearGradient(0, 0, 0, clampedHy);
    skyGrad.addColorStop(0, '#100000'); skyGrad.addColorStop(1, '#2d0400');
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, CW, clampedHy);
    // Lava glow blobs
    const lav1 = ctx.createRadialGradient(CW*0.3, clampedHy*0.5, 0, CW*0.3, clampedHy*0.5, CW*0.5);
    lav1.addColorStop(0, 'rgba(200,50,0,0.32)'); lav1.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lav1; ctx.fillRect(0, 0, CW, clampedHy);
    const lav2 = ctx.createRadialGradient(CW*0.75, clampedHy*0.7, 0, CW*0.75, clampedHy*0.7, CW*0.38);
    lav2.addColorStop(0, 'rgba(180,30,0,0.24)'); lav2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lav2; ctx.fillRect(0, 0, CW, clampedHy);
    // Ember particles
    const now2 = Date.now();
    for (let i = 0; i < 38; i++) {
      const t2 = ((now2 / 1800 + i * 0.32) % 1);
      const ex = ((i * 179 + Math.floor(worldAngle * 55) * 43) % (CW * 8) + CW * 8) % (CW * 8) / 8;
      const ey = clampedHy * (1 - t2 * 0.92);
      if (ey < 2 || ey > clampedHy) continue;
      ctx.globalAlpha = Math.min(0.85, t2 * 2.5) * (0.5 + (i % 3) * 0.18);
      ctx.fillStyle = i % 3 === 0 ? '#ff8800' : '#ff3300';
      ctx.beginPath(); ctx.arc(ex, ey, i % 4 === 0 ? 2 : 1.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Lava floor
    const floor = ctx.createLinearGradient(0, clampedHy, 0, CH);
    floor.addColorStop(0, '#220400'); floor.addColorStop(1, '#090100');
    ctx.fillStyle = floor; ctx.fillRect(0, clampedHy, CW, CH - clampedHy);
    // Horizon lava glow
    const hg = ctx.createLinearGradient(0, clampedHy - 14, 0, clampedHy + 24);
    hg.addColorStop(0, 'rgba(255,80,0,0)');
    hg.addColorStop(0.45, 'rgba(255,55,0,0.36)');
    hg.addColorStop(1, 'rgba(180,20,0,0)');
    ctx.fillStyle = hg; ctx.fillRect(0, clampedHy - 14, CW, 38);
    return;
  }

  // ── LOBBY 3: Golden Harvest Arena ──────────────────────────
  if (currentLobbyId === 3) {
    const skyGrad = ctx.createLinearGradient(0, 0, 0, clampedHy);
    skyGrad.addColorStop(0, '#1c0800'); skyGrad.addColorStop(0.5, '#3e1800'); skyGrad.addColorStop(1, '#5c2e00');
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, CW, clampedHy);
    // Golden haze
    const gld1 = ctx.createRadialGradient(CW*0.5, clampedHy*0.65, 0, CW*0.5, clampedHy*0.65, CW*0.65);
    gld1.addColorStop(0, 'rgba(255,140,0,0.22)'); gld1.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gld1; ctx.fillRect(0, 0, CW, clampedHy);
    const gld2 = ctx.createRadialGradient(CW*0.18, clampedHy*0.28, 0, CW*0.18, clampedHy*0.28, CW*0.32);
    gld2.addColorStop(0, 'rgba(220,90,0,0.18)'); gld2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gld2; ctx.fillRect(0, 0, CW, clampedHy);
    // Warm floating sparks (like hot potato embers)
    for (let i = 0; i < 55; i++) {
      const sx = ((i * 173 + Math.floor(worldAngle * 80) * 37) % (CW * 10) + CW * 10) % (CW * 10) / 10;
      const sy = (i * 71) % (clampedHy - 4) + 2;
      const sz = (i % 5 === 0) ? 2 : 1;
      ctx.globalAlpha = 0.25 + (i % 6) * 0.09;
      ctx.fillStyle = i % 4 === 0 ? '#FFD700' : i % 4 === 1 ? '#ff8c00' : 'rgba(255,200,80,0.7)';
      ctx.fillRect(sx, sy, sz, sz);
    }
    ctx.globalAlpha = 1;
    // Amber floor
    const floor = ctx.createLinearGradient(0, clampedHy, 0, CH);
    floor.addColorStop(0, '#1c0d00'); floor.addColorStop(1, '#080300');
    ctx.fillStyle = floor; ctx.fillRect(0, clampedHy, CW, CH - clampedHy);
    // Golden horizon glow
    const hg = ctx.createLinearGradient(0, clampedHy - 14, 0, clampedHy + 24);
    hg.addColorStop(0, 'rgba(255,180,0,0)');
    hg.addColorStop(0.45, 'rgba(255,160,0,0.30)');
    hg.addColorStop(1, 'rgba(180,80,0,0)');
    ctx.fillStyle = hg; ctx.fillRect(0, clampedHy - 14, CW, 38);
    return;
  }

  // ── DEFAULT: Deep Space (Lobby 1 + private lobbies) ─────────
  const skyGrad = ctx.createLinearGradient(0, 0, 0, clampedHy);
  skyGrad.addColorStop(0, '#060d22'); skyGrad.addColorStop(1, '#0c1a38');
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, CW, clampedHy);
  // Nebula glows
  const neb = ctx.createRadialGradient(CW * 0.6, clampedHy * 0.4, 0, CW * 0.6, clampedHy * 0.4, CW * 0.55);
  neb.addColorStop(0, 'rgba(100,30,180,0.28)'); neb.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = neb; ctx.fillRect(0, 0, CW, clampedHy);
  const neb2 = ctx.createRadialGradient(CW * 0.2, clampedHy * 0.6, 0, CW * 0.2, clampedHy * 0.6, CW * 0.4);
  neb2.addColorStop(0, 'rgba(20,80,160,0.22)'); neb2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = neb2; ctx.fillRect(0, 0, CW, clampedHy);
  const neb3 = ctx.createRadialGradient(CW * 0.8, clampedHy * 0.2, 0, CW * 0.8, clampedHy * 0.2, CW * 0.3);
  neb3.addColorStop(0, 'rgba(0,140,160,0.18)'); neb3.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = neb3; ctx.fillRect(0, 0, CW, clampedHy);
  // Stars
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 120; i++) {
    const sx = ((i * 173 + Math.floor(worldAngle * 80) * 37) % (CW * 10) + CW * 10) % (CW * 10) / 10;
    const sy = (i * 71) % (clampedHy - 4) + 2;
    const sz = (i % 3 === 0) ? 1.5 : (i % 7 === 0) ? 1 : 0.5;
    ctx.globalAlpha = 0.4 + (i % 5) * 0.12;
    ctx.fillRect(sx, sy, sz, sz);
  }
  ctx.globalAlpha = 1;
  // Dark teal floor
  const floor = ctx.createLinearGradient(0, clampedHy, 0, CH);
  floor.addColorStop(0, '#091820'); floor.addColorStop(1, '#040e14');
  ctx.fillStyle = floor; ctx.fillRect(0, clampedHy, CW, CH - clampedHy);
  // Horizon atmospheric glow
  const hg = ctx.createLinearGradient(0, clampedHy - 14, 0, clampedHy + 22);
  hg.addColorStop(0, 'rgba(0,180,200,0)');
  hg.addColorStop(0.5, 'rgba(40,160,220,0.22)');
  hg.addColorStop(1, 'rgba(0,100,160,0)');
  ctx.fillStyle = hg; ctx.fillRect(0, clampedHy - 14, CW, 36);
}

// ── Stone pillar obstacles ─────────────────────────────────────
function drawObstacle3D(obs) {
  const SEGS = 16;
  const OBS_H = obs.r * 2.4;
  const base = project(obs.x, obs.y, 0);
  if (!base || base.zc > 1500) return;

  ctx.save();

  // Shadow ellipse on floor
  const rw = obs.r * base.scale;
  ctx.beginPath(); ctx.ellipse(base.sx, base.sy, rw * 0.9, rw * 0.25, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();

  // Build visible face segments (back-face culled)
  const faces = [];
  for (let i = 0; i < SEGS; i++) {
    const a0 = (i / SEGS) * Math.PI * 2;
    const a1 = ((i + 1) / SEGS) * Math.PI * 2;
    const midA = (a0 + a1) / 2;
    // Back-face cull: segment faces away from camera when dot product is negative
    const facingFactor = -Math.cos(midA - worldAngle);
    if (facingFactor <= 0) continue;

    const wx0 = obs.x + Math.cos(a0) * obs.r;
    const wy0 = obs.y + Math.sin(a0) * obs.r;
    const wx1 = obs.x + Math.cos(a1) * obs.r;
    const wy1 = obs.y + Math.sin(a1) * obs.r;

    const pb0 = project(wx0, wy0, 0);
    const pb1 = project(wx1, wy1, 0);
    const pt0 = project(wx0, wy0, OBS_H);
    const pt1 = project(wx1, wy1, OBS_H);
    if (!pb0 || !pb1 || !pt0 || !pt1) continue;

    // Average zc for painter's sort
    const avgZc = (pb0.zc + pb1.zc) / 2;
    faces.push({ pb0, pb1, pt0, pt1, facingFactor, avgZc });
  }

  // Sort back to front
  faces.sort((a, b) => b.avgZc - a.avgZc);

  for (const f of faces) {
    const { pb0, pb1, pt0, pt1, facingFactor } = f;
    const l = 0.18 + facingFactor * 0.72;
    let r2, g2, b2;
    if (currentLobbyId === 2) {
      // Team Duels: same stone look as lobby 1 but with a warm red tint
      r2 = Math.round(55 + 88 * l); g2 = Math.round(42 + 72 * l); b2 = Math.round(42 + 72 * l);
    } else if (currentLobbyId === 3) {
      // Hot Potato: same stone look but with a warm golden/yellow tint
      r2 = Math.round(55 + 88 * l); g2 = Math.round(52 + 82 * l); b2 = Math.round(30 + 50 * l);
    } else {
      // Default: cool blue-grey stone (Lobby 1 + private)
      r2 = Math.round(45 + 80 * l); g2 = Math.round(50 + 85 * l); b2 = Math.round(70 + 100 * l);
    }
    ctx.beginPath();
    ctx.moveTo(pb0.sx, pb0.sy);
    ctx.lineTo(pb1.sx, pb1.sy);
    ctx.lineTo(pt1.sx, pt1.sy);
    ctx.lineTo(pt0.sx, pt0.sy);
    ctx.closePath();
    ctx.fillStyle = `rgb(${r2},${g2},${b2})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(0,0,0,${0.2 + facingFactor * 0.15})`;
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  ctx.restore();
}

// ── Stone platforms ────────────────────────────────────────────
function drawPlatform3D(plat) {
  const base = project(plat.x, plat.y, plat.h);
  const bot  = project(plat.x, plat.y, plat.h - 14);
  if (!base || base.zc > 1500) return;
  const sc = base.scale;
  const rw = plat.r * sc * 1.05, rh = rw * 0.32;
  const SIDEBOT = bot ? bot.sy : base.sy + 10 * sc;

  ctx.save();
  // Shadow on void floor
  const shadowBase = project(plat.x, plat.y, 0);
  if (shadowBase) {
    const sw = plat.r * shadowBase.scale * 0.9;
    ctx.beginPath(); ctx.ellipse(shadowBase.sx, shadowBase.sy, sw, sw * 0.28, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
  }
  // Side face
  ctx.beginPath();
  ctx.moveTo(base.sx - rw, base.sy);
  ctx.lineTo(base.sx + rw, base.sy);
  ctx.lineTo(base.sx + rw * (bot ? bot.scale / base.scale : 0.95), SIDEBOT);
  ctx.lineTo(base.sx - rw * (bot ? bot.scale / base.scale : 0.95), SIDEBOT);
  ctx.closePath();
  ctx.fillStyle = '#1e2230'; ctx.fill();
  ctx.strokeStyle = '#2a2e40'; ctx.lineWidth = 1; ctx.stroke();

  // Top surface
  ctx.beginPath(); ctx.ellipse(base.sx, base.sy, rw, rh, 0, 0, Math.PI * 2);
  const pg = ctx.createRadialGradient(base.sx - rw * 0.25, base.sy - rh * 0.3, 0, base.sx, base.sy, rw);
  pg.addColorStop(0, '#5a5e70'); pg.addColorStop(0.6, '#3a3e50'); pg.addColorStop(1, '#252838');
  ctx.fillStyle = pg; ctx.fill();
  ctx.strokeStyle = '#3a3e50'; ctx.lineWidth = 1.5; ctx.stroke();
  // Crack detail
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(base.sx - rw * 0.3, base.sy - rh * 0.1); ctx.lineTo(base.sx + rw * 0.1, base.sy + rh * 0.1); ctx.stroke();
  // Glow rim (floating platform energy)
  ctx.strokeStyle = 'rgba(100,80,220,0.5)'; ctx.lineWidth = 1.5;
  ctx.shadowColor = 'rgba(100,80,220,0.6)'; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.ellipse(base.sx, base.sy, rw, rh, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();
}

// ── Lantern positions per lobby ────────────────────────────────
const LANTERN_SPOTS = {
  1: [ // FFA — spaced around the outer ring
    {x:460, y:130}, {x:1140, y:130},
    {x:460, y:1070},{x:1140, y:1070},
    {x:130, y:390}, {x:1470, y:390},
    {x:130, y:810}, {x:1470, y:810},
  ],
  2: [ // Team Duels — marking the two team sides
    {x:800, y:130}, {x:800, y:1070},
    {x:130, y:600}, {x:1470, y:600},
    {x:480, y:600}, {x:1120, y:600},
    {x:490, y:130}, {x:1110, y:130},
  ],
  3: [ // Hot Potato — ringing the golden crater
    {x:800, y:130}, {x:800, y:1070},
    {x:130, y:600}, {x:1470, y:600},
    {x:400, y:200}, {x:1200, y:200},
    {x:400, y:1000},{x:1200, y:1000},
  ],
};

function drawLantern3D(wx, wy, lobbyId) {
  const bobH = 82 + Math.sin(Date.now() / 900 + wx * 0.007) * 6;
  const top = project(wx, wy, bobH + 14);
  const pos = project(wx, wy, bobH);
  const gnd = project(wx, wy, 0);
  if (!pos || pos.zc > 900) return;

  // Lobby-specific colour
  let glowRGB, coreHex, chainHex;
  if (lobbyId === 2) {
    glowRGB = '255,70,20'; coreHex = '#ff5500'; chainHex = 'rgba(160,80,60,0.55)';
  } else if (lobbyId === 3) {
    glowRGB = '255,200,30'; coreHex = '#ffd700'; chainHex = 'rgba(160,140,40,0.55)';
  } else {
    glowRGB = '120,90,255'; coreHex = '#9966ff'; chainHex = 'rgba(100,80,200,0.55)';
  }
  const sc = pos.scale;
  const pulse = 0.88 + Math.sin(Date.now() / 550 + wy * 0.009) * 0.12;

  ctx.save();

  // Chain / rod down from top
  if (top && gnd) {
    ctx.strokeStyle = chainHex;
    ctx.lineWidth = Math.max(1, sc * 1.2);
    ctx.setLineDash([Math.max(2, sc*3), Math.max(2, sc*2)]);
    ctx.beginPath(); ctx.moveTo(pos.sx, pos.sy); ctx.lineTo(gnd.sx, gnd.sy);
    ctx.stroke(); ctx.setLineDash([]);
  }

  // Outer glow halo
  const gr = Math.max(8, 42 * sc * pulse);
  const grd = ctx.createRadialGradient(pos.sx, pos.sy, 0, pos.sx, pos.sy, gr);
  grd.addColorStop(0,   `rgba(${glowRGB},0.55)`);
  grd.addColorStop(0.45,`rgba(${glowRGB},0.18)`);
  grd.addColorStop(1,   `rgba(${glowRGB},0)`);
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(pos.sx, pos.sy, gr, 0, Math.PI * 2); ctx.fill();

  // Lantern body (small glowing gem/orb)
  const lr = Math.max(2.5, 7 * sc * pulse);
  ctx.shadowColor = coreHex; ctx.shadowBlur = Math.max(8, 18 * sc);
  ctx.fillStyle = coreHex;
  ctx.beginPath(); ctx.arc(pos.sx, pos.sy, lr, 0, Math.PI * 2); ctx.fill();
  // Bright core
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.arc(pos.sx - lr*0.28, pos.sy - lr*0.28, lr * 0.38, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

// ── Floor decals — lobby-specific ground details ────────────────
function drawFloorDecals() {
  if (currentLobbyId === 2) {
    // Lava cracks radiating from center
    const cracks = [
      [{x:660,y:600},{x:540,y:480},{x:420,y:420}],
      [{x:940,y:600},{x:1060,y:480},{x:1180,y:420}],
      [{x:800,y:500},{x:800,y:350},{x:740,y:260}],
      [{x:800,y:700},{x:800,y:850},{x:860,y:940}],
      [{x:700,y:560},{x:580,y:560},{x:450,y:620}],
      [{x:900,y:640},{x:1020,y:640},{x:1150,y:580}],
    ];
    const glow = 0.25 + Math.sin(Date.now() / 700) * 0.12;
    cracks.forEach(pts => {
      const proj = pts.map(p => project(p.x, p.y, 0.5)).filter(Boolean);
      if (proj.length < 2) return;
      ctx.save();
      ctx.strokeStyle = `rgba(255,80,0,${glow})`;
      ctx.lineWidth = Math.max(1, proj[0].scale * 3);
      ctx.shadowColor = 'rgba(255,60,0,0.8)'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(proj[0].sx, proj[0].sy);
      proj.slice(1).forEach(p => ctx.lineTo(p.sx, p.sy));
      ctx.stroke(); ctx.restore();
    });
  }

  if (currentLobbyId === 3) {
    // Golden crop circle markings
    const rings = [180, 320, 460];
    rings.forEach((r, ri) => {
      const segs = 24, glow = 0.18 + Math.sin(Date.now() / 900 + ri) * 0.08;
      ctx.save();
      ctx.strokeStyle = `rgba(255,200,0,${glow})`;
      ctx.setLineDash([6, 10]);
      const pts = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const p = project(800 + Math.cos(a) * r, 600 + Math.sin(a) * r, 0.5);
        if (p) pts.push(p);
      }
      if (pts.length > 2) {
        ctx.lineWidth = Math.max(1, pts[0].scale * 2.5);
        ctx.beginPath(); ctx.moveTo(pts[0].sx, pts[0].sy);
        pts.slice(1).forEach(p => ctx.lineTo(p.sx, p.sy));
        ctx.stroke();
      }
      ctx.setLineDash([]); ctx.restore();
    });
  }
}

// ── Portal ─────────────────────────────────────────────────────
function drawPortal3D() {
  if (!portal) return;
  const base = project(portal.x, portal.y, 0);
  if (!base || base.zc > 1400) return;
  const sc = base.scale;
  const r = portal.r * sc;
  const t = Date.now() / 1000;
  const topP = project(portal.x, portal.y, portal.r * 2.8);
  ctx.save();

  // Ground glow
  ctx.beginPath(); ctx.ellipse(base.sx, base.sy, r * 1.4, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(180,80,255,${0.2 + Math.sin(t * 2.5) * 0.07})`; ctx.fill();

  // Vertical oval portal body
  const ph = topP ? (base.sy - topP.sy) : r * 3;
  const pcx = base.sx, pcy = base.sy - ph * 0.5;
  const pw = r * 0.9;
  // Outer ring
  ctx.beginPath(); ctx.ellipse(pcx, pcy, pw, ph * 0.5, 0, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(200,100,255,${0.7 + Math.sin(t * 3) * 0.2})`;
  ctx.lineWidth = 2 * sc; ctx.shadowColor = 'rgba(180,80,255,0.9)'; ctx.shadowBlur = 14; ctx.stroke();
  // Inner swirl
  const swirl = ctx.createRadialGradient(pcx, pcy, 0, pcx, pcy, pw);
  swirl.addColorStop(0, `rgba(255,255,255,${0.8 + Math.sin(t * 5) * 0.15})`);
  swirl.addColorStop(0.25, `rgba(200,100,255,0.7)`);
  swirl.addColorStop(0.65, `rgba(80,20,160,0.5)`);
  swirl.addColorStop(1, 'rgba(0,0,0,0.05)');
  ctx.beginPath(); ctx.ellipse(pcx, pcy, pw * 0.85, ph * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = swirl; ctx.fill();
  // Swirl lines
  ctx.strokeStyle = `rgba(255,200,255,0.3)`; ctx.lineWidth = 1; ctx.shadowBlur = 0;
  for (let i = 0; i < 4; i++) {
    const a = t * 2 + i * Math.PI / 2;
    ctx.beginPath(); ctx.arc(pcx + Math.cos(a) * pw * 0.3, pcy + Math.sin(a) * ph * 0.15, pw * 0.15, 0, Math.PI * 2); ctx.stroke();
  }
  // Label
  if (base.zc < 400) {
    ctx.fillStyle = `rgba(255,200,255,${Math.min(1, (400 - base.zc) / 200)})`;
    ctx.font = `bold ${Math.max(8, 13 * sc)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(180,80,255,0.9)'; ctx.shadowBlur = 8;
    ctx.fillText('EXIT', pcx, pcy - ph * 0.55);
  }
  ctx.shadowBlur = 0; ctx.restore();
}

// ── Shield block FX ────────────────────────────────────────────
function drawShieldBlockFX() {
  shieldBlockFX.forEach(fx => {
    const p = project(fx.x, fx.y, 22);
    if (!p) return;
    const a = fx.timer / 30;
    const r = (1 - a) * 40 * p.scale;
    ctx.save();
    ctx.strokeStyle = `rgba(80,200,255,${a * 0.9})`; ctx.lineWidth = 2 * p.scale;
    ctx.shadowColor = 'rgba(80,200,255,0.9)'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0; ctx.restore();
  });
}

// ── Shockwave ring FX ─────────────────────────────────────────
function drawShockwaveFX() {
  shockwaveFX.forEach(fx => {
    const t = fx.timer / fx.maxTimer;   // 1→0 as it fades
    const prog = 1 - t;                 // 0→1 as ring expands
    const worldR = fx.maxR * prog;
    const isOwn = Math.hypot(fx.x - camX, fx.y - camY) < 15;

    ctx.save();
    ctx.globalAlpha = t * 0.85;

    let cx2, cy2, screenR;
    if (isOwn) {
      // Own shockwave — camera is at origin so project() returns null.
      // Render as screen-space ring expanding outward from screen center.
      cx2 = CW / 2; cy2 = CH / 2;
      screenR = Math.min(CW, CH) * 0.48 * prog;
    } else {
      const cp = project(fx.x, fx.y, 0);
      if (!cp) { ctx.globalAlpha = 1; ctx.restore(); return; }
      const edge = project(fx.x + worldR, fx.y, 0);
      cx2 = cp.sx; cy2 = cp.sy;
      screenR = edge ? Math.abs(edge.sx - cp.sx) : worldR * cp.scale;
    }

    // Outer glow ring
    ctx.beginPath(); ctx.arc(cx2, cy2, screenR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(180,120,255,0.9)'; ctx.lineWidth = Math.max(2, 6 * t);
    ctx.shadowColor = 'rgba(160,80,255,0.9)'; ctx.shadowBlur = 18 * t;
    ctx.stroke();
    // Inner pulse
    ctx.beginPath(); ctx.arc(cx2, cy2, screenR * 0.55, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(220,180,255,0.5)'; ctx.lineWidth = Math.max(1, 3 * t);
    ctx.shadowBlur = 8 * t; ctx.stroke();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.restore();
  });
}

// ── Hit & heal screen flashes ──────────────────────────────────
function drawHealFlash() {
  if (healFlash < 0.01) return;
  const eg = ctx.createRadialGradient(CW/2, CH/2, CH * 0.15, CW/2, CH/2, CH * 0.85);
  eg.addColorStop(0, 'rgba(0,255,100,0)');
  eg.addColorStop(1, `rgba(0,255,100,${healFlash * 0.45})`);
  ctx.fillStyle = eg; ctx.fillRect(0, 0, CW, CH);
}

// ── Hat rendering ──────────────────────────────────────────────
function drawHatOn(hatId, sx, sy, R) {
  // sy = body sphere center Y; hat sits above that
  const base = sy - R; // top of head
  ctx.save(); ctx.shadowBlur = 0;
  switch (hatId) {
    case 'crown': {
      const hw = R * 1.1, hh = R * 0.75;
      ctx.lineWidth = Math.max(1, R * 0.1);
      // Band
      ctx.fillStyle = '#FFD700'; ctx.strokeStyle = '#8B6914';
      ctx.beginPath();
      ctx.moveTo(sx - hw, base); ctx.lineTo(sx + hw, base);
      ctx.lineTo(sx + hw, base - hh * 0.38); ctx.lineTo(sx - hw, base - hh * 0.38);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Three spikes
      [[-hw * 0.55, hh], [0, hh * 1.05], [hw * 0.55, hh]].forEach(([ox, oh]) => {
        ctx.beginPath();
        ctx.moveTo(sx + ox - hw * 0.42, base - hh * 0.38);
        ctx.lineTo(sx + ox, base - oh);
        ctx.lineTo(sx + ox + hw * 0.42, base - hh * 0.38);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      });
      // Center gem
      ctx.fillStyle = '#e33'; ctx.beginPath();
      ctx.arc(sx, base - hh * 0.19, R * 0.14, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'cowboy': {
      const hw = R * 1.45, hh = R * 0.95;
      ctx.lineWidth = Math.max(1, R * 0.1);
      // Brim
      ctx.fillStyle = '#6B3A2A'; ctx.strokeStyle = '#3D1F14';
      ctx.beginPath(); ctx.ellipse(sx, base, hw, hh * 0.2, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      // Crown
      ctx.beginPath();
      ctx.moveTo(sx - R * 0.72, base);
      ctx.quadraticCurveTo(sx - R * 0.6, base - hh, sx, base - hh);
      ctx.quadraticCurveTo(sx + R * 0.6, base - hh, sx + R * 0.72, base);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Hat band
      ctx.fillStyle = '#2a1208';
      ctx.beginPath();
      ctx.moveTo(sx - R * 0.65, base - hh * 0.2); ctx.lineTo(sx + R * 0.65, base - hh * 0.2);
      ctx.lineTo(sx + R * 0.65, base - hh * 0.35); ctx.lineTo(sx - R * 0.65, base - hh * 0.35);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'wizard': {
      const hw = R * 0.78, hh = R * 1.75;
      ctx.lineWidth = Math.max(1, R * 0.1);
      // Brim
      ctx.fillStyle = '#5B1D9E'; ctx.strokeStyle = '#9B30FF';
      ctx.beginPath(); ctx.ellipse(sx, base, hw * 1.5, hw * 0.28, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      // Cone (slightly tipped)
      ctx.beginPath();
      ctx.moveTo(sx - hw, base);
      ctx.quadraticCurveTo(sx - hw * 0.4, base - hh * 0.55, sx + R * 0.12, base - hh);
      ctx.quadraticCurveTo(sx + hw * 0.55, base - hh * 0.55, sx + hw, base);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Star
      ctx.fillStyle = '#FFD700'; ctx.font = `bold ${Math.round(R * 0.52)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('★', sx - R * 0.05, base - hh * 0.35);
      ctx.textBaseline = 'alphabetic';
      break;
    }
    case 'knight': {
      const hr = R * 0.92;
      ctx.lineWidth = Math.max(1, R * 0.1);
      // Helmet dome
      ctx.fillStyle = '#888'; ctx.strokeStyle = '#444';
      ctx.beginPath();
      ctx.arc(sx, base - hr * 0.5, hr, Math.PI * 1.05, Math.PI * 1.95);
      ctx.lineTo(sx + hr, base + hr * 0.08); ctx.lineTo(sx - hr, base + hr * 0.08);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Visor slots
      ctx.strokeStyle = '#222'; ctx.lineWidth = Math.max(1.5, R * 0.12);
      for (let i = 0; i < 3; i++) {
        const vy = base - hr * 0.22 + i * R * 0.17;
        ctx.beginPath(); ctx.moveTo(sx - hr * 0.62, vy); ctx.lineTo(sx + hr * 0.62, vy); ctx.stroke();
      }
      // Shimmer
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = Math.max(1, R * 0.07);
      ctx.beginPath(); ctx.arc(sx - hr * 0.22, base - hr * 0.72, hr * 0.44, Math.PI * 1.2, Math.PI * 1.65); ctx.stroke();
      break;
    }
    case 'santa': {
      const hw = R * 0.82, hh = R * 1.3;
      ctx.lineWidth = Math.max(1, R * 0.1);
      ctx.fillStyle = 'white'; ctx.strokeStyle = '#ddd';
      ctx.beginPath(); ctx.ellipse(sx, base, hw * 1.2, hw * 0.22, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#CC0000'; ctx.strokeStyle = '#880000';
      ctx.beginPath();
      ctx.moveTo(sx - hw, base);
      ctx.quadraticCurveTo(sx - hw * 0.3, base - hh * 0.9, sx + hw * 0.45, base - hh);
      ctx.quadraticCurveTo(sx + hw * 0.82, base - hh * 0.5, sx + hw, base);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'white';
      ctx.beginPath(); ctx.arc(sx + hw * 0.45, base - hh, hw * 0.27, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'tophat': {
      const hw = R * 0.78, hh = R * 1.1;
      ctx.lineWidth = Math.max(1, R * 0.1);
      ctx.fillStyle = '#111'; ctx.strokeStyle = '#555';
      // Brim
      ctx.beginPath(); ctx.ellipse(sx, base, hw * 1.4, hw * 0.22, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Cylinder
      ctx.beginPath();
      ctx.moveTo(sx - hw, base); ctx.lineTo(sx - hw, base - hh);
      ctx.lineTo(sx + hw, base - hh); ctx.lineTo(sx + hw, base);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Band
      ctx.fillStyle = '#cc2200';
      ctx.fillRect(sx - hw, base - hh * 0.24, hw * 2, hh * 0.14);
      // Top
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.ellipse(sx, base - hh, hw, hw * 0.18, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
    case 'party': {
      const hw = R * 0.65, hh = R * 1.4;
      ctx.lineWidth = Math.max(1, R * 0.1);
      // Colourful cone
      const colors = ['#ff4444','#ff8800','#ffdd00','#44ff44','#4488ff','#cc44ff'];
      for (let i = 0; i < colors.length; i++) {
        const a0 = (i / colors.length) * Math.PI * 2, a1 = ((i + 1) / colors.length) * Math.PI * 2;
        ctx.fillStyle = colors[i];
        ctx.beginPath(); ctx.moveTo(sx, base - hh);
        ctx.lineTo(sx + Math.cos(a0) * hw, base + Math.sin(a0) * hw * 0.22);
        ctx.lineTo(sx + Math.cos(a1) * hw, base + Math.sin(a1) * hw * 0.22);
        ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = Math.max(1, R * 0.08);
      ctx.beginPath(); ctx.moveTo(sx - hw, base); ctx.lineTo(sx, base - hh); ctx.lineTo(sx + hw, base); ctx.stroke();
      // Pom
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, base - hh, R * 0.18, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'halo': {
      // Golden ring floating above head
      ctx.strokeStyle = '#FFD700'; ctx.lineWidth = Math.max(2, R * 0.18);
      ctx.shadowColor = 'rgba(255,220,0,0.9)'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.ellipse(sx, base - R * 0.6, R * 0.9, R * 0.25, 0, 0, Math.PI * 2);
      ctx.stroke(); ctx.shadowBlur = 0;
      break;
    }
    case 'viking': {
      const hr = R * 0.88, hw2 = R * 1.0;
      ctx.lineWidth = Math.max(1, R * 0.1);
      // Helmet dome
      ctx.fillStyle = '#a0a0b0'; ctx.strokeStyle = '#555';
      ctx.beginPath(); ctx.arc(sx, base - hr * 0.45, hr, Math.PI, 0); ctx.lineTo(sx + hr, base); ctx.lineTo(sx - hr, base); ctx.closePath(); ctx.fill(); ctx.stroke();
      // Horns
      ctx.fillStyle = '#e8d0a0'; ctx.strokeStyle = '#888';
      ctx.lineWidth = Math.max(1, R * 0.08);
      [[-1, 1]].concat([[1, -1]]).forEach(([s2, tip]) => {
        ctx.beginPath();
        ctx.moveTo(sx + s2 * hr, base - hr * 0.4);
        ctx.quadraticCurveTo(sx + s2 * hw2 * 1.5, base - hr, sx + s2 * hw2 * 1.2, base - hr * 1.6);
        ctx.quadraticCurveTo(sx + s2 * hw2 * 0.9, base - hr, sx + s2 * hr * 0.7, base - hr * 0.3);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      });
      break;
    }
    case 'pirate': {
      const hw = R * 1.0, hh = R * 0.8;
      ctx.lineWidth = Math.max(1, R * 0.1);
      // Brim
      ctx.fillStyle = '#1a1a1a'; ctx.strokeStyle = '#444';
      ctx.beginPath(); ctx.ellipse(sx, base, hw * 1.35, hw * 0.22, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Main hat body (tricorne shape)
      ctx.beginPath();
      ctx.moveTo(sx - hw, base);
      ctx.quadraticCurveTo(sx - hw * 0.8, base - hh * 1.1, sx, base - hh * 0.9);
      ctx.quadraticCurveTo(sx + hw * 0.8, base - hh * 1.1, sx + hw, base);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Skull emoji / X bones
      ctx.fillStyle = 'white'; ctx.font = `bold ${Math.round(R * 0.55)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('☠', sx, base - hh * 0.52); ctx.textBaseline = 'alphabetic';
      break;
    }
    case 'beanie': {
      const hw = R * 0.82, hh = R * 0.72;
      ctx.lineWidth = Math.max(1, R * 0.1);
      // Body
      ctx.fillStyle = '#3355cc'; ctx.strokeStyle = '#1133aa';
      ctx.beginPath(); ctx.arc(sx, base - hh * 0.55, hw, Math.PI, 0);
      ctx.lineTo(sx + hw, base); ctx.lineTo(sx - hw, base); ctx.closePath(); ctx.fill(); ctx.stroke();
      // Stripe
      ctx.fillStyle = '#cc3333';
      ctx.beginPath(); ctx.moveTo(sx - hw * 0.95, base - hh * 0.28); ctx.lineTo(sx + hw * 0.95, base - hh * 0.28);
      ctx.lineTo(sx + hw * 0.95, base - hh * 0.46); ctx.lineTo(sx - hw * 0.95, base - hh * 0.46); ctx.closePath(); ctx.fill();
      // Pom
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(sx, base - hh - hw * 0.55, R * 0.22, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'graduation': {
      const hw = R * 0.9, hh = R * 0.18;
      ctx.lineWidth = Math.max(1, R * 0.1);
      // Cap top (mortarboard)
      ctx.fillStyle = '#111'; ctx.strokeStyle = '#333';
      ctx.beginPath(); ctx.moveTo(sx - hw, base - hh); ctx.lineTo(sx + hw, base - hh);
      ctx.lineTo(sx + hw, base); ctx.lineTo(sx - hw, base); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx - hw * 1.1, base - hh); ctx.lineTo(sx, base - R * 0.85); ctx.lineTo(sx + hw * 1.1, base - hh); ctx.closePath(); ctx.fill(); ctx.stroke();
      // Tassel
      ctx.strokeStyle = '#FFD700'; ctx.lineWidth = Math.max(1.5, R * 0.12);
      ctx.beginPath(); ctx.moveTo(sx + hw * 0.4, base - hh); ctx.lineTo(sx + hw * 0.4, base + R * 0.5); ctx.stroke();
      ctx.fillStyle = '#FFD700'; ctx.beginPath(); ctx.arc(sx + hw * 0.4, base + R * 0.5, R * 0.14, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'chef': {
      const hw = R * 0.7, hh = R * 1.1;
      ctx.lineWidth = Math.max(1, R * 0.1);
      // Puffed top
      ctx.fillStyle = 'white'; ctx.strokeStyle = '#ccc';
      ctx.beginPath(); ctx.arc(sx, base - hh * 0.6, hw * 0.85, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Band
      ctx.fillStyle = '#e8e8e8'; ctx.strokeStyle = '#bbb';
      ctx.beginPath(); ctx.moveTo(sx - hw, base); ctx.lineTo(sx + hw, base);
      ctx.lineTo(sx + hw, base - hh * 0.28); ctx.lineTo(sx - hw, base - hh * 0.28); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'bucket': {
      const hw = R * 0.9, hh = R * 0.85;
      ctx.lineWidth = Math.max(1, R * 0.1);
      ctx.fillStyle = '#4a8fc4'; ctx.strokeStyle = '#2a6fa4';
      // Brim
      ctx.beginPath(); ctx.ellipse(sx, base, hw * 1.15, hw * 0.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Bucket body (trapezoidal - wider at bottom)
      ctx.beginPath();
      ctx.moveTo(sx - hw, base); ctx.lineTo(sx - hw * 0.72, base - hh);
      ctx.lineTo(sx + hw * 0.72, base - hh); ctx.lineTo(sx + hw, base); ctx.closePath(); ctx.fill(); ctx.stroke();
      // Crease
      ctx.strokeStyle = '#3a7fb4'; ctx.lineWidth = Math.max(1, R * 0.07);
      ctx.beginPath(); ctx.moveTo(sx - hw * 0.68, base - hh * 0.48); ctx.lineTo(sx + hw * 0.68, base - hh * 0.48); ctx.stroke();
      break;
    }
    case 'baseball': {
      const hw = R * 0.85, hh = R * 0.65;
      ctx.lineWidth = Math.max(1, R * 0.1);
      ctx.fillStyle = '#cc2222'; ctx.strokeStyle = '#991111';
      // Dome
      ctx.beginPath(); ctx.arc(sx, base - hh * 0.55, hw, Math.PI, 0);
      ctx.lineTo(sx + hw, base); ctx.lineTo(sx - hw * 0.7, base); ctx.closePath(); ctx.fill(); ctx.stroke();
      // Brim (front)
      ctx.fillStyle = '#bb1111';
      ctx.beginPath(); ctx.moveTo(sx - hw * 0.7, base); ctx.lineTo(sx + hw * 1.35, base + R * 0.1);
      ctx.lineTo(sx + hw * 1.3, base - R * 0.1); ctx.lineTo(sx - hw * 0.65, base - R * 0.05); ctx.closePath(); ctx.fill(); ctx.stroke();
      // Button top
      ctx.fillStyle = '#aa1111'; ctx.beginPath(); ctx.arc(sx, base - hh - hw * 0.1, R * 0.16, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'frog': {
      const hw = R * 0.9, hh = R * 0.6;
      ctx.lineWidth = Math.max(1, R * 0.1);
      // Frog head shape
      ctx.fillStyle = '#3aaa44'; ctx.strokeStyle = '#228833';
      ctx.beginPath(); ctx.arc(sx, base - hh * 0.55, hw, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Eyes on top
      [-1, 1].forEach(s2 => {
        ctx.fillStyle = '#3aaa44';
        ctx.beginPath(); ctx.arc(sx + s2 * hw * 0.55, base - hh - hw * 0.15, R * 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(sx + s2 * hw * 0.55, base - hh - hw * 0.15, R * 0.14, 0, Math.PI * 2); ctx.fill();
      });
      break;
    }
    case 'devil': {
      // Two red horns
      ctx.lineWidth = Math.max(1, R * 0.1);
      [-1, 1].forEach(s2 => {
        ctx.fillStyle = '#cc0000'; ctx.strokeStyle = '#880000';
        ctx.beginPath();
        ctx.moveTo(sx + s2 * R * 0.5, base);
        ctx.quadraticCurveTo(sx + s2 * R * 0.5, base - R * 1.0, sx + s2 * R * 0.52, base - R * 1.4);
        ctx.quadraticCurveTo(sx + s2 * R * 0.6, base - R * 0.85, sx + s2 * R * 0.85, base - R * 0.1);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      });
      break;
    }
    case 'mohawk': {
      // Rainbow spiky mohawk down center
      const spikes = ['#ff4444','#ff8800','#ffdd00','#44dd44','#4488ff','#cc44ff'];
      spikes.forEach((col, i) => {
        const py = base - R * 0.2 - i * R * 0.22;
        const pw = R * (0.48 - i * 0.06);
        ctx.fillStyle = col; ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx - pw, py + R * 0.2); ctx.lineTo(sx, py - R * 0.3); ctx.lineTo(sx + pw, py + R * 0.2);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      });
      break;
    }
    case 'space': {
      const hr = R * 1.05;
      ctx.lineWidth = Math.max(1, R * 0.1);
      // Helmet dome
      const spaceGrad = ctx.createRadialGradient(sx - hr * 0.25, base - hr * 0.7, 0, sx, base - hr * 0.45, hr);
      spaceGrad.addColorStop(0, '#aaccff'); spaceGrad.addColorStop(0.5, '#334488'); spaceGrad.addColorStop(1, '#111833');
      ctx.fillStyle = spaceGrad; ctx.strokeStyle = '#445588';
      ctx.beginPath(); ctx.arc(sx, base - hr * 0.45, hr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Visor
      const vizGrad = ctx.createRadialGradient(sx - hr * 0.15, base - hr * 0.6, 0, sx, base - hr * 0.45, hr * 0.65);
      vizGrad.addColorStop(0, 'rgba(255,220,80,0.9)'); vizGrad.addColorStop(1, 'rgba(200,140,0,0.5)');
      ctx.fillStyle = vizGrad;
      ctx.beginPath(); ctx.ellipse(sx, base - hr * 0.45, hr * 0.62, hr * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      // Reflection
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.ellipse(sx - hr * 0.25, base - hr * 0.75, hr * 0.25, hr * 0.16, -0.4, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'jester': {
      const hw = R * 0.85, hh = R * 0.5;
      ctx.lineWidth = Math.max(1, R * 0.1);
      // Base band
      ctx.fillStyle = '#cc2266'; ctx.strokeStyle = '#991144';
      ctx.beginPath(); ctx.moveTo(sx - hw, base); ctx.lineTo(sx + hw, base);
      ctx.lineTo(sx + hw, base - hh); ctx.lineTo(sx - hw, base - hh); ctx.closePath(); ctx.fill(); ctx.stroke();
      // Three floppy tips
      const tipCols = ['#cc2266','#2266cc','#22cc66'];
      [[-1, 0], [0, -1], [1, 0]].forEach(([tx, ty], i) => {
        const tipX = sx + tx * hw * 0.75, tipY = base - hh - R * 1.0;
        ctx.fillStyle = tipCols[i]; ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath();
        ctx.moveTo(sx + tx * hw * 0.2, base - hh);
        ctx.quadraticCurveTo(sx + tx * hw * 0.5 + ty * R * 0.3, base - hh - R * 0.5, tipX, tipY);
        ctx.quadraticCurveTo(sx + tx * hw * 0.6 - ty * R * 0.3, base - hh - R * 0.5, sx + tx * hw * 0.72, base - hh);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#FFD700'; ctx.beginPath(); ctx.arc(tipX, tipY, R * 0.16, 0, Math.PI * 2); ctx.fill();
      });
      break;
    }
  }
  ctx.restore();
}

// ── Players ────────────────────────────────────────────────────
function drawPlayer3D(p) {
  if (!p.alive || p.id === myId) return;
  const pz = p.rz || 0;
  const base = project(p.rx, p.ry, pz);
  if (!base || base.zc > 1400) return;
  const sc = base.scale;
  const R = 20 * sc;
  const bodyY = base.sy - R * 1.05;

  ctx.save();

  // Ground shadow (always at z=0)
  const shadow = project(p.rx, p.ry, 0);
  if (shadow) {
    const sr = 20 * shadow.scale;
    ctx.beginPath(); ctx.ellipse(shadow.sx, shadow.sy, sr * 0.95, sr * 0.28, 0, 0, Math.PI * 2);
    const alpha = Math.max(0.1, 0.4 - pz * 0.003);
    ctx.fillStyle = `rgba(0,0,0,${alpha})`; ctx.fill();
  }

  // Hot potato golden aura (drawn behind body)
  if (p.hasPotato) {
    const pulse = 1 + Math.sin(Date.now() / 210) * 0.18;
    const auR = R * 1.85 * pulse;
    const potatoGlow = ctx.createRadialGradient(base.sx, bodyY, R * 0.4, base.sx, bodyY, auR);
    potatoGlow.addColorStop(0, 'rgba(255,215,0,0.45)');
    potatoGlow.addColorStop(0.55, 'rgba(255,140,0,0.18)');
    potatoGlow.addColorStop(1, 'rgba(255,80,0,0)');
    ctx.save();
    ctx.beginPath(); ctx.arc(base.sx, bodyY, auR, 0, Math.PI * 2);
    ctx.fillStyle = potatoGlow; ctx.fill();
    ctx.strokeStyle = `rgba(255,200,0,${0.5 + Math.sin(Date.now() / 200) * 0.3})`;
    ctx.lineWidth = Math.max(1.5, sc * 2.5);
    ctx.shadowColor = 'rgba(255,200,0,0.9)'; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(base.sx, bodyY, R * 1.15, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0; ctx.restore();
  }

  // Shield disc — slightly smaller than player body
  if (p.shieldActive) {
    const shX = base.sx - R * 1.6, shY = bodyY - R * 0.05;
    ctx.beginPath(); ctx.ellipse(shX, shY, R * 0.95, R * 1.25, -0.2, 0, Math.PI * 2);
    const shg = ctx.createRadialGradient(shX - R * 0.2, shY - R * 0.2, 0, shX, shY, R * 1.25);
    shg.addColorStop(0, 'rgba(200,240,255,0.95)');
    shg.addColorStop(0.5, 'rgba(60,160,240,0.8)');
    shg.addColorStop(1, 'rgba(20,80,180,0.5)');
    ctx.fillStyle = shg; ctx.fill();
    ctx.strokeStyle = 'rgba(80,200,255,1)'; ctx.lineWidth = Math.max(2, sc * 2.5);
    ctx.shadowColor = 'rgba(80,200,255,0.9)'; ctx.shadowBlur = 14; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(shX, shY, R * 0.55, R * 0.72, -0.2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(200,240,255,0.4)'; ctx.lineWidth = 1.5; ctx.shadowBlur = 0; ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,0.2)`;
    ctx.font = `bold ${Math.round(R * 0.75)}px Impact, fantasy`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('★', shX, shY); ctx.textBaseline = 'alphabetic';
  }

  // Hands
  const fa = p.ra - worldAngle;
  [fa + 0.72, fa - 0.72].forEach(ha => {
    const hx = base.sx + Math.cos(ha) * R * 1.5;
    const hy = bodyY + Math.sin(ha) * R * 0.45;
    ctx.beginPath(); ctx.arc(hx, hy, R * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = p.color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1; ctx.stroke();
  });

  // Body sphere
  ctx.beginPath(); ctx.arc(base.sx, bodyY, R, 0, Math.PI * 2);
  ctx.fillStyle = p.color; ctx.fill();
  // Lighting overlay using compositing
  ctx.globalCompositeOperation = 'screen';
  const lg = ctx.createRadialGradient(base.sx - R * 0.38, bodyY - R * 0.38, 0, base.sx, bodyY, R * 1.1);
  lg.addColorStop(0, 'rgba(255,255,255,0.35)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath(); ctx.arc(base.sx, bodyY, R, 0, Math.PI * 2);
  ctx.fillStyle = lg; ctx.fill();
  ctx.globalCompositeOperation = 'multiply';
  const dg = ctx.createRadialGradient(base.sx + R * 0.3, bodyY + R * 0.3, 0, base.sx, bodyY, R * 1.05);
  dg.addColorStop(0, 'rgba(0,0,0,0.45)'); dg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath(); ctx.arc(base.sx, bodyY, R, 0, Math.PI * 2);
  ctx.fillStyle = dg; ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = Math.max(1, sc * 2); ctx.stroke();

  // Purple kame charging aura
  if (p.kameCharging) {
    const pulse = 1.4 + Math.sin(Date.now() / 90) * 0.15;
    const auR = R * pulse;
    ctx.save();
    const ag = ctx.createRadialGradient(base.sx, bodyY, R * 0.6, base.sx, bodyY, auR * 2.2);
    ag.addColorStop(0, 'rgba(180,60,255,0.55)');
    ag.addColorStop(0.5, 'rgba(120,30,220,0.2)');
    ag.addColorStop(1, 'rgba(80,0,200,0)');
    ctx.beginPath(); ctx.arc(base.sx, bodyY, auR * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = ag; ctx.fill();
    ctx.strokeStyle = `rgba(210,100,255,${0.6 + Math.sin(Date.now() / 90) * 0.25})`;
    ctx.lineWidth = Math.max(1.5, sc * 2.5);
    ctx.shadowColor = 'rgba(180,80,255,0.95)'; ctx.shadowBlur = 22;
    ctx.beginPath(); ctx.arc(base.sx, bodyY, auR, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0; ctx.restore();
  }

  // Eyes
  const dotR = Math.max(1, R * 0.19);
  const eyeX = base.sx + Math.cos(fa) * R * 0.48;
  const eyeY = bodyY - R * 0.12;
  [-1, 1].forEach(s => {
    const ex2 = eyeX - Math.sin(fa) * R * 0.34 * s;
    ctx.beginPath(); ctx.arc(ex2, eyeY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0a0a'; ctx.fill();
    ctx.beginPath(); ctx.arc(ex2 + dotR * 0.35, eyeY - dotR * 0.35, dotR * 0.38, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.fill();
  });

  // Hat
  if (p.hat && HATS[p.hat]) {
    drawHatOn(p.hat, base.sx, bodyY, R);
  }

  // Name + HP bar — pushed up when hat is present to avoid overlap
  const bw = Math.max(30, R * 3.2), bh = Math.max(3, R * 0.28);
  const hatExtra = (p.hat && HATS[p.hat]) ? R * 2.0 : 0;
  const bx = base.sx - bw / 2, by2 = bodyY - R - bh - 4 - hatExtra;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx - 1, by2 - 1, bw + 2, bh + 2);
  const pct = p.hp / 75;
  ctx.fillStyle = pct > 0.5 ? '#4caf50' : pct > 0.25 ? '#ff9800' : '#f44336';
  ctx.fillRect(bx, by2, bw * pct, bh);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(bx, by2, bw, bh);
  // Name tag — gold for potato holder, team colors otherwise
  const nameClr = p.hasPotato ? '#FFD700' : p.team === 'red' ? '#ff4444' : p.team === 'blue' ? '#4488ff' : 'white';
  ctx.fillStyle = nameClr;
  if (p.hasPotato) { ctx.shadowColor = 'rgba(255,200,0,0.9)'; ctx.shadowBlur = 8; }
  ctx.font = `bold ${Math.max(7, R * 0.58)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.fillText(p.name, base.sx, by2 - 2);
  ctx.shadowBlur = 0;
  // Floating 🥔 above potato holder
  if (p.hasPotato) {
    const floatY = Math.sin(Date.now() / 480) * 4;
    const aboveY = bodyY - R - (p.hat && HATS[p.hat] ? R * 2.6 : R * 1.6) - 8 + floatY;
    ctx.font = `${Math.max(10, R * 0.95)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(255,180,0,0.9)'; ctx.shadowBlur = 10;
    ctx.fillText('🥔', base.sx, aboveY);
    ctx.shadowBlur = 0; ctx.textBaseline = 'alphabetic';
  }

  ctx.restore();
}

// ── Rocks ──────────────────────────────────────────────────────
function drawRock3D(r) {
  const rz = r.z !== undefined ? r.z : 14;
  const pr = project(r.x, r.y, rz);
  if (!pr || pr.zc > 1500) return;
  const rs = Math.max(2, 8 * pr.scale);
  ctx.save();
  if (r.isPotato) {
    // Glowing golden potato rock — bounces forever
    const pulse = 1 + Math.sin(Date.now() / 160) * 0.2;
    ctx.shadowColor = 'rgba(255,200,0,0.95)'; ctx.shadowBlur = 20;
    ctx.beginPath(); ctx.arc(pr.sx, pr.sy, rs * 1.5 * pulse, 0, Math.PI * 2);
    const pg = ctx.createRadialGradient(pr.sx - rs*0.3, pr.sy - rs*0.3, 0, pr.sx, pr.sy, rs * 1.5);
    pg.addColorStop(0, '#fff7a0'); pg.addColorStop(0.5, '#FFD700'); pg.addColorStop(1, '#c87000');
    ctx.fillStyle = pg; ctx.fill();
    ctx.shadowBlur = 0;
    if (rs > 5) {
      ctx.font = `${Math.max(8, rs * 1.6)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🥔', pr.sx, pr.sy);
      ctx.textBaseline = 'alphabetic';
    }
  } else if (r.isMeteor) {
    // Fire trail above meteor
    const trailTop = project(r.x, r.y, rz + 40);
    if (trailTop) {
      const tg = ctx.createLinearGradient(pr.sx, pr.sy, trailTop.sx, trailTop.sy);
      tg.addColorStop(0, `rgba(255,120,20,0.8)`); tg.addColorStop(1, 'rgba(255,120,20,0)');
      ctx.strokeStyle = tg; ctx.lineWidth = rs * 1.8;
      ctx.beginPath(); ctx.moveTo(pr.sx, pr.sy); ctx.lineTo(trailTop.sx, trailTop.sy); ctx.stroke();
    }
    ctx.shadowColor = 'rgba(255,80,0,0.9)'; ctx.shadowBlur = 15;
    ctx.beginPath(); ctx.arc(pr.sx, pr.sy, rs * 1.3, 0, Math.PI * 2);
    ctx.fillStyle = '#ff5010'; ctx.fill();
    ctx.beginPath(); ctx.arc(pr.sx, pr.sy, rs * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = '#ffee80'; ctx.fill();
  } else {
    if (r.bounces > 0) {
      ctx.shadowColor = 'rgba(255,200,80,0.9)'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(pr.sx, pr.sy, rs * (1.5 + r.bounces * 0.25), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,200,80,${Math.min(0.45, r.bounces * 0.12)})`; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(pr.sx, pr.sy, rs, 0, Math.PI * 2);
    const rg = ctx.createRadialGradient(pr.sx - rs * 0.3, pr.sy - rs * 0.3, 0, pr.sx, pr.sy, rs);
    rg.addColorStop(0, r.bounces > 0 ? '#f0c060' : '#aaa');
    rg.addColorStop(1, r.bounces > 0 ? '#805010' : '#444');
    ctx.fillStyle = rg; ctx.fill();
    ctx.strokeStyle = r.bounces > 0 ? '#604010' : '#333';
    ctx.lineWidth = Math.max(1, pr.scale * 1.5); ctx.stroke();
  }
  ctx.shadowBlur = 0; ctx.restore();
}

// ── Kamehameha beams ───────────────────────────────────────────
function drawBeams3D() {
  if (!serverState?.beams) return;
  serverState.beams.forEach(b => {
    const alpha = b.life / 30;
    const isOwn = b.owner === myId;
    const bz = b.z || 22;

    if (isOwn) {
      // Own kame: perspective trapezoid cone – wide at hand, converges to crosshair, fires through it
      ctx.save();
      const hx = CW / 2 + 130, hy2 = CH * 0.80;   // matches hand rest position
      const cx2 = CW / 2, cy2 = CH / 2;         // crosshair / aim point
      const dx2 = cx2 - hx, dy2 = cy2 - hy2;
      const dlen = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      const nx = dx2 / dlen, ny = dy2 / dlen;
      const perpX = -ny, perpY = nx;             // perpendicular direction
      const ext = Math.max(CW, CH) * 2.4;
      const farX = cx2 + nx * ext, farY = cy2 + ny * ext;

      const handW = 60 * alpha;   // beam half-width at hand
      const midW  = 10 * alpha;   // half-width at crosshair
      const farW  = 4  * alpha;   // half-width at far end

      // ── Outer glow trapezoid: hand → crosshair ──────────────
      ctx.shadowColor = 'rgba(80,200,255,0.9)'; ctx.shadowBlur = 36 * alpha;
      const trapGrad = ctx.createLinearGradient(hx, hy2, cx2, cy2);
      trapGrad.addColorStop(0,   `rgba(255,255,255,${alpha * 0.9})`);
      trapGrad.addColorStop(0.15,`rgba(80,200,255,${alpha * 0.85})`);
      trapGrad.addColorStop(0.6, `rgba(255,240,80,${alpha * 0.65})`);
      trapGrad.addColorStop(1,   `rgba(80,200,255,${alpha * 0.35})`);
      ctx.beginPath();
      ctx.moveTo(hx  + perpX * handW, hy2 + perpY * handW);
      ctx.lineTo(cx2 + perpX * midW,  cy2 + perpY * midW);
      ctx.lineTo(cx2 - perpX * midW,  cy2 - perpY * midW);
      ctx.lineTo(hx  - perpX * handW, hy2 - perpY * handW);
      ctx.closePath();
      ctx.fillStyle = trapGrad; ctx.fill();

      // ── Continuing beam past crosshair (thin tapering line) ─
      ctx.shadowBlur = 0;
      const farGrad = ctx.createLinearGradient(cx2, cy2, farX, farY);
      farGrad.addColorStop(0, `rgba(80,200,255,${alpha * 0.8})`);
      farGrad.addColorStop(1, 'rgba(80,200,255,0)');
      ctx.beginPath();
      ctx.moveTo(cx2 + perpX * midW, cy2 + perpY * midW);
      ctx.lineTo(farX + perpX * farW, farY + perpY * farW);
      ctx.lineTo(farX - perpX * farW, farY - perpY * farW);
      ctx.lineTo(cx2 - perpX * midW, cy2 - perpY * midW);
      ctx.closePath();
      ctx.fillStyle = farGrad; ctx.fill();

      // ── Bright white core line all the way through ──────────
      ctx.shadowColor = 'rgba(255,255,255,0.9)'; ctx.shadowBlur = 12 * alpha;
      const coreGrad = ctx.createLinearGradient(hx, hy2, farX, farY);
      coreGrad.addColorStop(0,   `rgba(255,255,255,${alpha})`);
      coreGrad.addColorStop(0.35,`rgba(255,255,255,${alpha * 0.8})`);
      coreGrad.addColorStop(1,   'rgba(255,255,255,0)');
      ctx.strokeStyle = coreGrad; ctx.lineWidth = 5 * alpha; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(hx, hy2); ctx.lineTo(farX, farY); ctx.stroke();

      // ── Hand origin burst ────────────────────────────────────
      ctx.shadowBlur = 0;
      const og = ctx.createRadialGradient(hx, hy2, 0, hx, hy2, 70 * alpha);
      og.addColorStop(0,   `rgba(255,255,255,${alpha})`);
      og.addColorStop(0.35,`rgba(80,200,255,${alpha * 0.8})`);
      og.addColorStop(1,   'rgba(80,200,255,0)');
      ctx.fillStyle = og; ctx.beginPath(); ctx.arc(hx, hy2, 70 * alpha, 0, Math.PI * 2); ctx.fill();

      // Screen tint
      ctx.fillStyle = `rgba(80,200,255,${alpha * 0.07})`; ctx.fillRect(0, 0, CW, CH);
      ctx.restore();
      return;
    }

    // Other player's kame beam — use pitch for proper 3D direction, len stops at walls
    const o = project(b.x, b.y, bz);
    if (!o) return;
    const beamDist = b.len || 3000;
    const bp = b.pitch || 0;
    const farX = b.x + Math.cos(b.angle) * beamDist;
    const farY = b.y + Math.sin(b.angle) * beamDist;
    const farZ = bz + Math.tan(bp) * beamDist;
    let esx, esy;
    const fp = project(farX, farY, farZ);
    if (fp && fp.zc > 0) { esx = fp.sx; esy = fp.sy; }
    else {
      const rel = b.angle - worldAngle;
      esx = o.sx + Math.sin(rel) * CW * 1.5;
      esy = o.sy - Math.cos(rel) * CH;
    }
    const lw = Math.min(40, Math.max(4, 26 * alpha * Math.sqrt(Math.min(o.scale, 2))));
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(80,200,255,0.9)'; ctx.shadowBlur = 22 * alpha;
    const grad2 = ctx.createLinearGradient(o.sx, o.sy, esx, esy);
    grad2.addColorStop(0,    `rgba(255,255,255,${alpha})`);
    grad2.addColorStop(0.1,  `rgba(80,200,255,${alpha * 0.95})`);
    grad2.addColorStop(0.45, `rgba(255,240,80,${alpha * 0.7})`);
    grad2.addColorStop(1,    'rgba(80,200,255,0)');
    ctx.strokeStyle = grad2; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(o.sx, o.sy); ctx.lineTo(esx, esy); ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.9})`; ctx.lineWidth = lw * 0.25; ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.moveTo(o.sx, o.sy); ctx.lineTo(esx, esy); ctx.stroke();
    ctx.restore();
  });
}

// ── Screen overlays ────────────────────────────────────────────
function drawKameText() {
  if (!serverState?.beams?.length) return;
  const b = serverState.beams[0];
  if (b.life > 15) {
    const ta = (b.life - 15) / 15;
    ctx.save(); ctx.font = 'bold 28px Impact, fantasy';
    ctx.fillStyle = `rgba(255,240,80,${ta})`; ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(80,200,255,0.9)'; ctx.shadowBlur = 16;
    ctx.fillText('LASER BEAM!!!', CW / 2, 46); ctx.restore();
  }
}

function drawHand() {
  if (!myId || !serverState) return;
  const me = serverState.players.find(p => p.id === myId);
  if (!me || !me.alive) return;

  const rest    = { x: CW / 2 + 130, y: CH * 0.80 };
  const windup  = { x: CW / 2 + 190, y: CH * 0.87 };
  const throwP  = { x: CW / 2 + 60,  y: CH * 0.61 };
  const armBase = { x: CW / 2 + 142, y: CH * 1.12 };
  const t = hand.timer / (hand.dur[hand.state] || 1);
  let hp;
  if (hand.state === 'idle')         hp = rest;
  else if (hand.state === 'windup')  hp = { x: lerp(rest.x, windup.x, t),   y: lerp(rest.y, windup.y, t) };
  else if (hand.state === 'throw')   hp = { x: lerp(windup.x, throwP.x, t), y: lerp(windup.y, throwP.y, t) };
  else                               hp = { x: lerp(throwP.x, rest.x, t),   y: lerp(throwP.y, rest.y, t) };

  ctx.save(); ctx.lineCap = 'round';
  const HR = 76;
  ctx.lineWidth = 62; ctx.strokeStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath(); ctx.moveTo(armBase.x + 3, armBase.y + 3); ctx.lineTo(hp.x + 3, hp.y + 3); ctx.stroke();
  ctx.lineWidth = 58; ctx.strokeStyle = me.color;
  ctx.beginPath(); ctx.moveTo(armBase.x, armBase.y); ctx.lineTo(hp.x, hp.y); ctx.stroke();
  ctx.beginPath(); ctx.arc(hp.x, hp.y, HR, 0, Math.PI * 2);
  ctx.fillStyle = me.color; ctx.fill();
  ctx.globalCompositeOperation = 'screen';
  const hl = ctx.createRadialGradient(hp.x - 10, hp.y - 10, 0, hp.x, hp.y, HR);
  hl.addColorStop(0, 'rgba(255,255,255,0.32)'); hl.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath(); ctx.arc(hp.x, hp.y, HR, 0, Math.PI * 2); ctx.fillStyle = hl; ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 4; ctx.stroke();
  if (me.ready && myAmmo > 0 && hand.state === 'idle') {
    const rx = hp.x - 14, ry = hp.y - HR - 18, rr = 26;
    const rg2 = ctx.createRadialGradient(rx - 7, ry - 7, 0, rx, ry, rr);
    rg2.addColorStop(0, '#cccccc'); rg2.addColorStop(0.5, '#888888'); rg2.addColorStop(1, '#333333');
    ctx.beginPath(); ctx.arc(rx, ry, rr, 0, Math.PI * 2);
    ctx.fillStyle = rg2; ctx.fill();
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2.5; ctx.stroke();
    // Highlight
    ctx.beginPath(); ctx.arc(rx - 8, ry - 8, 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fill();
  }
  ctx.restore();

  // Physical shield — left arm with big disc
  if (shieldRaise > 0.02) {
    const sa = shieldRaise;
    const sbX = CW / 2 - 180, sbY = CH + 30;
    const stX = CW / 2 - 270 + sa * 18, stY = lerp(CH + 20, CH - 195, sa);
    ctx.save(); ctx.lineCap = 'round';
    ctx.lineWidth = 58; ctx.strokeStyle = `rgba(0,0,0,${0.32 * sa})`;
    ctx.beginPath(); ctx.moveTo(sbX + 3, sbY + 3); ctx.lineTo(stX + 3, stY + 3); ctx.stroke();
    ctx.lineWidth = 54; ctx.strokeStyle = me.color;
    ctx.beginPath(); ctx.moveTo(sbX, sbY); ctx.lineTo(stX, stY); ctx.stroke();
    ctx.save(); ctx.translate(stX, stY); ctx.rotate(-0.35 + (1 - sa) * 1.1);
    const sw = 148 + sa * 34, sh = 178 + sa * 42;
    ctx.beginPath(); ctx.ellipse(0, 0, sw * 0.5, sh * 0.5, 0, 0, Math.PI * 2);
    const sdg = ctx.createRadialGradient(-sw * 0.18, -sh * 0.18, 0, 0, 0, sw * 0.65);
    sdg.addColorStop(0, `rgba(200,240,255,${0.95 * sa})`);
    sdg.addColorStop(0.5, `rgba(60,160,240,${0.8 * sa})`);
    sdg.addColorStop(1, `rgba(20,80,180,${0.55 * sa})`);
    ctx.fillStyle = sdg; ctx.fill();
    ctx.strokeStyle = `rgba(80,200,255,${sa})`; ctx.lineWidth = 3.5;
    ctx.shadowColor = 'rgba(80,200,255,0.8)'; ctx.shadowBlur = 16 * sa; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, sw * 0.3, sh * 0.3, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(220,250,255,${0.5 * sa})`; ctx.lineWidth = 1.5; ctx.shadowBlur = 0; ctx.stroke();
    // Boss emblem
    ctx.fillStyle = `rgba(255,255,255,${0.3 * sa})`;
    ctx.font = `bold ${Math.round(sw * 0.28)}px Impact, fantasy`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('★', 0, 0);
    ctx.textBaseline = 'alphabetic';
    ctx.restore(); ctx.restore();
  }
  if (shieldRaise > 0.05) {
    const eg = ctx.createRadialGradient(CW/2, CH/2, CH * 0.25, CW/2, CH/2, CH * 0.85);
    eg.addColorStop(0, 'rgba(80,200,255,0)');
    eg.addColorStop(1, `rgba(80,200,255,${0.16 * shieldRaise})`);
    ctx.fillStyle = eg; ctx.fillRect(0, 0, CW, CH);
  }

  // Kame charge orb
  if (kame.charge > 0 || kame.firing) {
    const ratio = kame.firing ? 1 : kame.charge / kame.maxCharge;
    const kcx = CW / 2 + 130, kcy = CH * 0.80, kr = 8 + ratio * 48;
    ctx.save();
    const kg = ctx.createRadialGradient(kcx, kcy, 0, kcx, kcy, kr);
    kg.addColorStop(0, `rgba(255,255,255,${ratio})`);
    kg.addColorStop(0.4, `rgba(80,200,255,${ratio * 0.85})`);
    kg.addColorStop(1, 'rgba(80,200,255,0)');
    ctx.shadowColor = 'rgba(80,200,255,0.95)'; ctx.shadowBlur = 28 * ratio;
    ctx.beginPath(); ctx.arc(kcx, kcy, kr, 0, Math.PI * 2); ctx.fillStyle = kg; ctx.fill(); ctx.restore();
    if (ratio > 0.5) {
      const ta2 = (ratio - 0.5) / 0.5;
      ctx.save(); ctx.font = `bold ${11 + ratio * 10}px sans-serif`;
      ctx.fillStyle = `rgba(255,240,80,${ta2})`; ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(80,200,255,0.9)'; ctx.shadowBlur = 10;
      ctx.fillText('CHARGING...', CW / 2, CH - 128 - ratio * 22); ctx.restore();
    }
  }
}

function drawCursor() {
  const cx = CW / 2, cy = CH / 2;
  ctx.save();
  if (isMobile) {
    // Simple white dot crosshair for mobile
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();
  } else {
    const s = 13, gap = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(cx - s, cy); ctx.lineTo(cx - gap, cy);
    ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + s, cy);
    ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy - gap);
    ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + s);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();
    if (!pointerLocked) {
      ctx.restore(); ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      roundRect(ctx, CW/2 - 138, CH/2 + 24, 276, 40, 10); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Click to capture mouse & play', CW/2, CH/2 + 49);
    }
  }
  ctx.restore();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x+r,y); c.lineTo(x+w-r,y); c.arcTo(x+w,y,x+w,y+r,r);
  c.lineTo(x+w,y+h-r); c.arcTo(x+w,y+h,x+w-r,y+h,r);
  c.lineTo(x+r,y+h); c.arcTo(x,y+h,x,y+h-r,r);
  c.lineTo(x,y+r); c.arcTo(x,y,x+r,y,r); c.closePath();
}

function drawHUD() {
  if (!serverState) return;
  const alive = serverState.players.filter(p => p.alive).length;
  const total = serverState.players.length;
  const me = serverState.players.find(p => p.id === myId);
  const myTotalKills = sessionKillCount;

  // ── Top-right: Alive counter + kill count ─────────────────────
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.65)'; roundRect(ctx, CW - 168, 10, 158, 52, 10); ctx.fill();
  ctx.fillStyle = 'orange'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`${alive} / ${total}  ALIVE`, CW - 89, 32);
  ctx.fillStyle = 'rgba(255,200,100,0.85)'; ctx.font = '12px sans-serif';
  ctx.fillText(`YOUR KILLS: ${myTotalKills}`, CW - 89, 53);
  ctx.restore();

  if (me?.alive) {
    // ── HP bar ────────────────────────────────────────────────
    const bw = 280, bh = 20, bx = CW/2 - bw/2, by = CH - 34;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; roundRect(ctx, bx - 4, by - 4, bw + 8, bh + 8, 8); ctx.fill();
    ctx.fillStyle = '#111'; ctx.fillRect(bx, by, bw, bh);
    const pct = me.hp / 75;
    const hpColor = pct > 0.6 ? '#4caf50' : pct > 0.3 ? '#ff9800' : '#f44336';
    ctx.fillStyle = hpColor;
    ctx.fillRect(bx, by, bw * pct, bh);
    // HP bar glow
    ctx.shadowColor = hpColor; ctx.shadowBlur = 8;
    ctx.strokeStyle = hpColor; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, bw, bh);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'white'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 4;
    ctx.fillText(`♥  ${me.hp} / 75`, CW/2, by + bh - 4);
    ctx.shadowBlur = 0; ctx.restore();

    // ── Kill streak ───────────────────────────────────────────
    if (myKillStreak > 0) {
      ctx.save();
      const pulse = 1 + Math.sin(Date.now() / 160) * 0.04;
      ctx.fillStyle = `rgba(255,${Math.max(50, 200 - myKillStreak * 40)},0,0.95)`;
      ctx.font = `bold ${Math.round((16 + myKillStreak * 3) * pulse)}px Impact, fantasy`;
      ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(255,80,0,0.9)'; ctx.shadowBlur = 14;
      ctx.fillText(`🔥 ${myKillStreak} KILL STREAK`, CW/2, CH - 62);
      // Streak pips
      for (let i = 0; i < 3; i++) {
        const px2 = CW/2 - 22 + i * 22, py2 = CH - 80;
        ctx.beginPath(); ctx.arc(px2, py2, 6, 0, Math.PI * 2);
        ctx.fillStyle = i < myKillStreak ? 'orange' : 'rgba(255,255,255,0.15)'; ctx.fill();
        ctx.shadowBlur = i < myKillStreak ? 8 : 0;
        ctx.strokeStyle = i < myKillStreak ? '#ffaa00' : '#333'; ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.shadowBlur = 0; ctx.restore();
    }
  }

  // ── Ammo (6 rocks) ────────────────────────────────────────────
  ctx.save();
  const ammoStartX = CW/2 + 152;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; roundRect(ctx, ammoStartX - 6, CH - 42, 6 * 22 + 4, 36, 6); ctx.fill();
  for (let i = 0; i < 6; i++) {
    const ax = ammoStartX + i * 22, ay = CH - 22;
    const full = i < myAmmo;
    ctx.beginPath(); ctx.arc(ax, ay, full ? 8 : 7, 0, Math.PI * 2);
    if (full) {
      const rg = ctx.createRadialGradient(ax - 2, ay - 2, 0, ax, ay, 8);
      rg.addColorStop(0, '#cccccc'); rg.addColorStop(1, '#555555');
      ctx.fillStyle = rg;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
    }
    ctx.fill();
    ctx.strokeStyle = full ? '#888' : 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.fillStyle = 'rgba(200,200,200,0.6)'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('AMMO', ammoStartX + 6 * 11 - 11, CH - 42 + 10);
  ctx.restore();

  // ── Cooldown ability bars (left side) — PC only ───────────────
  if (!isMobile) {
    const bars = [
      { label: 'F  LASER',   ready: kame.cooldown <= 0,
        pct: kame.cooldown <= 0 ? 1 : 1 - kame.cooldown / kame.maxCooldown,
        color: [80, 200, 255], active: kame.firing },
      { label: 'Q  SHIELD',  ready: shieldCooldown <= 0 && !shieldActive,
        pct: shieldActive ? 1 : shieldCooldown <= 0 ? 1 : 1 - shieldCooldown / 480,
        color: [100, 180, 255], active: shieldActive },
      { label: '⎵  DASH',    ready: dashCooldown <= 0,
        pct: dashCooldown <= 0 ? 1 : 1 - dashCooldown / 180,
        color: [255, 200, 80], active: false },
      { label: 'E  HEAL +10', ready: healCooldown <= 0,
        pct: healCooldown <= 0 ? 1 : 1 - healCooldown / 360,
        color: [60, 220, 100], active: false },
      { label: 'R  SHOCKWAVE', ready: shockwaveCooldown <= 0,
        pct: shockwaveCooldown <= 0 ? 1 : 1 - shockwaveCooldown / 720,
        color: [180, 100, 255], active: false },
    ];
    ctx.save();
    bars.forEach((b, i) => {
      const bx = 14, by2 = CH - 38 - (bars.length - 1 - i) * 28, bw = 140, bh = 20;
      // Background
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; roundRect(ctx, bx, by2, bw, bh, 6); ctx.fill();
      // Fill bar
      const [r2, g2, b2] = b.color;
      const barAlpha = b.ready ? 0.9 : 0.35;
      ctx.fillStyle = `rgba(${r2},${g2},${b2},${barAlpha})`;
      if (b.pct > 0) { roundRect(ctx, bx, by2, bw * b.pct, bh, 6); ctx.fill(); }
      // Glow when ready/active
      if (b.ready || b.active) {
        ctx.shadowColor = `rgba(${r2},${g2},${b2},0.8)`; ctx.shadowBlur = 10;
        ctx.strokeStyle = `rgba(${r2},${g2},${b2},0.6)`; ctx.lineWidth = 1.5;
        roundRect(ctx, bx, by2, bw, bh, 6); ctx.stroke();
        ctx.shadowBlur = 0;
      }
      // Label
      ctx.fillStyle = b.ready ? 'white' : 'rgba(255,255,255,0.45)';
      ctx.font = `bold 10px sans-serif`; ctx.textAlign = 'left';
      ctx.fillText(b.label + (b.ready ? '  ✓' : ''), bx + 8, by2 + bh - 5);
    });
    ctx.restore();
  }

  // Kill feed
  killFeed.forEach((k, i) => {
    k.timer--;
    const alpha = Math.min(1, k.timer / 40);
    ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'right';
    const tw = ctx.measureText(k.text).width;
    const rowH = 28, rowY = 54 + i * (rowH + 4);
    const bg = k.isStreak ? `rgba(60,10,0,${alpha * 0.8})`
             : k.isLeave  ? `rgba(60,0,0,${alpha * 0.75})`
             : `rgba(0,0,0,${alpha * 0.6})`;
    ctx.fillStyle = bg;
    roundRect(ctx, CW - tw - 28, rowY, tw + 18, rowH, 6); ctx.fill();
    // Coloured border left edge
    ctx.fillStyle = k.isStreak ? `rgba(255,120,0,${alpha * 0.9})`
                  : k.isLeave  ? `rgba(255,60,60,${alpha * 0.9})`
                  : `rgba(255,180,0,${alpha * 0.6})`;
    ctx.fillRect(CW - tw - 28, rowY, 3, rowH);
    ctx.fillStyle = k.isStreak ? `rgba(255,140,0,${alpha})`
                  : k.isLeave  ? `rgba(255,100,100,${alpha})`
                  : `rgba(255,230,120,${alpha})`;
    ctx.fillText(k.text, CW - 10, rowY + rowH - 8);
  });
  for (let i = killFeed.length - 1; i >= 0; i--) { if (killFeed[i].timer <= 0) killFeed.splice(i, 1); }

  // Meteor warning
  if (meteorWarning > 0) {
    const wa = Math.min(1, meteorWarning / 40) * (meteorWarning > 80 ? 1 : (meteorWarning % 20 < 10 ? 1 : 0.3));
    ctx.save(); ctx.fillStyle = `rgba(255,60,0,${wa * 0.08})`; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = `rgba(255,80,0,${wa})`; ctx.font = 'bold 22px Impact, fantasy';
    ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(255,50,0,0.9)'; ctx.shadowBlur = 12;
    ctx.fillText('☄  METEOR SHOWER  ☄', CW/2, CH * 0.15);
    ctx.shadowBlur = 0; ctx.restore();
  }

  // Respawn overlay (canvas-drawn, not HTML overlay)
  if (me && !me.alive) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = '#f44336'; ctx.font = 'bold 52px Impact, fantasy';
    ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(255,0,0,0.5)'; ctx.shadowBlur = 20;
    ctx.fillText('ELIMINATED', CW/2, CH/2 - 30);
    const sec = Math.ceil(me.respawnTimer / 60);
    ctx.fillStyle = 'white'; ctx.font = 'bold 24px sans-serif'; ctx.shadowBlur = 0;
    ctx.fillText(`Respawning in ${sec}...`, CW/2, CH/2 + 20);
    ctx.restore();
  }
}

function drawMinimap() {
  if (!serverState) return;
  const mw = 162, mh = 122;
  const mx = isMobile ? 8 : CW - 178;
  const my = isMobile ? 8 : CH - 152;
  const sx = mw / WORLD_W, sy2 = mh / WORLD_H;
  ctx.fillStyle = 'rgba(0,0,0,0.7)'; roundRect(ctx, mx-2, my-2, mw+4, mh+4, 6); ctx.fill();
  ctx.fillStyle = 'rgba(8,5,20,0.92)'; ctx.fillRect(mx, my, mw, mh);
  obstacles.forEach(obs => {
    ctx.beginPath(); ctx.arc(mx + obs.x * sx, my + obs.y * sy2, Math.max(2, obs.r * sx), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(60,65,80,0.9)'; ctx.fill();
  });
  platforms.forEach(plat => {
    ctx.beginPath(); ctx.arc(mx + plat.x * sx, my + plat.y * sy2, Math.max(2, plat.r * sx * 0.7), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(80,80,140,0.6)'; ctx.fill();
  });
  if (portal) {
    ctx.beginPath(); ctx.arc(mx + portal.x * sx, my + portal.y * sy2, Math.max(2, portal.r * sx), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(180,80,255,0.7)'; ctx.fill();
  }
  serverState.players.forEach(p => {
    if (!p.alive) return;
    const px2 = mx + p.x * sx, py2 = my + p.y * sy2;
    ctx.beginPath(); ctx.arc(px2, py2, p.id === myId ? 4.5 : 3, 0, Math.PI * 2);
    const dotClr = p.id === myId ? 'white' : (p.team === 'red' ? '#ff4444' : p.team === 'blue' ? '#4488ff' : p.color);
    ctx.fillStyle = dotClr; ctx.fill();
    if (p.id === myId) {
      ctx.save(); ctx.translate(px2, py2); ctx.rotate(p.angle);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-4, -3); ctx.lineTo(-4, 3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  });
  ctx.strokeStyle = 'rgba(100,80,200,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(mx, my, mw, mh);
  ctx.fillStyle = 'rgba(200,180,255,0.3)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('MAP', mx + 3, my + 9);
}

function drawCompass() {
  if (!serverState) return;
  const cx = CW / 2, y = 22, w = 210;
  ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(ctx, cx - w/2, y - 10, w, 20, 6); ctx.fill();
  const dirs = [{ l: 'N', a: 0 }, { l: 'E', a: Math.PI/2 }, { l: 'S', a: Math.PI }, { l: 'W', a: -Math.PI/2 }];
  dirs.forEach(d => {
    let diff = d.a - worldAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > Math.PI * 0.5) return;
    const sxd = cx + (diff / (Math.PI * 0.5)) * (w / 2);
    ctx.fillStyle = d.l === 'N' ? 'orange' : 'rgba(200,180,255,0.7)';
    ctx.font = `bold ${d.l === 'N' ? 12 : 10}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(d.l, sxd, y);
  });
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx, y - 9); ctx.lineTo(cx, y - 4); ctx.stroke();
  ctx.textBaseline = 'alphabetic'; ctx.restore();
}

function drawVignette() {
  const g = ctx.createRadialGradient(CW/2, CH/2, CH * 0.28, CW/2, CH/2, CH * 0.95);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,10,0.6)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
}

function drawHitFlash() {
  if (hitFlash < 0.01) return;
  ctx.fillStyle = `rgba(255,0,0,${hitFlash * 0.38})`;
  ctx.fillRect(0, 0, CW, CH);
  // Edge flash
  const eg = ctx.createRadialGradient(CW/2, CH/2, CH * 0.2, CW/2, CH/2, CH * 0.9);
  eg.addColorStop(0, 'rgba(255,0,0,0)'); eg.addColorStop(1, `rgba(255,0,0,${hitFlash * 0.5})`);
  ctx.fillStyle = eg; ctx.fillRect(0, 0, CW, CH);
}

// ── Hot Potato HUD (Lobby 3) ──────────────────────────────────
function drawPotatoHUD() {
  if (!isHotPotato || !serverState) return;
  const potatoTimer = serverState.potatoTimer || 0;
  const potatoActive = serverState.potatoActive;
  const me = serverState.players.find(p => p.id === myId);
  const myHasPotato = !!me?.hasPotato;

  if (!potatoActive) {
    ctx.save();
    const pulse = 1 + Math.sin(Date.now() / 300) * 0.06;
    ctx.font = `bold ${Math.round(16 * pulse)}px sans-serif`;
    ctx.fillStyle = 'rgba(255,200,80,0.75)'; ctx.textAlign = 'center';
    ctx.fillText('🥔 Next round starting…', CW / 2, 58);
    ctx.restore();
    return;
  }

  const timeFrac = Math.max(0, potatoTimer / 900); // 900 = POTATO_TIME
  const secLeft = Math.ceil(potatoTimer / 60);
  const isUrgent = potatoTimer < 240; // last 4 seconds

  const cx = CW / 2, cy = 88, r = 26;
  ctx.save();

  // Background disc
  ctx.beginPath(); ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fill();

  // Countdown ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + timeFrac * Math.PI * 2);
  const ringClr = timeFrac > 0.4 ? '#FFD700' : timeFrac > 0.2 ? '#ff8c00' : '#ff3333';
  ctx.strokeStyle = ringClr; ctx.lineWidth = 6;
  if (isUrgent) { ctx.shadowColor = '#ff3333'; ctx.shadowBlur = 14; }
  ctx.stroke(); ctx.shadowBlur = 0;

  // Timer number
  ctx.font = `bold ${Math.round(r * 0.72)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = isUrgent ? '#ff4444' : '#FFD700';
  ctx.fillText(secLeft > 0 ? secLeft : '!', cx, cy);
  ctx.textBaseline = 'alphabetic';

  // Potato emoji label
  ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,200,80,0.7)'; ctx.fillText('🥔 POTATO', cx, cy - r - 8);

  // My status
  if (myHasPotato) {
    const pulse2 = 1 + Math.sin(Date.now() / 140) * 0.07;
    ctx.font = `bold ${Math.round(13 * pulse2)}px sans-serif`;
    ctx.fillStyle = isUrgent ? '#ff4444' : '#FFD700';
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10;
    ctx.fillText('YOU HAVE IT — THROW TO PASS!', cx, cy + r + 18);
    ctx.shadowBlur = 0;
  } else {
    const holder = serverState.players.find(p => p.hasPotato);
    if (holder) {
      ctx.font = '11px sans-serif';
      ctx.fillStyle = 'rgba(255,200,120,0.65)';
      ctx.fillText(holder.name + ' has it', cx, cy + r + 18);
    }
  }
  ctx.restore();
}

// ── Team HUD (Lobby 2) ────────────────────────────────────────
function drawTeamHUD() {
  if (!isTeamLobby) return;
  const red = currentTeamKills.red || 0, blue = currentTeamKills.blue || 0;
  const W = 260, H = 48, x = CW / 2 - W / 2, y = 38; // below compass
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; roundRect(ctx, x, y, W, H, 10); ctx.fill();
  // Red side
  ctx.fillStyle = '#ff4444'; ctx.font = 'bold 22px Impact, fantasy';
  ctx.textAlign = 'center';
  ctx.fillText(`🔴 ${red}`, x + W * 0.28, y + 30);
  // vs
  ctx.fillStyle = '#aaa'; ctx.font = 'bold 14px sans-serif';
  ctx.fillText('vs', CW / 2, y + 30);
  // Blue side
  ctx.fillStyle = '#4488ff'; ctx.font = 'bold 22px Impact, fantasy';
  ctx.fillText(`${blue} 🔵`, x + W * 0.72, y + 30);
  // Round info
  ctx.fillStyle = '#888'; ctx.font = '10px sans-serif';
  ctx.fillText(`Round ${currentRound}  —  first to ${10} kills wins`, CW / 2, y + H - 5);
  ctx.restore();
  // Round-over flash
  if (roundOverFlash > 0) {
    roundOverFlash--;
    const a = Math.min(1, roundOverFlash / 40);
    const winClr = roundOverWinner === 'red' ? 'rgba(255,40,40,' : 'rgba(40,100,255,';
    ctx.save();
    ctx.fillStyle = winClr + (a * 0.22) + ')'; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = roundOverWinner === 'red' ? `rgba(255,80,80,${a})` : `rgba(80,140,255,${a})`;
    ctx.font = 'bold 56px Impact, fantasy'; ctx.textAlign = 'center';
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 28;
    const label = roundOverWinner === 'red' ? '🔴 RED WINS!' : '🔵 BLUE WINS!';
    ctx.fillText(label, CW / 2, CH / 2 - 14);
    ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.font = 'bold 20px sans-serif'; ctx.shadowBlur = 0;
    ctx.fillText('New round starting in 5 seconds…', CW / 2, CH / 2 + 28);
    ctx.restore();
  }
}

// ── Return to lobby ────────────────────────────────────────────
window.returnToLobby = function() { returnToLobby(); };
let _fullscreenDone = false;
function returnToLobby() {
  // 1. Kill render loop and clear canvas immediately — prevents frozen frame
  gameActive = false;
  ctx.clearRect(0, 0, CW, CH);

  // 2. Swap DOM immediately — no delay
  document.getElementById('game').style.display = 'none';
  document.getElementById('lobby').style.display = 'block';
  document.getElementById('bg').style.display = 'block';
  const escMenu = document.getElementById('esc-menu');
  if (escMenu) escMenu.style.display = 'none';
  escMenuOpen = false;

  // 3. Notify server
  socket.emit('leave_game');

  // 4. Release locks
  try { if (document.pointerLockElement) document.exitPointerLock(); } catch(_) {}
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen || function(){}).call(document);
    }
  } catch(_) {}
  _fullscreenDone = false;

  // 5. Reset all game state
  myId = null; serverState = null; gameOverFlag = false;
  roundOverFlash = 0; roundOverWinner = null;
  isTeamLobby = false; myTeam = null; isHotPotato = false; currentLobbyId = null;
  obstacles = []; platforms = []; portal = null; killFeed.length = 0;
  shieldRaise = 0; hitFlash = 0; meteorShake = 0; meteorWarning = 0;
  killFXParticles.length = 0; surviveStreak = 0; throwCount = 0;
  hand.state = 'idle'; hand.timer = 0;
  kame.held = false; kame.charge = 0; kame.cooldown = 0; kame.firing = false;
  Object.keys(keys).forEach(k => keys[k] = false);
  mob.joy.active = false; mob.joy.dx = 0; mob.joy.dy = 0;
  mob.cam.active = false; Object.keys(mob.btns).forEach(k => delete mob.btns[k]);

  refreshLobbies();
  startTitle();
}

// ── Kill FX ────────────────────────────────────────────────────
function spawnKillFX(wx, wy, type) {
  const count = 28;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const speed = 1.5 + Math.random() * 4;
    killFXParticles.push({
      wx, wy, wz: 18 + Math.random() * 35,
      vwx: Math.cos(angle) * speed * (Math.random() * 0.5 + 0.5),
      vwy: Math.sin(angle) * speed * (Math.random() * 0.5 + 0.5),
      vwz: 1.5 + Math.random() * 3.5,
      timer: 55 + Math.random() * 55, maxTimer: 110,
      type, size: 5 + Math.random() * 9
    });
  }
}

function drawKillFX() {
  if (!killFXParticles.length) return;
  killFXParticles.forEach(par => {
    par.wx += par.vwx; par.wy += par.vwy; par.wz += par.vwz;
    par.vwz -= 0.12; // gravity
    const proj = project(par.wx, par.wy, par.wz);
    if (!proj) return;
    const t = par.timer / par.maxTimer;
    const s = Math.max(1, par.size * proj.scale);
    ctx.save();
    ctx.globalAlpha = t;
    switch (par.type) {
      case 'fire':
        ctx.fillStyle = `hsl(${15 + t * 25}, 100%, ${45 + t * 25}%)`;
        ctx.shadowColor = 'rgba(255,80,0,0.9)'; ctx.shadowBlur = 12; break;
      case 'supernova': {
        const h = ((Date.now() / 8) + par.maxTimer - par.timer) % 360;
        ctx.fillStyle = `hsl(${h},100%,65%)`;
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 14; break;
      }
      case 'electric':
        ctx.fillStyle = t > 0.5 ? '#00ffff' : '#ffffff';
        ctx.shadowColor = 'rgba(0,220,255,0.9)'; ctx.shadowBlur = 14; break;
      case 'void':
        ctx.fillStyle = `hsl(280, 80%, ${15 + t * 35}%)`;
        ctx.shadowColor = 'rgba(120,0,255,0.9)'; ctx.shadowBlur = 14; break;
      case 'rainbow': {
        const h2 = (par.timer * 8) % 360;
        ctx.fillStyle = `hsl(${h2},100%,60%)`;
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 12; break;
      }
      case 'ice':
        ctx.fillStyle = t > 0.6 ? '#a8eeff' : '#ffffff';
        ctx.shadowColor = 'rgba(100,230,255,0.9)'; ctx.shadowBlur = 13; break;
      case 'explosion':
        ctx.fillStyle = `hsl(${20 + (1-t)*18},100%,${42+t*28}%)`;
        ctx.shadowColor = 'rgba(255,120,0,0.9)'; ctx.shadowBlur = 18; break;
      case 'portal': {
        const hp = (280 + t * 80) % 360;
        ctx.fillStyle = `hsl(${hp},90%,${48+t*20}%)`;
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 15; break;
      }
      case 'galaxy': {
        const hg2 = (par.wx * 0.8 + par.timer * 6) % 360;
        ctx.fillStyle = `hsl(${hg2},80%,${28+t*38}%)`;
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10; break;
      }
      case 'golden':
        ctx.fillStyle = `hsl(${40+t*15},100%,${48+t*22}%)`;
        ctx.shadowColor = 'rgba(255,200,0,0.9)'; ctx.shadowBlur = 16; break;
    }
    ctx.beginPath(); ctx.arc(proj.sx, proj.sy, s, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.restore();
  });
}

// ── Render loop ────────────────────────────────────────────────
function render() {
  if (!gameActive) { requestAnimationFrame(render); return; }
  if (!serverState) {
    ctx.fillStyle = '#02020f'; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = 'rgba(200,180,255,0.4)'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Connecting...', CW/2, CH/2);
    requestAnimationFrame(render); return;
  }

  // Screenshake for meteor
  let ox = 0, oy = 0;
  if (meteorShake > 0) {
    const intensity = (meteorShake / 60) * 6;
    ox = (Math.random() - 0.5) * intensity;
    oy = (Math.random() - 0.5) * intensity;
    ctx.save(); ctx.translate(ox, oy);
  }

  drawSkyAndFloor();
  drawFloorDecals();

  // Collect & sort far→near
  const objects = [];
  obstacles.forEach(obs => {
    const p = project(obs.x, obs.y, 0);
    if (p) objects.push({ type: 'obs', d: obs, zc: p.zc });
  });
  if (portal) {
    const p = project(portal.x, portal.y, 0);
    if (p) objects.push({ type: 'portal', d: portal, zc: p.zc });
  }
  if (serverState.players) serverState.players.forEach(p => {
    if (!p.alive || p.id === myId) return;
    const pr = project(p.rx, p.ry, p.rz || 0);
    if (pr) objects.push({ type: 'player', d: p, zc: pr.zc });
  });
  if (serverState.rocks) serverState.rocks.forEach(r => {
    const rz = r.z !== undefined ? r.z : 14;
    const pr = project(r.x, r.y, rz);
    if (pr) objects.push({ type: 'rock', d: r, zc: pr.zc });
  });
  // Add lanterns to depth-sorted list
  const lid = currentLobbyId || 1;
  const spots = LANTERN_SPOTS[lid] || LANTERN_SPOTS[1];
  spots.forEach(s => {
    const p = project(s.x, s.y, 82);
    if (p) objects.push({ type: 'lantern', d: s, zc: p.zc });
  });

  objects.sort((a, b) => b.zc - a.zc);
  objects.forEach(o => {
    if (o.type === 'obs')         drawObstacle3D(o.d);
    else if (o.type === 'portal') drawPortal3D();
    else if (o.type === 'player') drawPlayer3D(o.d);
    else if (o.type === 'rock')   drawRock3D(o.d);
    else if (o.type === 'lantern') drawLantern3D(o.d.x, o.d.y, lid);
  });

  drawShieldBlockFX();
  drawShockwaveFX();
  drawKillFX();
  drawBeams3D();
  drawVignette();
  drawHitFlash();
  drawHealFlash();
  drawKameText();
  drawHand();
  drawHUD();
  drawTeamHUD();
  drawPotatoHUD();
  drawCompass();
  drawMinimap();
  drawCursor();
  drawMobileControls();

  if (meteorShake > 0) ctx.restore();

  requestAnimationFrame(render);
}

render();
