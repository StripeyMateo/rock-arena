const WORLD_W = 1600, WORLD_H = 1200;
const CW = 900, CH = 620;
function hsla(color, alpha) { return color.replace('hsl(', 'hsla(').replace(')', `,${alpha})`); }

// ── State ─────────────────────────────────────────────────────
let myId = null, serverState = null, obstacles = [];
let camX = 800, camY = 600;
let mouseX = CW / 2, mouseY = CH / 2, mouseAngle = 0;
let gameActive = false, gameOverFlag = false;
const keys = { up: false, down: false, left: false, right: false };

// Hand animation
const hand = { state: 'idle', timer: 0, rockSent: false, dur: { windup: 11, throw: 7, recover: 18 } };

// Kamehameha
const kame = { held: false, charge: 0, maxCharge: 90, cooldown: 0, maxCooldown: 480, firing: false, fireTimer: 0 };

// Dash
let dashCooldown = 0;
const DASH_MAX = 180;

// Kill feed
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
  bgCtx.fillStyle = '#070714';
  bgCtx.fillRect(0, 0, W, H);
  const grd = bgCtx.createRadialGradient(W/2, H/2, 0, W/2, H/2, W * 0.6);
  grd.addColorStop(0, 'rgba(255,100,0,0.06)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
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
    bgCtx.beginPath(); bgCtx.arc(b.x, b.y, b.r * 2.5, 0, Math.PI * 2);
    bgCtx.fillStyle = glow; bgCtx.fill();
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
socket.on('lobby_full', () => alert('That lobby is full! Try another.'));
socket.on('state', s => { serverState = s; });
socket.on('kill', ({ killer, victim }) => {
  killFeed.unshift({ text: `${killer} eliminated ${victim}`, timer: 240 });
  if (killFeed.length > 5) killFeed.pop();
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
    const lobby = parseInt(btn.dataset.lobby);
    const name = document.getElementById('name-input').value.trim() || 'Player';
    const color = document.getElementById('color-pick').value;
    socket.emit('join', { lobby, name, color });
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
  if (me && me.alive && me.ready && hand.state === 'idle') {
    hand.state = 'windup'; hand.timer = 0; hand.rockSent = false;
  }
});

// ── Game loop ─────────────────────────────────────────────────
setInterval(() => {
  if (!myId || !gameActive) return;
  if (serverState) {
    const me = serverState.players.find(p => p.id === myId);
    if (me) {
      const sx = me.x - camX + CW / 2, sy = me.y - camY + CH / 2;
      mouseAngle = Math.atan2(mouseY - sy, mouseX - sx);
      dashCooldown = me.dashCooldown || 0;
    }
  }
  socket.emit('input', { keys, angle: mouseAngle });

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
function ws(wx, wy) { return { x: wx - camX + CW / 2, y: wy - camY + CH / 2 }; }
function lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }

// ── Draw ──────────────────────────────────────────────────────
function drawArena() {
  ctx.fillStyle = '#1a3a18';
  ctx.fillRect(0, 0, CW, CH);
  const gsx = Math.floor((camX - CW / 2) / 50) * 50;
  const gsy = Math.floor((camY - CH / 2) / 50) * 50;
  ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 1;
  for (let wx = gsx; wx < camX + CW / 2 + 50; wx += 50) {
    const sx = wx - camX + CW / 2;
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, CH); ctx.stroke();
  }
  for (let wy = gsy; wy < camY + CH / 2 + 50; wy += 50) {
    const sy = wy - camY + CH / 2;
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(CW, sy); ctx.stroke();
  }
  const tl = ws(0, 0), br = ws(WORLD_W, WORLD_H);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  if (tl.x > 0)  ctx.fillRect(0, 0, tl.x, CH);
  if (br.x < CW) ctx.fillRect(br.x, 0, CW - br.x, CH);
  if (tl.y > 0)  ctx.fillRect(tl.x, 0, br.x - tl.x, tl.y);
  if (br.y < CH) ctx.fillRect(tl.x, br.y, br.x - tl.x, CH - br.y);
  ctx.strokeStyle = 'rgba(255,165,0,0.7)'; ctx.lineWidth = 4;
  ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
}

function drawObstacles() {
  obstacles.forEach(obs => {
    const { x, y } = ws(obs.x, obs.y);
    // Shadow
    ctx.beginPath(); ctx.ellipse(x, y + obs.r * 0.3 + 4, obs.r * 0.8, obs.r * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
    // Rock body
    ctx.beginPath(); ctx.arc(x, y, obs.r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(x - obs.r * 0.3, y - obs.r * 0.3, 0, x, y, obs.r);
    g.addColorStop(0, '#7a7060'); g.addColorStop(1, '#3a3530');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = '#2a2520'; ctx.lineWidth = 3; ctx.stroke();
    // Cracks
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - obs.r * 0.2, y - obs.r * 0.3);
    ctx.lineTo(x + obs.r * 0.1, y + obs.r * 0.2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + obs.r * 0.3, y - obs.r * 0.1);
    ctx.lineTo(x + obs.r * 0.1, y + obs.r * 0.35); ctx.stroke();
  });
}

function drawPlayer(p) {
  if (!p.alive || p.id === myId) return; // don't draw self
  const { x, y } = ws(p.x, p.y);
  const R = 20, HR = 9, HD = R + HR + 3;
  ctx.beginPath(); ctx.ellipse(x, y + R + 4, R * 0.7, R * 0.22, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill();
  [p.angle + 0.65, p.angle - 0.65].forEach(ha => {
    ctx.beginPath(); ctx.arc(x + Math.cos(ha) * HD, y + Math.sin(ha) * HD, HR, 0, Math.PI * 2);
    ctx.fillStyle = p.color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.stroke();
  });
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fillStyle = p.color; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.5; ctx.stroke();
  const ex = Math.cos(p.angle), ey = Math.sin(p.angle);
  const px = -Math.sin(p.angle), py = Math.cos(p.angle);
  [1, -1].forEach(s => {
    ctx.beginPath(); ctx.arc(x + ex * 11 + px * 5 * s, y + ey * 11 + py * 5 * s, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#111'; ctx.fill();
    ctx.beginPath(); ctx.arc(x + ex * 11 + px * 5 * s + 1, y + ey * 11 + py * 5 * s - 1, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = 'white'; ctx.fill();
  });
  const bw = 46, bh = 6, bx = x - bw / 2, by = y - R - 16;
  ctx.fillStyle = '#222'; ctx.fillRect(bx, by, bw, bh);
  const pct = p.hp / 50;
  ctx.fillStyle = pct > 0.5 ? '#4caf50' : pct > 0.2 ? '#ff9800' : '#f44336';
  ctx.fillRect(bx, by, bw * pct, bh);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = '#ccc'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(p.name, x, by - 3);
}

function drawRock(r) {
  const { x, y } = ws(r.x, r.y);
  // Glow trail after bounces
  if (r.bounces > 0) {
    ctx.beginPath(); ctx.arc(x, y, 8 + r.bounces * 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,200,80,${r.bounces * 0.08})`; ctx.fill();
  }
  ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fillStyle = r.bounces > 0 ? '#c8a050' : '#999'; ctx.fill();
  ctx.strokeStyle = r.bounces > 0 ? '#906020' : '#555'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(x - 2, y - 2, 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill();
}

function drawBeams() {
  if (!serverState?.beams) return;
  serverState.beams.forEach(b => {
    const s = ws(b.x, b.y);
    const alpha = b.life / 30;
    const far = ws(b.x + Math.cos(b.angle) * 3000, b.y + Math.sin(b.angle) * 3000);
    ctx.save();
    const grad = ctx.createLinearGradient(s.x, s.y, far.x, far.y);
    grad.addColorStop(0, `rgba(80,200,255,${alpha})`);
    grad.addColorStop(0.4, `rgba(255,240,80,${alpha * 0.9})`);
    grad.addColorStop(1, `rgba(80,200,255,0)`);
    ctx.strokeStyle = grad; ctx.lineWidth = 28 * alpha; ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(80,200,255,0.9)'; ctx.shadowBlur = 30;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(far.x, far.y); ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.9})`; ctx.lineWidth = 5 * alpha; ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(far.x, far.y); ctx.stroke();
    ctx.restore();
    if (b.life > 15) {
      const ta = (b.life - 15) / 15;
      ctx.save(); ctx.font = 'bold 28px Bangers, Impact, fantasy';
      ctx.fillStyle = `rgba(255,240,80,${ta})`; ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(80,200,255,0.9)'; ctx.shadowBlur = 16;
      ctx.fillText('KAMEHAMEHA!!!', CW / 2, 46); ctx.restore();
    }
  });
}

function drawHand() {
  if (!myId || !serverState) return;
  const me = serverState.players.find(p => p.id === myId);
  if (!me || !me.alive) return;

  const rest   = { x: CW / 2 + 80,  y: CH - 80 };
  const windup = { x: CW / 2 + 150, y: CH - 40 };
  const throwP = { x: CW / 2 - 30,  y: CH - 155 };
  const armBase = { x: CW / 2 + 100, y: CH + 40 };

  let hp;
  const t = hand.timer / (hand.dur[hand.state] || 1);
  if (hand.state === 'idle')   hp = rest;
  else if (hand.state === 'windup')  hp = { x: lerp(rest.x, windup.x, t),   y: lerp(rest.y, windup.y, t) };
  else if (hand.state === 'throw')   hp = { x: lerp(windup.x, throwP.x, t), y: lerp(windup.y, throwP.y, t) };
  else                          hp = { x: lerp(throwP.x, rest.x, t),  y: lerp(throwP.y, rest.y, t) };

  ctx.save();
  ctx.lineCap = 'round';
  // Arm shadow
  ctx.lineWidth = 24; ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.moveTo(armBase.x + 3, armBase.y + 3); ctx.lineTo(hp.x + 3, hp.y + 3); ctx.stroke();
  // Arm
  ctx.lineWidth = 22; ctx.strokeStyle = me.color;
  ctx.beginPath(); ctx.moveTo(armBase.x, armBase.y); ctx.lineTo(hp.x, hp.y); ctx.stroke();

  // Fist
  ctx.beginPath(); ctx.arc(hp.x, hp.y, 20, 0, Math.PI * 2);
  ctx.fillStyle = me.color; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 3; ctx.stroke();
  // Knuckle details
  ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1.5;
  [-7, 0, 7].forEach(o => {
    ctx.beginPath(); ctx.moveTo(hp.x - 10, hp.y + o - 3);
    ctx.quadraticCurveTo(hp.x, hp.y + o - 6, hp.x + 10, hp.y + o - 3); ctx.stroke();
  });
  // Rock in hand
  if (me.ready && hand.state === 'idle') {
    ctx.beginPath(); ctx.arc(hp.x - 14, hp.y - 26, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#888'; ctx.fill();
    ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(hp.x - 16, hp.y - 28, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill();
  }
  ctx.restore();

  // Kame charge
  if (kame.charge > 0 || kame.firing) {
    const ratio = kame.firing ? 1 : kame.charge / kame.maxCharge;
    const cx = CW / 2 + 20, cy = CH - 70;
    const radius = 6 + ratio * 36;
    ctx.save();
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, `rgba(255,255,255,${ratio})`);
    g.addColorStop(0.4, `rgba(80,200,255,${ratio * 0.85})`);
    g.addColorStop(1, 'rgba(80,200,255,0)');
    ctx.shadowColor = 'rgba(80,200,255,0.95)'; ctx.shadowBlur = 25 * ratio;
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.restore();
    if (ratio > 0.5) {
      const ta = (ratio - 0.5) / 0.5;
      ctx.save(); ctx.font = `bold ${11 + ratio * 9}px sans-serif`;
      ctx.fillStyle = `rgba(255,240,80,${ta})`; ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(80,200,255,0.9)'; ctx.shadowBlur = 10;
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

function drawHUD() {
  if (!serverState) return;
  const alive = serverState.players.filter(p => p.alive).length;
  const total = serverState.players.length;
  const me = serverState.players.find(p => p.id === myId);

  // Alive counter
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(ctx, CW - 120, 10, 110, 32, 8); ctx.fill();
  ctx.fillStyle = 'orange'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`${alive} / ${total} alive`, CW - 65, 31);

  // My HP bar (bottom center)
  if (me && me.alive) {
    const bw = 200, bh = 12, bx = CW / 2 - bw / 2, by = CH - 22;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(ctx, bx - 2, by - 2, bw + 4, bh + 4, 6); ctx.fill();
    ctx.fillStyle = '#222'; ctx.fillRect(bx, by, bw, bh);
    const pct = me.hp / 50;
    ctx.fillStyle = pct > 0.5 ? '#4caf50' : pct > 0.2 ? '#ff9800' : '#f44336';
    ctx.fillRect(bx, by, bw * pct, bh);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = 'white'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${me.hp} HP`, CW / 2, by + bh - 1);
  }

  // Cooldown bars (bottom left)
  const barW = 110;
  // Kamehameha
  const kameReady = kame.cooldown <= 0;
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(ctx, 10, CH - 60, barW, 16, 4); ctx.fill();
  ctx.fillStyle = kameReady ? 'rgba(80,200,255,0.9)' : 'rgba(80,200,255,0.4)';
  roundRect(ctx, 10, CH - 60, barW * (kameReady ? 1 : 1 - kame.cooldown / kame.maxCooldown), 16, 4); ctx.fill();
  ctx.fillStyle = kameReady ? 'white' : 'rgba(255,255,255,0.4)';
  ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`F — KAMEHAMEHA${kameReady ? ' READY' : ''}`, 10 + barW / 2, CH - 48);

  // Dash
  const dashReady = dashCooldown <= 0;
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(ctx, 10, CH - 36, barW, 16, 4); ctx.fill();
  ctx.fillStyle = dashReady ? 'rgba(255,200,80,0.9)' : 'rgba(255,200,80,0.4)';
  roundRect(ctx, 10, CH - 36, barW * (dashReady ? 1 : 1 - dashCooldown / DASH_MAX), 16, 4); ctx.fill();
  ctx.fillStyle = dashReady ? 'white' : 'rgba(255,255,255,0.4)';
  ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`SPACE — DASH${dashReady ? ' READY' : ''}`, 10 + barW / 2, CH - 24);

  // Kill feed (top right)
  killFeed.forEach((k, i) => {
    k.timer--;
    const alpha = Math.min(1, k.timer / 40);
    ctx.fillStyle = `rgba(0,0,0,${alpha * 0.5})`;
    const tw = ctx.measureText(k.text).width;
    roundRect(ctx, CW - tw - 22, 52 + i * 22, tw + 12, 18, 4); ctx.fill();
    ctx.fillStyle = `rgba(255,220,100,${alpha})`;
    ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(k.text, CW - 10, 65 + i * 22);
  });
  for (let i = killFeed.length - 1; i >= 0; i--) {
    if (killFeed[i].timer <= 0) killFeed.splice(i, 1);
  }
}

function drawMinimap() {
  if (!serverState) return;
  const mx = CW - 175, my = CH - 145, mw = 160, mh = 120, s = 0.1;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; roundRect(ctx, mx - 2, my - 2, mw + 4, mh + 4, 6); ctx.fill();
  ctx.fillStyle = 'rgba(26,58,24,0.8)'; ctx.fillRect(mx, my, mw, mh);
  ctx.strokeStyle = 'rgba(255,165,0,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(mx, my, mw, mh);
  // Obstacles
  obstacles.forEach(obs => {
    ctx.beginPath(); ctx.arc(mx + obs.x * s, my + obs.y * s, obs.r * s, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(100,90,70,0.8)'; ctx.fill();
  });
  // Players
  serverState.players.forEach(p => {
    if (!p.alive) return;
    ctx.beginPath(); ctx.arc(mx + p.x * s, my + p.y * s, p.id === myId ? 4 : 3, 0, Math.PI * 2);
    ctx.fillStyle = p.id === myId ? 'white' : p.color; ctx.fill();
    if (p.id === myId) { ctx.strokeStyle = 'white'; ctx.lineWidth = 1; ctx.stroke(); }
  });
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('MAP', mx + 3, my + 9);
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h); c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r); c.closePath();
}

function drawVignette() {
  const g = ctx.createRadialGradient(CW / 2, CH / 2, CH * 0.3, CW / 2, CH / 2, CH * 0.85);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
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
    ctx.fillText('Connecting...', CW / 2, CH / 2);
    requestAnimationFrame(render); return;
  }
  drawArena();
  drawObstacles();
  drawBeams();
  serverState.rocks.forEach(drawRock);
  serverState.players.forEach(drawPlayer);
  drawVignette();
  drawHand();
  drawHUD();
  drawMinimap();
  drawCursor();
  checkEnd();
  requestAnimationFrame(render);
}
render();
