// ── Settings (persist via localStorage) ──────────────────────
let SENSITIVITY = parseFloat(localStorage.getItem('ra_sens') || '0.003');
let FOCAL       = parseInt(localStorage.getItem('ra_fov')  || '500');
function updateSetting(key, val) {
  if (key === 'sens') {
    SENSITIVITY = parseFloat(val); localStorage.setItem('ra_sens', val);
    document.getElementById('sens-val').textContent = parseFloat(val).toFixed(3);
  }
  if (key === 'fov') {
    FOCAL = parseInt(val); localStorage.setItem('ra_fov', val);
    document.getElementById('fov-val').textContent = val;
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
  // Track our own kills
  const me = serverState?.players.find(p => p.id === myId);
  if (me && killer === me.name) sessionKillCount++;
});
socket.on('hit_flash', () => { hitFlash = 1.0; });
socket.on('healed', () => { healFlash = 1.0; });
socket.on('shockwave_fx', ({ x, y, r }) => {
  shockwaveFX.push({ x, y, maxR: r, timer: 40, maxTimer: 40 });
});
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
  if (e.key === 'e' || e.key === 'E') socket.emit('heal');
  if (e.key === 'r' || e.key === 'R') socket.emit('shockwave');
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
  pitchAngle += e.movementY * SENSITIVITY;
  pitchAngle = Math.max(-0.55, Math.min(0.55, pitchAngle));
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
      socket.emit('kamehameha', { angle: worldAngle, pitch: pitchAngle });
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
  shockwaveFX = shockwaveFX.filter(fx => { fx.timer--; return fx.timer > 0; });
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

// ── Space sky & void floor ─────────────────────────────────────
function drawSkyAndFloor() {
  const hy = CH / 2 - Math.tan(pitchAngle) * FOCAL + camZ * FOCAL / Math.max(1, 200);
  const clampedHy = Math.max(CH * 0.1, Math.min(CH * 0.9, hy));

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
    const r2 = Math.round(20 + 40 * l);
    const g2 = Math.round(22 + 43 * l);
    const b2 = Math.round(30 + 50 * l);
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
    const t = fx.timer / fx.maxTimer;        // 1→0 as it fades
    const prog = 1 - t;                      // 0→1 as ring expands
    const worldR = fx.maxR * prog;
    // Project the ring: sample 6 points around the circle to get screen radius
    const cp = project(fx.x, fx.y, 0);
    if (!cp) return;
    const edge = project(fx.x + worldR, fx.y, 0);
    const screenR = edge ? Math.abs(edge.sx - cp.sx) : worldR * cp.scale;
    ctx.save();
    ctx.globalAlpha = t * 0.85;
    // Outer glow ring
    ctx.beginPath(); ctx.arc(cp.sx, cp.sy, screenR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(180,120,255,0.9)'; ctx.lineWidth = Math.max(2, 6 * t);
    ctx.shadowColor = 'rgba(160,80,255,0.9)'; ctx.shadowBlur = 18 * t;
    ctx.stroke();
    // Inner fill pulse
    ctx.beginPath(); ctx.arc(cp.sx, cp.sy, screenR * 0.55, 0, Math.PI * 2);
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
      // Own kame: perspective trapezoid cone – wide at hand, converges to crosshair, fires through it
      ctx.save();
      const hx = CW / 2 + 30, hy2 = CH * 0.80;   // matches hand rest position
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
    ctx.fillText('KAMEHAMEHA!!!', CW / 2, 46); ctx.restore();
  }
}

function drawHand() {
  if (!myId || !serverState) return;
  const me = serverState.players.find(p => p.id === myId);
  if (!me || !me.alive) return;

  const rest    = { x: CW / 2 + 30,  y: CH * 0.80 };
  const windup  = { x: CW / 2 + 90,  y: CH * 0.87 };
  const throwP  = { x: CW / 2 - 40,  y: CH * 0.61 };
  const armBase = { x: CW / 2 + 42,  y: CH * 1.12 };
  const t = hand.timer / (hand.dur[hand.state] || 1);
  let hp;
  if (hand.state === 'idle')         hp = rest;
  else if (hand.state === 'windup')  hp = { x: lerp(rest.x, windup.x, t),   y: lerp(rest.y, windup.y, t) };
  else if (hand.state === 'throw')   hp = { x: lerp(windup.x, throwP.x, t), y: lerp(windup.y, throwP.y, t) };
  else                               hp = { x: lerp(throwP.x, rest.x, t),   y: lerp(throwP.y, rest.y, t) };

  ctx.save(); ctx.lineCap = 'round';
  const HR = 58;
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
  [-10, 0, 10].forEach(o => {
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hp.x - 16, hp.y + o - 4);
    ctx.quadraticCurveTo(hp.x, hp.y + o - 10, hp.x + 16, hp.y + o - 4); ctx.stroke();
  });
  if (me.ready && myAmmo > 0 && hand.state === 'idle') {
    ctx.beginPath(); ctx.arc(hp.x - 20, hp.y - HR - 8, 12, 0, Math.PI * 2);
    ctx.fillStyle = '#888'; ctx.fill(); ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(hp.x - 22, hp.y - HR - 10, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill();
  }
  ctx.restore();

  // Physical shield — left arm with big disc
  if (shieldRaise > 0.02) {
    const sa = shieldRaise;
    const sbX = CW / 2 - 110, sbY = CH + 30;
    const stX = CW / 2 - 190 + sa * 18, stY = lerp(CH + 20, CH - 195, sa);
    ctx.save(); ctx.lineCap = 'round';
    ctx.lineWidth = 54; ctx.strokeStyle = `rgba(0,0,0,${0.32 * sa})`;
    ctx.beginPath(); ctx.moveTo(sbX + 3, sbY + 3); ctx.lineTo(stX + 3, stY + 3); ctx.stroke();
    ctx.lineWidth = 50; ctx.strokeStyle = me.color;
    ctx.beginPath(); ctx.moveTo(sbX, sbY); ctx.lineTo(stX, stY); ctx.stroke();
    ctx.save(); ctx.translate(stX, stY); ctx.rotate(-0.35 + (1 - sa) * 1.1);
    const sw = 108 + sa * 24, sh = 130 + sa * 30;
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
    const kcx = CW / 2 + 30, kcy = CH * 0.80, kr = 8 + ratio * 48;
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

  // ── Cooldown ability bars (left side) ─────────────────────────
  const bars = [
    { label: 'F  KAME',    ready: kame.cooldown <= 0,
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
    if (o.type === 'obs')      drawObstacle3D(o.d);
    else if (o.type === 'portal') drawPortal3D();
    else if (o.type === 'player') drawPlayer3D(o.d);
    else if (o.type === 'rock')   drawRock3D(o.d);
  });

  drawShieldBlockFX();
  drawShockwaveFX();
  drawBeams3D();
  drawVignette();
  drawHitFlash();
  drawHealFlash();
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
