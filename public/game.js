const WORLD_W = 1600, WORLD_H = 1200;
const CW = 900, CH = 620;

// ── State ────────────────────────────────────────────────────
let myId = null, serverState = null;
let camX = 800, camY = 600;
let mouseX = CW / 2, mouseY = CH / 2, mouseAngle = 0;
let gameActive = false, gameOverFlag = false;
const keys = { up: false, down: false, left: false, right: false };

// Hand animation
const hand = { state: 'idle', timer: 0, rockSent: false, dur: { windup: 11, throw: 7, recover: 18 } };

// Kamehameha
const kame = { held: false, charge: 0, maxCharge: 90, cooldown: 0, maxCooldown: 480, firing: false, fireTimer: 0 };

// ── Canvas setup ─────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// ── Title screen animation ───────────────────────────────────
const bgCanvas = document.getElementById('bg');
const bgCtx = bgCanvas.getContext('2d');
let titleRunning = false;

const titleBalls = Array.from({ length: 12 }, () => ({
  x: Math.random() * window.innerWidth,
  y: Math.random() * window.innerHeight,
  vx: (Math.random() - 0.5) * 1.4,
  vy: (Math.random() - 0.5) * 1.4,
  r: 14 + Math.random() * 14,
  color: `hsl(${Math.floor(Math.random() * 360)},70%,60%)`,
  angle: Math.random() * Math.PI * 2,
  eyeAngle: Math.random() * Math.PI * 2
}));

const titleRocks = Array.from({ length: 8 }, () => ({
  x: Math.random() * window.innerWidth,
  y: Math.random() * window.innerHeight,
  vx: (Math.random() - 0.5) * 2,
  vy: (Math.random() - 0.5) * 2
}));

function resizeBg() {
  bgCanvas.width = window.innerWidth;
  bgCanvas.height = window.innerHeight;
}
resizeBg();
window.addEventListener('resize', resizeBg);

function animateTitle() {
  if (!titleRunning) return;
  const W = bgCanvas.width, H = bgCanvas.height;

  bgCtx.fillStyle = '#070714';
  bgCtx.fillRect(0, 0, W, H);

  // Subtle radial glow center
  const grd = bgCtx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.6);
  grd.addColorStop(0, 'rgba(255,100,0,0.06)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  bgCtx.fillStyle = grd;
  bgCtx.fillRect(0, 0, W, H);

  // Rocks
  titleRocks.forEach(r => {
    r.x += r.vx; r.y += r.vy;
    if (r.x < 0) r.x = W; if (r.x > W) r.x = 0;
    if (r.y < 0) r.y = H; if (r.y > H) r.y = 0;
    bgCtx.beginPath();
    bgCtx.arc(r.x, r.y, 6, 0, Math.PI * 2);
    bgCtx.fillStyle = 'rgba(140,140,140,0.18)';
    bgCtx.fill();
  });

  // Balls
  titleBalls.forEach(b => {
    b.x += b.vx; b.y += b.vy;
    b.eyeAngle += 0.012;
    if (b.x < b.r || b.x > W - b.r) { b.vx *= -1; b.x = Math.max(b.r, Math.min(W - b.r, b.x)); }
    if (b.y < b.r || b.y > H - b.r) { b.vy *= -1; b.y = Math.max(b.r, Math.min(H - b.r, b.y)); }

    // Glow
    const glow = bgCtx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 2.5);
    glow.addColorStop(0, b.color + '30');
    glow.addColorStop(1, 'transparent');
    bgCtx.beginPath();
    bgCtx.arc(b.x, b.y, b.r * 2.5, 0, Math.PI * 2);
    bgCtx.fillStyle = glow;
    bgCtx.fill();

    // Body
    bgCtx.beginPath();
    bgCtx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    bgCtx.fillStyle = b.color + '28';
    bgCtx.fill();
    bgCtx.strokeStyle = b.color + '60';
    bgCtx.lineWidth = 2;
    bgCtx.stroke();

    // Eyes
    const ex = Math.cos(b.eyeAngle), ey = Math.sin(b.eyeAngle);
    const px = -Math.sin(b.eyeAngle), py = Math.cos(b.eyeAngle);
    bgCtx.fillStyle = b.color + '70';
    [[1], [-1]].forEach(([s]) => {
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

// ── Socket ───────────────────────────────────────────────────
const socket = io();

socket.on('joined', ({ id }) => {
  myId = id;
  gameActive = true;
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('game').style.display = 'block';
  stopTitle();
});

socket.on('lobby_full', () => alert('That lobby is full! Try another.'));
socket.on('state', s => { serverState = s; });

// ── Lobby UI ─────────────────────────────────────────────────
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

// ── Input ────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (!gameActive) return;
  if (e.key === 'w' || e.key === 'ArrowUp')    keys.up    = true;
  if (e.key === 's' || e.key === 'ArrowDown')  keys.down  = true;
  if (e.key === 'a' || e.key === 'ArrowLeft')  keys.left  = true;
  if (e.key === 'd' || e.key === 'ArrowRight') keys.right = true;
  if (e.key === 'f' || e.key === 'F') kame.held = true;
});

document.addEventListener('keyup', e => {
  if (!gameActive) return;
  if (e.key === 'w' || e.key === 'ArrowUp')    keys.up    = false;
  if (e.key === 's' || e.key === 'ArrowDown')  keys.down  = false;
  if (e.key === 'a' || e.key === 'ArrowLeft')  keys.left  = false;
  if (e.key === 'd' || e.key === 'ArrowRight') keys.right = false;
  if (e.key === 'f' || e.key === 'F') {
    kame.held = false;
    if (!kame.firing) kame.charge = 0;
  }
});

canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouseX = e.clientX - r.left;
  mouseY = e.clientY - r.top;
});

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (!gameActive || !myId || !serverState) return;
  const me = serverState.players.find(p => p.id === myId);
  if (me && me.alive && me.ready && hand.state === 'idle') {
    hand.state = 'windup';
    hand.timer = 0;
    hand.rockSent = false;
  }
});

// ── Game loop (input + kame + hand) ──────────────────────────
setInterval(() => {
  if (!myId || !gameActive) return;

  // Calculate angle from my player screen pos to mouse
  if (serverState) {
    const me = serverState.players.find(p => p.id === myId);
    if (me) {
      const sx = me.x - camX + CW / 2;
      const sy = me.y - camY + CH / 2;
      mouseAngle = Math.atan2(mouseY - sy, mouseX - sx);
    }
  }

  socket.emit('input', { keys, angle: mouseAngle });

  // Kamehameha charge
  if (kame.held && kame.cooldown === 0 && !kame.firing) {
    kame.charge++;
    if (kame.charge >= kame.maxCharge) {
      kame.held = false;
      kame.charge = 0;
      kame.cooldown = kame.maxCooldown;
      kame.firing = true;
      kame.fireTimer = 40;
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
    const dur = hand.dur[hand.state];
    if (hand.timer >= dur) {
      hand.timer = 0;
      if (hand.state === 'windup')  hand.state = 'throw';
      else if (hand.state === 'throw')   hand.state = 'recover';
      else hand.state = 'idle';
    }
  }
}, 1000 / 60);

// ── Camera ───────────────────────────────────────────────────
function updateCam() {
  if (!serverState) return;
  const me = serverState.players.find(p => p.id === myId);
  if (me) { camX = me.x; camY = me.y; }
}

// World → screen
function ws(wx, wy) {
  return { x: wx - camX + CW / 2, y: wy - camY + CH / 2 };
}

// ── Draw helpers ─────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }

function drawArena() {
  ctx.fillStyle = '#1a3a18';
  ctx.fillRect(0, 0, CW, CH);

  // Scrolling grid
  const gsx = Math.floor((camX - CW / 2) / 50) * 50;
  const gsy = Math.floor((camY - CH / 2) / 50) * 50;
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  for (let wx = gsx; wx < camX + CW / 2 + 50; wx += 50) {
    const sx = wx - camX + CW / 2;
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, CH); ctx.stroke();
  }
  for (let wy = gsy; wy < camY + CH / 2 + 50; wy += 50) {
    const sy = wy - camY + CH / 2;
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(CW, sy); ctx.stroke();
  }

  // World border
  const tl = ws(0, 0), br = ws(WORLD_W, WORLD_H);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  if (tl.x > 0)  ctx.fillRect(0, 0, tl.x, CH);
  if (br.x < CW) ctx.fillRect(br.x, 0, CW - br.x, CH);
  if (tl.y > 0)  ctx.fillRect(tl.x, 0, br.x - tl.x, tl.y);
  if (br.y < CH) ctx.fillRect(tl.x, br.y, br.x - tl.x, CH - br.y);
  ctx.strokeStyle = 'rgba(255,165,0,0.7)';
  ctx.lineWidth = 4;
  ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
}

function drawPlayer(p) {
  if (!p.alive) return;
  const { x, y } = ws(p.x, p.y);
  const R = 20, HR = 9, HD = R + HR + 3;

  // Shadow
  ctx.beginPath();
  ctx.ellipse(x, y + R + 4, R * 0.7, R * 0.22, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();

  // Hands
  [p.angle + 0.65, p.angle - 0.65].forEach(ha => {
    ctx.beginPath();
    ctx.arc(x + Math.cos(ha) * HD, y + Math.sin(ha) * HD, HR, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  // Body
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fillStyle = p.color;
  ctx.fill();
  ctx.strokeStyle = p.id === myId ? 'white' : 'rgba(0,0,0,0.45)';
  ctx.lineWidth = p.id === myId ? 2.5 : 1.5;
  ctx.stroke();

  // Eyes
  const ex = Math.cos(p.angle), ey = Math.sin(p.angle);
  const px = -Math.sin(p.angle), py = Math.cos(p.angle);
  [1, -1].forEach(s => {
    ctx.beginPath();
    ctx.arc(x + ex * 11 + px * 5 * s, y + ey * 11 + py * 5 * s, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + ex * 11 + px * 5 * s + 1, y + ey * 11 + py * 5 * s - 1, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();
  });

  // HP bar
  const bw = 46, bh = 6, bx = x - bw / 2, by = y - R - 16;
  ctx.fillStyle = '#222'; ctx.fillRect(bx, by, bw, bh);
  const pct = p.hp / 50;
  ctx.fillStyle = pct > 0.5 ? '#4caf50' : pct > 0.2 ? '#ff9800' : '#f44336';
  ctx.fillRect(bx, by, bw * pct, bh);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, bh);

  // Name
  ctx.fillStyle = p.id === myId ? 'white' : '#ccc';
  ctx.font = `${p.id === myId ? 'bold ' : ''}11px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(p.name, x, by - 3);
}

function drawRock(r) {
  const { x, y } = ws(r.x, r.y);
  ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#999'; ctx.fill();
  ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.stroke();
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
    // Outer glow
    const grad = ctx.createLinearGradient(s.x, s.y, far.x, far.y);
    grad.addColorStop(0, `rgba(80,200,255,${alpha})`);
    grad.addColorStop(0.4, `rgba(255,240,80,${alpha * 0.9})`);
    grad.addColorStop(1, `rgba(80,200,255,0)`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 28 * alpha;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(80,200,255,0.9)';
    ctx.shadowBlur = 30;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(far.x, far.y); ctx.stroke();
    // Bright core
    ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.9})`;
    ctx.lineWidth = 5 * alpha;
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(far.x, far.y); ctx.stroke();
    ctx.restore();

    // KAMEHAMEHA text
    if (b.life > 15) {
      const ta = (b.life - 15) / 15;
      ctx.save();
      ctx.font = 'bold 28px Bangers, Impact, fantasy';
      ctx.fillStyle = `rgba(255,240,80,${ta})`;
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(80,200,255,0.9)';
      ctx.shadowBlur = 16;
      ctx.fillText('KAMEHAMEHA!!!', CW / 2, 46);
      ctx.restore();
    }
  });
}

function drawHand() {
  if (!myId || !serverState) return;
  const me = serverState.players.find(p => p.id === myId);
  if (!me || !me.alive) return;

  // Hand positions (screen space)
  const rest    = { x: CW / 2 + 75,  y: CH - 95 };
  const windup  = { x: CW / 2 + 140, y: CH - 55 };
  const throwP  = { x: CW / 2 - 15,  y: CH - 148 };
  const armBase = { x: CW / 2 + 95,  y: CH + 35 };

  let hp;
  const t = hand.timer / (hand.dur[hand.state] || 1);
  if (hand.state === 'idle')    hp = rest;
  else if (hand.state === 'windup')  hp = { x: lerp(rest.x, windup.x, t),   y: lerp(rest.y, windup.y, t) };
  else if (hand.state === 'throw')   hp = { x: lerp(windup.x, throwP.x, t), y: lerp(windup.y, throwP.y, t) };
  else                          hp = { x: lerp(throwP.x, rest.x, t),  y: lerp(throwP.y, rest.y, t) };

  // Arm
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = 22;
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.moveTo(armBase.x + 2, armBase.y + 2); ctx.lineTo(hp.x + 2, hp.y + 2); ctx.stroke();
  ctx.strokeStyle = me.color;
  ctx.beginPath(); ctx.moveTo(armBase.x, armBase.y); ctx.lineTo(hp.x, hp.y); ctx.stroke();

  // Fist
  ctx.beginPath();
  ctx.arc(hp.x, hp.y, 18, 0, Math.PI * 2);
  ctx.fillStyle = me.color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Knuckle lines
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1.5;
  [-6, 0, 6].forEach(o => {
    ctx.beginPath();
    ctx.moveTo(hp.x - 9, hp.y + o - 3);
    ctx.quadraticCurveTo(hp.x, hp.y + o - 5, hp.x + 9, hp.y + o - 3);
    ctx.stroke();
  });

  // Rock on hand if ready and idle
  if (me.ready && hand.state === 'idle') {
    ctx.beginPath();
    ctx.arc(hp.x - 13, hp.y - 24, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#888'; ctx.fill();
    ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath();
    ctx.arc(hp.x - 15, hp.y - 26, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill();
  }
  ctx.restore();

  // Kamehameha charge ball
  if (kame.charge > 0 || kame.firing) {
    const ratio = kame.firing ? 1 : kame.charge / kame.maxCharge;
    const cx = CW / 2 + 20, cy = CH - 65;
    const radius = 6 + ratio * 34;

    ctx.save();
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, `rgba(255,255,255,${ratio})`);
    g.addColorStop(0.4, `rgba(80,200,255,${ratio * 0.85})`);
    g.addColorStop(1, 'rgba(80,200,255,0)');
    ctx.shadowColor = 'rgba(80,200,255,0.95)';
    ctx.shadowBlur = 25 * ratio;
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();

    if (ratio > 0.5) {
      ctx.save();
      const ta = (ratio - 0.5) / 0.5;
      ctx.font = `bold ${11 + ratio * 9}px sans-serif`;
      ctx.fillStyle = `rgba(255,240,80,${ta})`;
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(80,200,255,0.9)';
      ctx.shadowBlur = 10;
      ctx.fillText('KAME... HAME...', CW / 2, CH - 125 - ratio * 20);
      ctx.restore();
    }
  }
}

function drawCursor() {
  const s = 11;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(mouseX - s, mouseY); ctx.lineTo(mouseX + s, mouseY);
  ctx.moveTo(mouseX, mouseY - s); ctx.lineTo(mouseX, mouseY + s);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(mouseX, mouseY, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawHUD() {
  if (!serverState) return;
  const alive = serverState.players.filter(p => p.alive).length;
  const total = serverState.players.length;

  // Alive counter top-right
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  roundRect(ctx, CW - 120, 10, 110, 32, 8);
  ctx.fill();
  ctx.fillStyle = 'orange';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${alive} / ${total} alive`, CW - 65, 31);

  // Kamehameha cooldown bar bottom-left
  if (kame.cooldown > 0) {
    const pct = 1 - kame.cooldown / kame.maxCooldown;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    roundRect(ctx, 10, CH - 36, 120, 18, 4);
    ctx.fill();
    ctx.fillStyle = pct > 0.8 ? 'rgba(80,200,255,0.9)' : 'rgba(80,200,255,0.5)';
    roundRect(ctx, 10, CH - 36, 120 * pct, 18, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('KAMEHAMEHA', 70, CH - 23);
  } else if (myId) {
    const me = serverState.players.find(p => p.id === myId);
    if (me && me.alive) {
      ctx.fillStyle = 'rgba(80,200,255,0.5)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('F — KAMEHAMEHA ready', 12, CH - 24);
    }
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r);
  c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h);
  c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r);
  c.arcTo(x, y, x + r, y, r);
  c.closePath();
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
    // Reset all state
    myId = null; serverState = null; gameActive = false; gameOverFlag = false;
    hand.state = 'idle'; hand.timer = 0;
    kame.held = false; kame.charge = 0; kame.cooldown = 0; kame.firing = false;
    Object.keys(keys).forEach(k => keys[k] = false);
    refreshLobbies();
    startTitle();
  }, 3200);
}

// ── Render loop ───────────────────────────────────────────────
function render() {
  updateCam();

  if (!serverState) {
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Connecting...', CW / 2, CH / 2);
    requestAnimationFrame(render);
    return;
  }

  drawArena();
  drawBeams();
  serverState.rocks.forEach(drawRock);
  serverState.players.forEach(drawPlayer);
  drawHand();
  drawHUD();
  drawCursor();
  checkEnd();

  requestAnimationFrame(render);
}

render();
