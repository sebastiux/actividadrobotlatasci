// Juego: el usuario controla al Águila 5000 en la cancha de Coapa.
// Cada "jugada" es un paso del MDP: la zona donde termina el robot define la acción
// (cancha = buscar, banca = esperar, vestidor = recargar) y la batería transiciona con α / β.

import { ACTIONS, ACTION_EMOJI, transitions, actionsFor } from './model.js';
import { emptyQ, argmaxValid, greedyPolicy } from './algorithms.js';

const W = 960, H = 540;
const TURN_SECONDS = 5;
const TURNS = 18; // 18 jugadas × 5 minutos = 90 minutos
const BALLS_ON_FIELD = 5;
const RESPAWN_MS = 1200;
const SPEED = [270, 165]; // px/s con batería alta / baja
const ROBOT_R = 20, BALL_R = 9;
const ZONES = {
  vestidor: { x: 0, y: 0, w: 150, h: 170, label: 'VESTIDOR 🔋', color: 'rgba(27,175,122,.30)' },
  banca: { x: 360, y: H - 70, w: 240, h: 70, label: 'BANCA 🪑', color: 'rgba(235,104,52,.30)' },
};
const ETA = 0.2;

const inZone = (z, x, y) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
const rand = (a, b) => a + Math.random() * (b - a);
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

export function initGame({ getParams, getOptimal }) {
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);

  let G; // estado de la partida
  let Q = emptyQ(); // Q-learning alimentado por las jugadas del usuario (persiste entre partidas)
  let experience = 0;
  const keys = new Set();
  let pointer = null; // destino de mouse/touch en coordenadas lógicas
  let last = 0;
  let best = 0;
  try { best = parseFloat(localStorage.getItem('aguila-best')) || 0; } catch { /* sin almacenamiento */ }

  function newGame() {
    G = {
      mode: 'menu', // menu | playing | paused | rescue | turnEnd | over
      x: 75, y: 85, vx: 0, vy: 0, dir: 0,
      s: 0, turn: 0, tTurn: 0,
      balls: [], floats: [], particles: [],
      score: 0, G: 0, ballsTotal: 0, rescues: 0,
      turnBalls: 0, history: [], lastCard: null,
      rescueT: 0, cart: null, autopilot: false,
    };
    for (let i = 0; i < BALLS_ON_FIELD; i++) G.balls.push(spawnBall());
    renderSide();
  }

  function spawnBall() {
    for (let k = 0; k < 50; k++) {
      const b = { x: rand(40, W - 40), y: rand(40, H - 40), bob: Math.random() * 6 };
      if (!inZone(ZONES.vestidor, b.x, b.y) && !inZone(ZONES.banca, b.x, b.y) && Math.hypot(b.x - G.x, b.y - G.y) > 80) return b;
    }
    return { x: W / 2, y: H / 2, bob: 0 };
  }

  function zoneAction(x, y, s) {
    if (inZone(ZONES.vestidor, x, y)) return s === 1 ? 2 : 1; // en alta no existe recargar: cuenta como esperar
    if (inZone(ZONES.banca, x, y)) return 1;
    return 0;
  }

  // ---------------------------------------------------------------- fin de jugada = paso del MDP
  function endTurn() {
    const p = getParams();
    const s = G.s;
    const a = zoneAction(G.x, G.y, s);
    const ts = transitions(p, s, a);
    const u = Math.random();
    let acc = 0, tr = ts[ts.length - 1];
    for (const t of ts) { acc += t.prob; if (u < acc) { tr = t; break; } }

    // recompensa de la jugada: balones reales recogidos + recompensa de la acción si no es buscar
    // Recompensas idénticas al MDP: buscar paga r_s si recuperaste al menos un balón en la jugada
    let r;
    let why;
    if (tr.rescue) { r = p.rescue; why = `🚑 ¡Se vació la batería! (prob. 1−β = ${fmt(1 - p.beta)}) → castigo ${fmt(p.rescue, 1)}`; }
    else if (a === 0) { r = G.turnBalls ? p.rs : 0; why = (G.turnBalls ? '' : '¡Sin balón no hay r_s! ') + (s === 0 ? `Batería ${tr.s2 === 0 ? 'sigue alta' : 'baja a baja'} (prob. ${tr.s2 === 0 ? `α = ${fmt(p.alpha)}` : `1−α = ${fmt(1 - p.alpha)}`})` : `Batería sigue baja (prob. β = ${fmt(p.beta)})`); }
    else if (a === 1) { r = p.rw; why = `Un canterano le regresa balones: +r_w = ${fmt(p.rw, 1)}. Batería sin cambio (prob. 1)`; }
    else { r = 0; why = 'Recarga completa: batería → alta (prob. 1), recompensa 0'; }

    // Q-learning con la experiencia del jugador
    const target = r + p.gamma * Q[tr.s2][argmaxValid(Q[tr.s2], tr.s2)];
    const old = Q[s][a];
    Q[s][a] = old + ETA * (target - old);
    experience += 1;

    G.G += p.gamma ** G.turn * r;
    G.score += r;
    G.history.push({ turn: G.turn + 1, s, a, r, s2: tr.s2, balls: G.turnBalls, rescue: !!tr.rescue, q: [old, Q[s][a]] });
    const opt = getOptimal().policy[s];
    G.lastCard = {
      title: `Jugada ${G.turn + 1}: ${ACTION_EMOJI[a]} ${ACTIONS[a].toUpperCase()} con batería ${s === 0 ? 'alta' : 'baja'}`,
      lines: [`Recompensa: ${fmt(r, 1)} · balones en la jugada: ${G.turnBalls}`, why,
        opt === a ? '✔ Coincide con la política óptima π*' : `π* habría elegido ${ACTION_EMOJI[opt]} ${ACTIONS[opt]}`],
      bad: !!tr.rescue, t: 3.2,
    };
    G.turn += 1;
    G.turnBalls = 0;
    G.tTurn = 0;

    if (tr.rescue) {
      G.rescues += 1;
      G.mode = 'rescue';
      G.rescueT = 0;
      G.cart = { x: 75, y: 85, phase: 0 };
    } else {
      if (a === 2) burst(G.x, G.y, '#1baf7a', 24);
      G.s = tr.s2;
    }
    if (G.turn >= TURNS && G.mode !== 'rescue') finish();
    renderSide();
  }

  function finish() {
    G.mode = 'over';
    if (G.score > best) { best = G.score; try { localStorage.setItem('aguila-best', String(best)); } catch { /* nada */ } }
    renderSide();
  }

  function burst(x, y, color, n = 12) {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2, sp = rand(60, 220);
      G.particles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: rand(.4, .9), color });
    }
  }

  // ---------------------------------------------------------------- piloto automático (sigue π*)
  function autopilotTarget() {
    const a = getOptimal().policy[G.s];
    if (a === 2) return { x: 70, y: 80 };
    if (a === 1) return { x: ZONES.banca.x + ZONES.banca.w / 2, y: ZONES.banca.y + 35 };
    // buscar: balón más cercano, pero al final de la jugada asegurarse de estar en la cancha
    let bestB = null, bd = Infinity;
    for (const b of G.balls) { const d = Math.hypot(b.x - G.x, b.y - G.y); if (d < bd) { bd = d; bestB = b; } }
    return bestB || { x: W / 2, y: H / 2 };
  }

  // ---------------------------------------------------------------- bucle principal
  function update(dt) {
    const p = getParams();
    G.floats = G.floats.filter((f) => (f.t -= dt) > 0);
    G.particles = G.particles.filter((q) => { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= .92; q.vy *= .92; return (q.life -= dt) > 0; });
    if (G.lastCard && (G.lastCard.t -= dt) <= 0) G.lastCard = null;

    if (G.mode === 'rescue') {
      G.rescueT += dt;
      const c = G.cart;
      const tx = c.phase === 0 ? G.x : 75, ty = c.phase === 0 ? G.y : 85;
      const d = Math.hypot(tx - c.x, ty - c.y);
      const sp = 420 * dt;
      if (d <= sp) {
        c.x = tx; c.y = ty;
        if (c.phase === 0) c.phase = 1;
        else {
          G.x = 80; G.y = 85; G.s = 0; G.cart = null; G.mode = 'playing';
          if (G.turn >= TURNS) finish();
          renderSide();
        }
      } else { c.x += (tx - c.x) / d * sp; c.y += (ty - c.y) / d * sp; }
      if (c.phase === 1) { G.x = c.x + 22; G.y = c.y; }
      return;
    }
    if (G.mode !== 'playing') return;

    // dirección
    let dx = 0, dy = 0;
    if (G.autopilot) {
      const t = autopilotTarget();
      dx = t.x - G.x; dy = t.y - G.y;
      if (Math.hypot(dx, dy) < 6) { dx = 0; dy = 0; }
    } else {
      if (keys.has('ArrowLeft') || keys.has('a')) dx -= 1;
      if (keys.has('ArrowRight') || keys.has('d')) dx += 1;
      if (keys.has('ArrowUp') || keys.has('w')) dy -= 1;
      if (keys.has('ArrowDown') || keys.has('s')) dy += 1;
      if (!dx && !dy && pointer) {
        dx = pointer.x - G.x; dy = pointer.y - G.y;
        if (Math.hypot(dx, dy) < 8) { dx = 0; dy = 0; }
      }
    }
    const len = Math.hypot(dx, dy);
    const sp = SPEED[G.s];
    const tvx = len ? dx / len * sp : 0, tvy = len ? dy / len * sp : 0;
    G.vx += (tvx - G.vx) * Math.min(1, dt * 12);
    G.vy += (tvy - G.vy) * Math.min(1, dt * 12);
    G.x = Math.max(ROBOT_R, Math.min(W - ROBOT_R, G.x + G.vx * dt));
    G.y = Math.max(ROBOT_R, Math.min(H - ROBOT_R, G.y + G.vy * dt));
    if (Math.hypot(G.vx, G.vy) > 20) G.dir = Math.atan2(G.vy, G.vx);

    // recoger balones
    for (let i = G.balls.length - 1; i >= 0; i--) {
      const b = G.balls[i];
      if (Math.hypot(b.x - G.x, b.y - G.y) < ROBOT_R + BALL_R) {
        G.balls.splice(i, 1);
        G.turnBalls += 1; G.ballsTotal += 1;
        G.floats.push({ x: b.x, y: b.y - 10, t: .9, text: '⚽ ¡balón!' });
        burst(b.x, b.y, '#ffc72c');
        setTimeout(() => { if (G.balls.length < BALLS_ON_FIELD) G.balls.push(spawnBall()); }, RESPAWN_MS);
      }
    }

    G.tTurn += dt;
    if (G.tTurn >= TURN_SECONDS) endTurn();
    void p;
  }

  // ---------------------------------------------------------------- dibujo
  function drawField() {
    // pasto con franjas
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 ? '#2f8a3a' : '#349a40';
      ctx.fillRect(i * W / 12, 0, W / 12 + 1, H);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 3;
    ctx.strokeRect(12, 12, W - 24, H - 24);
    ctx.beginPath(); ctx.moveTo(W / 2, 12); ctx.lineTo(W / 2, H - 12); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 70, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 4, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeRect(W - 12 - 130, H / 2 - 120, 130, 240);
    ctx.strokeRect(W - 12 - 50, H / 2 - 60, 50, 120);
    ctx.strokeRect(12, H / 2 - 120, 130, 240);
    // portería derecha
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillRect(W - 12, H / 2 - 40, 10, 80);
    // escudo-texto central
    ctx.save();
    ctx.globalAlpha = .18;
    ctx.fillStyle = '#ffc72c';
    ctx.font = '700 64px "Bebas Neue", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('COAPA', W / 2, H / 2 + 22);
    ctx.restore();

    // zonas
    const p = getParams();
    const optA = getOptimal().policy[G.s];
    for (const [k, z] of Object.entries(ZONES)) {
      ctx.fillStyle = z.color;
      ctx.fillRect(z.x, z.y, z.w, z.h);
      const hint = $('gameHint').checked && G.mode === 'playing' && ((k === 'vestidor' && optA === 2) || (k === 'banca' && optA === 1));
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = hint ? '#ffc72c' : 'rgba(255,255,255,.8)';
      ctx.lineWidth = hint ? 5 : 2;
      ctx.strokeRect(z.x + 2, z.y + 2, z.w - 4, z.h - 4);
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      ctx.font = '700 16px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(z.label, z.x + z.w / 2, k === 'banca' ? z.y + 26 : z.y + z.h - 14);
      if (k === 'banca') {
        ctx.font = '600 12px Inter, sans-serif';
        ctx.fillText(`esperar · +${fmt(p.rw, 1)} por jugada`, z.x + z.w / 2, z.y + 48);
      } else {
        ctx.font = '600 12px Inter, sans-serif';
        ctx.fillText('recargar (solo en baja)', z.x + z.w / 2, z.y + z.h - 34);
      }
    }
  }

  function drawBall(b, t) {
    const y = b.y + Math.sin(t * 3 + b.bob) * 1.5;
    ctx.beginPath(); ctx.ellipse(b.x + 2, b.y + 8, 8, 3, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fill();
    ctx.beginPath(); ctx.arc(b.x, y, BALL_R, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * 2 * Math.PI / 5;
      ctx[i ? 'lineTo' : 'moveTo'](b.x + Math.cos(a) * 3.8, y + Math.sin(a) * 3.8);
    }
    ctx.closePath(); ctx.fillStyle = '#222'; ctx.fill();
  }

  function drawRobot(t) {
    const { x, y } = G;
    const moving = Math.hypot(G.vx, G.vy) > 20;
    const bounce = moving ? Math.sin(t * 18) * 1.5 : 0;
    ctx.save();
    ctx.translate(x, y + bounce);
    // sombra
    ctx.beginPath(); ctx.ellipse(2, 18, 20, 6, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill();
    // ruedas
    ctx.fillStyle = '#0a1e46';
    ctx.fillRect(-20, 8, 10, 12); ctx.fillRect(10, 8, 10, 12);
    // cuerpo
    const lowBlink = G.s === 1 && Math.floor(t * 4) % 2 === 0;
    ctx.fillStyle = '#ffc72c';
    ctx.strokeStyle = '#0a1e46'; ctx.lineWidth = 3;
    roundRect(-17, -22, 34, 32, 8); ctx.fill(); ctx.stroke();
    // orejas / plumas
    ctx.beginPath(); ctx.moveTo(-12, -22); ctx.lineTo(-7, -32); ctx.lineTo(-3, -22); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(3, -22); ctx.lineTo(7, -32); ctx.lineTo(12, -22); ctx.closePath(); ctx.fill(); ctx.stroke();
    // ojos que miran hacia la dirección
    const ex = Math.cos(G.dir) * 2.5, ey = Math.sin(G.dir) * 2.5;
    for (const sx of [-7, 7]) {
      ctx.beginPath(); ctx.arc(sx, -10, 5.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(sx + ex, -10 + ey, 2.4, 0, Math.PI * 2); ctx.fillStyle = '#0a1e46'; ctx.fill();
    }
    // pico
    ctx.beginPath(); ctx.moveTo(-4, -2); ctx.lineTo(0, 4); ctx.lineTo(4, -2); ctx.closePath(); ctx.fillStyle = '#d6332a'; ctx.fill();
    // batería en la espalda
    ctx.fillStyle = '#0a1e46'; ctx.fillRect(19, -18, 10, 22);
    ctx.fillStyle = G.s === 0 ? '#3ad15a' : (lowBlink ? '#ff3b3b' : '#7a1010');
    const lvl = G.s === 0 ? 18 : 6;
    ctx.fillRect(21, 2 - lvl, 6, lvl);
    ctx.restore();
    if (G.autopilot) {
      ctx.font = '700 11px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
      ctx.fillText('IA π*', x, y - 40);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------------------------------------------------------------- HUD, tarjetas y pantallas (DOM: legibles en celular)
  const hudCache = {};
  function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
  function updateHud() {
    const minute = Math.min(90, Math.floor((G.turn + G.tTurn / TURN_SECONDS) * 5));
    setText('hMin', `${String(minute).padStart(2, '0')}'`);
    setText('hTurn', `${Math.min(G.turn + 1, TURNS)}/${TURNS}`);
    setText('hScore', fmt(G.score, 1));
    setText('hBalls', String(G.ballsTotal));
    setText('hRescues', String(G.rescues));
    setText('hBatt', G.s === 0 ? 'ALTA' : 'BAJA');
    $('hBattBox').classList.toggle('low', G.s === 1);
    $('hBar').style.width = `${Math.min(100, G.tTurn / TURN_SECONDS * 100)}%`;
    const a = zoneAction(G.x, G.y, G.s);
    setText('hAction', `${ACTION_EMOJI[a]} ${ACTIONS[a]}`);
    const o = getOptimal().policy[G.s];
    setText('hHint', $('gameHint').checked ? `${ACTION_EMOJI[o]} ${ACTIONS[o]}` : '—');
    $('hHintBox').classList.toggle('match', $('gameHint').checked && a === o);

    // tarjeta de la última jugada
    const c = G.lastCard;
    const card = $('gameCard');
    if (c) {
      const key = c.title + c.lines.join();
      if (hudCache.card !== key) {
        hudCache.card = key;
        card.innerHTML = `<strong>${c.title}</strong>${c.lines.map((l) => `<span>${l}</span>`).join('')}`;
      }
      card.hidden = false;
      card.classList.toggle('bad', c.bad);
      card.style.opacity = String(Math.min(1, c.t * 2));
    } else card.hidden = true;

    // pantallas
    let html = '';
    if (G.mode === 'menu') {
      html = `<h3>¡A la cancha, Águila 5000!</h3><p>Recoge balones durante 90 minutos sin quedarte sin batería.</p>
        <ul><li><b>Mover:</b> flechas / WASD, o mantén presionado el dedo o el mouse sobre la cancha.</li>
        <li><b>Cada 5 s termina una jugada:</b> cancha = ⚽ buscar, banca = 🪑 esperar, vestidor = 🔋 recargar.</li>
        <li>Buscar paga r<sub>s</sub> = ${fmt(getParams().rs, 1)} si recuperas al menos un balón; banca paga r<sub>w</sub> = ${fmt(getParams().rw, 1)}.</li>
        <li>Con batería baja vas más lento y buscar puede vaciarla (🚑 ${fmt(getParams().rescue, 1)}).</li></ul>
        <button class="btn btn-gold" data-act="play">▶ Silbatazo inicial</button>`;
    } else if (G.mode === 'paused') {
      html = '<h3>Pausa</h3><p>Pulsa continuar o la barra espaciadora.</p><button class="btn btn-gold" data-act="play">▶ Continuar</button>';
    } else if (G.mode === 'rescue') {
      html = '<h3 class="alarm">¡Sin batería! 🚑</h3><p>Entra el carrito médico a rescatarlo…</p>';
    } else if (G.mode === 'over') {
      html = `<h3>¡Final del partido!</h3>
        <p class="big">${fmt(G.score, 1)} puntos</p>
        <p>⚽ ${G.ballsTotal} balones · 🚑 ${G.rescues} rescates · Récord: ${fmt(best, 1)}</p>
        <p>Retorno descontado G₀ = ${fmt(G.G, 2)} (γ = ${fmt(getParams().gamma)})</p>
        <p>Tus jugadas coincidieron con π* en <b>${agreement()}%</b> de las veces.</p>
        <button class="btn btn-gold" data-act="new">↺ Jugar otra vez</button>`;
    }
    const ov = $('gameOverlay');
    if (hudCache.ov !== html) { hudCache.ov = html; ov.innerHTML = html; }
    ov.hidden = !html;
    ov.classList.toggle('thin', G.mode === 'rescue');
  }

  function draw(t) {
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    drawField();
    G.balls.forEach((b) => drawBall(b, t));
    for (const q of G.particles) { ctx.globalAlpha = Math.max(0, q.life); ctx.fillStyle = q.color; ctx.fillRect(q.x - 2, q.y - 2, 4, 4); }
    ctx.globalAlpha = 1;
    if (G.cart) {
      ctx.font = '34px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('🚑', G.cart.x, G.cart.y + 12);
    }
    drawRobot(t);
    for (const f of G.floats) {
      ctx.globalAlpha = Math.min(1, f.t * 2); ctx.fillStyle = '#ffc72c'; ctx.font = '700 16px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y - (0.9 - f.t) * 30);
    }
    ctx.globalAlpha = 1;
    if (G.mode === 'rescue') {
      ctx.fillStyle = `rgba(200,16,46,${0.2 + 0.12 * Math.sin(t * 10)})`; ctx.fillRect(0, 0, W, H);
    }
    updateHud();
  }

  function agreement() {
    if (!G.history.length) return 0;
    const pol = getOptimal().policy;
    return Math.round(100 * G.history.filter((h) => h.a === pol[h.s]).length / G.history.length);
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    update(dt);
    draw(now / 1000);
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- panel lateral (DOM)
  function renderSide() {
    const rows = G.history.slice(-8).reverse().map((h) => `<tr class="${h.rescue ? 'rescue' : ''}"><td class="num">${h.turn}</td><td>${h.s === 0 ? 'alta' : 'baja'}</td><td>${ACTION_EMOJI[h.a]} ${ACTIONS[h.a]}</td><td class="num">${fmt(h.r, 1)}</td><td>${h.s2 === 0 ? 'alta' : 'baja'}${h.rescue ? ' 🚑' : ''}</td></tr>`).join('');
    $('gameLog').innerHTML = `<thead><tr><th class="num">#</th><th>S</th><th>A</th><th class="num">R</th><th>S'</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">Aún no hay jugadas.</td></tr>'}</tbody>`;
    const opt = getOptimal();
    const qr = [];
    for (let s = 0; s < 2; s++) for (const a of actionsFor(s)) {
      qr.push(`<tr><td>${s === 0 ? 'alta' : 'baja'}</td><td>${ACTION_EMOJI[a]} ${ACTIONS[a]}</td><td class="num">${fmt(Q[s][a], 2)}</td></tr>`);
    }
    const lp = greedyPolicy(Q);
    $('gameQ').innerHTML = `<thead><tr><th>S</th><th>A</th><th class="num">Q aprendida</th></tr></thead><tbody>${qr.join('')}</tbody>`;
    $('gameQNote').innerHTML = experience
      ? `Con <strong>${experience}</strong> jugadas tuyas, Q-learning (η = ${ETA}) cree que lo mejor es: alta → ${ACTION_EMOJI[lp[0]]} ${ACTIONS[lp[0]]}, baja → ${ACTION_EMOJI[lp[1]]} ${ACTIONS[lp[1]]}. La π* del modelo es alta → ${ACTIONS[opt.policy[0]]}, baja → ${ACTIONS[opt.policy[1]]}.`
      : 'Cada jugada que haces es una transición (S, A, R, S\') con la que se actualiza esta tabla con Q-learning. Explora distintas zonas para que aprenda.';
    $('gamePlay').textContent = G.mode === 'playing' ? '⏸ Pausa' : '▶ Jugar';
    $('gameAuto').textContent = G.autopilot ? '🧑 Tomar el control' : '🤖 Que juegue la IA (π*)';
    $('gameBest').textContent = fmt(best, 1);
  }

  // ---------------------------------------------------------------- controles
  function togglePlay() {
    if (G.mode === 'over') newGame();
    if (G.mode === 'menu' || G.mode === 'paused') G.mode = 'playing';
    else if (G.mode === 'playing') G.mode = 'paused';
    renderSide();
  }
  const isGameVisible = () => { const r = canvas.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };

  addEventListener('keydown', (e) => {
    if (!isGameVisible() || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'].includes(k)) {
      keys.add(k);
      if (G.mode === 'playing') e.preventDefault();
      if (G.mode === 'menu') { G.mode = 'playing'; renderSide(); }
    }
    if (k === ' ' || k === 'Enter') { e.preventDefault(); togglePlay(); }
  });
  addEventListener('keyup', (e) => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  addEventListener('blur', () => keys.clear());

  const toLogical = (ev) => {
    const r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width * W, y: (ev.clientY - r.top) / r.height * H };
  };
  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    if (G.mode === 'menu' || G.mode === 'paused') { G.mode = 'playing'; renderSide(); }
    pointer = toLogical(ev);
  });
  canvas.addEventListener('pointermove', (ev) => { if (pointer) pointer = toLogical(ev); });
  const up = () => { pointer = null; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  $('gamePlay').addEventListener('click', togglePlay);
  $('gameOverlay').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'new') newGame();
    G.mode = 'playing';
    renderSide();
  });
  $('gameReset').addEventListener('click', () => { newGame(); });
  $('gameAuto').addEventListener('click', () => {
    G.autopilot = !G.autopilot;
    if (G.mode === 'menu' || G.mode === 'paused') G.mode = 'playing';
    renderSide();
  });
  $('gameForget').addEventListener('click', () => { Q = emptyQ(); experience = 0; renderSide(); });

  // canvas nítido según tamaño y densidad de pixeles
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.width * H / W * dpr);
  }
  addEventListener('resize', resize);

  newGame();
  resize();
  requestAnimationFrame(loop);

  return { onParamsChange: renderSide };
}
