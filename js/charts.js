// Gráficas SVG ligeras sin dependencias: líneas con crosshair + tooltip y mapas de calor categóricos.

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    // var(--x) no funciona en atributos de presentación SVG: va como estilo
    if ((k === 'fill' || k === 'stroke') && String(v).startsWith('var(')) n.style[k] = v;
    else n.setAttribute(k, v);
  }
  if (parent) parent.appendChild(n);
  return n;
}

function niceTicks(min, max, count = 5) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

function fmt(v, d = 2) {
  if (!Number.isFinite(v)) return '—';
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(d);
}

function ensureTooltip(container) {
  let tip = container.querySelector('.chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    container.appendChild(tip);
  }
  return tip;
}

/**
 * series: [{ name, values:number[], color:'var(--x)', dash?:string }]
 * opts: { xLabel, yLabel, height, xStart, refLine:{value,label}, legend:true }
 */
export function lineChart(container, series, opts = {}) {
  container.classList.add('chart');
  container.querySelectorAll('svg, .chart-legend').forEach((n) => n.remove());
  const width = Math.max(280, container.clientWidth || 600);
  const height = opts.height || 260;
  const m = { t: 16, r: 92, b: 40, l: 48 };
  if (width < 480) m.r = 64;
  const iw = width - m.l - m.r, ih = height - m.t - m.b;
  const n = Math.max(...series.map((s) => s.values.length));
  const xStart = opts.xStart ?? 0;
  let all = series.flatMap((s) => s.values.filter(Number.isFinite));
  if (opts.refLine) all = all.concat(opts.refLine.value);
  if (!all.length) all = [0, 1];
  const ticks = niceTicks(Math.min(...all), Math.max(...all));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const x = (i) => m.l + (n <= 1 ? 0 : (i / (n - 1)) * iw);
  const y = (v) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;

  if (series.length > 1 && opts.legend !== false) {
    const lg = document.createElement('div');
    lg.className = 'chart-legend';
    for (const s of series) {
      const it = document.createElement('span');
      it.innerHTML = `<svg width="22" height="10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" style="stroke:${s.color}" stroke-width="2.5" stroke-linecap="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/></svg>${s.name}`;
      lg.appendChild(it);
    }
    container.prepend(lg);
  }

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': opts.ariaLabel || 'Gráfica de líneas' });
  container.appendChild(svg);

  // grid + eje Y
  for (const t of ticks) {
    el('line', { x1: m.l, x2: m.l + iw, y1: y(t), y2: y(t), class: 'grid' }, svg);
    const tx = el('text', { x: m.l - 8, y: y(t) + 4, class: 'axis-label', 'text-anchor': 'end' }, svg);
    tx.textContent = fmt(t, Math.abs(y1 - y0) < 2 ? 2 : 1);
  }
  // eje X
  const xt = niceTicks(xStart, xStart + n - 1, width < 480 ? 3 : 6).filter((v) => v >= xStart && v <= xStart + n - 1);
  for (const t of xt) {
    const tx = el('text', { x: x(t - xStart), y: m.t + ih + 18, class: 'axis-label', 'text-anchor': 'middle' }, svg);
    tx.textContent = t;
  }
  el('line', { x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih, class: 'axis' }, svg);
  if (opts.xLabel) {
    const tx = el('text', { x: m.l + iw / 2, y: height - 4, class: 'axis-title', 'text-anchor': 'middle' }, svg);
    tx.textContent = opts.xLabel;
  }
  if (opts.yLabel) {
    const tx = el('text', { x: 12, y: m.t + ih / 2, class: 'axis-title', 'text-anchor': 'middle', transform: `rotate(-90 12 ${m.t + ih / 2})` }, svg);
    tx.textContent = opts.yLabel;
  }
  if (opts.refLine) {
    el('line', { x1: m.l, x2: m.l + iw, y1: y(opts.refLine.value), y2: y(opts.refLine.value), class: 'ref-line' }, svg);
    const tx = el('text', { x: m.l + iw - 4, y: y(opts.refLine.value) - 6, class: 'axis-label', 'text-anchor': 'end' }, svg);
    tx.textContent = opts.refLine.label;
  }

  // líneas + etiquetas directas al final (desplazadas si chocan)
  const ends = [];
  for (const s of series) {
    const pts = s.values.map((v, i) => (Number.isFinite(v) ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : null)).filter(Boolean);
    if (!pts.length) continue;
    el('polyline', { points: pts.join(' '), fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...(s.dash ? { 'stroke-dasharray': s.dash } : {}) }, svg);
    const last = s.values.length - 1;
    ends.push({ s, yy: y(s.values[last]), xx: x(last) });
  }
  ends.sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 13) ends[i].yy = ends[i - 1].yy + 13;
  if (series.length <= 4) {
    for (const e of ends) {
      el('circle', { cx: e.xx, cy: y(e.s.values[e.s.values.length - 1]), r: 4, fill: e.s.color, stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
      const tx = el('text', { x: e.xx + 8, y: e.yy + 4, class: 'direct-label' }, svg);
      tx.textContent = e.s.short || e.s.name;
    }
  }

  // capa de hover: crosshair + tooltip
  const tip = ensureTooltip(container);
  const cross = el('line', { y1: m.t, y2: m.t + ih, class: 'crosshair', visibility: 'hidden' }, svg);
  const dots = series.map((s) => el('circle', { r: 4.5, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }, svg));
  const hit = el('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' }, svg);
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * width;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    let rows = '';
    series.forEach((s, k) => {
      const v = s.values[i];
      if (Number.isFinite(v)) {
        dots[k].setAttribute('cx', x(i)); dots[k].setAttribute('cy', y(v)); dots[k].setAttribute('visibility', 'visible');
      }
      rows += `<div class="tip-row"><span class="tip-key" style="background:${s.color}"></span>${s.name}<b>${fmt(v, 3)}</b></div>`;
    });
    tip.innerHTML = `<div class="tip-title">${opts.xLabel || 'x'}: ${i + xStart}</div>${rows}`;
    tip.hidden = false;
    const cr = container.getBoundingClientRect();
    const left = ev.clientX - cr.left + 14;
    tip.style.left = `${Math.min(left, cr.width - tip.offsetWidth - 4)}px`;
    tip.style.top = `${ev.clientY - cr.top - tip.offsetHeight - 10}px`;
  };
  const leave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerleave', leave);
}

/**
 * Mapa de calor categórico. cells: [{ xi, yi, cat, tip }], categories: [{ name, color }]
 */
export function categoryMap(container, cells, n, categories, opts = {}) {
  container.classList.add('chart');
  container.querySelectorAll('svg, .chart-legend').forEach((x) => x.remove());
  const size = Math.min(container.clientWidth || 320, 360);
  const m = { t: 8, r: 8, b: 40, l: 46 };
  const w = size, h = size;
  const iw = w - m.l - m.r, ih = h - m.t - m.b;
  const cw = iw / n, ch = ih / n;

  const lg = document.createElement('div');
  lg.className = 'chart-legend';
  for (const c of categories) {
    const it = document.createElement('span');
    it.innerHTML = `<i class="sw" style="background:${c.color}"></i>${c.name}`;
    lg.appendChild(it);
  }
  container.prepend(lg);

  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: 'img', 'aria-label': opts.ariaLabel || 'Mapa de política' });
  container.appendChild(svg);
  const tip = ensureTooltip(container);
  for (const c of cells) {
    const r = el('rect', {
      x: m.l + c.xi * cw + 1, y: m.t + (n - 1 - c.yi) * ch + 1,
      width: Math.max(1, cw - 2), height: Math.max(1, ch - 2), rx: 2,
      fill: categories[c.cat].color, class: 'cell',
    }, svg);
    r.addEventListener('pointermove', (ev) => {
      tip.innerHTML = c.tip;
      tip.hidden = false;
      const cr = container.getBoundingClientRect();
      tip.style.left = `${Math.min(ev.clientX - cr.left + 12, cr.width - tip.offsetWidth - 4)}px`;
      tip.style.top = `${ev.clientY - cr.top - tip.offsetHeight - 10}px`;
    });
    r.addEventListener('pointerleave', () => { tip.hidden = true; });
  }
  if (opts.marker) {
    const mx = m.l + opts.marker.x * iw, my = m.t + ih - opts.marker.y * ih;
    el('circle', { cx: mx, cy: my, r: 7, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2.5 }, svg);
    el('circle', { cx: mx, cy: my, r: 2.5, fill: 'var(--ink)' }, svg);
  }
  const lab = (txt, attrs) => { const t = el('text', attrs, svg); t.textContent = txt; };
  lab(opts.xLabel || 'x', { x: m.l + iw / 2, y: h - 4, class: 'axis-title', 'text-anchor': 'middle' });
  lab(opts.yLabel || 'y', { x: 12, y: m.t + ih / 2, class: 'axis-title', 'text-anchor': 'middle', transform: `rotate(-90 12 ${m.t + ih / 2})` });
  const [x0, x1] = opts.xRange || [0, 1];
  const [y0, y1] = opts.yRange || [0, 1];
  lab(fmt(x0, 1), { x: m.l, y: m.t + ih + 16, class: 'axis-label', 'text-anchor': 'start' });
  lab(fmt(x1, 1), { x: m.l + iw, y: m.t + ih + 16, class: 'axis-label', 'text-anchor': 'end' });
  lab(fmt(y0, 1), { x: m.l - 6, y: m.t + ih, class: 'axis-label', 'text-anchor': 'end' });
  lab(fmt(y1, 1), { x: m.l - 6, y: m.t + 10, class: 'axis-label', 'text-anchor': 'end' });
}

export function movingAverage(values, w = 20) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= w) sum -= values[i - w];
    out.push(sum / Math.min(i + 1, w));
  }
  return out;
}
