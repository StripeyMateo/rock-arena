const WORLD_W = 1600, WORLD_H = 1200;
let CW = window.innerWidth, CH = window.innerHeight;
function hsla(c, a) { return c.replace('hsl(', 'hsla(').replace(')', `,${a})`); }
function lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ── State ──────────────────────────────────────────────────────
let myId = null, serverState = null, obstacles = [];
let camX = 800, camY = 600, worldAngle = 0;
let gameActive = false, gameOverFlag = false;
const keys = { up: false, down: false, left: false, right: false };
const hand = { state: 'idle', timer: 0, rockSent: false, dur: { windup: 11, throw: 7, recover: 18 } };
const kame = { held: false, charge: 0, maxCharge: 90, cooldown: 0, maxCooldown: 480, firing: false, fireTimer: 0 };
let dashCooldown = 0, shieldCooldown = 0, shieldActive = false;
let myAmmo = 10;
const killFeed = [];
let shieldRaise = 0;

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

socket.on('joined', ({ id, obstacles: obs }) => {
  myId = id; obstacles = obs || [];
  gameActive = true;
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('game').style.display = 'block';
  document.getElementById('bg').style.display = 'none';
  stopTitle();
  resizeCanvas();
  setTimeout(() => canvas.requestPointerLock(), 100);
});
socket.on('lobby_full', () => alert('That lobby is full!'));
socket.on('kill', ({ killer, victim }) => {
  killFeed.unshift({ text: `${killer}  ›  ${victim}`, timer: 280 });
  if (killFeed.length > 5) killFeed.pop();
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
      } else { np.rx = np.x; np.ry = np.y; np.ra = np.angle; }
    });
  } else {
    newState.players.forEach(p => { p.rx = p.x; p.ry = p.y; p.ra = p.angle; });
  }
  serverState = newState;
  const me = serverState.players.find(p => p.id === myId);
  if (me) { myAmmo = me.ammo; dashCooldown = me.dashCooldown; shieldCooldown = me.shieldCooldown; shieldActive = me.shieldActive; }
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
});
document.addEventListener('keyup', e => {
  if (!gameActive) return;
  if (e.key === 'w' || e.key === 'ArrowUp')    keys.up    = false;
  if (e.key === 's' || e.key === 'ArrowDown')  keys.down  = false;
  if (e.key === 'a' || e.key === 'ArrowLeft')  keys.left  = false;
  if (e.key === 'd' || e.key === 'ArrowRight') keys.right = false;
  if (e.key === 'f' || e.key === 'F') { kame.held = false; if (!kame.firing) kame.charge = 0; }
});
const SENSITIVITY = 0.003;
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
}, 1000 / 60);

// ── 3D Projection ──────────────────────────────────────────────
const EYE_H = 55;
const FOCAL = 500;

function project(wx, wy, wz) {
  wz = wz || 0;
  const dx = wx - camX, dy = wy - camY;
  const zc = dx * Math.cos(worldAngle) + dy * Math.sin(worldAngle);
  const xc = -dx * Math.sin(worldAngle) + dy * Math.cos(worldAngle);
  if (zc < 2) return null;
  const scale = FOCAL / zc;
  return { sx: CW / 2 + xc * scale, sy: CH / 2 + (EYE_H - wz) * scale, scale, zc };
}

// ── 3D Render ──────────────────────────────────────────────────
function drawSkyAndFloor() {
  const hy = CH / 2;
  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, hy);
  sky.addColorStop(0, '#050510'); sky.addColorStop(1, '#0e1025');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, CW, hy);
  // Stars
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 60; i++) {
    const sx = ((i * 137 + worldAngle * 800) % CW + CW) % CW;
    const sy = (i * 73) % (hy - 10);
    ctx.fillRect(sx, sy, 1, 1);
  }
  // Floor
  const floor = ctx.createLinearGradient(0, hy, 0, CH);
  floor.addColorStop(0, '#0b1a08'); floor.addColorStop(1, '#040c03');
  ctx.fillStyle = floor; ctx.fillRect(0, hy, CW, CH - hy);
  // Horizon glow
  const hg = ctx.createLinearGradient(0, hy - 18, 0, hy + 18);
  hg.addColorStop(0, 'rgba(255,120,0,0)');
  hg.addColorStop(0.5, 'rgba(255,120,0,0.07)');
  hg.addColorStop(1, 'rgba(255,120,0,0)');
  ctx.fillStyle = hg; ctx.fillRect(0, hy - 18, CW, 36);
  // Floor grid converging to horizon
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 14; i++) {
    const bx = (i / 14) * CW;
    ctx.beginPath(); ctx.moveTo(bx, CH); ctx.lineTo(CW / 2, hy); ctx.stroke();
  }
  for (let d = 40; d <= 700; d += 50) {
    const sy = CH / 2 + EYE_H * FOCAL / d;
    if (sy > CH || sy < hy) continue;
    const frac = (sy - hy) / (CH - hy);
    ctx.beginPath(); ctx.moveTo(CW / 2 - frac * CW * 0.7, sy); ctx.lineTo(CW / 2 + frac * CW * 0.7, sy); ctx.stroke();
  }
  ctx.restore();
}

function drawObstacle3D(obs) {
  const OBS_H = obs.r * 2.2;
  const base = project(obs.x, obs.y, 0);
  const top  = project(obs.x, obs.y, OBS_H);
  if (!base) return;
  const sc = base.scale;
  const rw = obs.r * sc;
  const topY = top ? top.sy : base.sy - rw * 2;
  const h = base.sy - topY;

  ctx.save();
  // Shadow
  ctx.beginPath(); ctx.ellipse(base.sx, base.sy, rw * 0.95, rw * 0.28, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
  // Side body (trapezoid from base ellipse to top ellipse)
  const topRw = top ? obs.r * top.scale : rw * 0.5;
  ctx.beginPath();
  ctx.moveTo(base.sx - rw, base.sy);
  ctx.lineTo(base.sx + rw, base.sy);
  ctx.lineTo(base.sx + topRw, topY);
  ctx.lineTo(base.sx - topRw, topY);
  ctx.closePath();
  const sg = ctx.createLinearGradient(base.sx - rw, 0, base.sx + rw, 0);
  sg.addColorStop(0, '#2e2a24'); sg.addColorStop(0.4, '#5a5248'); sg.addColorStop(1, '#2a2620');
  ctx.fillStyle = sg; ctx.fill();
  // Base ellipse
  ctx.beginPath(); ctx.ellipse(base.sx, base.sy, rw, rw * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#3a3530'; ctx.fill();
  // Top cap
  ctx.beginPath(); ctx.ellipse(base.sx, topY, topRw, topRw * 0.3, 0, 0, Math.PI * 2);
  const tg = ctx.createRadialGradient(base.sx - topRw * 0.3, topY - topRw * 0.1, 0, base.sx, topY, topRw);
  tg.addColorStop(0, '#8a8070'); tg.addColorStop(1, '#4a4540');
  ctx.fillStyle = tg; ctx.fill();
  ctx.restore();
}

function drawPlayer3D(p) {
  if (!p.alive || p.id === myId) return;
  const base = project(p.rx, p.ry, 0);
  if (!base || base.zc > 1400) return;
  const sc = base.scale;
  const R = 20 * sc;
  const bodyY = base.sy - R * 1.1;

  ctx.save();
  // Ground shadow
  ctx.beginPath(); ctx.ellipse(base.sx, base.sy, R, R * 0.28, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill();

  // Shield disc on left arm
  if (p.shieldActive) {
    const sx2 = base.sx - R * 1.2, sy2 = bodyY - R * 0.1;
    ctx.beginPath(); ctx.ellipse(sx2, sy2, R * 0.65, R * 0.85, -0.25, 0, Math.PI * 2);
    const sg2 = ctx.createRadialGradient(sx2 - R * 0.2, sy2 - R * 0.2, 0, sx2, sy2, R * 0.9);
    sg2.addColorStop(0, 'rgba(160,230,255,0.9)'); sg2.addColorStop(1, 'rgba(40,120,200,0.6)');
    ctx.fillStyle = sg2; ctx.fill();
    ctx.strokeStyle = 'rgba(80,200,255,1)'; ctx.lineWidth = Math.max(1.5, sc * 2.5);
    ctx.shadowColor = 'rgba(80,200,255,0.8)'; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
  }

  // Hands
  const faceAngle = p.ra - worldAngle;
  const h1x = base.sx + Math.cos(faceAngle + 0.7) * R * 1.45;
  const h1y = bodyY + Math.sin(faceAngle + 0.7) * R * 0.5;
  const h2x = base.sx + Math.cos(faceAngle - 0.7) * R * 1.45;
  const h2y = bodyY + Math.sin(faceAngle - 0.7) * R * 0.5;
  [{ x: h1x, y: h1y }, { x: h2x, y: h2y }].forEach(h => {
    ctx.beginPath(); ctx.arc(h.x, h.y, R * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = p.color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
  });

  // Body
  ctx.beginPath(); ctx.arc(base.sx, bodyY, R, 0, Math.PI * 2);
  const bg2 = ctx.createRadialGradient(base.sx - R * 0.35, bodyY - R * 0.35, 0, base.sx, bodyY, R * 1.1);
  bg2.addColorStop(0, lighten(p.color)); bg2.addColorStop(1, darken(p.color));
  ctx.fillStyle = bg2; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = Math.max(1, sc * 2); ctx.stroke();

  // Eyes (face toward p.ra, projected into screen x only)
  const dotR = Math.max(1, R * 0.18);
  const ef = faceAngle; // face angle relative to camera
  // only draw eyes if somewhat facing camera (|ef| < PI/2 roughly)
  const eyeBaseX = base.sx + Math.cos(ef) * R * 0.45;
  const eyeBaseY = bodyY - R * 0.15;
  const eyeSpread = R * 0.35;
  [-1, 1].forEach(s => {
    const ex2 = eyeBaseX - Math.sin(ef) * eyeSpread * s;
    const ey2 = eyeBaseY;
    ctx.beginPath(); ctx.arc(ex2, ey2, dotR, 0, Math.PI * 2);
    ctx.fillStyle = '#111'; ctx.fill();
    ctx.beginPath(); ctx.arc(ex2 + dotR * 0.4, ey2 - dotR * 0.4, dotR * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill();
  });

  // Name + HP bar above
  const barW = Math.max(28, R * 3); const barH = Math.max(3, R * 0.28);
  const barX = base.sx - barW / 2; const barY2 = bodyY - R - barH - 3;
  ctx.fillStyle = '#222'; ctx.fillRect(barX, barY2, barW, barH);
  const pct = p.hp / 50;
  ctx.fillStyle = pct > 0.5 ? '#4caf50' : pct > 0.2 ? '#ff9800' : '#f44336';
  ctx.fillRect(barX, barY2, barW * pct, barH);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(barX, barY2, barW, barH);
  ctx.fillStyle = 'white'; ctx.font = `${Math.max(7, R * 0.55)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.fillText(p.name, base.sx, barY2 - 2);

  ctx.restore();
}

function drawRock3D(r) {
  const pr = project(r.x, r.y, 14);
  if (!pr || pr.zc > 1400) return;
  const rs = Math.max(2, 8 * pr.scale);
  ctx.save();
  if (r.bounces > 0) {
    ctx.beginPath(); ctx.arc(pr.sx, pr.sy, rs * (1.6 + r.bounces * 0.3), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,200,80,${Math.min(0.5, r.bounces * 0.13)})`; ctx.fill();
    ctx.shadowColor = 'rgba(255,200,80,0.9)'; ctx.shadowBlur = 8;
  }
  ctx.beginPath(); ctx.arc(pr.sx, pr.sy, rs, 0, Math.PI * 2);
  const rg = ctx.createRadialGradient(pr.sx - rs * 0.3, pr.sy - rs * 0.3, 0, pr.sx, pr.sy, rs);
  rg.addColorStop(0, r.bounces > 0 ? '#f0c060' : '#aaa');
  rg.addColorStop(1, r.bounces > 0 ? '#805010' : '#555');
  ctx.fillStyle = rg; ctx.fill();
  ctx.strokeStyle = r.bounces > 0 ? '#704010' : '#444'; ctx.lineWidth = Math.max(1, pr.scale * 1.5); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawBeams3D() {
  if (!serverState?.beams) return;
  serverState.beams.forEach(b => {
    const alpha = b.life / 30;
    const o = project(b.x, b.y, 30);
    if (!o) return;
    const ex = b.x + Math.cos(b.angle) * 3000;
    const ey2 = b.y + Math.sin(b.angle) * 3000;
    const ep = project(ex, ey2, 30);
    const esx = ep ? ep.sx : CW / 2 + Math.cos(b.angle - worldAngle + Math.PI / 2) * CW;
    const esy = ep ? ep.sy : CH / 2;
    ctx.save();
    const grad = ctx.createLinearGradient(o.sx, o.sy, esx, esy);
    grad.addColorStop(0, `rgba(80,200,255,${alpha})`);
    grad.addColorStop(0.35, `rgba(255,240,80,${alpha * 0.9})`);
    grad.addColorStop(1, `rgba(80,200,255,0)`);
    ctx.strokeStyle = grad; ctx.lineWidth = Math.max(4, 22 * alpha); ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(80,200,255,0.9)'; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.moveTo(o.sx, o.sy); ctx.lineTo(esx, esy); ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.9})`; ctx.lineWidth = 3 * alpha; ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.moveTo(o.sx, o.sy); ctx.lineTo(esx, esy); ctx.stroke();
    ctx.restore();
  });
}

// Minimal color lightening/darkening (supports #hex only; falls back gracefully)
function lighten(c) {
  if (c && c[0] === '#' && c.length >= 7) {
    const r = Math.min(255, parseInt(c.slice(1,3),16) + 60);
    const g = Math.min(255, parseInt(c.slice(3,5),16) + 60);
    const b = Math.min(255, parseInt(c.slice(5,7),16) + 60);
    return `rgb(${r},${g},${b})`;
  }
  return c;
}
function darken(c) {
  if (c && c[0] === '#' && c.length >= 7) {
    const r = Math.max(0, parseInt(c.slice(1,3),16) - 40);
    const g = Math.max(0, parseInt(c.slice(3,5),16) - 40);
    const b = Math.max(0, parseInt(c.slice(5,7),16) - 40);
    return `rgb(${r},${g},${b})`;
  }
  return c;
}

// ── Camera ─────────────────────────────────────────────────────
function updateCam() {
  if (!serverState) return;
  const me = serverState.players.find(p => p.id === myId);
  if (me) { camX = me.x; camY = me.y; }
}

// ── Screen-space overlays ──────────────────────────────────────
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
  const throwP  = { x: CW / 2 - 30,  y: CH - 160 };
  const armBase = { x: CW / 2 + 100, y: CH + 45 };
  const t = hand.timer / (hand.dur[hand.state] || 1);
  let hp;
  if (hand.state === 'idle')         hp = rest;
  else if (hand.state === 'windup')  hp = { x: lerp(rest.x, windup.x, t),   y: lerp(rest.y, windup.y, t) };
  else if (hand.state === 'throw')   hp = { x: lerp(windup.x, throwP.x, t), y: lerp(windup.y, throwP.y, t) };
  else                               hp = { x: lerp(throwP.x, rest.x, t),   y: lerp(throwP.y, rest.y, t) };

  ctx.save(); ctx.lineCap = 'round';
  ctx.lineWidth = 24; ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.moveTo(armBase.x + 3, armBase.y + 3); ctx.lineTo(hp.x + 3, hp.y + 3); ctx.stroke();
  ctx.lineWidth = 22; ctx.strokeStyle = me.color;
  ctx.beginPath(); ctx.moveTo(armBase.x, armBase.y); ctx.lineTo(hp.x, hp.y); ctx.stroke();
  ctx.beginPath(); ctx.arc(hp.x, hp.y, 20, 0, Math.PI * 2);
  ctx.fillStyle = me.color; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 3; ctx.stroke();
  [-7, 0, 7].forEach(o => {
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(hp.x - 10, hp.y + o - 3);
    ctx.quadraticCurveTo(hp.x, hp.y + o - 6, hp.x + 10, hp.y + o - 3); ctx.stroke();
  });
  if (me.ready && myAmmo > 0 && hand.state === 'idle') {
    ctx.beginPath(); ctx.arc(hp.x - 14, hp.y - 26, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#888'; ctx.fill(); ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(hp.x - 16, hp.y - 28, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill();
  }
  ctx.restore();

  // Physical shield — left arm holding a disc
  if (shieldRaise > 0.02) {
    const sa = shieldRaise;
    const sbX = CW / 2 - 110, sbY = CH + 30;
    const stX = CW / 2 - 185 + sa * 15, stY = lerp(CH + 20, CH - 200, sa);
    ctx.save(); ctx.lineCap = 'round';
    ctx.lineWidth = 20; ctx.strokeStyle = `rgba(0,0,0,${0.3 * sa})`;
    ctx.beginPath(); ctx.moveTo(sbX + 2, sbY + 2); ctx.lineTo(stX + 2, stY + 2); ctx.stroke();
    ctx.lineWidth = 18; ctx.strokeStyle = me.color;
    ctx.beginPath(); ctx.moveTo(sbX, sbY); ctx.lineTo(stX, stY); ctx.stroke();
    ctx.save(); ctx.translate(stX, stY); ctx.rotate(-0.4 + (1 - sa) * 1.1);
    const sw = 55 + sa * 18, sh = 70 + sa * 22;
    ctx.beginPath(); ctx.ellipse(0, 0, sw * 0.5, sh * 0.5, 0, 0, Math.PI * 2);
    const sdg = ctx.createRadialGradient(-sw * 0.15, -sh * 0.15, 0, 0, 0, sw * 0.65);
    sdg.addColorStop(0, `rgba(180,235,255,${0.9 * sa})`);
    sdg.addColorStop(0.55, `rgba(60,150,220,${0.75 * sa})`);
    sdg.addColorStop(1, `rgba(30,80,160,${0.5 * sa})`);
    ctx.fillStyle = sdg; ctx.fill();
    ctx.strokeStyle = `rgba(80,200,255,${sa})`; ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(80,200,255,0.75)'; ctx.shadowBlur = 14 * sa; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, sw * 0.32, sh * 0.32, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(200,245,255,${0.45 * sa})`; ctx.lineWidth = 1.5; ctx.shadowBlur = 0; ctx.stroke();
    ctx.restore(); ctx.restore();
  }
  if (shieldRaise > 0.05) {
    const eg = ctx.createRadialGradient(CW/2, CH/2, CH * 0.3, CW/2, CH/2, CH * 0.85);
    eg.addColorStop(0, 'rgba(80,200,255,0)');
    eg.addColorStop(1, `rgba(80,200,255,${0.14 * shieldRaise})`);
    ctx.fillStyle = eg; ctx.fillRect(0, 0, CW, CH);
  }

  // Kame charge orb
  if (kame.charge > 0 || kame.firing) {
    const ratio = kame.firing ? 1 : kame.charge / kame.maxCharge;
    const kcx = CW / 2 + 20, kcy = CH - 70, kr = 6 + ratio * 36;
    ctx.save();
    const kg = ctx.createRadialGradient(kcx, kcy, 0, kcx, kcy, kr);
    kg.addColorStop(0, `rgba(255,255,255,${ratio})`);
    kg.addColorStop(0.4, `rgba(80,200,255,${ratio * 0.85})`);
    kg.addColorStop(1, 'rgba(80,200,255,0)');
    ctx.shadowColor = 'rgba(80,200,255,0.95)'; ctx.shadowBlur = 25 * ratio;
    ctx.beginPath(); ctx.arc(kcx, kcy, kr, 0, Math.PI * 2); ctx.fillStyle = kg; ctx.fill(); ctx.restore();
    if (ratio > 0.5) {
      const ta2 = (ratio - 0.5) / 0.5;
      ctx.save(); ctx.font = `bold ${11 + ratio * 9}px sans-serif`;
      ctx.fillStyle = `rgba(255,240,80,${ta2})`; ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(80,200,255,0.9)'; ctx.shadowBlur = 10;
      ctx.fillText('KAME... HAME...', CW / 2, CH - 130 - ratio * 20); ctx.restore();
    }
  }
}

function drawCursor() {
  const cx = CW / 2, cy = CH / 2, s = 12, gap = 4;
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy); ctx.lineTo(cx - gap, cy);
  ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + s, cy);
  ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy - gap);
  ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + s);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill(); ctx.restore();
  if (!pointerLocked) {
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.6)';
    roundRect(ctx, CW/2 - 135, CH/2 + 22, 270, 40, 10); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Click to capture mouse & play', CW/2, CH/2 + 47); ctx.restore();
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
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(ctx, CW-122, 10, 112, 30, 8); ctx.fill();
  ctx.fillStyle = 'orange'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`${alive} / ${total} alive`, CW - 66, 30);
  if (me?.alive) {
    const bw = 200, bh = 12, bx = CW/2 - bw/2, by = CH - 22;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(ctx, bx-2, by-2, bw+4, bh+4, 6); ctx.fill();
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(bx, by, bw, bh);
    const pct = me.hp / 50;
    ctx.fillStyle = pct > 0.5 ? '#4caf50' : pct > 0.2 ? '#ff9800' : '#f44336';
    ctx.fillRect(bx, by, bw * pct, bh);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = 'white'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${me.hp} HP`, CW/2, by + bh - 1);
  }
  for (let i = 0; i < 10; i++) {
    const ax = CW/2 + 118 + i * 14, ay = CH - 16;
    ctx.beginPath(); ctx.arc(ax, ay, 5, 0, Math.PI * 2);
    ctx.fillStyle = i < myAmmo ? '#999' : 'rgba(255,255,255,0.1)'; ctx.fill();
    if (i < myAmmo) { ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.stroke(); }
  }
  const bars = [
    { label: 'F — KAME',     ready: kame.cooldown <= 0,                      pct: kame.cooldown <= 0 ? 1 : 1 - kame.cooldown / kame.maxCooldown, color: 'rgba(80,200,255,' },
    { label: 'Q — SHIELD',   ready: shieldCooldown <= 0 && !shieldActive,    pct: shieldActive ? 1 : shieldCooldown <= 0 ? 1 : 1 - shieldCooldown / 480, color: 'rgba(80,200,255,' },
    { label: 'SPACE — DASH', ready: dashCooldown <= 0,                       pct: dashCooldown <= 0 ? 1 : 1 - dashCooldown / 180, color: 'rgba(255,200,80,' },
  ];
  bars.forEach((b, i) => {
    const bx = 10, by2 = CH - 22 - (bars.length - i - 1) * 20, bw = 110, bh = 14;
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(ctx, bx, by2, bw, bh, 4); ctx.fill();
    ctx.fillStyle = b.color + (b.ready ? '0.85)' : '0.4)');
    roundRect(ctx, bx, by2, bw * b.pct, bh, 4); ctx.fill();
    ctx.fillStyle = b.ready ? 'white' : 'rgba(255,255,255,0.4)';
    ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(b.label + (b.ready ? ' ✓' : ''), bx + bw/2, by2 + bh - 3);
  });
  killFeed.forEach((k, i) => {
    k.timer--;
    const alpha = Math.min(1, k.timer / 40);
    ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
    const tw = ctx.measureText(k.text).width;
    ctx.fillStyle = `rgba(0,0,0,${alpha * 0.5})`; roundRect(ctx, CW - tw - 22, 50 + i * 22, tw + 12, 18, 4); ctx.fill();
    ctx.fillStyle = `rgba(255,220,100,${alpha})`;
    ctx.fillText(k.text, CW - 10, 63 + i * 22);
  });
  for (let i = killFeed.length - 1; i >= 0; i--) { if (killFeed[i].timer <= 0) killFeed.splice(i, 1); }
}

function drawMinimap() {
  if (!serverState) return;
  const mx = CW - 175, my = CH - 148, mw = 160, mh = 120, s = mw / WORLD_W;
  ctx.fillStyle = 'rgba(0,0,0,0.65)'; roundRect(ctx, mx-2, my-2, mw+4, mh+4, 6); ctx.fill();
  ctx.fillStyle = 'rgba(20,50,18,0.9)'; ctx.fillRect(mx, my, mw, mh);
  obstacles.forEach(obs => {
    ctx.beginPath(); ctx.arc(mx + obs.x * s, my + obs.y * (mh / WORLD_H), Math.max(2, obs.r * s), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(100,90,70,0.9)'; ctx.fill();
  });
  serverState.players.forEach(p => {
    if (!p.alive) return;
    const px2 = mx + p.x * s, py2 = my + p.y * (mh / WORLD_H);
    ctx.beginPath(); ctx.arc(px2, py2, p.id === myId ? 4.5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = p.id === myId ? 'white' : p.color; ctx.fill();
    if (p.id === myId) {
      ctx.save(); ctx.translate(px2, py2); ctx.rotate(p.angle);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-4, -3); ctx.lineTo(-4, 3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  });
  ctx.strokeStyle = 'rgba(255,165,0,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(mx, my, mw, mh);
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('MAP', mx + 3, my + 9);
}

function drawCompass() {
  if (!serverState) return;
  const cx = CW / 2, y = 22, w = 200;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  roundRect(ctx, cx - w/2, y - 10, w, 20, 6); ctx.fill();
  const dirs = [{ l: 'N', a: 0 }, { l: 'E', a: Math.PI/2 }, { l: 'S', a: Math.PI }, { l: 'W', a: -Math.PI/2 }];
  dirs.forEach(d => {
    let diff = d.a - worldAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > Math.PI * 0.5) return;
    const sx = cx + (diff / (Math.PI * 0.5)) * (w / 2);
    ctx.fillStyle = d.l === 'N' ? 'orange' : 'rgba(255,255,255,0.6)';
    ctx.font = `bold ${d.l === 'N' ? 12 : 10}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(d.l, sx, y);
  });
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx, y - 9); ctx.lineTo(cx, y - 4); ctx.stroke();
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

function drawVignette() {
  const g = ctx.createRadialGradient(CW/2, CH/2, CH * 0.3, CW/2, CH/2, CH * 0.9);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
}

function checkEnd() {
  if (!serverState || gameOverFlag) return;
  const me = serverState.players.find(p => p.id === myId);
  if (!me) return;
  const alive = serverState.players.filter(p => p.alive);
  if (!me.alive) showEnd('Eliminated!', 'Better luck next time.');
  else if (alive.length === 1 && serverState.players.length > 1 && alive[0].id === myId) showEnd('You Win!', 'Last ball standing!');
}

function showEnd(title, sub) {
  if (gameOverFlag) return;
  gameOverFlag = true;
  document.getElementById('overlay-title').textContent = title;
  document.getElementById('overlay-sub').textContent = sub;
  document.getElementById('overlay').style.display = 'flex';
  setTimeout(() => {
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('game').style.display = 'none';
    document.getElementById('lobby').style.display = 'block';
    document.getElementById('bg').style.display = 'block';
    if (document.pointerLockElement) document.exitPointerLock();
    myId = null; serverState = null; gameActive = false; gameOverFlag = false;
    obstacles = []; killFeed.length = 0; shieldRaise = 0;
    hand.state = 'idle'; hand.timer = 0;
    kame.held = false; kame.charge = 0; kame.cooldown = 0; kame.firing = false;
    Object.keys(keys).forEach(k => keys[k] = false);
    refreshLobbies(); startTitle();
  }, 3200);
}

// ── Render loop ────────────────────────────────────────────────
function render() {
  updateCam();

  if (!serverState) {
    ctx.fillStyle = '#0a0a14'; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Connecting...', CW/2, CH/2);
    requestAnimationFrame(render); return;
  }

  drawSkyAndFloor();

  // Collect & sort objects far→near (painter's algorithm)
  const objects = [];
  obstacles.forEach(obs => {
    const p = project(obs.x, obs.y, 0);
    if (p) objects.push({ type: 'obs', d: obs, zc: p.zc });
  });
  if (serverState.players) serverState.players.forEach(p => {
    if (!p.alive || p.id === myId) return;
    const pr = project(p.rx, p.ry, 0);
    if (pr) objects.push({ type: 'player', d: p, zc: pr.zc });
  });
  if (serverState.rocks) serverState.rocks.forEach(r => {
    const pr = project(r.x, r.y, 14);
    if (pr) objects.push({ type: 'rock', d: r, zc: pr.zc });
  });
  objects.sort((a, b) => b.zc - a.zc);
  objects.forEach(o => {
    if (o.type === 'obs')    drawObstacle3D(o.d);
    else if (o.type === 'player') drawPlayer3D(o.d);
    else if (o.type === 'rock')   drawRock3D(o.d);
  });

  drawBeams3D();
  drawVignette();
  drawKameText();
  drawHand();
  drawHUD();
  drawCompass();
  drawMinimap();
  drawCursor();
  checkEnd();

  requestAnimationFrame(render);
}

render();
