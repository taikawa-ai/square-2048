const WORLD_W = 3000;
const WORLD_H = 2000;
const SUM_CAP = 2047;
const GAME_DURATION = 300; // seconds
const NUM_BOTS = 7;
const NUM_FLOATING_BLOCKS = 45;
const RESPAWN_DELAY = 3000; // ms
const BASE_SPEED = 160 * 1.3; // px/sec
const TURN_RATE = Math.PI * 2.2; // rad/sec
const SEGMENT_GAP = 6; // px gap between adjacent square blocks
const HIT_MARGIN = 6; // extra forgiveness for pickup/steal/head hit boxes
const MULTIPLIER_HALF = 20; // half-size of x2/div2 power-up blocks
const INITIAL_SUM = 32;
const MIN_RESPAWN_VALUE = 2;
const NUM_FLOORS = 5;
const FLOOR_SIZE = 180;
const FLOOR_RESPAWN_MIN = 6000; // ms before a used-up floor reappears elsewhere
const FLOOR_RESPAWN_MAX = 12000;
const BOOST_MULTIPLIER = 1.9;
const FLOOR_BOOST_DURATION = 2500; // ms, from stepping on a dash floor
const BUTTON_BOOST_DURATION = 2000; // ms, from pressing the boost button
const BUTTON_BOOST_COOLDOWN = 8000; // ms between button boosts

// Half the side length of a block's square hitbox/sprite, based on its value.
function blockHalfSize(value) {
  return 10 + Math.min(18, Math.log2(value) * 3);
}

// Square-vs-square (AABB) overlap test. Returns the penetration on each axis
// (positive means overlapping) plus the center-to-center delta, or null if
// the squares don't intersect at all.
function squareOverlap(ax, ay, aHalf, bx, by, bHalf, margin = 0) {
  const dx = ax - bx;
  const dy = ay - by;
  const ox = aHalf + bHalf + margin - Math.abs(dx);
  const oy = aHalf + bHalf + margin - Math.abs(dy);
  if (ox <= 0 || oy <= 0) return null;
  return { ox, oy, dx, dy };
}

const BLOCK_WEIGHTS = [
  { value: 1, weight: 30 },
  { value: 2, weight: 26 },
  { value: 4, weight: 20 },
  { value: 8, weight: 12 },
  { value: 16, weight: 7 },
  { value: 32, weight: 3 },
  { value: 64, weight: 1 },
  { value: 128, weight: 0.3 }, // rare
];

// Chance a spawned floating block is a power-up rather than a plain number.
const MULTIPLIER_CHANCE = 0.06; // x2
const DIVIDER_CHANCE = 0.06; // /2

function isPrime(n) {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
  return true;
}

// Special floor tiles. 'double' floors double the player's number, but only
// if their current total satisfies the tile's condition. 'speed' floors just
// give a temporary speed boost to whoever steps on them. Each floor is
// single-use: once triggered it disappears and reappears elsewhere later.
const FLOOR_DEFS = [
  { type: 'double', label: '素数', color: '#ff6b6b', test: (n) => isPrime(n) },
  { type: 'double', label: '3の倍数', color: '#4fd3c4', test: (n) => n % 3 === 0 },
  { type: 'double', label: '4の倍数', color: '#7c83fd', test: (n) => n % 4 === 0 },
  { type: 'double', label: '5の倍数', color: '#ffd54a', test: (n) => n % 5 === 0 },
  { type: 'double', label: '7の倍数', color: '#69db7c', test: (n) => n % 7 === 0 },
  { type: 'double', label: '奇数', color: '#e879f9', test: (n) => n % 2 === 1 },
  { type: 'speed', label: 'ダッシュ', color: '#38bdf8' },
];

const BOT_NAMES = [
  'ミク', 'ハルト', 'ソラ', 'レン', 'アオイ', 'ユナ', 'カイ', 'リン', 'ノア', 'ヒナ',
];

const COLORS = [
  '#4fd3c4', '#ff6b6b', '#ffd54a', '#7c83fd', '#ff9f6b', '#69db7c', '#e879f9', '#60a5fa',
];

function pickWeightedValue() {
  const total = BLOCK_WEIGHTS.reduce((s, b) => s + b.weight, 0);
  let r = Math.random() * total;
  for (const b of BLOCK_WEIGHTS) {
    if (r < b.weight) return b.value;
    r -= b.weight;
  }
  return 1;
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

// Decompose a sum into its binary components (descending), e.g. 15 -> [8,4,2,1].
// The chain is always kept in this canonical form, so the largest block is
// always the head, and picking up a matching block carries just like binary addition.
function bitsOf(n) {
  const bits = [];
  for (let p = 1024; p >= 1; p /= 2) {
    if (n & p) bits.push(p);
  }
  return bits;
}

class Snake {
  constructor(id, name, isPlayer, color) {
    this.id = id;
    this.name = name;
    this.isPlayer = isPlayer;
    this.color = color;
    this.trophies = 0;
    this.eatenCount = 0;
    this.spawn();
  }

  spawn(sum = INITIAL_SUM) {
    this.x = randRange(200, WORLD_W - 200);
    this.y = randRange(200, WORLD_H - 200);
    this.angle = Math.random() * Math.PI * 2;
    this.desiredAngle = this.angle;
    this.sum = sum;
    this.path = [{ x: this.x, y: this.y }];
    this.alive = true;
    this.respawnAt = 0;
    this.aiTarget = null;
    this.aiRepathAt = 0;
    this.boostUntil = 0;
    this.boostReadyAt = 0;
  }

  get chain() {
    return bitsOf(this.sum);
  }

  get headValue() {
    return this.chain[0];
  }

  segmentPositions() {
    const chain = this.chain;
    const positions = [];
    let dist = 0;
    let pi = this.path.length - 1;
    let prev = this.path[pi];
    let cumulative = 0;
    for (let i = 0; i < chain.length; i++) {
      if (i > 0) {
        cumulative += blockHalfSize(chain[i - 1]) + blockHalfSize(chain[i]) + SEGMENT_GAP;
      }
      while (dist < cumulative && pi > 0) {
        pi--;
        const cur = this.path[pi];
        dist += Math.hypot(cur.x - prev.x, cur.y - prev.y);
        prev = cur;
      }
      positions.push({ x: prev.x, y: prev.y, value: chain[i] });
    }
    return positions;
  }
}

// Total distance from the head to the tail-end of a chain once every
// adjacent pair of blocks is packed edge-to-edge (used to size path history).
function chainSpan(chain) {
  let span = 0;
  for (let i = 1; i < chain.length; i++) {
    span += blockHalfSize(chain[i - 1]) + blockHalfSize(chain[i]) + SEGMENT_GAP;
  }
  return span;
}

export class Game {
  constructor({ onEnd }) {
    this.onEnd = onEnd;
    this.entities = [];
    this.blocks = [];
    this.timeLeft = GAME_DURATION;
    this.running = false;
    this.keys = { up: false, down: false, left: false, right: false };
    this.pointerActive = false;
    this.pointerAngle = 0;
    this._nextId = 1;
    this._setupInput();
  }

  // Touch/drag steering (mobile): the caller feeds an absolute angle computed
  // from where the pointer is relative to the player, which overrides keys
  // while active. Call clearPointer() on release to fall back to keys.
  setPointerAngle(angle) {
    this.pointerActive = true;
    this.pointerAngle = angle;
  }

  clearPointer() {
    this.pointerActive = false;
  }

  _setupInput() {
    const map = {
      ArrowUp: 'up', KeyW: 'up',
      ArrowDown: 'down', KeyS: 'down',
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
    };
    window.addEventListener('keydown', (e) => {
      if (map[e.code]) this.keys[map[e.code]] = true;
      if (e.code === 'Space' && !e.repeat) this.triggerPlayerBoost();
    });
    window.addEventListener('keyup', (e) => {
      if (map[e.code]) this.keys[map[e.code]] = false;
    });
  }

  start() {
    this.entities = [];
    this.blocks = [];
    this.timeLeft = GAME_DURATION;
    this.running = true;

    this.player = new Snake(this._nextId++, 'あなた', true, '#ffd54a');
    this.entities.push(this.player);
    for (let i = 0; i < NUM_BOTS; i++) {
      const name = BOT_NAMES[i % BOT_NAMES.length];
      const color = COLORS[i % COLORS.length];
      this.entities.push(new Snake(this._nextId++, name, false, color));
    }
    for (let i = 0; i < NUM_FLOATING_BLOCKS; i++) this._spawnBlock();

    this.floors = [];
    for (let i = 0; i < NUM_FLOORS; i++) this._spawnFloor();
  }

  _spawnFloor() {
    const def = FLOOR_DEFS[Math.floor(Math.random() * FLOOR_DEFS.length)];
    this.floors.push({
      id: this._nextId++,
      ...def,
      x: randRange(300, WORLD_W - 300),
      y: randRange(300, WORLD_H - 300),
      w: FLOOR_SIZE,
      h: FLOOR_SIZE,
    });
  }

  _consumeFloor(index) {
    this.floors.splice(index, 1);
    setTimeout(() => this._spawnFloor(), randRange(FLOOR_RESPAWN_MIN, FLOOR_RESPAWN_MAX));
  }

  _spawnBlock() {
    const r = Math.random();
    let kind;
    if (r < MULTIPLIER_CHANCE) kind = { kind: 'multiplier', op: 'x2' };
    else if (r < MULTIPLIER_CHANCE + DIVIDER_CHANCE) kind = { kind: 'multiplier', op: 'div2' };
    else kind = { kind: 'number', value: pickWeightedValue() };

    this.blocks.push({
      id: this._nextId++,
      ...kind,
      x: randRange(60, WORLD_W - 60),
      y: randRange(60, WORLD_H - 60),
    });
  }

  update(dt) {
    if (!this.running) return;

    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.running = false;
      this.onEnd?.(this._standings());
      return;
    }

    for (const s of this.entities) {
      if (!s.alive) {
        if (performance.now() >= s.respawnAt) s.spawn(s.respawnSum);
        continue;
      }
      if (s.isPlayer) this._steerPlayer(s);
      else this._steerBot(s, dt);
      this._moveSnake(s, dt);
      this._resolveBlockObstacles(s);
    }

    this._resolvePickups();
    this._resolveCombat();
    this._resolveFloors();
  }

  _steerPlayer(s) {
    if (this.pointerActive) {
      s.desiredAngle = this.pointerAngle;
      return;
    }
    const { up, down, left, right } = this.keys;
    let vx = (right ? 1 : 0) - (left ? 1 : 0);
    let vy = (down ? 1 : 0) - (up ? 1 : 0);
    if (vx !== 0 || vy !== 0) s.desiredAngle = Math.atan2(vy, vx);
  }

  _steerBot(s, dt) {
    const now = performance.now();
    if (!s.aiTarget || now >= s.aiRepathAt) {
      s.aiTarget = this._chooseBotTarget(s);
      s.aiRepathAt = now + randRange(600, 1200);
    }
    if (s.aiTarget) {
      s.desiredAngle = Math.atan2(s.aiTarget.y - s.y, s.aiTarget.x - s.x);
    }
    // steer away from walls
    const margin = 120;
    if (s.x < margin) s.desiredAngle = 0;
    else if (s.x > WORLD_W - margin) s.desiredAngle = Math.PI;
    if (s.y < margin) s.desiredAngle = Math.PI / 2;
    else if (s.y > WORLD_H - margin) s.desiredAngle = -Math.PI / 2;
  }

  _chooseBotTarget(s) {
    const SEARCH = 500;
    let best = null;
    let bestD = Infinity;
    for (const b of this.blocks) {
      if (b.value > s.headValue) continue;
      const d = Math.hypot(b.x - s.x, b.y - s.y);
      if (d < SEARCH && d < bestD) { bestD = d; best = { x: b.x, y: b.y }; }
    }
    if (best) return best;
    for (const other of this.entities) {
      if (other === s || !other.alive) continue;
      const positions = other.segmentPositions();
      for (let i = 1; i < positions.length; i++) {
        const seg = positions[i];
        if (seg.value >= s.headValue) continue;
        const d = Math.hypot(seg.x - s.x, seg.y - s.y);
        if (d < SEARCH && d < bestD) { bestD = d; best = { x: seg.x, y: seg.y }; }
      }
    }
    if (best) return best;
    return { x: randRange(0, WORLD_W), y: randRange(0, WORLD_H) };
  }

  _moveSnake(s, dt) {
    let diff = s.desiredAngle - s.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = TURN_RATE * dt;
    s.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));

    const speed = performance.now() < s.boostUntil ? BASE_SPEED * BOOST_MULTIPLIER : BASE_SPEED;
    s.x += Math.cos(s.angle) * speed * dt;
    s.y += Math.sin(s.angle) * speed * dt;
    s.x = Math.max(10, Math.min(WORLD_W - 10, s.x));
    s.y = Math.max(10, Math.min(WORLD_H - 10, s.y));

    s.path.push({ x: s.x, y: s.y });
    const maxPathLen = chainSpan(s.chain) / (BASE_SPEED * dt) + 20;
    if (s.path.length > maxPathLen) s.path.splice(0, s.path.length - maxPathLen);
  }

  // Floating blocks bigger than a snake's head act as solid obstacles: the
  // head gets pushed back out along the shallowest axis instead of passing through.
  _resolveBlockObstacles(s) {
    const aHalf = blockHalfSize(s.headValue);
    for (const b of this.blocks) {
      if (b.kind === 'multiplier') continue;
      if (b.value <= s.headValue) continue;
      const o = squareOverlap(s.x, s.y, aHalf, b.x, b.y, blockHalfSize(b.value));
      if (!o) continue;
      if (o.ox < o.oy) s.x += Math.sign(o.dx || 1) * o.ox;
      else s.y += Math.sign(o.dy || 1) * o.oy;
      s.x = Math.max(10, Math.min(WORLD_W - 10, s.x));
      s.y = Math.max(10, Math.min(WORLD_H - 10, s.y));
    }
  }

  _applyGrowth(s, value) {
    s.sum += value;
    if (s.sum >= 2048) {
      s.sum = 2;
      s.trophies++;
    }
  }

  _applyMultiplier(s, factor) {
    if (factor > 1) {
      s.sum *= factor;
      if (s.sum >= 2048) {
        s.sum = 2;
        s.trophies++;
      }
    } else {
      // Truncate down when the sum is odd (e.g. 41 -> 20), never round up.
      s.sum = Math.max(1, Math.floor(s.sum * factor));
    }
  }

  _applyBoost(s, duration) {
    s.boostUntil = Math.max(s.boostUntil, performance.now() + duration);
  }

  // Called by the boost button / key. Gated by its own cooldown, separate
  // from the free speed boosts granted by dash floors.
  triggerPlayerBoost() {
    const s = this.player;
    if (!s || !s.alive) return false;
    const now = performance.now();
    if (now < (s.boostReadyAt || 0)) return false;
    this._applyBoost(s, BUTTON_BOOST_DURATION);
    s.boostReadyAt = now + BUTTON_BOOST_COOLDOWN;
    return true;
  }

  _resolvePickups() {
    for (const s of this.entities) {
      if (!s.alive) continue;
      const aHalf = blockHalfSize(s.headValue);
      for (let i = this.blocks.length - 1; i >= 0; i--) {
        const b = this.blocks[i];
        if (b.kind === 'multiplier') {
          if (squareOverlap(s.x, s.y, aHalf, b.x, b.y, MULTIPLIER_HALF, HIT_MARGIN)) {
            this.blocks.splice(i, 1);
            this._applyMultiplier(s, b.op === 'x2' ? 2 : 0.5);
            setTimeout(() => this._spawnBlock(), randRange(400, 1500));
          }
          continue;
        }
        if (b.value > s.headValue) continue;
        if (squareOverlap(s.x, s.y, aHalf, b.x, b.y, blockHalfSize(b.value), HIT_MARGIN)) {
          this.blocks.splice(i, 1);
          this._applyGrowth(s, b.value);
          setTimeout(() => this._spawnBlock(), randRange(400, 1500));
        }
      }
    }
  }

  _resolveFloors() {
    for (let i = this.floors.length - 1; i >= 0; i--) {
      const f = this.floors[i];
      for (const s of this.entities) {
        if (!s.alive) continue;
        const half = blockHalfSize(s.headValue);
        const overlapping =
          Math.abs(s.x - f.x) < f.w / 2 + half && Math.abs(s.y - f.y) < f.h / 2 + half;
        if (!overlapping) continue;
        if (f.type === 'double' && f.test(s.sum)) {
          this._applyMultiplier(s, 2);
          this._consumeFloor(i);
          break;
        }
        if (f.type === 'speed') {
          this._applyBoost(s, FLOOR_BOOST_DURATION);
          this._consumeFloor(i);
          break;
        }
      }
    }
  }

  _resolveCombat() {
    const alive = this.entities.filter((s) => s.alive);
    for (const a of alive) {
      for (const b of alive) {
        if (a === b || !a.alive || !b.alive) continue;
        const aHalf = blockHalfSize(a.headValue);
        if (squareOverlap(a.x, a.y, aHalf, b.x, b.y, blockHalfSize(b.headValue), HIT_MARGIN)) {
          if (a.headValue > b.headValue) {
            this._applyGrowth(a, b.sum);
            this._kill(b);
          } else if (b.headValue > a.headValue) {
            this._applyGrowth(b, a.sum);
            this._kill(a);
          }
          continue;
        }
        const positions = b.segmentPositions();
        for (let i = 1; i < positions.length; i++) {
          const seg = positions[i];
          if (seg.value < a.headValue && squareOverlap(a.x, a.y, aHalf, seg.x, seg.y, blockHalfSize(seg.value), HIT_MARGIN)) {
            b.sum -= seg.value;
            this._applyGrowth(a, seg.value);
            break;
          }
        }
      }
    }
  }

  _kill(s) {
    s.alive = false;
    s.eatenCount++;
    s.respawnAt = performance.now() + RESPAWN_DELAY;
    s.respawnSum = Math.max(MIN_RESPAWN_VALUE, Math.floor(s.headValue / 2));
  }

  // Ranking: most trophies wins; ties broken by fewer times eaten.
  _standings() {
    return [...this.entities]
      .sort((a, b) => b.trophies - a.trophies || a.eatenCount - b.eatenCount)
      .map((s) => ({
        name: s.name,
        trophies: s.trophies,
        eatenCount: s.eatenCount,
        isPlayer: s.isPlayer,
      }));
  }

  standings() {
    return this._standings();
  }
}

export { WORLD_W, WORLD_H, SUM_CAP, GAME_DURATION, blockHalfSize, MULTIPLIER_HALF };
