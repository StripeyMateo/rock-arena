const WORLD_W = 1600, WORLD_H = 1200;
const CW = 900, CH = 620;
function hsla(c, a) { return c.replace('hsl(', 'hsla(').replace(')', `,${a})`); }
function lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ── State ─────────────────────────────────────────────────────
let myId = null, serverState = null, obstacles = [];
let camX = 800, camY = 600, worldAngle = 0;
let mouseX = CW / 2, mouseY = CH / 2, mouseAngle = 0;
let gameActive = false, gameOverFlag = false;
const keys = { up: false, down: false, left: false, right: false };

const hand = { state: 'idle', timer: 0, rockSent: false, dur: { windup: 11, throw: 7, recover: 18 } };
const kame = { held: false, charge: 0, maxCharge: 90, cooldown: 0, maxCooldown: 480, firing: false, fireTimer: 0 };
let dashCooldown = 0, shieldCooldown = 0, shieldActive = false;
let myAmmo = 10;
const killFeed = [];

// ── Canvas ────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// ── Title screen ──────────────────────────────────────────────
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
    const px = -Math.sin(b.eyeAngle), py = Math.cos(b.eyeAngle);
    bgCtx.fillStyle = hsla(b.color, 0.44);
    [1, -1].forEach(s => {
      bgCtx.beginPath();
      bgCtx.arc(b.x + ex * b.r * 0.5 + px * b.r * 0.28 * s, b.y + ey * b.r * 0.5 + py * b.r * 0.28 * s, b.r * 0.18, 0, Math.PI * 2);
      bgCtx.fill();
    });
  });
  requestAnimationFrame(animateTitle);
}
function startTitle() { titleRunning = true; animateTitle(); }
function stopTitle() { titleRunning = false; }
startTitle();

// ── Socket ────────────────────────────────────────────────────
const socket = io();

socket.on('joined', ({ id, obstacles: obs }) => {
  myId = id; obstacles = obs || [];
  gameActive = true;
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('game').style.display = 'block';
  stopTitle();
});
socket.on('lobby_full', () => alert('That lobby is full!'));
socket.on('kill', ({ killer, victim }) => {
  killFeed.unshift({ text: `${killer}  ›  ${victim}`, timer: 280 });
  if (killFeed.length > 5) killFeed.pop();
});

// Interpolate other players' positions on state update
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
      } else {
        np.rx = np.x; np.ry = np.y; np.ra = np.angle;
      }
    });
  } else {
    newState.players.forEach(p => { p.rx = p.x; p.ry = p.y; p.ra = p.angle; });
  }
  serverState = newState;
  const me = serverState.players.find(p => p.id === myId);
  if (me) {
    myAmmo = me.ammo;
    dashCooldown = me.dashCooldown;
    shieldCooldown = me.shieldCooldown;
    shieldActive = me.shieldActive;
  }
});

// ── Lobby ─────────────────────────────────────────────────────
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

// ── Input ─────────────────────────────────────────────────────
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
canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouseX = e.clientX - r.left; mouseY = e.clientY - r.top;
});
canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (!gameActive || !myId || !serverState) return;
  const me = serverState.players.find(p => p.id === myId);
  if (me && me.alive && me.ready && hand.state === 'idle' && myAmmo > 0) {
    hand.state = 'windup'; hand.timer = 0; hand.rockSent = false;
  }
});

// ── Game loop ─────────────────────────────────────────────────
setInterval(() => {
  if (!myId || !gameActive) return;

  // Mouse angle from player screen center
  const sx = CW / 2, sy = CH / 2;
  mouseAngle = Math.atan2(mouseY - sy, mouseX - sx);
  worldAngle = mouseAngle; // world rotates instantly with mouse

  socket.emit('input', { keys, angle: mouseAngle });

  // Kamehameha
  if (kame.held && kame.cooldown === 0 && !kame.firing) {
    kame.charge++;
    if (kame.charge >= kame.maxCharge) {
      kame.held = false; kame.charge = 0;
      kame.cooldown = kame.maxCooldown;
      kame.firing = true; kame.fireTimer = 40;
      socket.emit('kamehameha', { angle: mouseAngle });
    }
  }
  if (kame.cooldown > 0) kame.cooldown--;
  if (kame.firing) { kame.fireTimer--; if (kame.fireTimer <= 0) kame.firing = false; }

  // Hand animation
  if (hand.state !== 'idle') {
    hand.timer++;
    if (hand.state === 'throw' && hand.timer === 4 && !hand.rockSent) {
      hand.rockSent = true;
      socket.emit('throw', { angle: mouseAngle });
    }
    if (hand.timer >= hand.dur[hand.state]) {
      hand.timer = 0;
      if (hand.state === 'windup') hand.state = 'throw';
      else if (hand.state === 'throw') hand.state = 'recover';
      else hand.state = 'idle';
    }
  }
}, 1000 / 60);

// ── Camera ────────────────────────────────────────────────────
function updateCam() {
  if (!serverState) return;
  const me = serverState.players.find(p => p.id === myId);
  if (me) { camX = me.x; camY = me.y; }
}

// Apply world-space transform (call ctx.save() before, ctx.restore() after)
function applyWorldTransform() {
  ctx.translate(CW / 2, CH / 2);
  ctx.rotate(-worldAngle - Math.PI / 2);
  ctx.translate(-camX, -camY);
}

// Draw text/UI at a world position counter-rotated so it's always readable
function atWorld(wx, wy, fn) {
  ctx.save();
  ctx.translate(wx, wy);
  ctx.rotate(worldAngle + Math.PI / 2);
  fn();
  ctx.restore();
}

// ── Draw world ────────────────────────────────────────────────
function drawArena() {
  // Out-of-bounds dark fill
  ctx.fillStyle = '#06100a';
  ctx.fillRect(-2000, -2000, WORLD_W + 4000, WORLD_H + 4000);

  // Arena floor with zone tinting
  ctx.fillStyle = '#1a3a18';
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // Center zone highlight
  const cg = ctx.createRadialGradient(800, 600, 0, 800, 600, 420);
  cg.addColorStop(0, 'rgba(255,165,0,0.04)');
  cg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = cg; ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1;
  for (let x = 0; x <= WORLD_W; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); ctx.stroke(); }
  for (let y = 0; y <= WORLD_H; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke(); }

  // Border
  ctx.strokeStyle = 'rgba(255,165,0,0.7)'; ctx.lineWidth = 5;
  ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
  ctx.strokeStyle = 'rgba(255,165,0,0.2)'; ctx.lineWidth = 20;
  ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
}

function drawObstacles() {
  obstacles.forEach(obs => {
    // Shadow
    ctx.beginPath(); ctx.ellipse(obs.x, obs.y + obs.r * 0.3 + 5, obs.r * 0.8, obs.r * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
    // Rock body
    ctx.beginPath(); ctx.arc(obs.x, obs.y, obs.r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(obs.x - obs.r * 0.3, obs.y - obs.r * 0.3, 0, obs.x, obs.y, obs.r);
    g.addColorStop(0, '#7a7060'); g.addColorStop(1, '#3a3530');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = '#2a2520'; ctx.lineWidth = 3; ctx.stroke();
    // Crack details
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(obs.x - obs.r * 0.2, obs.y - obs.r * 0.3); ctx.lineTo(obs.x + obs.r * 0.1, obs.y + obs.r * 0.2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(obs.x + obs.r * 0.3, obs.y - obs.r * 0.1); ctx.lineTo(obs.x + obs.r * 0.1, obs.y + obs.r * 0.35); ctx.stroke();
  });
}

function drawPlayer(p) {
  if (!p.alive || p.id === myId) return;
  const x = p.rx, y = p.ry, R = 20, HR = 9, HD = R + HR + 3;

  // Shadow
  ctx.beginPath(); ctx.ellipse(x, y + R + 4, R * 0.7, R * 0.22, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();

  // Shield ring
  if (p.shieldActive) {
    ctx.beginPath(); ctx.arc(x, y, R + 10, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(80,200,255,0.8)'; ctx.lineWidth = 4;
    ctx.shadowColor = 'rgba(80,200,255,0.9)'; ctx.shadowBlur = 15;
    ctx.stroke(); ctx.shadowBlur = 0;
  }

  // Hands
  [p.ra + 0.65, p.ra - 0.65].forEach(ha => {
    ctx.beginPath(); ctx.arc(x + Math.cos(ha) * HD, y + Math.sin(ha) * HD, HR, 0, Math.PI * 2);
    ctx.fillStyle = p.color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.stroke();
  });

  // Body
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fillStyle = p.color; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2; ctx.stroke();

  // Eyes
  const ex = Math.cos(p.ra), ey = Math.sin(p.ra);
  const px = -Math.sin(p.ra), py = Math.cos(p.ra);
  [1, -1].forEach(s => {
    ctx.beginPath(); ctx.arc(x + ex * 11 + px * 5 * s, y + ey * 11 + py * 5 * s, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#111'; ctx.fill();
    ctx.beginPath(); ctx.arc(x + ex * 11 + px * 5 * s + 1, y + ey * 11 + py * 5 * s - 1, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = 'white'; ctx.fill();
  });

  // Counter-rotated name + HP bar
  atWorld(x, y, () => {
    const R2 = 20, bw = 46, bh = 6;
    const bx = -bw / 2, by = -R2 - 16;
    ctx.fillStyle = '#222'; ctx.fillRect(bx, by, bw, bh);
    const pct = p.hp / 50;
    ctx.fillStyle = pct > 0.5 ? '#4caf50' : pct > 0.2 ? '#ff9800' : '#f44336';
    ctx.fillRect(bx, by, bw * pct, bh);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = '#ccc'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(p.name, 0, by - 3);
  });
}

function drawRock(r) {
  if (r.bounces > 0) {
    ctx.beginPath(); ctx.arc(r.x, r.y, 8 + r.bounces * 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,200,80,${r.bounces * 0.07})`; ctx.fill();
  }
  ctx.beginPath(); ctx.arc(r.x, r.y, 8, 0, Math.PI * 2);
  ctx.fillStyle = r.bounces > 0 ? '#c8a050' : '#999'; ctx.fill();
  ctx.strokeStyle = r.bounces > 0 ? '#906020' : '#555'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(r.x - 2, r.y - 2, 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill();
}

function drawBeams() {
  if (!serverState?.beams) return;
  serverState.beams.forEach(b => {
    const alpha = b.life / 30;
    const bx2 = b.x + Math.cos(b.angle) * 3000, by2 = b.y + Math.sin(b.angle) * 3000;
    ctx.save();
    const grad = ctx.createLinearGradient(b.x, b.y, bx2, by2);
    grad.addColorStop(0, `rgba(80,200,255,${alpha})`);
    grad.addColorStop(0.4, `rgba(255,240,80,${alpha * 0.9})`);
    grad.addColorStop(1, `rgba(80,200,255,0)`);
    ctx.strokeStyle = grad; ctx.lineWidth = 28 * alpha; ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(80,200,255,0.9)'; ctx.shadowBlur = 30;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(bx2, by2); ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.9})`; ctx.lineWidth = 5 * alpha; ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(bx2, by2); ctx.stroke();
    ctx.restore();
  });
}

// ── Draw screen-space (after restore) ────────────────────────
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

  // Since world rotates to put aim at top, hand is always at bottom center
  const rest    = { x: CW / 2 + 80,  y: CH - 80 };
  const windup  = { x: CW / 2 + 150, y: CH - 38 };
  const throwP  = { x: CW / 2 - 30,  y: CH - 160 };
  const armBase = { x: CW / 2 + 100, y: CH + 45 };

  const t = hand.timer / (hand.dur[hand.state] || 1);
  let hp;
  if (hand.state === 'idle')   hp = rest;
  else if (hand.state === 'windup')  hp = { x: lerp(rest.x, windup.x, t),   y: lerp(rest.y, windup.y, t) };
  else if (hand.state === 'throw')   hp = { x: lerp(windup.x, throwP.x, t), y: lerp(windup.y, throwP.y, t) };
  else                          hp = { x: lerp(throwP.x, rest.x, t),  y: lerp(throwP.y, rest.y, t) };

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

  // Shield glow around screen edge when active
  if (shieldActive) {
    const sg = ctx.createRadialGradient(CW/2, CH/2, CH * 0.35, CW/2, CH/2, CH * 0.85);
    sg.addColorStop(0, 'rgba(80,200,255,0)');
    sg.addColorStop(1, 'rgba(80,200,255,0.18)');
    ctx.fillStyle = sg; ctx.fillRect(0, 0, CW, CH);
  }

  // Kame charge
  if (kame.charge > 0 || kame.firing) {
    const ratio = kame.firing ? 1 : kame.charge / kame.maxCharge;
    const cx = CW / 2 + 20, cy = CH - 70, radius = 6 + ratio * 36;
    ctx.save();
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, `rgba(255,255,255,${ratio})`);
    g.addColorStop(0.4, `rgba(80,200,255,${ratio * 0.85})`);
    g.addColorStop(1, 'rgba(80,200,255,0)');
    ctx.shadowColor = 'rgba(80,200,255,0.95)'; ctx.shadowBlur = 25 * ratio;
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill(); ctx.restore();
    if (ratio > 0.5) {
      ctx.save(); const ta = (ratio - 0.5) / 0.5;
      ctx.font = `bold ${11 + ratio * 9}px sans-serif`; ctx.fillStyle = `rgba(255,240,80,${ta})`;
      ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(80,200,255,0.9)'; ctx.shadowBlur = 10;
      ctx.fillText('KAME... HAME...', CW / 2, CH - 130 - ratio * 20); ctx.restore();
    }
  }
}

function drawCursor() {
  const s = 11;
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(mouseX - s, mouseY); ctx.lineTo(mouseX + s, mouseY);
  ctx.moveTo(mouseX, mouseY - s); ctx.lineTo(mouseX, mouseY + s);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(mouseX, mouseY, 4, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x+r, y); c.lineTo(x+w-r, y); c.arcTo(x+w,y,x+w,y+r,r);
  c.lineTo(x+w,y+h-r); c.arcTo(x+w,y+h,x+w-r,y+h,r);
  c.lineTo(x+r,y+h); c.arcTo(x,y+h,x,y+h-r,r);
  c.lineTo(x,y+r); c.arcTo(x,y,x+r,y,r); c.closePath();
}

function drawHUD() {
  if (!serverState) return;
  const alive = serverState.players.filter(p => p.alive).length;
  const total = serverState.players.length;
  const me = serverState.players.find(p => p.id === myId);

  // Alive counter top-right
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(ctx, CW-122, 10, 112, 30, 8); ctx.fill();
  ctx.fillStyle = 'orange'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`${alive} / ${total} alive`, CW - 66, 30);

  // HP bar bottom center
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

  // Ammo (rock icons bottom center-right)
  for (let i = 0; i < 10; i++) {
    const ax = CW/2 + 118 + i * 14, ay = CH - 16;
    ctx.beginPath(); ctx.arc(ax, ay, 5, 0, Math.PI * 2);
    ctx.fillStyle = i < myAmmo ? '#999' : 'rgba(255,255,255,0.1)'; ctx.fill();
    if (i < myAmmo) { ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.stroke(); }
  }

  // Cooldown bars (bottom left)
  const bars = [
    { label: 'F — KAME', ready: kame.cooldown <= 0, pct: kame.cooldown <= 0 ? 1 : 1 - kame.cooldown / kame.maxCooldown, color: 'rgba(80,200,255,' },
    { label: 'Q — SHIELD', ready: shieldCooldown <= 0 && !shieldActive, pct: shieldActive ? 1 : shieldCooldown <= 0 ? 1 : 1 - shieldCooldown / 480, color: shieldActive ? 'rgba(80,200,255,' : 'rgba(80,200,255,' },
    { label: 'SPACE — DASH', ready: dashCooldown <= 0, pct: dashCooldown <= 0 ? 1 : 1 - dashCooldown / 180, color: 'rgba(255,200,80,' },
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

  // Kill feed top-right
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
    ctx.beginPath(); ctx.arc(mx + obs.x * s, my + obs.y * s, Math.max(2, obs.r * s), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(100,90,70,0.9)'; ctx.fill();
  });
  serverState.players.forEach(p => {
    if (!p.alive) return;
    const px = mx + p.x * s, py = my + p.y * s;
    ctx.beginPath(); ctx.arc(px, py, p.id === myId ? 4.5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = p.id === myId ? 'white' : p.color; ctx.fill();
    if (p.id === myId) {
      // Direction arrow
      const ar = 8;
      ctx.save(); ctx.translate(px, py); ctx.rotate(p.angle);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.moveTo(ar, 0); ctx.lineTo(-4, -3); ctx.lineTo(-4, 3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  });
  ctx.strokeStyle = 'rgba(255,165,0,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(mx, my, mw, mh);
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('MAP', mx + 3, my + 9);
}

function drawVignette() {
  const g = ctx.createRadialGradient(CW/2, CH/2, CH * 0.3, CW/2, CH/2, CH * 0.9);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
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
    myId = null; serverState = null; gameActive = false; gameOverFlag = false;
    obstacles = []; killFeed.length = 0;
    hand.state = 'idle'; hand.timer = 0;
    kame.held = false; kame.charge = 0; kame.cooldown = 0; kame.firing = false;
    Object.keys(keys).forEach(k => keys[k] = false);
    refreshLobbies(); startTitle();
  }, 3200);
}

// ── Render loop ───────────────────────────────────────────────
function render() {
  updateCam();

  if (!serverState) {
    ctx.fillStyle = '#0a0a14'; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Connecting...', CW/2, CH/2);
    requestAnimationFrame(render); return;
  }

  // World (rotated with mouse)
  ctx.save();
  applyWorldTransform();
  drawArena();
  drawObstacles();
  drawBeams();
  serverState.rocks.forEach(drawRock);
  serverState.players.forEach(drawPlayer);
  ctx.restore();

  // Screen-space overlays
  drawVignette();
  drawKameText();
  drawHand();
  drawHUD();
  drawMinimap();
  drawCursor();
  checkEnd();

  requestAnimationFrame(render);
}

render();
