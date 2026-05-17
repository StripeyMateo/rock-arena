const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));

const LOBBY_COUNT = 3;
const MAX_PLAYERS = 10;
const TICK_RATE = 60;
const MAP_W = 1600;
const MAP_H = 1200;
const PLAYER_R = 20;
const ROCK_R = 8;
const PLAYER_SPEED = 3;
const ROCK_SPEED = 8;
const MAX_HP = 50;
const HIT_DAMAGE = 10;
const ROCK_COOLDOWN = 36;
const KAME_COOLDOWN = 480;
const KAME_BEAM_LEN = 3000;
const KAME_BEAM_WIDTH = 35;
const KAME_DAMAGE = 30;
const DASH_FORCE = 14;
const DASH_COOLDOWN = 180;
const MAX_BOUNCES = 4;
const SHIELD_DURATION = 120;
const SHIELD_COOLDOWN = 480;
const MAX_AMMO = 10;
const AMMO_REFILL_RATE = 180;

// Map obstacles — symmetrical arena with corridors and a central fort
const OBSTACLES = [
  // Central fort
  { x: 800, y: 600, r: 62 },
  // Inner ring (4 cover rocks)
  { x: 800, y: 380, r: 42 },
  { x: 800, y: 820, r: 42 },
  { x: 575, y: 600, r: 42 },
  { x: 1025, y: 600, r: 42 },
  // Corner fortresses
  { x: 290, y: 240, r: 52 },
  { x: 1310, y: 240, r: 52 },
  { x: 290, y: 960, r: 52 },
  { x: 1310, y: 960, r: 52 },
  // Mid-edge cover
  { x: 155, y: 600, r: 38 },
  { x: 1445, y: 600, r: 38 },
  { x: 800, y: 155, r: 38 },
  { x: 800, y: 1045, r: 38 },
  // Diagonal mid cover
  { x: 480, y: 380, r: 28 },
  { x: 1120, y: 380, r: 28 },
  { x: 480, y: 820, r: 28 },
  { x: 1120, y: 820, r: 28 },
];

const lobbies = {};
for (let i = 1; i <= LOBBY_COUNT; i++) {
  lobbies[i] = { id: i, players: {}, rocks: [], beams: [], rockCounter: 0 };
}

function playerCount(id) { return Object.keys(lobbies[id].players).length; }

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function pushOutObstacles(p) {
  OBSTACLES.forEach(obs => {
    const dx = p.x - obs.x, dy = p.y - obs.y;
    const dist = Math.hypot(dx, dy);
    if (dist < PLAYER_R + obs.r) {
      const ang = Math.atan2(dy, dx);
      p.x = obs.x + Math.cos(ang) * (PLAYER_R + obs.r + 1);
      p.y = obs.y + Math.sin(ang) * (PLAYER_R + obs.r + 1);
    }
  });
}

io.on('connection', (socket) => {
  let lobbyId = null;
  const id = socket.id;

  socket.on('join', ({ lobby, name, color }) => {
    const l = lobbies[lobby];
    if (!l) return;
    if (playerCount(lobby) >= MAX_PLAYERS) { socket.emit('lobby_full'); return; }
    lobbyId = lobby;
    socket.join(`lobby_${lobby}`);
    l.players[id] = {
      id, name: (name || 'Player').slice(0, 16),
      x: 150 + Math.random() * (MAP_W - 300),
      y: 150 + Math.random() * (MAP_H - 300),
      hp: MAX_HP, alive: true,
      color: color || `hsl(${Math.floor(Math.random() * 360)},70%,60%)`,
      keys: { up: false, down: false, left: false, right: false },
      angle: 0, vx: 0, vy: 0,
      rockCooldown: 0, kameCooldown: 0, dashCooldown: 0,
      shieldActive: false, shieldTimer: 0, shieldCooldown: 0,
      ammo: MAX_AMMO, ammoTimer: 0,
      lastHitBy: null
    };
    socket.emit('joined', { id, mapW: MAP_W, mapH: MAP_H, obstacles: OBSTACLES });
  });

  socket.on('input', ({ keys, angle }) => {
    if (!lobbyId) return;
    const p = lobbies[lobbyId].players[id];
    if (!p || !p.alive) return;
    p.keys = keys; p.angle = angle;
  });

  socket.on('throw', ({ angle }) => {
    if (!lobbyId) return;
    const l = lobbies[lobbyId];
    const p = l.players[id];
    if (!p || !p.alive || p.rockCooldown > 0 || p.ammo <= 0) return;
    p.rockCooldown = ROCK_COOLDOWN;
    p.ammo--;
    l.rocks.push({
      id: l.rockCounter++,
      x: p.x + Math.cos(angle) * (PLAYER_R + ROCK_R + 2),
      y: p.y + Math.sin(angle) * (PLAYER_R + ROCK_R + 2),
      vx: Math.cos(angle) * ROCK_SPEED,
      vy: Math.sin(angle) * ROCK_SPEED,
      owner: id, life: 220, bounces: 0
    });
  });

  socket.on('shield', () => {
    if (!lobbyId) return;
    const p = lobbies[lobbyId].players[id];
    if (!p || !p.alive || p.shieldCooldown > 0 || p.shieldActive) return;
    p.shieldActive = true;
    p.shieldTimer = SHIELD_DURATION;
    p.shieldCooldown = SHIELD_COOLDOWN;
  });

  socket.on('dash', () => {
    if (!lobbyId) return;
    const p = lobbies[lobbyId].players[id];
    if (!p || !p.alive || p.dashCooldown > 0) return;
    p.dashCooldown = DASH_COOLDOWN;
    const fwdX = Math.cos(p.angle), fwdY = Math.sin(p.angle);
    const lefX = Math.sin(p.angle), lefY = -Math.cos(p.angle);
    let dvx = 0, dvy = 0;
    if (p.keys.up)    { dvx += fwdX; dvy += fwdY; }
    if (p.keys.down)  { dvx -= fwdX; dvy -= fwdY; }
    if (p.keys.left)  { dvx += lefX; dvy += lefY; }
    if (p.keys.right) { dvx -= lefX; dvy -= lefY; }
    const dlen = Math.hypot(dvx, dvy) || 1;
    p.vx = (dvx / dlen) * DASH_FORCE;
    p.vy = (dvy / dlen) * DASH_FORCE;
  });

  socket.on('kamehameha', ({ angle }) => {
    if (!lobbyId) return;
    const l = lobbies[lobbyId];
    const p = l.players[id];
    if (!p || !p.alive || p.kameCooldown > 0) return;
    p.kameCooldown = KAME_COOLDOWN;
    const bx2 = p.x + Math.cos(angle) * KAME_BEAM_LEN;
    const by2 = p.y + Math.sin(angle) * KAME_BEAM_LEN;
    for (const pid in l.players) {
      if (pid === id) continue;
      const t = l.players[pid];
      if (!t.alive) continue;
      if (distToSegment(t.x, t.y, p.x, p.y, bx2, by2) < KAME_BEAM_WIDTH) {
        if (t.shieldActive) { t.shieldActive = false; t.shieldTimer = 0; continue; }
        t.hp -= KAME_DAMAGE;
        t.lastHitBy = id;
        if (t.hp <= 0) {
          t.hp = 0; t.alive = false;
          io.to(`lobby_${lobbyId}`).emit('kill', { killer: p.name, victim: t.name });
        }
      }
    }
    l.beams.push({ id: l.rockCounter++, x: p.x, y: p.y, angle, life: 30 });
  });

  socket.on('disconnect', () => {
    if (!lobbyId) return;
    delete lobbies[lobbyId].players[id];
  });
});

setInterval(() => {
  for (const lid in lobbies) {
    const l = lobbies[lid];
    for (const pid in l.players) {
      const p = l.players[pid];
      if (!p.alive) continue;

      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.78; p.vy *= 0.78;
      if (Math.abs(p.vx) < 0.1) p.vx = 0;
      if (Math.abs(p.vy) < 0.1) p.vy = 0;

      // FPS-relative movement (WASD moves relative to facing direction)
      const fwdX = Math.cos(p.angle), fwdY = Math.sin(p.angle);
      const lefX = Math.sin(p.angle), lefY = -Math.cos(p.angle);
      if (p.keys.up)    { p.x += fwdX * PLAYER_SPEED; p.y += fwdY * PLAYER_SPEED; }
      if (p.keys.down)  { p.x -= fwdX * PLAYER_SPEED; p.y -= fwdY * PLAYER_SPEED; }
      if (p.keys.left)  { p.x += lefX * PLAYER_SPEED; p.y += lefY * PLAYER_SPEED; }
      if (p.keys.right) { p.x -= lefX * PLAYER_SPEED; p.y -= lefY * PLAYER_SPEED; }

      p.x = Math.max(PLAYER_R, Math.min(MAP_W - PLAYER_R, p.x));
      p.y = Math.max(PLAYER_R, Math.min(MAP_H - PLAYER_R, p.y));
      pushOutObstacles(p);

      if (p.rockCooldown > 0) p.rockCooldown--;
      if (p.kameCooldown > 0) p.kameCooldown--;
      if (p.dashCooldown > 0) p.dashCooldown--;
      if (p.shieldTimer > 0) { p.shieldTimer--; if (p.shieldTimer === 0) p.shieldActive = false; }
      if (p.shieldCooldown > 0 && !p.shieldActive) p.shieldCooldown--;
      if (p.ammo < MAX_AMMO) { p.ammoTimer++; if (p.ammoTimer >= AMMO_REFILL_RATE) { p.ammo++; p.ammoTimer = 0; } }
    }

    l.rocks = l.rocks.filter(r => {
      r.x += r.vx; r.y += r.vy; r.life--;
      if (r.life <= 0) return false;
      if (r.x < ROCK_R)         { r.x = ROCK_R;         r.vx *= -1; r.bounces++; }
      if (r.x > MAP_W - ROCK_R) { r.x = MAP_W - ROCK_R; r.vx *= -1; r.bounces++; }
      if (r.y < ROCK_R)         { r.y = ROCK_R;         r.vy *= -1; r.bounces++; }
      if (r.y > MAP_H - ROCK_R) { r.y = MAP_H - ROCK_R; r.vy *= -1; r.bounces++; }
      if (r.bounces > MAX_BOUNCES) return false;
      for (const obs of OBSTACLES) {
        const dx = r.x - obs.x, dy = r.y - obs.y;
        const dist = Math.hypot(dx, dy);
        if (dist < ROCK_R + obs.r) {
          const nx = dx / dist, ny = dy / dist;
          const dot = r.vx * nx + r.vy * ny;
          r.vx -= 2 * dot * nx; r.vy -= 2 * dot * ny;
          r.x = obs.x + nx * (ROCK_R + obs.r + 1);
          r.y = obs.y + ny * (ROCK_R + obs.r + 1);
          r.bounces++; break;
        }
      }
      for (const pid in l.players) {
        if (pid === r.owner) continue;
        const p = l.players[pid];
        if (!p.alive) continue;
        if (Math.hypot(r.x - p.x, r.y - p.y) < PLAYER_R + ROCK_R) {
          if (p.shieldActive) { p.shieldActive = false; p.shieldTimer = 0; return false; }
          p.hp -= HIT_DAMAGE;
          p.lastHitBy = r.owner;
          if (p.hp <= 0) {
            p.hp = 0; p.alive = false;
            const killer = l.players[r.owner];
            io.to(`lobby_${lid}`).emit('kill', { killer: killer?.name || '?', victim: p.name });
          }
          return false;
        }
      }
      return true;
    });

    l.beams = l.beams.filter(b => { b.life--; return b.life > 0; });
    if (Object.keys(l.players).length === 0) continue;

    io.to(`lobby_${lid}`).emit('state', {
      players: Object.values(l.players).map(p => ({
        id: p.id, name: p.name, x: p.x, y: p.y,
        hp: p.hp, alive: p.alive, color: p.color, angle: p.angle,
        ready: p.rockCooldown === 0, kamReady: p.kameCooldown === 0,
        dashCooldown: p.dashCooldown, shieldActive: p.shieldActive,
        shieldCooldown: p.shieldCooldown, ammo: p.ammo
      })),
      rocks: l.rocks.map(r => ({ id: r.id, x: r.x, y: r.y, bounces: r.bounces })),
      beams: l.beams.map(b => ({ id: b.id, x: b.x, y: b.y, angle: b.angle, life: b.life }))
    });
  }
}, 1000 / TICK_RATE);

app.get('/api/lobbies', (req, res) => {
  res.json(Object.keys(lobbies).map(id => ({ id: parseInt(id), count: playerCount(id), max: MAX_PLAYERS })));
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Rock Arena running on port ${PORT}`));
