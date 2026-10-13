import {
  DEFAULTS, ACTIONS, ACTION_LABELS, ACTION_EMOJI, STATES, actionsFor, transitions, qFromV, expectedReward, step, mulberry32,
} from './model.js';
import {
  valueIteration, policyIteration, policyEvaluation, evaluatePolicyExact, optimal, monteCarlo, sarsa, qLearning,
  policyMap, emptyQ, argmaxValid, greedyPolicy,
} from './algorithms.js';
import { lineChart, categoryMap, movingAverage } from './charts.js';

// ---------------------------------------------------------------- utilidades
const $ = (sel) => document.querySelector(sel);
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
const ACT_COLOR = ['var(--act-0)', 'var(--act-1)', 'var(--act-2)'];
const stateName = (s) => (s === 0 ? 'alto' : 'bajo');
const actName = (a) => ACTIONS[a];
const polText = (pi) => `alto → ${ACTION_EMOJI[pi[0]]} ${actName(pi[0])}, bajo → ${ACTION_EMOJI[pi[1]]} ${actName(pi[1])}`;

function renderMath(root = document.body) {
  if (window.renderMathInElement) {
    window.renderMathInElement(root, {
      delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
      throwOnError: false,
    });
  }
}

// ---------------------------------------------------------------- parámetros
let P = { ...DEFAULTS, ...(store.get('aguila-params') || {}) };
const SLIDERS = [
  { key: 'alpha', label: 'α · P(seguir alta | alta, buscar)', min: 0, max: 1, step: 0.01, help: 'Qué tan bien aguanta la batería un recorrido con carga alta.' },
  { key: 'beta', label: 'β · P(seguir baja | baja, buscar)', min: 0, max: 1, step: 0.01, help: 'Probabilidad de NO vaciarse al buscar con carga baja.' },
  { key: 'rs', label: 'r_s · recompensa por buscar', min: 0.1, max: 5, step: 0.1, help: 'Balones esperados por recorrido.' },
  { key: 'rw', label: 'r_w · recompensa por esperar', min: 0, max: 5, step: 0.1, help: 'Balones que le devuelven en la banca (debería ser < r_s).' },
  { key: 'rescue', label: 'Castigo por rescate', min: -10, max: 0, step: 0.5, help: 'La práctica usa −3: entra el carrito médico.' },
  { key: 'gamma', label: 'γ · factor de descuento', min: 0, max: 0.99, step: 0.01, help: 'Visión de largo plazo del técnico.' },
];
const PRESETS = {
  clasico: { ...DEFAULTS },
  bateria: { ...DEFAULTS, alpha: 0.95, beta: 0.85 },
  miope: { ...DEFAULTS, gamma: 0.3 },
  banca: { ...DEFAULTS, rw: 0.9 },
  camilla: { ...DEFAULTS, rescue: -0.5 },
};

function buildSliders() {
  const box = $('#sliders');
  box.innerHTML = '';
  for (const s of SLIDERS) {
    const wrap = document.createElement('div');
    wrap.className = 'slider';
    wrap.innerHTML = `
      <div class="slider-top"><label for="sl-${s.key}">${s.label}</label><output id="out-${s.key}"></output></div>
      <input type="range" id="sl-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}">
      <p>${s.help}</p>${s.key === 'rw' ? '<p class="warn" id="rwWarn" hidden>Ojo: r_w ≥ r_s rompe el supuesto de la práctica.</p>' : ''}`;
    box.appendChild(wrap);
    const input = wrap.querySelector('input');
    input.addEventListener('input', () => { P[s.key] = parseFloat(input.value); syncSliders(); onParamsChange(); });
  }
  syncSliders();
}
function syncSliders() {
  for (const s of SLIDERS) {
    $(`#sl-${s.key}`).value = P[s.key];
    $(`#out-${s.key}`).textContent = f(P[s.key], s.step < 0.1 ? 2 : 1);
  }
  $('#rwWarn').hidden = P.rw < P.rs;
}
function setParams(np) { P = { ...np }; syncSliders(); onParamsChange(); }

function openDrawer(open) {
  $('#paramsDrawer').classList.toggle('open', open);
  $('#paramsDrawer').setAttribute('aria-hidden', String(!open));
  $('#drawerScrim').hidden = !open;
  if (open) $('#sl-alpha').focus();
}

// ---------------------------------------------------------------- cache del óptimo
let OPT = optimal(P);

// ---------------------------------------------------------------- tabla y vínculos del MDP
function renderSummary() {
  $('#paramsSummary').textContent = `α=${f(P.alpha)} β=${f(P.beta)} r_s=${f(P.rs, 1)} r_w=${f(P.rw, 1)} rescate=${f(P.rescue, 1)} γ=${f(P.gamma)}`;
  document.querySelectorAll('[data-bind]').forEach((n) => {
    const k = n.dataset.bind;
    const v = k === '1-alpha' ? 1 - P.alpha : k === '1-beta' ? 1 - P.beta : P[k];
    n.textContent = `${Math.round(v * 100)}%`;
  });
}

function renderMdpTable() {
  const rows = [
    ['alto', 'buscar', 'alto', 'α', P.alpha, 'r_buscar', P.rs],
    ['alto', 'buscar', 'bajo', '1 − α', 1 - P.alpha, 'r_buscar', P.rs],
    ['bajo', 'buscar', 'alto (rescate 🚑)', '1 − β', 1 - P.beta, 'rescate', P.rescue, true],
    ['bajo', 'buscar', 'bajo', 'β', P.beta, 'r_buscar', P.rs],
    ['alto', 'esperar', 'alto', '1', 1, 'r_esperar', P.rw],
    ['alto', 'esperar', 'bajo', '0', 0, '—', NaN],
    ['bajo', 'esperar', 'alto', '0', 0, '—', NaN],
    ['bajo', 'esperar', 'bajo', '1', 1, 'r_esperar', P.rw],
    ['bajo', 'recargar', 'alto', '1', 1, '0', 0],
    ['bajo', 'recargar', 'bajo', '0', 0, '—', NaN],
  ];
  $('#mdpTable').innerHTML = `<thead><tr><th>S</th><th>a</th><th>s'</th><th>P(s'|S,a)</th><th class="num">valor</th><th>r(S,a,s')</th><th class="num">valor</th></tr></thead><tbody>${
    rows.map((r) => `<tr class="${r[7] ? 'rescue' : ''}"><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td class="num">${f(r[4])}</td><td>${r[5]}</td><td class="num">${f(r[6], 1)}</td></tr>`).join('')
  }</tbody>`;
}

// ---------------------------------------------------------------- grafo de transiciones
const SVGNS = 'http://www.w3.org/2000/svg';
function sv(name, attrs, parent) {
  const n = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent.appendChild(n);
  return n;
}
function buildGraph(container, idp) {
  container.innerHTML = '';
  const svg = sv('svg', { viewBox: '0 0 640 400', role: 'img', 'aria-label': 'Grafo de transiciones del MDP' }, container);
  const defs = sv('defs', {}, svg);
  for (const [id, cls] of [['arr', ''], ['arrA', 'active']]) {
    const m = sv('marker', { id: `${idp}-${id}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
    const pth = sv('path', { d: 'M0 0L10 5L0 10z' }, m);
    pth.style.fill = cls ? 'var(--gold-strong)' : 'var(--ink-2)';
  }
  const H = { x: 180, y: 200 }, L = { x: 460, y: 200 };
  // nodos de acción
  const actsPos = {
    '0-1': { x: 180, y: 70, label: 'esperar', lx: 192, ly: 64 },
    '0-0': { x: 180, y: 330, label: 'buscar', lx: 192, ly: 348 },
    '1-0': { x: 460, y: 70, label: 'buscar', lx: 472, ly: 64 },
    '1-1': { x: 460, y: 330, label: 'esperar', lx: 472, ly: 348 },
    '1-2': { x: 320, y: 200, label: 'recargar', lx: 320, ly: 186 },
  };
  // tallos estado → acción
  const stems = {
    '0-1': `M${H.x} ${H.y - 40} L${H.x} 76`,
    '0-0': `M${H.x} ${H.y + 40} L${H.x} 324`,
    '1-0': `M${L.x} ${L.y - 40} L${L.x} 76`,
    '1-1': `M${L.x} ${L.y + 40} L${L.x} 324`,
    '1-2': `M${L.x - 40} ${L.y} L326 ${L.y}`,
  };
  // aristas acción → estado siguiente  (clave s-a-s2)
  const edges = {
    '0-1-0': { d: 'M174 70 C 80 40 70 170 140 190', lx: 70, ly: 70 },
    '0-0-0': { d: 'M174 330 C 80 360 70 230 140 212', lx: 60, ly: 330 },
    '0-0-1': { d: 'M186 332 C 300 380 430 330 452 238', lx: 300, ly: 378 },
    '1-0-1': { d: 'M466 70 C 560 40 570 170 500 190', lx: 575, ly: 70 },
    '1-0-0': { d: 'M454 66 C 330 0 220 60 196 162', lx: 320, ly: 24 },
    '1-1-1': { d: 'M466 330 C 560 360 570 230 500 212', lx: 580, ly: 330 },
    '1-2-0': { d: 'M314 200 L 222 200', lx: 268, ly: 222 },
  };
  const api = { stems: {}, edges: {}, edgeLabels: {}, acts: {}, states: [] };
  for (const [k, d] of Object.entries(stems)) {
    api.stems[k] = sv('path', { d, class: 'g-edge' }, svg);
  }
  for (const [k, e] of Object.entries(edges)) {
    api.edges[k] = sv('path', { d: e.d, class: `g-edge${k === '1-0-0' ? ' rescue' : ''}`, 'marker-end': `url(#${idp}-arr)` }, svg);
    const t = sv('text', { x: e.lx, y: e.ly, class: 'g-edge-label', 'text-anchor': 'middle' }, svg);
    api.edgeLabels[k] = t;
  }
  for (const [k, a] of Object.entries(actsPos)) {
    const c = sv('circle', { cx: a.x, cy: a.y, r: 9, class: 'g-act' }, svg);
    c.style.fill = ACT_COLOR[+k.split('-')[1]];
    api.acts[k] = c;
    const t = sv('text', { x: a.lx, y: a.ly, class: 'g-act-label', 'text-anchor': k === '1-2' ? 'middle' : 'start' }, svg);
    t.textContent = a.label;
  }
  [H, L].forEach((pos, s) => {
    api.states[s] = sv('circle', { cx: pos.x, cy: pos.y, r: 40, class: `g-state ${s === 0 ? 'hi' : 'lo'}` }, svg);
    const t = sv('text', { x: pos.x, y: pos.y + 7, class: 'g-state-label', 'text-anchor': 'middle' }, svg);
    t.textContent = STATES[s];
  });
  api.update = (p) => {
    for (const [k, t] of Object.entries(api.edgeLabels)) {
      const [s, a, s2] = k.split('-').map(Number);
      const tr = transitions(p, s, a).find((x) => x.s2 === s2);
      t.textContent = `(${f(tr.prob)}, ${f(tr.r, 1)})`;
    }
  };
  api.highlight = (s, a, s2) => {
    Object.values(api.edges).forEach((e) => { e.classList.remove('active'); e.setAttribute('marker-end', `url(#${idp}-arr)`); });
    Object.values(api.stems).forEach((e) => e.classList.remove('active'));
    Object.values(api.acts).forEach((e) => e.classList.remove('active'));
    Object.values(api.edgeLabels).forEach((e) => e.classList.remove('active'));
    api.states.forEach((n) => n.classList.remove('current'));
    if (s == null) { api.states[0].classList.add('current'); return; }
    api.stems[`${s}-${a}`]?.classList.add('active');
    api.acts[`${s}-${a}`]?.classList.add('active');
    const e = api.edges[`${s}-${a}-${s2}`];
    if (e) { e.classList.add('active'); e.setAttribute('marker-end', `url(#${idp}-arrA)`); }
    api.edgeLabels[`${s}-${a}-${s2}`]?.classList.add('active');
    api.states[s2].classList.add('current');
  };
  return api;
}
let graphMain, graphSim;

// ---------------------------------------------------------------- γ
function renderGamma() {
  const bars = $('#gammaBars');
  bars.innerHTML = '';
  for (let k = 0; k < 30; k++) {
    const i = document.createElement('i');
    i.style.height = `${Math.max(1, P.gamma ** k * 100)}%`;
    i.title = `k=${k}: γ^k = ${f(P.gamma ** k, 3)}`;
    bars.appendChild(i);
  }
  $('#horizon').textContent = P.gamma < 1 ? f(1 / (1 - P.gamma), 1) : '∞';
}

// ---------------------------------------------------------------- evaluación de política
function renderEvaluation() {
  const pi = [+$('#evalH').value, +$('#evalL').value];
  const { V, P: Pm, R } = evaluatePolicyExact(P, pi);
  const hist = policyEvaluation(P, pi, { theta: 1e-4, maxIter: 400 });
  const best = OPT.V;
  $('#evalExact').innerHTML = `
    <p class="small">Sistema lineal <span class="mono">V = R + γ P V</span> con esta política:</p>
    <p class="mono small">P<sub>π</sub> = [[${f(Pm[0][0])}, ${f(Pm[0][1])}], [${f(Pm[1][0])}, ${f(Pm[1][1])}]] &nbsp; R<sub>π</sub> = [${f(R[0])}, ${f(R[1])}]</p>
    <div class="vbox">
      <div class="vcard"><div class="lbl">v<sub>π</sub>(alto)</div><div class="big">${f(V[0])}</div><div class="lbl">óptimo: ${f(best[0])}</div></div>
      <div class="vcard"><div class="lbl">v<sub>π</sub>(bajo)</div><div class="big">${f(V[1])}</div><div class="lbl">óptimo: ${f(best[1])}</div></div>
    </div>
    <p class="small mt">${pi[0] === OPT.policy[0] && pi[1] === OPT.policy[1]
    ? '🏆 ¡Esta es la política óptima con los parámetros actuales!'
    : `Le faltan <strong>${f(best[0] - V[0])}</strong> (alto) y <strong>${f(best[1] - V[1])}</strong> (bajo) para el óptimo. Prueba otra combinación.`}</p>`;
  lineChart($('#evalChart'), [
    { name: 'V(alto)', short: 'alto', values: hist.map((h) => h.V[0]), color: 'var(--st-hi)' },
    { name: 'V(bajo)', short: 'bajo', values: hist.map((h) => h.V[1]), color: 'var(--st-lo)', dash: '6 4' },
  ], { xLabel: 'barrido k', yLabel: 'V_k(s)', height: 240 });
  $('#evalNote').textContent = `Convergió (Δ < 10⁻⁴) en ${hist.length - 1} barridos. Con γ más cercano a 1 se necesitan más barridos: el error se reduce por un factor γ en cada uno.`;
}

// ---------------------------------------------------------------- iteración de valor
let VI = { hist: [], k: 0, timer: null };
function resetVI() {
  clearInterval(VI.timer);
  VI = { hist: valueIteration(P, { theta: 1e-4, maxIter: 2000 }), k: 0, timer: null };
  renderVI();
}
function backupLines(p, V, s, Qrow) {
  const best = argmaxValid(Qrow, s);
  return [0, 1, 2].map((a) => {
    if (!actionsFor(s).includes(a)) {
      return `<div class="q-line na"><span>${ACTION_EMOJI[a]} ${actName(a)}</span><span class="expr">no disponible en alto</span><span class="val">—</span></div>`;
    }
    const expr = transitions(p, s, a).map((t) => `${f(t.prob)}·[${f(t.r, 1)} + ${f(p.gamma)}·${f(V[t.s2])}]`).join(' + ');
    return `<div class="q-line ${a === best ? 'win' : ''}"><span>${ACTION_EMOJI[a]} ${actName(a)}</span><span class="expr">${expr}</span><span class="val">${f(Qrow[a], 3)}</span></div>`;
  }).join('');
}
function renderVI() {
  const { hist, k } = VI;
  const cur = hist[k];
  const last = hist.length - 1;
  $('#viK').textContent = k === 0 ? '(inicio)' : `k = ${k}`;
  if (k === 0) {
    $('#viDetail').innerHTML = '<p>Arrancamos con <span class="mono">V₀(alto) = V₀(bajo) = 0</span>: el robot todavía no sabe nada del valor de cada estado. Pulsa <strong>Siguiente barrido</strong>.</p>';
  } else {
    const Vp = cur.Vprev;
    $('#viDetail').innerHTML = [0, 1].map((s) => `
      <div class="state-block"><h4>V<sub>${k}</sub>(${stateName(s)}) = max<sub>a</sub> Σ p·[r + γ·V<sub>${k - 1}</sub>(s')]</h4>
      ${backupLines(P, Vp, s, cur.Q[s])}
      <p class="small">⇒ V<sub>${k}</sub>(${stateName(s)}) = <strong>${f(cur.V[s], 3)}</strong> · mejor jugada: ${ACTION_EMOJI[cur.policy[s]]} ${actName(cur.policy[s])}</p></div>`).join('')
      + `<p class="small">Usamos V<sub>${k - 1}</sub> = (${f(Vp[0], 3)}, ${f(Vp[1], 3)}). Δ = ${f(cur.delta, 5)}</p>`;
  }
  const done = k === last;
  $('#viBadge').textContent = done ? `✔ Convergió en ${last} barridos · π* = ${polText(hist[last].policy)}` : `Barrido ${k} de ${last}`;
  $('#viBadge').classList.toggle('ok', done);
  $('#viStep').disabled = done;
  $('#viRun').disabled = done;
  const sl = hist.slice(0, k + 1);
  lineChart($('#viChart'), [
    { name: 'V(alto)', short: 'alto', values: sl.map((h) => h.V[0]), color: 'var(--st-hi)' },
    { name: 'V(bajo)', short: 'bajo', values: sl.map((h) => h.V[1]), color: 'var(--st-lo)', dash: '6 4' },
  ], { xLabel: 'barrido k', yLabel: 'V_k(s)', height: 220 });
  const rows = sl.slice(-6).map((h) => `<tr class="${h.k === k ? 'flash' : ''}"><td class="num">${h.k}</td><td class="num">${f(h.V[0], 3)}</td><td class="num">${f(h.V[1], 3)}</td><td class="num">${f(h.delta, 4)}</td><td>${h.policy ? `${actName(h.policy[0])} / ${actName(h.policy[1])}` : '—'}</td></tr>`).join('');
  $('#viTable').innerHTML = `<thead><tr><th class="num">k</th><th class="num">V(alto)</th><th class="num">V(bajo)</th><th class="num">Δ</th><th>π greedy</th></tr></thead><tbody>${rows}</tbody>`;
}

// ---------------------------------------------------------------- iteración de política
function renderPI() {
  const steps = policyIteration(P, [+$('#piInitH').value, +$('#piInitL').value]);
  $('#piSteps').innerHTML = steps.map((st) => {
    const qRows = [0, 1].map((s) => `<tr><td>${stateName(s)}</td>${[0, 1, 2].map((a) => `<td class="num">${actionsFor(s).includes(a) ? (a === st.next[s] ? `<strong>${f(st.Q[s][a])}</strong>` : f(st.Q[s][a])) : '—'}</td>`).join('')}</tr>`).join('');
    const changes = [0, 1].filter((s) => st.next[s] !== st.pi[s]).map((s) => `<span class="chg">${stateName(s)}: ${actName(st.pi[s])} → ${actName(st.next[s])}</span>`);
    return `<div class="pi-step ${st.stable ? 'final' : ''}">
      <h4>Iteración ${st.i + 1}</h4>
      <p class="small"><strong>π<sub>${st.i}</sub>:</strong> ${polText(st.pi)}</p>
      <p class="small"><strong>1 · Evaluación:</strong> v(alto) = ${f(st.V[0])}, v(bajo) = ${f(st.V[1])} <span class="muted">(${st.sweeps} barridos iterativos o exacta con el sistema lineal)</span></p>
      <p class="small"><strong>2 · Mejora</strong> con q<sub>π</sub>(s,a):</p>
      <div class="table-scroll"><table class="tbl compact"><thead><tr><th>s</th><th class="num">⚽ busc.</th><th class="num">🪑 esp.</th><th class="num">🔋 rec.</th></tr></thead><tbody>${qRows}</tbody></table></div>
      <p class="small mt">${st.stable ? '✔ <strong>Política estable</strong>: ninguna acción mejora → es óptima.' : `Cambios: ${changes.join(', ')}`}</p>
    </div>`;
  }).join('');

  const rows = [];
  for (const a0 of actionsFor(0)) for (const a1 of actionsFor(1)) {
    const { V } = evaluatePolicyExact(P, [a0, a1]);
    rows.push({ pi: [a0, a1], V });
  }
  const bestKey = OPT.policy.join();
  $('#allPolicies').innerHTML = `<thead><tr><th>Política (alto / bajo)</th><th class="num">v(alto)</th><th class="num">v(bajo)</th><th>Comentario</th></tr></thead><tbody>${
    rows.map((r) => `<tr class="${r.pi.join() === bestKey ? 'best' : ''}"><td>${ACTION_EMOJI[r.pi[0]]} ${actName(r.pi[0])} / ${ACTION_EMOJI[r.pi[1]]} ${actName(r.pi[1])}</td><td class="num">${f(r.V[0])}</td><td class="num">${f(r.V[1])}</td><td>${r.pi.join() === bestKey ? '🏆 π* (domina a todas en ambos estados)' : ''}</td></tr>`).join('')
  }</tbody>`;
}

// ---------------------------------------------------------------- mapa de política
const renderMap = debounce(() => {
  const axes = $('#mapAxes').value;
  const n = 21;
  const cellsH = [], cellsL = [];
  let xLabel, yLabel, marker, yRange = [0, 1];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i / (n - 1), y = j / (n - 1);
      let p;
      if (axes === 'ab') { p = { ...P, alpha: x, beta: y }; }
      else if (axes === 'bw') { p = { ...P, beta: x, rw: y * P.rs }; }
      else { p = { ...P, beta: x, gamma: y * 0.99 }; }
      const o = optimal(p);
      const desc = axes === 'ab' ? `α=${f(x)}, β=${f(y)}` : axes === 'bw' ? `β=${f(x)}, r_w=${f(y * P.rs)}` : `β=${f(x)}, γ=${f(y * 0.99)}`;
      const tip = `<div class="tip-title">${desc}</div>π*: alto→${actName(o.policy[0])}, bajo→${actName(o.policy[1])}<br>v*(alto)=${f(o.V[0])} · v*(bajo)=${f(o.V[1])}`;
      cellsH.push({ xi: i, yi: j, cat: o.policy[0], tip });
      cellsL.push({ xi: i, yi: j, cat: o.policy[1], tip });
    }
  }
  if (axes === 'ab') { xLabel = 'α'; yLabel = 'β'; marker = { x: P.alpha, y: P.beta }; }
  else if (axes === 'bw') { xLabel = 'β'; yLabel = 'r_w / r_s'; marker = { x: P.beta, y: Math.min(1, P.rw / P.rs) }; }
  else { xLabel = 'β'; yLabel = 'γ'; marker = { x: P.beta, y: P.gamma / 0.99 }; yRange = [0, 0.99]; }
  const cats3 = ACTIONS.map((a, i) => ({ name: `${ACTION_EMOJI[i]} ${a}`, color: ACT_COLOR[i] }));
  categoryMap($('#mapH'), cellsH, n, cats3.slice(0, 2), { xLabel, yLabel, marker, yRange, ariaLabel: 'Acción óptima con batería alta' });
  categoryMap($('#mapL'), cellsL, n, cats3, { xLabel, yLabel, marker, yRange, ariaLabel: 'Acción óptima con batería baja' });
  $('#mapNote').textContent = 'Lectura: con β alto (la batería baja aguanta) conviene seguir buscando aun en bajo; si la banca paga casi lo mismo que buscar (r_w/r_s → 1) o el técnico es miope (γ bajo), esperar o arriesgar se vuelve atractivo porque el futuro pesa poco.';
}, 120);

// ---------------------------------------------------------------- Monte Carlo: episodio de muestra
let mcSeed = 11;
function renderMcSample() {
  const rng = mulberry32(mcSeed);
  const T = 12;
  let s = 0;
  const traj = [];
  for (let t = 0; t < T; t++) {
    const acts = actionsFor(s);
    const a = rng() < 0.3 ? acts[Math.floor(rng() * acts.length)] : OPT.policy[s];
    const tr = step(P, s, a, rng);
    traj.push({ t, s, a, r: tr.r, s2: tr.s2, rescue: tr.rescue });
    s = tr.s2;
  }
  let g = 0;
  for (let t = T - 1; t >= 0; t--) { g = traj[t].r + P.gamma * g; traj[t].G = g; traj[t].Gnext = t < T - 1 ? traj[t + 1].G : 0; }
  $('#mcEpisode').innerHTML = `<thead><tr><th class="num">t</th><th>S<sub>t</sub></th><th>A<sub>t</sub></th><th class="num">R<sub>t+1</sub></th><th>G<sub>t</sub> = R<sub>t+1</sub> + γ·G<sub>t+1</sub></th><th class="num">G<sub>t</sub></th></tr></thead><tbody>${
    traj.map((x) => `<tr class="${x.rescue ? 'rescue' : ''}"><td class="num">${x.t}</td><td>${stateName(x.s)}</td><td>${ACTION_EMOJI[x.a]} ${actName(x.a)}${x.rescue ? ' 🚑' : ''}</td><td class="num">${f(x.r, 1)}</td><td class="mono small">${f(x.r, 1)} + ${f(P.gamma)}·${f(x.Gnext)}</td><td class="num"><strong>${f(x.G)}</strong></td></tr>`).join('')
  }</tbody>`;
}

// ---------------------------------------------------------------- TD con lupa
let TD;
function resetTD() {
  TD = { Qs: emptyQ(), Qq: emptyQ(), s: 0, rng: mulberry32(3), n: 0, last: null };
  renderTD();
}
function tdStep() {
  const eta = Math.min(1, Math.max(0.01, parseFloat($('#tdEta').value) || 0.5));
  const { rng } = TD;
  const eps = 0.3;
  const pick = (Q, s) => {
    const acts = actionsFor(s);
    return rng() < eps ? acts[Math.floor(rng() * acts.length)] : argmaxValid(Q[s], s);
  };
  const s = TD.s;
  const a = pick(TD.Qq, s);
  const tr = step(P, s, a, rng);
  const a2 = pick(TD.Qs, tr.s2);
  const bestNext = argmaxValid(TD.Qq[tr.s2], tr.s2);
  const tS = tr.r + P.gamma * TD.Qs[tr.s2][a2];
  const tQ = tr.r + P.gamma * TD.Qq[tr.s2][bestNext];
  const oldS = TD.Qs[s][a], oldQ = TD.Qq[s][a];
  TD.Qs[s][a] = oldS + eta * (tS - oldS);
  TD.Qq[s][a] = oldQ + eta * (tQ - oldQ);
  TD.n += 1;
  TD.last = { s, a, tr, a2, bestNext, tS, tQ, oldS, oldQ, eta };
  TD.s = tr.s2;
  renderTD();
}
function renderTD() {
  const L = TD.last;
  if (!L) {
    $('#tdExplain').innerHTML = '<p>Las dos tablas empiezan en cero. Cada clic toma una transición real <span class="mono">(S, A, R, S\')</span> generada con ε-greedy (ε = 0.3) y muestra cómo la procesa cada algoritmo.</p>';
  } else {
    $('#tdExplain').innerHTML = `
      <div class="state-block"><h4>Transición #${TD.n}</h4>
        <p class="mono small">S = ${stateName(L.s)}, A = ${actName(L.a)} → R = ${f(L.tr.r, 1)}${L.tr.rescue ? ' 🚑' : ''}, S' = ${stateName(L.tr.s2)}</p></div>
      <div class="state-block"><h4>SARSA <span class="muted small">(usa A' = ${actName(L.a2)}, la que sí jugará)</span></h4>
        <p class="mono small">objetivo = ${f(L.tr.r, 1)} + ${f(P.gamma)}·Q(${stateName(L.tr.s2)}, ${actName(L.a2)}) = <strong>${f(L.tS, 3)}</strong></p>
        <p class="mono small">δ = ${f(L.tS, 3)} − ${f(L.oldS, 3)} = ${f(L.tS - L.oldS, 3)}</p>
        <p class="mono small">Q ← ${f(L.oldS, 3)} + ${f(L.eta)}·${f(L.tS - L.oldS, 3)} = <strong>${f(TD.Qs[L.s][L.a], 3)}</strong></p></div>
      <div class="state-block"><h4>Q-learning <span class="muted small">(usa max: ${actName(L.bestNext)})</span></h4>
        <p class="mono small">objetivo = ${f(L.tr.r, 1)} + ${f(P.gamma)}·max Q(${stateName(L.tr.s2)}, ·) = <strong>${f(L.tQ, 3)}</strong></p>
        <p class="mono small">δ = ${f(L.tQ, 3)} − ${f(L.oldQ, 3)} = ${f(L.tQ - L.oldQ, 3)}</p>
        <p class="mono small">Q ← ${f(L.oldQ, 3)} + ${f(L.eta)}·${f(L.tQ - L.oldQ, 3)} = <strong>${f(TD.Qq[L.s][L.a], 3)}</strong></p></div>`;
  }
  const rows = [];
  for (let s = 0; s < 2; s++) for (const a of actionsFor(s)) {
    const hit = L && L.s === s && L.a === a;
    rows.push(`<tr class="${hit ? 'flash best' : ''}"><td>${stateName(s)}</td><td>${ACTION_EMOJI[a]} ${actName(a)}</td><td class="num">${f(TD.Qs[s][a], 3)}</td><td class="num">${f(TD.Qq[s][a], 3)}</td><td class="num">${f(OPT.Q[s][a], 3)}</td></tr>`);
  }
  $('#tdQ').innerHTML = `<thead><tr><th>S</th><th>A</th><th class="num">Q SARSA</th><th class="num">Q Q-learning</th><th class="num">q* (DP)</th></tr></thead><tbody>${rows.join('')}</tbody>`;
}

// ---------------------------------------------------------------- comparativa
let lastQL = null;
function stationaryAvgReward(p, pi) {
  const { P: Pm } = evaluatePolicyExact(p, pi);
  const a = Pm[0][1], b = Pm[1][0];
  const d = a + b > 0 ? [b / (a + b), a / (a + b)] : [1, 0];
  return d[0] * expectedReward(p, 0, pi[0]) + d[1] * expectedReward(p, 1, pi[1]);
}
const runCompare = debounce(() => {
  const opts = {
    episodes: Math.min(3000, Math.max(20, +$('#hEpisodes').value || 400)),
    T: Math.min(300, Math.max(10, +$('#hT').value || 60)),
    eta: Math.min(1, Math.max(0.005, +$('#hEta').value || 0.1)),
    eps: Math.min(1, Math.max(0, +$('#hEps').value)),
    epsDecay: $('#hDecay').checked,
    seed: +$('#hSeed').value || 7,
  };
  const mc = monteCarlo(P, OPT.Q, opts);
  const sa = sarsa(P, OPT.Q, opts);
  const ql = qLearning(P, OPT.Q, opts);
  lastQL = ql;
  const opt = stationaryAvgReward(P, OPT.policy);
  const series = (key, ma) => [
    { name: 'Monte Carlo', short: 'MC', values: ma ? movingAverage(mc[key]) : mc[key], color: 'var(--alg-mc)' },
    { name: 'SARSA', short: 'SARSA', values: ma ? movingAverage(sa[key]) : sa[key], color: 'var(--alg-sarsa)', dash: '7 4' },
    { name: 'Q-learning', short: 'Q-learn', values: ma ? movingAverage(ql[key]) : ql[key], color: 'var(--alg-q)', dash: '2 3' },
  ];
  lineChart($('#cmpReward'), series('reward', true), { xLabel: 'episodio', yLabel: 'recompensa / paso', refLine: { value: opt, label: `π* ≈ ${f(opt)}` }, height: 270 });
  lineChart($('#cmpError'), series('error', false), { xLabel: 'episodio', yLabel: 'RMSE(Q, q*)', height: 270 });
  const rows = [];
  for (let s = 0; s < 2; s++) for (const a of actionsFor(s)) {
    rows.push(`<tr><td>${stateName(s)}</td><td>${ACTION_EMOJI[a]} ${actName(a)}</td><td class="num"><strong>${f(OPT.Q[s][a], 3)}</strong></td><td class="num">${f(mc.Q[s][a], 3)}</td><td class="num">${f(sa.Q[s][a], 3)}</td><td class="num">${f(ql.Q[s][a], 3)}</td></tr>`);
  }
  const pol = (x) => `${actName(x.policy[0])} / ${actName(x.policy[1])} ${x.policy.join() === OPT.policy.join() ? '✔' : '✘'}`;
  rows.push(`<tr class="best"><td colspan="2">Política greedy (alto / bajo)</td><td>${actName(OPT.policy[0])} / ${actName(OPT.policy[1])}</td><td>${pol(mc)}</td><td>${pol(sa)}</td><td>${pol(ql)}</td></tr>`);
  $('#cmpTable').innerHTML = `<thead><tr><th>S</th><th>A</th><th class="num">q* (DP)</th><th class="num">Monte Carlo</th><th class="num">SARSA</th><th class="num">Q-learning</th></tr></thead><tbody>${rows.join('')}</tbody>`;
  $('#cmpNote').innerHTML = `Error final — MC: <strong>${f(mc.error.at(-1), 3)}</strong>, SARSA: <strong>${f(sa.error.at(-1), 3)}</strong>, Q-learning: <strong>${f(ql.error.at(-1), 3)}</strong>.
    Observa: las acciones poco visitadas (las que la política greedy casi no juega) son las que peor se estiman; lo importante es que el <em>orden</em> de las acciones sea correcto.
    Prueba ε = 0 (sin exploración) o η muy grande para ver cómo fallan.`;
  if (SIM.policy === 'ql') resetSim();
}, 150);

// ---------------------------------------------------------------- simulador
const SIM = { s: 0, t: 0, total: 0, G: 0, balls: 0, rescues: 0, timer: null, rng: mulberry32(2024), policy: 'opt', log: [] };
function simPolicyFn(name) {
  if (name === 'opt') return (s) => OPT.policy[s];
  if (name === 'greedy') return () => 0;
  if (name === 'safe') return () => 1;
  if (name === 'ql') { const pol = lastQL ? greedyPolicy(lastQL.Q) : OPT.policy; return (s) => pol[s]; }
  return (s, rng) => { const acts = actionsFor(s); return acts[Math.floor(rng() * acts.length)]; };
}
const COMMENTS = {
  0: ['¡Recupera el balón en tres cuartos de cancha!', 'Barre la banda derecha y se lleva otro balón.', 'Presión alta, ¡como en las finales!', 'Va por el balón que quedó en el área chica.'],
  1: ['Se queda junto a la banca; un canterano le devuelve un balón.', 'Pausa táctica en la banca.', 'Administra el esfuerzo, espera su momento.'],
  2: ['Al vestidor a recargar baterías. 🔋', 'Medio tiempo: recarga completa.'],
  rescue: ['¡Se quedó sin pila en medio de la cancha! Entra el carrito médico 🚑', '¡Se apagó! Lo sacan en camilla y lo recargan (castigo).'],
};
function resetSim() {
  clearInterval(SIM.timer); SIM.timer = null;
  Object.assign(SIM, { s: 0, t: 0, total: 0, G: 0, balls: 0, rescues: 0, rng: mulberry32(2024), policy: $('#simPolicy').value, log: [] });
  $('#simPlay').textContent = '▶ Jugar';
  graphSim.highlight(null);
  $('#sbComment').textContent = 'El silbatazo inicial está por sonar… el Águila 5000 arranca con batería alta.';
  renderSim();
}
function simStep() {
  const fn = simPolicyFn(SIM.policy);
  const s = SIM.s;
  const a = fn(s, SIM.rng);
  const tr = step(P, s, a, SIM.rng);
  SIM.G += P.gamma ** SIM.t * tr.r;
  SIM.total += tr.r;
  if (a === 0 && !tr.rescue) SIM.balls += 1;
  if (tr.rescue) SIM.rescues += 1;
  SIM.log.unshift({ t: SIM.t, s, a, r: tr.r, s2: tr.s2, rescue: tr.rescue });
  if (SIM.log.length > 200) SIM.log.pop();
  SIM.t += 1;
  SIM.s = tr.s2;
  graphSim.highlight(s, a, tr.s2);
  const pool = tr.rescue ? COMMENTS.rescue : COMMENTS[a];
  $('#sbComment').textContent = `Min ${SIM.t}: ${pool[Math.floor(SIM.rng() * pool.length)]}`;
  renderSim();
}
function renderSim() {
  $('#sbT').textContent = SIM.t;
  $('#sbS').textContent = SIM.s === 0 ? 'alta 🟩' : 'baja 🟥';
  $('#sbBalls').textContent = SIM.balls;
  $('#sbRescues').textContent = SIM.rescues;
  $('#sbTotal').textContent = f(SIM.total, 1);
  $('#sbG').textContent = f(SIM.G, 3);
  $('#sbAvg').textContent = SIM.t ? f(SIM.total / SIM.t, 3) : '0';
  $('#simLog').innerHTML = `<thead><tr><th class="num">t</th><th>S</th><th>A</th><th class="num">R</th><th>S'</th></tr></thead><tbody>${
    SIM.log.map((x, i) => `<tr class="${x.rescue ? 'rescue' : ''} ${i === 0 ? 'flash' : ''}"><td class="num">${x.t}</td><td>${stateName(x.s)}</td><td>${ACTION_EMOJI[x.a]} ${actName(x.a)}</td><td class="num">${f(x.r, 1)}</td><td>${stateName(x.s2)}${x.rescue ? ' 🚑' : ''}</td></tr>`).join('')
  }</tbody>`;
}
function toggleSim() {
  if (SIM.timer) { clearInterval(SIM.timer); SIM.timer = null; $('#simPlay').textContent = '▶ Jugar'; return; }
  const speed = 1260 - +$('#simSpeed').value;
  SIM.timer = setInterval(simStep, speed);
  $('#simPlay').textContent = '⏸ Pausa';
}

// ---------------------------------------------------------------- conclusiones + quiz
function renderConclusions() {
  const qL = OPT.Q[1];
  const ranking = actionsFor(1).slice().sort((a, b) => qL[b] - qL[a]).map((a) => `${actName(a)} (${f(qL[a])})`).join(' &gt; ');
  $('#conclusions').innerHTML = `
    <li>Con los parámetros actuales la política óptima es <strong>${polText(OPT.policy)}</strong>, con v*(alto) = ${f(OPT.V[0])} y v*(bajo) = ${f(OPT.V[1])}.</li>
    <li>En batería baja el orden de las jugadas es: ${ranking}.</li>
    <li>Los tres métodos de programación dinámica llegan a la <strong>misma</strong> respuesta; iteración de política lo hace en muy pocas iteraciones externas, iteración de valor en ${OPT.iterations} barridos (θ = 10⁻¹⁰).</li>
    <li>Monte Carlo, SARSA y Q-learning recuperan esa política <strong>sin conocer α ni β</strong>, solo jugando; necesitan exploración (ε &gt; 0) y una η adecuada.</li>
    <li>El castigo por rescate y β son los que deciden si arriesgar con batería baja vale la pena: mira el mapa de política.</li>`;
}
const QUIZ = [
  { q: '¿Qué hace a este problema un MDP finito?', o: ['Que el robot es americanista', 'Estados y acciones finitos con dinámica que solo depende del estado actual', 'Que las recompensas son positivas'], a: 1, why: 'Propiedad de Markov + conjuntos finitos de estados y acciones.' },
  { q: '¿Por qué no existe la acción “recargar” en batería alta?', o: ['Porque el MDP define A(s) por estado y recargar con carga alta no tiene sentido', 'Por un error de la práctica', 'Porque γ < 1'], a: 0, why: 'El conjunto de acciones puede depender del estado: A(S_H) = {buscar, esperar}.' },
  { q: 'Iteración de valor usa la ecuación de Bellman de…', o: ['expectativa', 'optimalidad (con max)', 'Monte Carlo'], a: 1, why: 'V(s) ← max_a Σ p [r + γ V(s\')].' },
  { q: 'La diferencia entre SARSA y Q-learning está en…', o: ['la tasa de aprendizaje', 'el objetivo: Q(S\',A\') de la acción jugada vs. max_a Q(S\',a)', 'que SARSA necesita el modelo'], a: 1, why: 'SARSA es on-policy; Q-learning es off-policy.' },
  { q: 'Si γ = 0, el robot…', o: ['solo maximiza la recompensa inmediata', 'planea infinitamente', 'nunca aprende'], a: 0, why: 'Con γ = 0, G_t = R_{t+1}: miopía total, siempre busca porque r_s > r_w.' },
];
function renderQuiz() {
  $('#quiz').innerHTML = QUIZ.map((x, i) => `<div class="quiz-q" data-i="${i}"><p>${i + 1}. ${x.q}</p>${x.o.map((o, j) => `<button data-j="${j}">${o}</button>`).join('')}<div class="why" hidden>${x.why}</div></div>`).join('');
  $('#quiz').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const box = b.closest('.quiz-q');
    const item = QUIZ[+box.dataset.i];
    box.querySelectorAll('button').forEach((x) => x.classList.remove('right', 'wrong'));
    b.classList.add(+b.dataset.j === item.a ? 'right' : 'wrong');
    box.querySelector(`button[data-j="${item.a}"]`).classList.add('right');
    box.querySelector('.why').hidden = false;
  });
}

// ---------------------------------------------------------------- orquestación
function onParamsChange() {
  store.set('aguila-params', P);
  OPT = optimal(P);
  renderSummary();
  renderMdpTable();
  graphMain.update(P);
  graphSim.update(P);
  renderGamma();
  renderEvaluation();
  resetVI();
  renderPI();
  renderMap();
  renderMcSample();
  resetTD();
  runCompare();
  resetSim();
  renderConclusions();
}

function initNav() {
  const btn = $('#menuBtn'), nav = $('#mainNav');
  btn.addEventListener('click', () => { const o = nav.classList.toggle('open'); btn.setAttribute('aria-expanded', String(o)); });
  nav.addEventListener('click', (e) => { if (e.target.tagName === 'A') { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
  const links = [...nav.querySelectorAll('a')];
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting) links.forEach((l) => l.classList.toggle('active', l.getAttribute('href') === `#${en.target.id}`));
    }
  }, { rootMargin: '-40% 0px -55% 0px' });
  document.querySelectorAll('main section[id]').forEach((s) => io.observe(s));

  const saved = store.get('aguila-theme');
  if (saved) document.documentElement.dataset.theme = saved;
  $('#themeBtn').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    store.set('aguila-theme', document.documentElement.dataset.theme);
  });
}

function init() {
  initNav();
  buildSliders();
  graphMain = buildGraph($('#graphMain'), 'gm');
  graphSim = buildGraph($('#graphSim'), 'gs');

  $('#openParams').addEventListener('click', () => openDrawer(true));
  $('#closeParams').addEventListener('click', () => openDrawer(false));
  $('#drawerScrim').addEventListener('click', () => openDrawer(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openDrawer(false); });
  $('#resetParams').addEventListener('click', () => setParams(DEFAULTS));
  document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => setParams(PRESETS[b.dataset.preset])));

  $('#evalH').addEventListener('change', renderEvaluation);
  $('#evalL').addEventListener('change', renderEvaluation);
  $('#viStep').addEventListener('click', () => { if (VI.k < VI.hist.length - 1) { VI.k += 1; renderVI(); } });
  $('#viRun').addEventListener('click', () => {
    clearInterval(VI.timer);
    VI.timer = setInterval(() => {
      if (VI.k >= VI.hist.length - 1) { clearInterval(VI.timer); return; }
      VI.k = Math.min(VI.hist.length - 1, VI.k + Math.max(1, Math.floor(VI.hist.length / 60)));
      renderVI();
    }, 40);
  });
  $('#viReset').addEventListener('click', resetVI);
  $('#piInitH').addEventListener('change', renderPI);
  $('#piInitL').addEventListener('change', renderPI);
  $('#mapAxes').addEventListener('change', renderMap);
  $('#mcSample').addEventListener('click', () => { mcSeed += 1; renderMcSample(); });
  $('#tdStep').addEventListener('click', tdStep);
  $('#tdReset').addEventListener('click', resetTD);
  $('#runCompare').addEventListener('click', runCompare);
  $('#simPolicy').addEventListener('change', resetSim);
  $('#simPlay').addEventListener('click', toggleSim);
  $('#simStep').addEventListener('click', () => { if (SIM.timer) toggleSim(); simStep(); });
  $('#simReset').addEventListener('click', resetSim);
  $('#simSpeed').addEventListener('change', () => { if (SIM.timer) { toggleSim(); toggleSim(); } });

  renderQuiz();
  onParamsChange();
  // Redibuja las gráficas al cambiar el ancho (son SVG con tamaño calculado)
  let lastW = innerWidth;
  addEventListener('resize', debounce(() => {
    if (Math.abs(innerWidth - lastW) < 40) return;
    lastW = innerWidth;
    renderEvaluation(); renderVI(); renderMap(); runCompare();
  }, 250));

  if (window.renderMathInElement) renderMath();
  else addEventListener('load', () => renderMath());
}

init();
