import './style.css';
import { Game, WORLD_W, WORLD_H, blockHalfSize, MULTIPLIER_HALF } from './game.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayPanel = document.getElementById('overlay-panel');
const startBtn = document.getElementById('start-btn');
const timerEl = document.getElementById('hud-timer');
const trophyEl = document.getElementById('trophy-count');
const sumEl = document.getElementById('sum-count');
const leaderboardEl = document.getElementById('leaderboard');
const boostBtn = document.getElementById('boost-btn');
const toastEl = document.getElementById('toast');

let toastTimer = null;
function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 1600);
}

// View state in CSS pixels plus the device-pixel-ratio for the backing store.
// `zoom` shrinks the world on small screens so phone players still see a
// useful chunk of the field instead of getting ambushed off-screen.
const view = { w: window.innerWidth, h: window.innerHeight, dpr: 1, zoom: 1 };

function computeZoom() {
  const minDim = Math.min(view.w, view.h);
  return Math.max(0.55, Math.min(1, minDim / 720));
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  view.w = w;
  view.h = h;
  view.dpr = dpr;
  view.zoom = computeZoom();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
window.visualViewport?.addEventListener('resize', resize);
resize();

function fmtTime(t) {
  const m = Math.floor(t / 60).toString().padStart(2, '0');
  const s = Math.floor(t % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const game = new Game({
  onEnd: (standings) => showResults(standings),
  onMessage: (text) => showToast(text),
});

function showResults(standings) {
  const lines = standings
    .slice(0, 8)
    .map((s, i) => `${i + 1}. ${s.isPlayer ? '★ ' : ''}${s.name} — 🏆${s.trophies} 💀${s.eatenCount}`)
    .join('<br />');
  overlayPanel.innerHTML = `
    <h1>タイムアップ！</h1>
    <div class="result">${lines}</div>
    <button id="start-btn">もう一度プレイ</button>
  `;
  overlay.classList.remove('hidden');
  document.getElementById('start-btn').addEventListener('click', beginGame, { once: true });
}

function beginGame() {
  overlay.classList.add('hidden');
  game.start();
}

startBtn.addEventListener('click', beginGame, { once: true });
boostBtn.addEventListener('click', () => game.triggerPlayerBoost());

// Touch/drag steering: the player is always drawn at screen center (the
// camera follows them), so the pointer's offset from center gives the
// direction to travel. Works for touch, mouse, and pen via Pointer Events.
let activePointerId = null;
function pointerToAngle(e) {
  const rect = canvas.getBoundingClientRect();
  // Zoom/DPR are uniform scales, so they don't affect the direction angle.
  const dx = e.clientX - rect.left - rect.width / 2;
  const dy = e.clientY - rect.top - rect.height / 2;
  return Math.atan2(dy, dx);
}
canvas.addEventListener('pointerdown', (e) => {
  activePointerId = e.pointerId;
  game.setPointerAngle(pointerToAngle(e));
});
canvas.addEventListener('pointermove', (e) => {
  if (activePointerId !== e.pointerId) return;
  game.setPointerAngle(pointerToAngle(e));
});
function releasePointer(e) {
  if (activePointerId !== e.pointerId) return;
  activePointerId = null;
  game.clearPointer();
}
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);

function drawGrid(camX, camY) {
  const { w, h, zoom } = view;
  const step = 100; // world units
  const halfW = w / 2 / zoom;
  const halfH = h / 2 / zoom;
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  const startX = Math.floor((camX - halfW) / step) * step;
  const startY = Math.floor((camY - halfH) / step) * step;
  for (let x = startX; x < camX + halfW; x += step) {
    const sx = (x - camX) * zoom + w / 2;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
    ctx.stroke();
  }
  for (let y = startY; y < camY + halfH; y += step) {
    const sy = (y - camY) * zoom + h / 2;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
    ctx.stroke();
  }
}

function drawBlock(px, py, value, half, fill, textColor = '#1a1c2c') {
  const side = half * 2;
  ctx.beginPath();
  ctx.roundRect(px - half, py - half, side, side, Math.min(6, half * 0.3));
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.font = `${Math.max(10, half * 0.8)}px sans-serif`;
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(value, px, py + 1);
}

function drawFloor(f, camX, camY) {
  const { w, h, zoom } = view;
  const sx = (f.x - camX) * zoom + w / 2;
  const sy = (f.y - camY) * zoom + h / 2;
  const fw = f.w * zoom;
  const fh = f.h * zoom;
  if (sx < -fw || sx > w + fw || sy < -fh || sy > h + fh) return;
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = f.color;
  ctx.beginPath();
  ctx.roundRect(sx - fw / 2, sy - fh / 2, fw, fh, 14);
  ctx.fill();
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = f.color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  ctx.font = `bold ${Math.max(12, Math.min(22, fw * 0.13))}px sans-serif`;
  ctx.fillStyle = f.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const text =
    f.type === 'speed' ? `⚡ ${f.label}` : f.type === 'quad' ? `x4: ${f.label}` : `x2: ${f.label}`;
  ctx.fillText(text, sx, sy);
}

function render() {
  const { w, h, dpr, zoom } = view;
  const cam = game.player && game.player.alive ? game.player : null;
  const camX = cam ? cam.x : WORLD_W / 2;
  const camY = cam ? cam.y : WORLD_H / 2;

  // Draw in CSS pixels; the DPR scale keeps it crisp on retina.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#23263a';
  ctx.fillRect(0, 0, w, h);
  drawGrid(camX, camY);

  const toScreen = (x, y) => ({
    x: (x - camX) * zoom + w / 2,
    y: (y - camY) * zoom + h / 2,
  });

  // world bounds
  const tl = toScreen(0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 3;
  ctx.strokeRect(tl.x, tl.y, WORLD_W * zoom, WORLD_H * zoom);

  for (const f of game.floors ?? []) drawFloor(f, camX, camY);

  const margin = 40;
  for (const b of game.blocks) {
    const p = toScreen(b.x, b.y);
    if (p.x < -margin || p.x > w + margin || p.y < -margin || p.y > h + margin) continue;
    if (b.kind === 'multiplier') {
      const fill = b.op === 'x2' ? '#ffd54a' : b.op === 'x3' ? '#fb923c' : '#60a5fa';
      const label = b.op === 'x2' ? '×2' : b.op === 'x3' ? '×3' : '÷2';
      drawBlock(p.x, p.y, label, MULTIPLIER_HALF * zoom, fill);
    } else {
      drawBlock(p.x, p.y, b.value, blockHalfSize(b.value) * zoom, '#8b93b8');
    }
  }

  for (const s of game.entities) {
    if (!s.alive) continue;
    const invincible = s.isInvincible;
    if (invincible) ctx.globalAlpha = 0.5 + 0.4 * Math.sin(performance.now() / 90);
    const positions = s.segmentPositions();
    for (let i = positions.length - 1; i >= 0; i--) {
      const seg = positions[i];
      const p = toScreen(seg.x, seg.y);
      drawBlock(p.x, p.y, seg.value, blockHalfSize(seg.value) * zoom, s.color, '#12131c');
    }
    ctx.globalAlpha = 1;
    const headPos = toScreen(s.x, s.y);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(
      invincible ? `🛡️ ${s.name}` : s.name,
      headPos.x,
      headPos.y - blockHalfSize(s.headValue) * zoom - 10,
    );
  }
}

function updateHud() {
  timerEl.textContent = fmtTime(Math.max(0, game.timeLeft));
  if (game.player) {
    trophyEl.textContent = game.player.trophies;
    sumEl.textContent = game.player.alive ? game.player.sum : 0;

    const now = performance.now();
    const cooldownLeft = Math.max(0, (game.player.boostReadyAt ?? 0) - now);
    if (cooldownLeft > 0) {
      boostBtn.disabled = true;
      boostBtn.textContent = `⚡ ${Math.ceil(cooldownLeft / 1000)}`;
    } else {
      boostBtn.disabled = false;
      boostBtn.textContent = '⚡ ブースト';
    }
  }
  const standings = game.standings();
  const mySum = game.player ? (game.player.alive ? game.player.sum : 0) : 0;
  leaderboardEl.innerHTML = `<h3>リーダーボード</h3><ol>${standings
    .slice(0, 6)
    .map((s) => `<li class="${s.isPlayer ? 'me' : ''}">${s.name} 🏆${s.trophies} 💀${s.eatenCount}</li>`)
    .join('')}</ol><div id="my-value">${mySum}</div>`;
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game.running) {
    game.update(dt);
    updateHud();
  }
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
