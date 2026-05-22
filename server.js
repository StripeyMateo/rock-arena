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

const LOBBY_COUNT    = 3;
const MAX_PLAYERS    = 10;
const TICK_RATE      = 60;
const MAP_W          = 1600;
const MAP_H          = 1200;
const PLAYER_R       = 20;
const ROCK_R         = 8;
const PLAYER_SPEED   = 3;
const ROCK_SPEED     = 8;
const MAX_HP         = 75;
const HIT_DAMAGE     = 10;
const ROCK_COOLDOWN  = 36;
const KAME_COOLDOWN  = 480;
const KAME_BEAM_LEN  = 3000;
const KAME_BEAM_WIDTH = 40;
const KAME_DAMAGE    = 30;
const DASH_FORCE     = 22;
const DASH_COOLDOWN  = 180;
const MAX_BOUNCES    = 4;
const SHIELD_DURATION = 120;
const SHIELD_COOLDOWN = 480;
const MAX_AMMO       = 6;
const AMMO_REFILL_RATE = 80;
const JUMP_FORCE       = 15;
const GRAVITY          = 0.5;
const RESPAWN_TIME     = 180; // ticks = 3 s
const STREAK_TARGET    = 3;
const HEAL_AMOUNT      = 10;
const HEAL_COOLDOWN    = 360;  // 6 s
const SHOCKWAVE_RADIUS = 420;
const SHOCKWAVE_FORCE  = 68;
const SHOCKWAVE_COOLDOWN = 720; // 12 s

// ── Redeem codes ────────────────────────────────────────────────
const REDEEM_CODES = {
  // Public codes (shown in release notes)
  'ROCKSTAR':    { type: 'coins', coins: 500 },
  'ARENA2025':   { type: 'coins', coins: 200 },
  'NEWPLAYER':   { type: 'coins', coins: 150 },
  'HATKING':     { type: 'coins', coins: 400 },
  'BALLBUSTER':  { type: 'coins', coins: 300 },
  'COINFALL':    { type: 'coins', coins: 250 },
  'STONECOLD':   { type: 'coins', coins: 350 },
  'ROCKOUT':     { type: 'coins', coins: 450 },
  'ARENASTAR':   { type: 'coins', coins: 300 },
  'HATLIFE':     { type: 'coins', coins: 275 },
  // Secret code — not shown publicly
  'SUPERSECRET': { type: 'ability', ability: 'admin_kill' },
};
const usedCodesBySocket = {}; // socketId → Set of redeemed keys

// ── Private lobbies ─────────────────────────────────────────────
const privateLobbies = {};
function generateLobbyCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function getLobby(lid) { return lobbies[lid] || privateLobbies[lid] || null; }

const PLATFORMS = [
  { x: 480,  y: 390, r: 52, h: 72 },
  { x: 1120, y: 390, r: 52, h: 72 },
  { x: 480,  y: 810, r: 52, h: 72 },
  { x: 1120, y: 810, r: 52, h: 72 },
];

const PORTAL_POS = { x: 800, y: 68, r: 34 };

// Lobby 1 — Central Cluster (original layout)
const OBSTACLES_1 = [
  { x: 800,  y: 600, r: 62 },
  { x: 800,  y: 380, r: 42 },
  { x: 800,  y: 820, r: 42 },
  { x: 575,  y: 600, r: 42 },
  { x: 1025, y: 600, r: 42 },
  { x: 290,  y: 240, r: 52 },
  { x: 1310, y: 240, r: 52 },
  { x: 290,  y: 960, r: 52 },
  { x: 1310, y: 960, r: 52 },
  { x: 155,  y: 600, r: 38 },
  { x: 1445, y: 600, r: 38 },
  { x: 800,  y: 155, r: 38 },
  { x: 800,  y: 1045,r: 38 },
  { x: 480,  y: 380, r: 28 },
  { x: 1120, y: 380, r: 28 },
  { x: 480,  y: 820, r: 28 },
  { x: 1120, y: 820, r: 28 },
];

// Lobby 2 — Grid Arena (evenly-spaced pillars)
const OBSTACLES_2 = [
  { x: 400,  y: 300, r: 55 },
  { x: 800,  y: 300, r: 40 },
  { x: 1200, y: 300, r: 55 },
  { x: 400,  y: 600, r: 48 },
  { x: 800,  y: 600, r: 72 },
  { x: 1200, y: 600, r: 48 },
  { x: 400,  y: 900, r: 55 },
  { x: 800,  y: 900, r: 40 },
  { x: 1200, y: 900, r: 55 },
  { x: 160,  y: 160, r: 38 },
  { x: 1440, y: 160, r: 38 },
  { x: 160,  y: 1040,r: 38 },
  { x: 1440, y: 1040,r: 38 },
  { x: 160,  y: 450, r: 32 },
  { x: 1440, y: 450, r: 32 },
  { x: 160,  y: 750, r: 32 },
  { x: 1440, y: 750, r: 32 },
];

// Lobby 3 — Ring Arena (outer ring, open center)
const OBSTACLES_3 = [
  { x: 800,  y: 600, r: 55 },
  { x: 800,  y: 185, r: 52 },
  { x: 800,  y: 1015,r: 52 },
  { x: 220,  y: 600, r: 52 },
  { x: 1380, y: 600, r: 52 },
  { x: 400,  y: 300, r: 44 },
  { x: 1200, y: 300, r: 44 },
  { x: 400,  y: 900, r: 44 },
  { x: 1200, y: 900, r: 44 },
  { x: 580,  y: 175, r: 32 },
  { x: 1020, y: 175, r: 32 },
  { x: 580,  y: 1025,r: 32 },
  { x: 1020, y: 1025,r: 32 },
  { x: 175,  y: 380, r: 30 },
  { x: 1425, y: 380, r: 30 },
  { x: 175,  y: 820, r: 30 },
  { x: 1425, y: 820, r: 30 },
];

const LOBBY_OBSTACLES = { 1: OBSTACLES_1, 2: OBSTACLES_2, 3: OBSTACLES_3 };
// Keep a default for any shared server logic that needs an obstacle list
const OBSTACLES = OBSTACLES_1;

const lobbies = {};
for (let i = 1; i <= LOBBY_COUNT; i++) {
  lobbies[i] = { id: i, players: {}, rocks: [], beams: [], rockCounter: 0, obstacles: LOBBY_OBSTACLES[i] };
}

const sessionKills = {};

function playerCount(id) { return Object.keys(lobbies[id].players).length; }

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function pushOutObstacles(p, obsArray) {
  obsArray.forEach(obs => {
    const dx = p.x - obs.x, dy = p.y - obs.y;
    const dist = Math.hypot(dx, dy);
    if (dist < PLAYER_R + obs.r) {
      const ang = Math.atan2(dy, dx);
      p.x = obs.x + Math.cos(ang) * (PLAYER_R + obs.r + 1);
      p.y = obs.y + Math.sin(ang) * (PLAYER_R + obs.r + 1);
    }
  });
}

// Returns how far (in world units) a beam travels before hitting a wall
function getKameBeamLength(startX, startY, angle, obsArray) {
  const cdx = Math.cos(angle), cdy = Math.sin(angle);
  let len = KAME_BEAM_LEN;
  for (const obs of obsArray) {
    const dx = obs.x - startX, dy = obs.y - startY;
    const proj = dx * cdx + dy * cdy;
    if (proj <= 0) continue;
    const perp = Math.abs(-dx * cdy + dy * cdx);
    if (perp >= obs.r) continue;
    const entry = proj - Math.sqrt(obs.r * obs.r - perp * perp);
    if (entry > 0 && entry < len) len = entry;
  }
  return len;
}

function handleKill(l, lid, killerId, victim) {
  const killer = l.players[killerId];
  if (!killer) return;
  killer.killStreak++;
  sessionKills[killer.name] = (sessionKills[killer.name] || 0) + 1;
  io.to(`lobby_${lid}`).emit('kill', {
    killer: killer.name, victim: victim.name, streak: killer.killStreak,
    victimX: victim.x, victimY: victim.y
  });
  if (killer.killStreak >= STREAK_TARGET) {
    killer.killStreak = 0;
    const killerName = killer.name;
    // Warn immediately, delay actual meteors by 3 seconds
    io.to(`lobby_${lid}`).emit('meteor_shower', { shooter: killerName });
    setTimeout(() => {
      if (!lobbies[lid]) return;
      triggerMeteorShower(lobbies[lid], lid, killerId);
    }, 3000);
  }
}

function triggerMeteorShower(l, lid, ownerId) {
  // Target living enemies + random spots for saturation
  const enemyPositions = Object.values(l.players)
    .filter(p => p.alive && p.id !== ownerId)
    .map(p => ({ x: p.x, y: p.y }));

  // Build a grid of positions covering the whole map (6×5 = 30 cells)
  const COLS = 6, ROWS = 5;
  const cellW = MAP_W / COLS, cellH = MAP_H / ROWS;
  const gridPositions = [];
  for (let row = 0; row < ROWS; row++)
    for (let col = 0; col < COLS; col++)
      gridPositions.push({
        x: col * cellW + Math.random() * cellW,
        y: row * cellH + Math.random() * cellH
      });
  // Shuffle grid so meteors don't fall in order
  for (let i = gridPositions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [gridPositions[i], gridPositions[j]] = [gridPositions[j], gridPositions[i]];
  }

  const TOTAL = 36;
  for (let i = 0; i < TOTAL; i++) {
    setTimeout(() => {
      if (!lobbies[lid]) return;
      const ll = lobbies[lid];
      let mx, my;
      if (i < 6 && enemyPositions.length > 0) {
        // First 6 target living enemies with tight spread
        const target = enemyPositions[i % enemyPositions.length];
        mx = target.x + (Math.random() - 0.5) * 120;
        my = target.y + (Math.random() - 0.5) * 120;
      } else {
        // Rest spread across the whole map via shuffled grid
        const gp = gridPositions[i % gridPositions.length];
        mx = gp.x; my = gp.y;
      }
      ll.rocks.push({
        id: ll.rockCounter++,
        x: Math.max(40, Math.min(MAP_W - 40, mx)),
        y: Math.max(40, Math.min(MAP_H - 40, my)),
        vx: (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.5) * 1.5,
        z: 480 + Math.random() * 200,
        vz: -16 - Math.random() * 6,
        owner: ownerId, life: 280, bounces: 0, isMeteor: true
      });
    }, i * 160);
  }
}

io.on('connection', (socket) => {
  let lobbyId = null;
  let hasAdminKill = false; // set per session when code is redeemed
  const id = socket.id;

  socket.on('join', ({ lobby, name, color, hat, isPrivate }) => {
    const cleanName = (name || '').trim().slice(0, 16);
    if (!cleanName) { socket.emit('join_error', { msg: 'Please enter a name to play!' }); return; }

    let l, lid;
    if (isPrivate) {
      lid = String(lobby).toUpperCase();
      l = privateLobbies[lid];
      if (!l) { socket.emit('join_error', { msg: 'Private lobby not found. Check your code.' }); return; }
    } else {
      lid = parseInt(lobby);
      l = lobbies[lid];
      if (!l) return;
    }

    if (Object.keys(l.players).length >= MAX_PLAYERS) { socket.emit('lobby_full'); return; }

    // Name uniqueness within lobby
    const nameTaken = Object.values(l.players).some(p => p.name.toLowerCase() === cleanName.toLowerCase());
    if (nameTaken) { socket.emit('join_error', { msg: `Name "${cleanName}" is already in use. Pick another!` }); return; }

    // Leave previous lobby room
    if (lobbyId) {
      socket.leave(`lobby_${lobbyId}`);
      const prev = getLobby(lobbyId);
      if (prev) delete prev.players[id];
    }
    lobbyId = lid;
    socket.join(`lobby_${lid}`);

    l.players[id] = {
      id, name: cleanName, hat: hat || null,
      x: 200 + Math.random() * (MAP_W - 400),
      y: 200 + Math.random() * (MAP_H - 400),
      z: 0, vz: 0, onGround: true,
      hp: MAX_HP, alive: true,
      color: color || `hsl(${Math.floor(Math.random() * 360)},70%,60%)`,
      keys: { up: false, down: false, left: false, right: false },
      angle: 0, vx: 0, vy: 0,
      rockCooldown: 0, kameCooldown: 0, dashCooldown: 0,
      shieldActive: false, shieldTimer: 0, shieldCooldown: 0,
      ammo: MAX_AMMO, ammoTimer: 0,
      healCooldown: 0, shockwaveCooldown: 0,
      killStreak: 0, respawnTimer: 0, lastHitBy: null
    };
    socket.emit('joined', {
      id, mapW: MAP_W, mapH: MAP_H,
      obstacles: l.obstacles, platforms: PLATFORMS, portal: PORTAL_POS,
      lobbyId: lid
    });
  });

  socket.on('input', ({ keys, angle, kameCharging }) => {
    if (!lobbyId) return;
    const p = getLobby(lobbyId)?.players[id];
    if (!p || !p.alive) return;
    p.keys = keys; p.angle = angle;
    p.kameCharging = !!kameCharging;
  });

  socket.on('jump', () => {
    if (!lobbyId) return;
    const p = getLobby(lobbyId)?.players[id];
    if (!p || !p.alive || !p.onGround) return;
    p.vz = JUMP_FORCE; p.onGround = false;
  });

  socket.on('set_hat', ({ hat }) => {
    if (!lobbyId) return;
    const p = getLobby(lobbyId)?.players[id];
    if (p) p.hat = hat || null;
  });

  socket.on('redeem_code', ({ code }) => {
    const key = (code || '').toUpperCase().trim();
    const codeData = REDEEM_CODES[key];
    if (!codeData) { socket.emit('code_result', { ok: false, msg: 'Invalid code. Check spelling and try again.' }); return; }
    if (!usedCodesBySocket[id]) usedCodesBySocket[id] = new Set();
    if (usedCodesBySocket[id].has(key)) { socket.emit('code_result', { ok: false, msg: 'You already redeemed this code.' }); return; }
    usedCodesBySocket[id].add(key);
    if (codeData.type === 'ability' && codeData.ability === 'admin_kill') {
      hasAdminKill = true;
      socket.emit('code_result', { ok: true, type: 'ability', ability: 'admin_kill', msg: 'Special ability unlocked! Right-click players to use.' });
    } else {
      socket.emit('code_result', { ok: true, type: 'coins', coins: codeData.coins, msg: `+${codeData.coins} coins added!` });
    }
  });

  socket.on('throw', ({ angle }) => {
    if (!lobbyId) return;
    const l = getLobby(lobbyId);
    const p = l?.players[id];
    if (!p || !p.alive || p.rockCooldown > 0 || p.ammo <= 0) return;
    p.rockCooldown = ROCK_COOLDOWN; p.ammo--;
    l.rocks.push({
      id: l.rockCounter++,
      x: p.x + Math.cos(angle) * (PLAYER_R + ROCK_R + 2),
      y: p.y + Math.sin(angle) * (PLAYER_R + ROCK_R + 2),
      vx: Math.cos(angle) * ROCK_SPEED, vy: Math.sin(angle) * ROCK_SPEED,
      z: p.z + 12, vz: 0,
      owner: id, life: 220, bounces: 0, isMeteor: false
    });
  });

  socket.on('shield', () => {
    if (!lobbyId) return;
    const p = getLobby(lobbyId)?.players[id];
    if (!p || !p.alive || p.shieldCooldown > 0 || p.shieldActive) return;
    p.shieldActive = true; p.shieldTimer = SHIELD_DURATION; p.shieldCooldown = SHIELD_COOLDOWN;
  });

  socket.on('dash', () => {
    if (!lobbyId) return;
    const p = getLobby(lobbyId)?.players[id];
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
    p.vx = (dvx / dlen) * DASH_FORCE; p.vy = (dvy / dlen) * DASH_FORCE;
  });

  socket.on('kamehameha', ({ angle, pitch }) => {
    if (!lobbyId) return;
    const l = getLobby(lobbyId);
    const p = l?.players[id];
    if (!p || !p.alive || p.kameCooldown > 0) return;
    p.kameCooldown = KAME_COOLDOWN;
    // Beam stops at first wall — find actual endpoint
    const beamLen = getKameBeamLength(p.x, p.y, angle, l.obstacles);
    const bx2 = p.x + Math.cos(angle) * beamLen;
    const by2 = p.y + Math.sin(angle) * beamLen;
    // Sort players by distance so shield closest to shooter blocks everyone behind
    const inBeam = [];
    for (const pid in l.players) {
      if (pid === id) continue;
      const t = l.players[pid];
      if (!t.alive) continue;
      if (distToSegment(t.x, t.y, p.x, p.y, bx2, by2) < KAME_BEAM_WIDTH) {
        const d = Math.hypot(t.x - p.x, t.y - p.y);
        inBeam.push({ pid, t, d });
      }
    }
    inBeam.sort((a, b) => a.d - b.d);
    for (const { pid, t } of inBeam) {
      if (t.shieldActive) {
        // Front-only check: dot(player_forward, beam_direction) < 0 means facing each other
        const kDot = Math.cos(t.angle) * Math.cos(angle) + Math.sin(t.angle) * Math.sin(angle);
        if (kDot < 0) {
          // Shield absorbs kame from front — no damage, shield breaks, beam continues
          t.shieldActive = false; t.shieldTimer = 0;
          io.to(`lobby_${lobbyId}`).emit('shield_block', { x: t.x, y: t.y });
          continue; // beam passes through, everyone behind still gets hit
        }
        // Hit from behind — shield doesn't protect, fall through to damage
      }
      t.hp -= KAME_DAMAGE; t.lastHitBy = id;
      io.to(pid).emit('hit_flash');
      if (t.hp <= 0) {
        t.hp = 0; t.alive = false; t.respawnTimer = RESPAWN_TIME;
        handleKill(l, lobbyId, id, t);
      }
    }
    // Store actual beam length so client can render it stopping at wall
    l.beams.push({ id: l.rockCounter++, x: p.x, y: p.y, z: p.z + 22, angle, pitch: pitch || 0, life: 30, owner: id, len: beamLen });
  });

  socket.on('heal', () => {
    if (!lobbyId) return;
    const p = getLobby(lobbyId)?.players[id];
    if (!p || !p.alive || p.healCooldown > 0) return;
    p.hp = Math.min(MAX_HP, p.hp + HEAL_AMOUNT);
    p.healCooldown = HEAL_COOLDOWN;
    io.to(id).emit('healed', { hp: p.hp });
  });

  socket.on('shockwave', () => {
    if (!lobbyId) return;
    const l = getLobby(lobbyId);
    const p = l?.players[id];
    if (!p || !p.alive || p.shockwaveCooldown > 0) return;
    p.shockwaveCooldown = SHOCKWAVE_COOLDOWN;
    // Push players in radius and deal 5 damage
    for (const pid in l.players) {
      if (pid === id) continue;
      const t = l.players[pid];
      if (!t.alive) continue;
      const dx = t.x - p.x, dy = t.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist < SHOCKWAVE_RADIUS && dist > 0) {
        const strength = SHOCKWAVE_FORCE * (1 - dist / SHOCKWAVE_RADIUS);
        t.vx += (dx / dist) * strength;
        t.vy += (dy / dist) * strength;
        t.hp -= 5; t.lastHitBy = id;
        io.to(pid).emit('hit_flash');
        if (t.hp <= 0) {
          t.hp = 0; t.alive = false; t.respawnTimer = RESPAWN_TIME;
          handleKill(l, lobbyId, id, t);
        }
      }
    }
    io.to(`lobby_${lobbyId}`).emit('shockwave_fx', { x: p.x, y: p.y, r: SHOCKWAVE_RADIUS });
  });

  socket.on('admin_kill', ({ targetId }) => {
    if (!lobbyId || !hasAdminKill) return;
    const l = getLobby(lobbyId);
    const p = l?.players[id];
    if (!p || !p.alive) return;
    const target = l.players[targetId];
    if (!target || !target.alive) return;
    target.hp = 0; target.alive = false; target.respawnTimer = RESPAWN_TIME;
    target.lastHitBy = id;
    handleKill(l, lobbyId, id, target);
  });

  socket.on('disconnect', () => {
    if (!lobbyId) return;
    const l = getLobby(lobbyId);
    if (l) delete l.players[id];
    delete usedCodesBySocket[id];
  });
});

setInterval(() => {
  const allLobbies = Object.assign({}, lobbies, privateLobbies);
  for (const lid in allLobbies) {
    const l = allLobbies[lid];
    const portalExits = [];

    for (const pid in l.players) {
      const p = l.players[pid];

      if (!p.alive) {
        if (p.respawnTimer > 0) {
          p.respawnTimer--;
          if (p.respawnTimer === 0) {
            p.alive = true; p.hp = MAX_HP;
            p.x = 200 + Math.random() * (MAP_W - 400);
            p.y = 200 + Math.random() * (MAP_H - 400);
            p.z = 0; p.vz = 0; p.onGround = true;
          }
        }
        continue;
      }

      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.78; p.vy *= 0.78;
      if (Math.abs(p.vx) < 0.1) p.vx = 0;
      if (Math.abs(p.vy) < 0.1) p.vy = 0;

      const fwdX = Math.cos(p.angle), fwdY = Math.sin(p.angle);
      const lefX = Math.sin(p.angle), lefY = -Math.cos(p.angle);
      if (p.keys.up)    { p.x += fwdX * PLAYER_SPEED; p.y += fwdY * PLAYER_SPEED; }
      if (p.keys.down)  { p.x -= fwdX * PLAYER_SPEED; p.y -= fwdY * PLAYER_SPEED; }
      if (p.keys.left)  { p.x += lefX * PLAYER_SPEED; p.y += lefY * PLAYER_SPEED; }
      if (p.keys.right) { p.x -= lefX * PLAYER_SPEED; p.y -= lefY * PLAYER_SPEED; }

      p.x = Math.max(PLAYER_R, Math.min(MAP_W - PLAYER_R, p.x));
      p.y = Math.max(PLAYER_R, Math.min(MAP_H - PLAYER_R, p.y));
      pushOutObstacles(p, l.obstacles);

      // Z physics
      p.vz -= GRAVITY;
      p.z += p.vz;
      p.onGround = false;
      if (p.z <= 0) { p.z = 0; p.vz = 0; p.onGround = true; }
      for (const plat of PLATFORMS) {
        const d = Math.hypot(p.x - plat.x, p.y - plat.y);
        if (d < plat.r - PLAYER_R + 8 && p.vz <= 0 && p.z <= plat.h + 8 && p.z >= plat.h - 20) {
          p.z = plat.h; p.vz = 0; p.onGround = true; break;
        }
      }

      if (p.rockCooldown > 0) p.rockCooldown--;
      if (p.kameCooldown > 0) p.kameCooldown--;
      if (p.dashCooldown > 0) p.dashCooldown--;
      if (p.shieldTimer > 0) { p.shieldTimer--; if (p.shieldTimer === 0) p.shieldActive = false; }
      if (p.shieldCooldown > 0 && !p.shieldActive) p.shieldCooldown--;
      if (p.healCooldown > 0) p.healCooldown--;
      if (p.shockwaveCooldown > 0) p.shockwaveCooldown--;
      if (p.ammo < MAX_AMMO) { p.ammoTimer++; if (p.ammoTimer >= AMMO_REFILL_RATE) { p.ammo++; p.ammoTimer = 0; } }

      if (Math.hypot(p.x - PORTAL_POS.x, p.y - PORTAL_POS.y) < PORTAL_POS.r + PLAYER_R) {
        portalExits.push(pid);
      }
    }

    portalExits.forEach(pid => {
      const leavingName = l.players[pid]?.name || 'Player';
      // Remove from socket.io room so they stop receiving this lobby's state
      const leavingSocket = io.sockets.sockets.get(pid);
      if (leavingSocket) leavingSocket.leave(`lobby_${lid}`);
      io.to(pid).emit('portal_exit');
      delete l.players[pid];
      io.to(`lobby_${lid}`).emit('player_left', { name: leavingName });
    });

    l.rocks = l.rocks.filter(r => {
      if (r.isMeteor) {
        r.x += r.vx; r.y += r.vy;
        r.z += r.vz; r.life--;
        if (r.life <= 0) return false;
        if (r.z <= 0) {
          const SPLASH = 170;
          const METEOR_DMG = 10;
          const HIT_CHANCE = 0.60;
          for (const pid in l.players) {
            // Owner is always immune — check both pid and p.id for safety
            if (pid === r.owner) continue;
            const p = l.players[pid];
            if (!p || !p.alive || p.id === r.owner) continue;
            const dist = Math.hypot(r.x - p.x, r.y - p.y);
            if (dist < SPLASH) {
              if (Math.random() > HIT_CHANCE) continue; // 60% hit chance
              if (p.shieldActive) { p.shieldActive = false; p.shieldTimer = 0; continue; }
              p.hp -= METEOR_DMG; p.lastHitBy = r.owner;
              io.to(pid).emit('hit_flash');
              if (p.hp <= 0) {
                p.hp = 0; p.alive = false; p.respawnTimer = RESPAWN_TIME;
                handleKill(l, lid, r.owner, p);
              }
            }
          }
          return false;
        }
        return true;
      }

      r.x += r.vx; r.y += r.vy; r.life--;
      if (r.life <= 0) return false;
      if (r.x < ROCK_R)         { r.x = ROCK_R;         r.vx *= -1; r.bounces++; }
      if (r.x > MAP_W - ROCK_R) { r.x = MAP_W - ROCK_R; r.vx *= -1; r.bounces++; }
      if (r.y < ROCK_R)         { r.y = ROCK_R;         r.vy *= -1; r.bounces++; }
      if (r.y > MAP_H - ROCK_R) { r.y = MAP_H - ROCK_R; r.vy *= -1; r.bounces++; }
      if (r.bounces > MAX_BOUNCES) return false;
      for (const obs of l.obstacles) {
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
        if (p.z > 50) continue; // elevated players safe from ground rocks
        if (Math.hypot(r.x - p.x, r.y - p.y) < PLAYER_R + ROCK_R) {
          if (p.shieldActive) {
            // Front-only: rock velocity dot player forward < 0 means rock comes from in front
            const dot = r.vx * Math.cos(p.angle) + r.vy * Math.sin(p.angle);
            if (dot < 0) {
              p.shieldActive = false; p.shieldTimer = 0;
              io.to(`lobby_${lid}`).emit('shield_block', { x: p.x, y: p.y });
              return false; // rock absorbed
            }
            // Rock from behind — no protection, fall through
          }
          p.hp -= HIT_DAMAGE; p.lastHitBy = r.owner;
          io.to(pid).emit('hit_flash');
          if (p.hp <= 0) {
            p.hp = 0; p.alive = false; p.respawnTimer = RESPAWN_TIME;
            handleKill(l, lid, r.owner, p);
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
        id: p.id, name: p.name, x: p.x, y: p.y, z: p.z,
        hp: p.hp, alive: p.alive, color: p.color, angle: p.angle,
        hat: p.hat || null,
        ready: p.rockCooldown === 0, kamReady: p.kameCooldown === 0,
        dashCooldown: p.dashCooldown, shieldActive: p.shieldActive,
        shieldCooldown: p.shieldCooldown, ammo: p.ammo,
        healCooldown: p.healCooldown, shockwaveCooldown: p.shockwaveCooldown,
        killStreak: p.killStreak, respawnTimer: p.respawnTimer, onGround: p.onGround,
        kameCharging: p.kameCharging || false
      })),
      rocks: l.rocks.map(r => ({
        id: r.id, x: r.x, y: r.y,
        z: (r.z !== undefined ? r.z : 14),
        bounces: r.bounces, isMeteor: !!r.isMeteor
      })),
      beams: l.beams.map(b => ({ id: b.id, x: b.x, y: b.y, z: b.z || 22, angle: b.angle, pitch: b.pitch || 0, life: b.life, owner: b.owner, len: b.len || KAME_BEAM_LEN }))
    });
  }
}, 1000 / TICK_RATE);

app.get('/api/lobbies', (req, res) => {
  res.json(Object.keys(lobbies).map(id => ({ id: parseInt(id), count: playerCount(id), max: MAX_PLAYERS })));
});

app.post('/api/private/create', (req, res) => {
  let code;
  do { code = generateLobbyCode(); } while (privateLobbies[code]);
  privateLobbies[code] = {
    id: code, isPrivate: true,
    players: {}, rocks: [], beams: [], rockCounter: 0,
    obstacles: OBSTACLES_1
  };
  // Auto-clean private lobbies that have been empty for 30min
  setTimeout(() => {
    if (privateLobbies[code] && Object.keys(privateLobbies[code].players).length === 0) {
      delete privateLobbies[code];
    }
  }, 30 * 60 * 1000);
  res.json({ code });
});

app.get('/api/private/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const l = privateLobbies[code];
  if (!l) return res.json({ exists: false });
  res.json({ exists: true, count: Object.keys(l.players).length, max: MAX_PLAYERS });
});

app.get('/api/leaderboard', (req, res) => {
  const entries = Object.entries(sessionKills)
    .map(([name, kills]) => ({ name, kills }))
    .sort((a, b) => b.kills - a.kills)
    .slice(0, 15);
  res.json(entries);
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Rock Arena running on port ${PORT}`));
