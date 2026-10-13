// Modelo del MDP finito del "Águila 5000" (adaptación del Can Finder 5000).
// Estados: 0 = energía ALTA, 1 = energía BAJA.
// Acciones: 0 = buscar balones, 1 = esperar en la banca, 2 = recargar en el vestidor.

export const STATES = ['alto', 'bajo'];
export const STATE_LABELS = ['Energía alta (S_H)', 'Energía baja (S_L)'];
export const ACTIONS = ['buscar', 'esperar', 'recargar'];
export const ACTION_LABELS = ['Buscar balones', 'Esperar en la banca', 'Recargar en el vestidor'];
export const ACTION_EMOJI = ['⚽', '🪑', '🔋'];

export const DEFAULTS = {
  alpha: 0.8,   // P(seguir en alto | alto, buscar)
  beta: 0.4,    // P(seguir en bajo | bajo, buscar)
  rs: 1,        // recompensa por buscar (balón recuperado)
  rw: 0.3,      // recompensa por esperar (un compañero le pasa el balón)
  rescue: -3,   // castigo por quedarse sin batería (sale en camilla)
  gamma: 0.9,   // factor de descuento
};

// Acciones válidas por estado: en energía alta no se puede recargar.
export function actionsFor(s) {
  return s === 0 ? [0, 1] : [0, 1, 2];
}

// Dinámica p(s', r | s, a) como lista de resultados posibles.
export function transitions(p, s, a) {
  if (s === 0 && a === 0) {
    return [
      { s2: 0, prob: p.alpha, r: p.rs },
      { s2: 1, prob: 1 - p.alpha, r: p.rs },
    ];
  }
  if (s === 1 && a === 0) {
    return [
      { s2: 1, prob: p.beta, r: p.rs },
      { s2: 0, prob: 1 - p.beta, r: p.rescue, rescue: true },
    ];
  }
  if (a === 1) return [{ s2: s, prob: 1, r: p.rw }];
  if (s === 1 && a === 2) return [{ s2: 0, prob: 1, r: 0 }];
  return [];
}

// r(s, a): recompensa esperada de tomar a en s.
export function expectedReward(p, s, a) {
  return transitions(p, s, a).reduce((acc, t) => acc + t.prob * t.r, 0);
}

// q(s, a) a partir de V usando la ecuación de Bellman (un paso de anticipación).
export function qFromV(p, V, s, a) {
  return transitions(p, s, a).reduce((acc, t) => acc + t.prob * (t.r + p.gamma * V[t.s2]), 0);
}

// Muestrea una transición del entorno (para los métodos sin modelo).
export function step(p, s, a, rng) {
  const ts = transitions(p, s, a);
  const u = rng();
  let c = 0;
  for (const t of ts) {
    c += t.prob;
    if (u < c) return t;
  }
  return ts[ts.length - 1];
}

// Generador pseudoaleatorio con semilla, para que los experimentos sean reproducibles.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
