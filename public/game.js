// ── Settings (persist via localStorage) ──────────────────────
let SENSITIVITY = parseFloat(localStorage.getItem('ra_sens') || '0.003');
let FOCAL       = parseInt(localStorage.getItem('ra_fov')  || '500');
function updateSetting(key, val) {
  if (key === 'sens') { SENSITIVITY = parseFloat(val); localStorage.setItem('ra_sens', val); }
  if (key === 'fov')  { FOCAL = parseInt(val);         localStorage.setItem('ra_fov',  val); }
  document.getElementById('sens-val').textContent = parseFloat(val).toFixed(3);
  if (key === 'fov') document.getElementById('fov-val').textContent = val;
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
let gameActive = false, gameOverFlag = false;
const keys = { up: false, down: false, left: false, right: false };
const hand = { state: 'idle', timer: 0, rockSent: false, dur: { windup: 11, throw: 7, recover: 18 } };
const kame = { held: false, charge: 0, maxCharge: 90, cooldown: 0, maxCooldown: 480, firing: false, fireTimer: 0 };
let dashCooldown = 0, shieldCooldown = 0, shieldActive = false;
let myAmmo = 10, myHP = 75, myKillStreak = 0;
const killFeed = [];
let shieldRaise = 0;
let hitFlash = 0;
let meteorShake = 0;
let prevHP = 75;
let shieldBlockFX = [];
let meteorWarning = 0;

// ── Canvas ─────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let pointerLocked = false;

function resizeCanvas() {
  CW = window.innerWidth; CH = window.innerHeight;
  canvas.width = CW; canvas.height = CH;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

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

socket.on('joined', ({ id, obstacles: obs, platforms: plts, portal: por }) => {
  myId = id; obstacles = obs || []; platforms = plts || []; portal = por || null;
  gameActive = true;
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('game').style.display = 'block';
  document.getElementById('bg').style.display = 'none';
  stopTitle(); resizeCanvas();
  setTimeout(() => canvas.requestPointerLock(), 100);
});
socket.on('lobby_full', () => alert('That lobby is full!'));
socket.on('kill', ({ killer, victim, streak }) => {
  let msg = `${killer}  ›  ${victim}`;
  if (streak >= 2) msg += `  [${streak} streak]`;
  killFeed.unshift({ text: msg, timer: 300, isStreak: streak >= 3 });
  if (killFeed.length > 5) killFeed.pop();
});
socket.on('hit_flash', () => { hitFlash = 1.0; });
socket.on('shield_block', ({ x, y }) => {
  shieldBlockFX.push({ x, y, timer: 30 });
});
socket.on('meteor_shower', ({ shooter }) => {
  meteorShake = 60; meteorWarning = 180;
  killFeed.unshift({ text: `☄  ${shooter} called meteor shower!`, timer: 300, isStreak: true });
  if (killFeed.length > 5) killFeed.pop();
});
socket.on('portal_exit', () => returnToLobby());

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
  const me = serverState.players.find(p => p.id === myId);
  if (me) {
    prevHP = myHP;
    myAmmo = me.ammo; dashCooldown = me.dashCooldown;
    shieldCooldown = me.shieldCooldown; shieldActive = me.shieldActive;
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
document.querySelectorAll('.lobby-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('full')) return;
    socket.emit('join', {
      lobby: parseInt(btn.dataset.lobby),
      name: document.getElementById('name-input').value.trim() || 'Player',
      color: document.getElementById('color-pick').value
    });
  });
});

// ── Input ──────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (!gameActive) return;
  if (e.key === 'w' || e.key === 'ArrowUp')    keys.up    = true;
  if (e.key === 's' || e.key === 'ArrowDown')  keys.down  = true;
  if (e.key === 'a' || e.key === 'ArrowLeft')  keys.left  = true;
  if (e.key === 'd' || e.key === 'ArrowRight') keys.right = true;
  if (e.key === 'f' || e.key === 'F') kame.held = true;
  if (e.key === ' ') { e.preventDefault(); socket.emit('dash'); }
  if (e.key === 'q' || e.key === 'Q') socket.emit('shield');
  if (e.key === 'e' || e.key === 'E') socket.emit('jump');
});
document.addEventListener('keyup', e => {
  if (!gameActive) return;
  if (e.key === 'w' || e.key === 'ArrowUp')    keys.up    = false;
  if (e.key === 's' || e.key === 'ArrowDown')  keys.down  = false;
  if (e.key === 'a' || e.key === 'ArrowLeft')  keys.left  = false;
  if (e.key === 'd' || e.key === 'ArrowRight') keys.right = false;
  if (e.key === 'f' || e.key === 'F') { kame.held = false; if (!kame.firing) kame.charge = 0; }
});
canvas.addEventListener('click', () => { if (gameActive) canvas.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => { pointerLocked = document.pointerLockElement === canvas; });
document.addEventListener('mousemove', e => {
  if (!gameActive || !pointerLocked) return;
  worldAngle += e.movementX * SENSITIVITY;
});
canvas.addEventListener('mousedown', e => {
  if (e.button !== 2 || !gameActive || !myId || !serverState) return;
  const me = serverState.players.find(p => p.id === myId);
  if (me && me.alive && me.ready && hand.state === 'idle' && myAmmo > 0) {
    hand.state = 'windup'; hand.timer = 0; hand.rockSent = false;
  }
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ── Game tick ──────────────────────────────────────────────────
setInterval(() => {
  if (!myId || !gameActive) return;
  socket.emit('input', { keys, angle: worldAngle });
  if (kame.held && kame.cooldown === 0 && !kame.firing) {
    kame.charge++;
    if (kame.charge >= kame.maxCharge) {
      kame.held = false; kame.charge = 0;
      kame.cooldown = kame.maxCooldown; kame.firing = true; kame.fireTimer = 40;
      socket.emit('kamehameha', { angle: worldAngle });
    }
  }
  if (kame.cooldown > 0) kame.cooldown--;
  if (kame.firing) { kame.fireTimer--; if (kame.fireTimer <= 0) kame.firing = false; }
  if (hand.state !== 'idle') {
    hand.timer++;
    if (hand.state === 'throw' && hand.timer === 4 && !hand.rockSent) {
      hand.rockSent = true; socket.emit('throw', { angle: worldAngle });
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
  if (meteorWarning > 0) meteorWarning--;
  shieldBlockFX = shieldBlockFX.filter(fx => { fx.timer--; return fx.timer > 0; });
  if (hitFlash > 0) hitFlash *= 0.82;
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
  return { sx: CW / 2 + xc * sc, sy: CH / 2 + (eyeZ - wz) * sc, scale: sc, zc };
}

// ── Space sky & void floor ─────────────────────────────────────
function drawSkyAndFloor() {
  const hy = CH / 2 + camZ * FOCAL / Math.max(1, 200); // horizon shifts with height
  const clampedHy = Math.max(CH * 0.15, Math.min(CH * 0.85, hy));

  // Deep space sky
  ctx.fillStyle = '#02020f'; ctx.fillRect(0, 0, CW, clampedHy);
  // Nebula glow
  const neb = ctx.createRadialGradient(CW * 0.6, clampedHy * 0.4, 0, CW * 0.6, clampedHy * 0.4, CW * 0.5);
  neb.addColorStop(0, 'rgba(80,20,120,0.18)'); neb.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = neb; ctx.fillRect(0, 0, CW, clampedHy);
  const neb2 = ctx.createRadialGradient(CW * 0.2, clampedHy * 0.7, 0, CW * 0.2, clampedHy * 0.7, CW * 0.35);
  neb2.addColorStop(0, 'rgba(20,60,120,0.14)'); neb2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = neb2; ctx.fillRect(0, 0, CW, clampedHy);

  // Procedural stars (deterministic based on worldAngle bucket)
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 120; i++) {
    const sx = ((i * 173 + Math.floor(worldAngle * 80) * 37) % (CW * 10) + CW * 10) % (CW * 10) / 10;
    const sy = (i * 71) % (clampedHy - 4) + 2;
    const sz = (i % 3 === 0) ? 1.5 : (i % 7 === 0) ? 1 : 0.5;
    ctx.globalAlpha = 0.4 + (i % 5) * 0.12;
    ctx.fillRect(sx, sy, sz, sz);
  }
  ctx.globalAlpha = 1;

  // Void floor (dark asteroid field texture)
  const floor = ctx.createLinearGradient(0, clampedHy, 0, CH);
  floor.addColorStop(0, '#0a0812'); floor.addColorStop(1, '#04030a');
  ctx.fillStyle = floor; ctx.fillRect(0, clampedHy, CW, CH - clampedHy);

  // Horizon atmospheric glow
  const hg = ctx.createLinearGradient(0, clampedHy - 12, 0, clampedHy + 16);
  hg.addColorStop(0, 'rgba(80,40,160,0)');
  hg.addColorStop(0.5, 'rgba(100,50,180,0.12)');
  hg.addColorStop(1, 'rgba(80,40,160,0)');
  ctx.fillStyle = hg; ctx.fillRect(0, clampedHy - 12, CW, 28);

  // Floor grid
  ctx.save(); ctx.strokeStyle = 'rgba(80,50,130,0.08)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 16; i++) {
    const bx = (i / 16) * CW;
    ctx.beginPath(); ctx.moveTo(bx, CH); ctx.lineTo(CW / 2, clampedHy); ctx.stroke();
  }
  for (let d = 30; d <= 800; d += 55) {
    const sy2 = clampedHy + (EYE_H + camZ) * FOCAL / d;
    if (sy2 > CH || sy2 < clampedHy) continue;
    const frac = (sy2 - clampedHy) / (CH - clampedHy);
    ctx.beginPath(); ctx.moveTo(CW/2 - frac * CW * 0.75, sy2); ctx.lineTo(CW/2 + frac * CW * 0.75, sy2); ctx.stroke();
  }
  ctx.restore();
}

// ── Stone pillar obstacles ─────────────────────────────────────
function drawObstacle3D(obs) {
  const OBS_H = obs.r * 2.4;
  const base = project(obs.x, obs.y, 0);
  const top  = project(obs.x, obs.y, OBS_H);
  if (!base || base.zc > 1500) return;
  const sc = base.scale;
  const rw = obs.r * sc;
  const topRw = top ? obs.r * top.scale : rw * 0.5;
  const topY = top ? top.sy : base.sy - rw * 2.2;

  ctx.save();
  // Shadow
  ctx.beginPath(); ctx.ellipse(base.sx, base.sy, rw * 0.9, rw * 0.25, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fill();

  // Stone side body
  ctx.beginPath();
  ctx.moveTo(base.sx - rw, base.sy);
  ctx.lineTo(base.sx + rw, base.sy);
  ctx.lineTo(base.sx + topRw, topY);
  ctx.lineTo(base.sx - topRw, topY);
  ctx.closePath();
  const sg = ctx.createLinearGradient(base.sx - rw, 0, base.sx + rw, 0);
  sg.addColorStop(0, '#252830'); sg.addColorStop(0.35, '#3d4050'); sg.addColorStop(0.65, '#353840'); sg.addColorStop(1, '#1e2028');
  ctx.fillStyle = sg; ctx.fill();
  // Stone edge lines (cracks)
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.8;
  const cx2 = base.sx, midY = (base.sy + topY) / 2;
  ctx.beginPath(); ctx.moveTo(cx2 - rw * 0.15, midY + rw * 0.2); ctx.lineTo(cx2 + rw * 0.1, midY - rw * 0.1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx2 + rw * 0.25, midY + rw * 0.3); ctx.lineTo(cx2 + rw * 0.35, midY - rw * 0.15); ctx.stroke();

  // Top cap
  ctx.beginPath(); ctx.ellipse(base.sx, topY, topRw, topRw * 0.28, 0, 0, Math.PI * 2);
  const tg = ctx.createRadialGradient(base.sx - topRw * 0.3, topY, 0, base.sx, topY, topRw);
  tg.addColorStop(0, '#5a5e68'); tg.addColorStop(1, '#2e3038');
  ctx.fillStyle = tg; ctx.fill();
  ctx.strokeStyle = '#1e2028'; ctx.lineWidth = 1; ctx.stroke();

  // Moss/glow at base
  ctx.beginPath(); ctx.ellipse(base.sx, base.sy, rw, rw * 0.25, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(60,90,180,0.12)'; ctx.fill();
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

  // Shield disc (large, held in front-left)
  if (p.shieldActive) {
    const shX = base.sx - R * 1.4, shY = bodyY - R * 0.1;
    ctx.beginPath(); ctx.ellipse(shX, shY, R * 0.85, R * 1.1, -0.2, 0, Math.PI * 2);
    const shg = ctx.createRadialGradient(shX - R * 0.2, shY - R * 0.2, 0, shX, shY, R * 1.1);
    shg.addColorStop(0, 'rgba(200,240,255,0.95)');
    shg.addColorStop(0.5, 'rgba(60,160,240,0.8)');
    shg.addColorStop(1, 'rgba(20,80,180,0.5)');
    ctx.fillStyle = shg; ctx.fill();
    ctx.strokeStyle = 'rgba(80,200,255,1)'; ctx.lineWidth = Math.max(1.5, sc * 2.5);
    ctx.shadowColor = 'rgba(80,200,255,0.9)'; ctx.shadowBlur = 14; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(shX, shY, R * 0.5, R * 0.65, -0.2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(200,240,255,0.4)'; ctx.lineWidth = 1; ctx.shadowBlur = 0; ctx.stroke();
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

  // Name + HP bar
  const bw = Math.max(30, R * 3.2), bh = Math.max(3, R * 0.28);
  const bx = base.sx - bw / 2, by2 = bodyY - R - bh - 4;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx - 1, by2 - 1, bw + 2, bh + 2);
  const pct = p.hp / 75;
  ctx.fillStyle = pct > 0.5 ? '#4caf50' : pct > 0.25 ? '#ff9800' : '#f44336';
  ctx.fillRect(bx, by2, bw * pct, bh);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(bx, by2, bw, bh);
  ctx.fillStyle = 'white'; ctx.font = `${Math.max(7, R * 0.58)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.fillText(p.name, base.sx, by2 - 2);

  ctx.restore();
}

// ── Rocks ──────────────────────────────────────────────────────
function drawRock3D(r) {
  const rz = r.z !== undefined ? r.z : 14;
  const pr = project(r.x, r.y, rz);
  if (!pr || pr.zc > 1500) return;
  const rs = Math.max(2, 8 * pr.scale);
  ctx.save();
  if (r.isMeteor) {
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
      // My own kame: screen-space blast from screen center
      ctx.save();
      const bLen = Math.max(CW, CH) * 1.5;
      const grad = ctx.createLinearGradient(CW/2, CH/2, CW/2 + bLen, CH/2);
      grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
      grad.addColorStop(0.15, `rgba(80,200,255,${alpha * 0.9})`);
      grad.addColorStop(0.5, `rgba(255,240,80,${alpha * 0.6})`);
      grad.addColorStop(1, 'rgba(80,200,255,0)');
      ctx.strokeStyle = grad; ctx.lineWidth = 28 * alpha; ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(80,200,255,0.95)'; ctx.shadowBlur = 30;
      ctx.beginPath(); ctx.moveTo(CW/2, CH/2); ctx.lineTo(CW/2 + bLen, CH/2); ctx.stroke();
      // Screen flash
      ctx.fillStyle = `rgba(80,200,255,${alpha * 0.08})`;
      ctx.fillRect(0, 0, CW, CH);
      ctx.shadowBlur = 0; ctx.restore();
      return;
    }

    const o = project(b.x, b.y, bz);
    if (!o) return;
    const farX = b.x + Math.cos(b.angle) * 3000;
    const farY = b.y + Math.sin(b.angle) * 3000;
    const fp = project(farX, farY, bz);
    let esx, esy;
    if (fp && fp.zc > 0) { esx = fp.sx; esy = fp.sy; }
    else {
      const rel = b.angle - worldAngle;
      esx = o.sx + Math.sin(rel) * CW * 1.5;
      esy = o.sy - Math.cos(rel) * CH;
    }
    const lw = Math.min(32, Math.max(3, 20 * alpha * Math.sqrt(Math.min(o.scale, 2))));
    ctx.save();
    const grad2 = ctx.createLinearGradient(o.sx, o.sy, esx, esy);
    grad2.addColorStop(0, `rgba(255,255,255,${alpha})`);
    grad2.addColorStop(0.12, `rgba(80,200,255,${alpha * 0.95})`);
    grad2.addColorStop(0.45, `rgba(255,240,80,${alpha * 0.7})`);
    grad2.addColorStop(1, 'rgba(80,200,255,0)');
    ctx.strokeStyle = grad2; ctx.lineWidth = lw; ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(80,200,255,0.9)'; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.moveTo(o.sx, o.sy); ctx.lineTo(esx, esy); ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.85})`; ctx.lineWidth = lw * 0.22; ctx.shadowBlur = 0;
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
    ctx.fillText('KAMEHAMEHA!!!', CW / 2, 46); ctx.restore();
  }
}

function drawHand() {
  if (!myId || !serverState) return;
  const me = serverState.players.find(p => p.id === myId);
  if (!me || !me.alive) return;

  const rest    = { x: CW / 2 + 80,  y: CH - 80 };
  const windup  = { x: CW / 2 + 150, y: CH - 38 };
  const throwP  = { x: CW / 2 - 30,  y: CH - 165 };
  const armBase = { x: CW / 2 + 100, y: CH + 45 };
  const t = hand.timer / (hand.dur[hand.state] || 1);
  let hp;
  if (hand.state === 'idle')         hp = rest;
  else if (hand.state === 'windup')  hp = { x: lerp(rest.x, windup.x, t),   y: lerp(rest.y, windup.y, t) };
  else if (hand.state === 'throw')   hp = { x: lerp(windup.x, throwP.x, t), y: lerp(windup.y, throwP.y, t) };
  else                               hp = { x: lerp(throwP.x, rest.x, t),   y: lerp(throwP.y, rest.y, t) };

  ctx.save(); ctx.lineCap = 'round';
  ctx.lineWidth = 26; ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.moveTo(armBase.x + 3, armBase.y + 3); ctx.lineTo(hp.x + 3, hp.y + 3); ctx.stroke();
  ctx.lineWidth = 24; ctx.strokeStyle = me.color;
  ctx.beginPath(); ctx.moveTo(armBase.x, armBase.y); ctx.lineTo(hp.x, hp.y); ctx.stroke();
  ctx.beginPath(); ctx.arc(hp.x, hp.y, 22, 0, Math.PI * 2);
  ctx.fillStyle = me.color; ctx.fill();
  ctx.globalCompositeOperation = 'screen';
  const hl = ctx.createRadialGradient(hp.x - 7, hp.y - 7, 0, hp.x, hp.y, 22);
  hl.addColorStop(0, 'rgba(255,255,255,0.3)'); hl.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath(); ctx.arc(hp.x, hp.y, 22, 0, Math.PI * 2); ctx.fillStyle = hl; ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 3; ctx.stroke();
  [-7, 0, 7].forEach(o => {
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(hp.x - 11, hp.y + o - 3);
    ctx.quadraticCurveTo(hp.x, hp.y + o - 7, hp.x + 11, hp.y + o - 3); ctx.stroke();
  });
  if (me.ready && myAmmo > 0 && hand.state === 'idle') {
    ctx.beginPath(); ctx.arc(hp.x - 14, hp.y - 28, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#888'; ctx.fill(); ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(hp.x - 16, hp.y - 30, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill();
  }
  ctx.restore();

  // Physical shield — left arm with big disc
  if (shieldRaise > 0.02) {
    const sa = shieldRaise;
    const sbX = CW / 2 - 110, sbY = CH + 30;
    const stX = CW / 2 - 190 + sa * 18, stY = lerp(CH + 20, CH - 195, sa);
    ctx.save(); ctx.lineCap = 'round';
    ctx.lineWidth = 22; ctx.strokeStyle = `rgba(0,0,0,${0.3 * sa})`;
    ctx.beginPath(); ctx.moveTo(sbX + 2, sbY + 2); ctx.lineTo(stX + 2, stY + 2); ctx.stroke();
    ctx.lineWidth = 20; ctx.strokeStyle = me.color;
    ctx.beginPath(); ctx.moveTo(sbX, sbY); ctx.lineTo(stX, stY); ctx.stroke();
    ctx.save(); ctx.translate(stX, stY); ctx.rotate(-0.35 + (1 - sa) * 1.1);
    const sw = 72 + sa * 22, sh = 90 + sa * 28;
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
    const kcx = CW / 2 + 22, kcy = CH - 72, kr = 6 + ratio * 40;
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
      ctx.fillText('KAME... HAME...', CW / 2, CH - 128 - ratio * 22); ctx.restore();
    }
  }
}

function drawCursor() {
  const cx = CW / 2, cy = CH / 2, s = 13, gap = 5;
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy); ctx.lineTo(cx - gap, cy);
  ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + s, cy);
  ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy - gap);
  ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + s);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill(); ctx.restore();
  if (!pointerLocked) {
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.65)';
    roundRect(ctx, CW/2 - 138, CH/2 + 24, 276, 40, 10); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Click to capture mouse & play', CW/2, CH/2 + 49); ctx.restore();
  }
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

  // Alive counter
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; roundRect(ctx, CW-126, 10, 116, 32, 8); ctx.fill();
  ctx.fillStyle = 'orange'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`${alive} / ${total} alive`, CW - 68, 31);

  if (me?.alive) {
    // HP bar
    const bw = 200, bh = 13, bx = CW/2 - bw/2, by = CH - 22;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; roundRect(ctx, bx-2, by-2, bw+4, bh+4, 6); ctx.fill();
    ctx.fillStyle = '#0e0e0e'; ctx.fillRect(bx, by, bw, bh);
    const pct = me.hp / 75;
    ctx.fillStyle = pct > 0.5 ? '#4caf50' : pct > 0.25 ? '#ff9800' : '#f44336';
    ctx.fillRect(bx, by, bw * pct, bh);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = 'white'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${me.hp} / 75 HP`, CW/2, by + bh - 1);

    // Kill streak display
    if (myKillStreak > 0) {
      const sc2 = Math.min(3, myKillStreak);
      ctx.save();
      ctx.fillStyle = `rgba(255,${Math.max(60, 200 - myKillStreak * 40)},0,0.92)`;
      ctx.font = `bold ${14 + myKillStreak * 2}px Impact, fantasy`;
      ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(255,80,0,0.8)'; ctx.shadowBlur = 10;
      ctx.fillText(`${myKillStreak} KILL STREAK`, CW/2, CH - 42);
      ctx.shadowBlur = 0; ctx.restore();
    }
  }

  // Ammo
  for (let i = 0; i < 10; i++) {
    const ax = CW/2 + 118 + i * 14, ay = CH - 16;
    ctx.beginPath(); ctx.arc(ax, ay, 5, 0, Math.PI * 2);
    ctx.fillStyle = i < myAmmo ? '#888' : 'rgba(255,255,255,0.08)'; ctx.fill();
    if (i < myAmmo) { ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.stroke(); }
  }

  // Cooldown bars
  const bars = [
    { label: 'F — KAME',     ready: kame.cooldown <= 0,               pct: kame.cooldown <= 0 ? 1 : 1 - kame.cooldown / kame.maxCooldown, color: 'rgba(80,200,255,' },
    { label: 'Q — SHIELD',   ready: shieldCooldown <= 0 && !shieldActive, pct: shieldActive ? 1 : shieldCooldown <= 0 ? 1 : 1 - shieldCooldown / 480, color: 'rgba(80,200,255,' },
    { label: 'SPACE — DASH', ready: dashCooldown <= 0,                pct: dashCooldown <= 0 ? 1 : 1 - dashCooldown / 180, color: 'rgba(255,200,80,' },
    { label: 'E — JUMP',     ready: true,                             pct: 1, color: 'rgba(150,255,150,' },
  ];
  bars.forEach((b, i) => {
    const bx = 10, by2 = CH - 22 - (bars.length - i - 1) * 20, bw = 110, bh = 14;
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(ctx, bx, by2, bw, bh, 4); ctx.fill();
    ctx.fillStyle = b.color + (b.ready ? '0.85)' : '0.38)');
    roundRect(ctx, bx, by2, bw * b.pct, bh, 4); ctx.fill();
    ctx.fillStyle = b.ready ? 'white' : 'rgba(255,255,255,0.4)';
    ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(b.label + (b.ready ? ' ✓' : ''), bx + bw/2, by2 + bh - 3);
  });

  // Kill feed
  killFeed.forEach((k, i) => {
    k.timer--;
    const alpha = Math.min(1, k.timer / 40);
    ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
    const tw = ctx.measureText(k.text).width;
    const bg = k.isStreak ? `rgba(60,10,0,${alpha * 0.7})` : `rgba(0,0,0,${alpha * 0.5})`;
    ctx.fillStyle = bg; roundRect(ctx, CW - tw - 24, 50 + i * 23, tw + 14, 19, 4); ctx.fill();
    ctx.fillStyle = k.isStreak ? `rgba(255,120,0,${alpha})` : `rgba(255,220,100,${alpha})`;
    ctx.fillText(k.text, CW - 10, 64 + i * 23);
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
  const mx = CW - 178, my = CH - 152, mw = 162, mh = 122;
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
    ctx.fillStyle = p.id === myId ? 'white' : p.color; ctx.fill();
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

// ── Return to lobby ────────────────────────────────────────────
function returnToLobby() {
  document.getElementById('game').style.display = 'none';
  document.getElementById('lobby').style.display = 'block';
  document.getElementById('bg').style.display = 'block';
  if (document.pointerLockElement) document.exitPointerLock();
  myId = null; serverState = null; gameActive = false; gameOverFlag = false;
  obstacles = []; platforms = []; portal = null; killFeed.length = 0;
  shieldRaise = 0; hitFlash = 0; meteorShake = 0; meteorWarning = 0;
  hand.state = 'idle'; hand.timer = 0;
  kame.held = false; kame.charge = 0; kame.cooldown = 0; kame.firing = false;
  Object.keys(keys).forEach(k => keys[k] = false);
  refreshLobbies(); startTitle();
}

// ── Render loop ────────────────────────────────────────────────
function render() {
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

  // Collect & sort far→near
  const objects = [];
  platforms.forEach(pl => {
    const p = project(pl.x, pl.y, pl.h);
    if (p) objects.push({ type: 'platform', d: pl, zc: p.zc });
  });
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
  objects.sort((a, b) => b.zc - a.zc);
  objects.forEach(o => {
    if (o.type === 'platform') drawPlatform3D(o.d);
    else if (o.type === 'obs')    drawObstacle3D(o.d);
    else if (o.type === 'portal') drawPortal3D();
    else if (o.type === 'player') drawPlayer3D(o.d);
    else if (o.type === 'rock')   drawRock3D(o.d);
  });

  drawShieldBlockFX();
  drawBeams3D();
  drawVignette();
  drawHitFlash();
  drawKameText();
  drawHand();
  drawHUD();
  drawCompass();
  drawMinimap();
  drawCursor();

  if (meteorShake > 0) ctx.restore();

  requestAnimationFrame(render);
}

render();
