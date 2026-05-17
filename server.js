const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

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

const lobbies = {};
for (let i = 1; i <= LOBBY_COUNT; i++) {
  lobbies[i] = { id: i, players: {}, rocks: [], beams: [], rockCounter: 0 };
}

function playerCount(id) {
  return Object.keys(lobbies[id].players).length;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
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
      id,
      name: (name || 'Player').slice(0, 16),
      x: 150 + Math.random() * (MAP_W - 300),
      y: 150 + Math.random() * (MAP_H - 300),
      hp: MAX_HP,
      alive: true,
      color: color || `hsl(${Math.floor(Math.random() * 360)},70%,60%)`,
      keys: { up: false, down: false, left: false, right: false },
      angle: 0,
      rockCooldown: 0,
      kameCooldown: 0
    };

    socket.emit('joined', { id, mapW: MAP_W, mapH: MAP_H });
  });

  socket.on('input', ({ keys, angle }) => {
    if (!lobbyId) return;
    const p = lobbies[lobbyId].players[id];
    if (!p || !p.alive) return;
    p.keys = keys;
    p.angle = angle;
  });

  socket.on('throw', ({ angle }) => {
    if (!lobbyId) return;
    const l = lobbies[lobbyId];
    const p = l.players[id];
    if (!p || !p.alive || p.rockCooldown > 0) return;
    p.rockCooldown = ROCK_COOLDOWN;
    l.rocks.push({
      id: l.rockCounter++,
      x: p.x + Math.cos(angle) * (PLAYER_R + ROCK_R + 2),
      y: p.y + Math.sin(angle) * (PLAYER_R + ROCK_R + 2),
      vx: Math.cos(angle) * ROCK_SPEED,
      vy: Math.sin(angle) * ROCK_SPEED,
      owner: id,
      life: 160
    });
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
        t.hp -= KAME_DAMAGE;
        if (t.hp <= 0) { t.hp = 0; t.alive = false; }
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
      if (p.keys.up)    p.y -= PLAYER_SPEED;
      if (p.keys.down)  p.y += PLAYER_SPEED;
      if (p.keys.left)  p.x -= PLAYER_SPEED;
      if (p.keys.right) p.x += PLAYER_SPEED;
      p.x = Math.max(PLAYER_R, Math.min(MAP_W - PLAYER_R, p.x));
      p.y = Math.max(PLAYER_R, Math.min(MAP_H - PLAYER_R, p.y));
      if (p.rockCooldown > 0) p.rockCooldown--;
      if (p.kameCooldown > 0) p.kameCooldown--;
    }

    l.rocks = l.rocks.filter(r => {
      r.x += r.vx; r.y += r.vy; r.life--;
      if (r.life <= 0 || r.x < 0 || r.x > MAP_W || r.y < 0 || r.y > MAP_H) return false;
      for (const pid in l.players) {
        if (pid === r.owner) continue;
        const p = l.players[pid];
        if (!p.alive) continue;
        if (Math.hypot(r.x - p.x, r.y - p.y) < PLAYER_R + ROCK_R) {
          p.hp -= HIT_DAMAGE;
          if (p.hp <= 0) { p.hp = 0; p.alive = false; }
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
        ready: p.rockCooldown === 0, kamReady: p.kameCooldown === 0
      })),
      rocks: l.rocks.map(r => ({ id: r.id, x: r.x, y: r.y })),
      beams: l.beams.map(b => ({ id: b.id, x: b.x, y: b.y, angle: b.angle, life: b.life }))
    });
  }
}, 1000 / TICK_RATE);

app.get('/api/lobbies', (req, res) => {
  res.json(Object.keys(lobbies).map(id => ({
    id: parseInt(id), count: playerCount(id), max: MAX_PLAYERS
  })));
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Rock Arena running on http://localhost:${PORT}`));
