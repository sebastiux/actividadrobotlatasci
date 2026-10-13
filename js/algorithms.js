// Algoritmos de aprendizaje reforzado sobre el MDP del Águila 5000.
// Basados en modelo (programación dinámica): evaluación de política, iteración de valor,
// iteración de política. Sin modelo: Monte Carlo, SARSA y Q-learning.

import { actionsFor, qFromV, step, mulberry32, expectedReward, transitions } from './model.js?v=__V__';

const NS = 2;

export function emptyQ(fill = 0) {
  return [
    [fill, fill, -Infinity], // en alto no existe "recargar"
    [fill, fill, fill],
  ];
}

export function argmaxValid(Qs, s) {
  let best = actionsFor(s)[0];
  for (const a of actionsFor(s)) if (Qs[a] > Qs[best] + 1e-12) best = a;
  return best;
}

export function greedyPolicy(Q) {
  return [argmaxValid(Q[0], 0), argmaxValid(Q[1], 1)];
}

export function qTable(p, V) {
  const Q = emptyQ();
  for (let s = 0; s < NS; s++) for (const a of actionsFor(s)) Q[s][a] = qFromV(p, V, s, a);
  return Q;
}

// ---------- Evaluación exacta: resuelve (I - γ P_π) V = R_π (sistema 2x2) ----------
export function evaluatePolicyExact(p, pi) {
  const P = [[0, 0], [0, 0]];
  const R = [0, 0];
  for (let s = 0; s < NS; s++) {
    for (const t of transitions(p, s, pi[s])) P[s][t.s2] += t.prob;
    R[s] = expectedReward(p, s, pi[s]);
  }
  const a = 1 - p.gamma * P[0][0], b = -p.gamma * P[0][1];
  const c = -p.gamma * P[1][0], d = 1 - p.gamma * P[1][1];
  const det = a * d - b * c;
  return { V: [(d * R[0] - b * R[1]) / det, (a * R[1] - c * R[0]) / det], P, R };
}

// ---------- Evaluación iterativa de política (barridos de Bellman de expectativa) ----------
export function policyEvaluation(p, pi, { theta = 1e-6, maxIter = 1000, V0 = [0, 0] } = {}) {
  let V = V0.slice();
  const history = [{ k: 0, V: V.slice(), delta: NaN }];
  for (let k = 1; k <= maxIter; k++) {
    const Vn = [qFromV(p, V, 0, pi[0]), qFromV(p, V, 1, pi[1])];
    const delta = Math.max(Math.abs(Vn[0] - V[0]), Math.abs(Vn[1] - V[1]));
    V = Vn;
    history.push({ k, V: V.slice(), delta });
    if (delta < theta) break;
  }
  return history;
}

// ---------- Iteración de valor (barridos de Bellman de optimalidad) ----------
export function valueIteration(p, { theta = 1e-6, maxIter = 1000 } = {}) {
  let V = [0, 0];
  const history = [{ k: 0, V: V.slice(), Q: qTable(p, V), delta: NaN }];
  for (let k = 1; k <= maxIter; k++) {
    const Q = qTable(p, V);
    const Vn = [Math.max(...Q[0].filter(Number.isFinite)), Math.max(...Q[1])];
    const delta = Math.max(Math.abs(Vn[0] - V[0]), Math.abs(Vn[1] - V[1]));
    history.push({ k, V: Vn.slice(), Q, Vprev: V.slice(), delta, policy: greedyPolicy(Q) });
    V = Vn;
    if (delta < theta) break;
  }
  return history;
}

export function optimal(p) {
  const h = valueIteration(p, { theta: 1e-10, maxIter: 5000 });
  const V = h[h.length - 1].V;
  const Q = qTable(p, V);
  return { V, Q, policy: greedyPolicy(Q), iterations: h.length - 1 };
}

// ---------- Iteración de política (evaluar → mejorar hasta que sea estable) ----------
export function policyIteration(p, pi0 = [1, 1]) {
  let pi = pi0.slice();
  const steps = [];
  for (let i = 0; i < 50; i++) {
    const { V } = evaluatePolicyExact(p, pi);
    const sweeps = policyEvaluation(p, pi, { theta: 1e-6 }).length - 1;
    const Q = qTable(p, V);
    const next = greedyPolicy(Q);
    // Solo cambiamos si la mejora es estricta (evita oscilar entre empates)
    for (let s = 0; s < NS; s++) if (Q[s][next[s]] <= Q[s][pi[s]] + 1e-9) next[s] = pi[s];
    const stable = next[0] === pi[0] && next[1] === pi[1];
    steps.push({ i, pi: pi.slice(), V, Q, next, stable, sweeps });
    if (stable) break;
    pi = next;
  }
  return steps;
}

// ---------- Utilidades para los métodos sin modelo ----------
function epsGreedy(Q, s, eps, rng) {
  const acts = actionsFor(s);
  if (rng() < eps) return acts[Math.floor(rng() * acts.length)];
  return argmaxValid(Q[s], s);
}

export function qError(Q, Qstar) {
  let sum = 0, n = 0;
  for (let s = 0; s < NS; s++) for (const a of actionsFor(s)) { sum += (Q[s][a] - Qstar[s][a]) ** 2; n++; }
  return Math.sqrt(sum / n);
}

function cloneQ(Q) { return Q.map((r) => r.slice()); }

function defaults(opts) {
  return {
    episodes: 400, T: 60, eta: 0.1, eps: 0.2, epsDecay: true, seed: 7, ...opts,
  };
}

function epsAt(o, ep) {
  return o.epsDecay ? Math.max(0.01, o.eps * (1 - ep / o.episodes)) : o.eps;
}

// Monte Carlo de control ε-greedy (primera visita, promedio incremental).
// Como la tarea es continua, cada episodio es una "sesión de entrenamiento" de T pasos.
export function monteCarlo(p, Qstar, opts = {}) {
  const o = defaults(opts);
  const rng = mulberry32(o.seed);
  const Q = emptyQ();
  const N = emptyQ(0).map((r) => r.map(() => 0));
  const reward = [], error = [];
  for (let ep = 0; ep < o.episodes; ep++) {
    const eps = epsAt(o, ep);
    let s = 0;
    const traj = [];
    let total = 0;
    for (let t = 0; t < o.T; t++) {
      const a = epsGreedy(Q, s, eps, rng);
      const tr = step(p, s, a, rng);
      traj.push({ s, a, r: tr.r });
      total += tr.r;
      s = tr.s2;
    }
    // retornos descontados hacia atrás: G_t = r_{t+1} + γ G_{t+1}
    const G = new Array(traj.length);
    let g = 0;
    for (let t = traj.length - 1; t >= 0; t--) { g = traj[t].r + p.gamma * g; G[t] = g; }
    const seen = new Set();
    // Solo actualizamos con la primera mitad para que el truncamiento no sesgue los retornos
    const horizon = Math.ceil(traj.length / 2);
    for (let t = 0; t < horizon; t++) {
      const key = traj[t].s * 3 + traj[t].a;
      if (seen.has(key)) continue;
      seen.add(key);
      const { s: ss, a: aa } = traj[t];
      N[ss][aa] += 1;
      Q[ss][aa] += (G[t] - Q[ss][aa]) / N[ss][aa];
    }
    reward.push(total / o.T);
    error.push(qError(Q, Qstar));
  }
  return { Q, reward, error, policy: greedyPolicy(Q) };
}

// SARSA (on-policy TD): Q(s,a) += η [r + γ Q(s',a') - Q(s,a)], con a' elegida por la misma política ε-greedy.
export function sarsa(p, Qstar, opts = {}) {
  const o = defaults(opts);
  const rng = mulberry32(o.seed);
  const Q = emptyQ();
  const reward = [], error = [];
  for (let ep = 0; ep < o.episodes; ep++) {
    const eps = epsAt(o, ep);
    let s = 0;
    let a = epsGreedy(Q, s, eps, rng);
    let total = 0;
    for (let t = 0; t < o.T; t++) {
      const tr = step(p, s, a, rng);
      const a2 = epsGreedy(Q, tr.s2, eps, rng);
      Q[s][a] += o.eta * (tr.r + p.gamma * Q[tr.s2][a2] - Q[s][a]);
      total += tr.r;
      s = tr.s2;
      a = a2;
    }
    reward.push(total / o.T);
    error.push(qError(Q, Qstar));
  }
  return { Q, reward, error, policy: greedyPolicy(Q) };
}

// Q-learning (off-policy TD): Q(s,a) += η [r + γ max_a' Q(s',a') - Q(s,a)].
export function qLearning(p, Qstar, opts = {}) {
  const o = defaults(opts);
  const rng = mulberry32(o.seed);
  const Q = emptyQ();
  const reward = [], error = [];
  for (let ep = 0; ep < o.episodes; ep++) {
    const eps = epsAt(o, ep);
    let s = 0;
    let total = 0;
    for (let t = 0; t < o.T; t++) {
      const a = epsGreedy(Q, s, eps, rng);
      const tr = step(p, s, a, rng);
      const best = Q[tr.s2][argmaxValid(Q[tr.s2], tr.s2)];
      Q[s][a] += o.eta * (tr.r + p.gamma * best - Q[s][a]);
      total += tr.r;
      s = tr.s2;
    }
    reward.push(total / o.T);
    error.push(qError(Q, Qstar));
  }
  return { Q, reward, error, policy: greedyPolicy(Q) };
}

// Una sola actualización TD explicada paso a paso (para el panel didáctico).
export function tdExplain(p, Q, s, a, tr, a2, eta, kind) {
  const target = kind === 'q'
    ? tr.r + p.gamma * Q[tr.s2][argmaxValid(Q[tr.s2], tr.s2)]
    : tr.r + p.gamma * Q[tr.s2][a2];
  const tdError = target - Q[s][a];
  return { target, tdError, newQ: Q[s][a] + eta * tdError };
}

// Mapa de política óptima sobre una rejilla de α × β.
export function policyMap(p, n = 21) {
  const cells = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const alpha = i / (n - 1), beta = j / (n - 1);
      const o = optimal({ ...p, alpha, beta });
      cells.push({ alpha, beta, policy: o.policy, V: o.V });
    }
  }
  return cells;
}

// Simulación de una política fija (para comparar retornos promedio).
export function rollout(p, policyFn, { T = 60, seed = 1 } = {}) {
  const rng = mulberry32(seed);
  let s = 0;
  const log = [];
  for (let t = 0; t < T; t++) {
    const a = policyFn(s, rng);
    const tr = step(p, s, a, rng);
    log.push({ t, s, a, r: tr.r, s2: tr.s2, rescue: !!tr.rescue });
    s = tr.s2;
  }
  return log;
}

export { cloneQ };
