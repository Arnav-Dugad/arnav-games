// Shared geometry helpers for the Arnav Games brand scripts.

/** Polygon with circular-arc fillets. `r` is a number or one radius per vertex. Clockwise (screen) input. */
export function roundPoly(points, r) {
  const n = points.length;
  const radii = Array.isArray(r) ? r : points.map(() => r);
  const segs = [];
  for (let i = 0; i < n; i++) {
    const P = points[i];
    const A = points[(i - 1 + n) % n];
    const B = points[(i + 1) % n];
    const u1 = norm([A[0] - P[0], A[1] - P[1]]);
    const u2 = norm([B[0] - P[0], B[1] - P[1]]);
    const theta = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
    const rad = radii[i];
    const t = rad === 0 ? 0 : rad / Math.tan(theta / 2);
    const s = [P[0] + u1[0] * t, P[1] + u1[1] * t];
    const e = [P[0] + u2[0] * t, P[1] + u2[1] * t];
    const cross = (P[0] - A[0]) * (B[1] - P[1]) - (P[1] - A[1]) * (B[0] - P[0]);
    segs.push({ s, e, rad, sweep: cross > 0 ? 1 : 0 });
  }
  let d = `M${f(segs[0].e[0])} ${f(segs[0].e[1])}`;
  for (let k = 1; k <= n; k++) {
    const g = segs[k % n];
    d += `L${f(g.s[0])} ${f(g.s[1])}`;
    if (g.rad > 0) d += `A${f(g.rad)} ${f(g.rad)} 0 0 ${g.sweep} ${f(g.e[0])} ${f(g.e[1])}`;
  }
  return d + 'Z';
}

export function norm(v) {
  const l = Math.hypot(v[0], v[1]);
  return [v[0] / l, v[1] / l];
}

export const f = (x) => (Math.round(x * 100) / 100).toString();

/** Intersection of line p1→p2 with line p3→p4. */
export function intersect(p1, p2, p3, p4) {
  const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
  const a = p1[0] * p2[1] - p1[1] * p2[0];
  const b = p3[0] * p4[1] - p3[1] * p4[0];
  return [(a * (p3[0] - p4[0]) - (p1[0] - p2[0]) * b) / d, (a * (p3[1] - p4[1]) - (p1[1] - p2[1]) * b) / d];
}

/** Offsets the line a→b by `dist` along its left normal (screen coordinates). */
export function offsetLine(a, b, dist) {
  const [ux, uy] = norm([b[0] - a[0], b[1] - a[1]]);
  const nx = uy;
  const ny = -ux;
  return [
    [a[0] + nx * dist, a[1] + ny * dist],
    [b[0] + nx * dist, b[1] + ny * dist],
  ];
}

/** Four-point star (concave sides) centred at cx, cy; `rx` narrows the horizontal arms. */
export function star4(cx, cy, r, pinch = 0.22, rx = r) {
  const k = r * pinch;
  return `M${f(cx)} ${f(cy - r)}C${f(cx + k * 0.35)} ${f(cy - k)} ${f(cx + k)} ${f(cy - k * 0.35)} ${f(cx + rx)} ${f(cy)}C${f(cx + k)} ${f(cy + k * 0.35)} ${f(cx + k * 0.35)} ${f(cy + k)} ${f(cx)} ${f(cy + r)}C${f(cx - k * 0.35)} ${f(cy + k)} ${f(cx - k)} ${f(cy + k * 0.35)} ${f(cx - rx)} ${f(cy)}C${f(cx - k)} ${f(cy - k * 0.35)} ${f(cx - k * 0.35)} ${f(cy - k)} ${f(cx)} ${f(cy - r)}Z`;
}

/** Superellipse ("squircle") of exponent n filling a size × size box: continuous-curvature corners. */
export function squircle(size, n = 5, steps = 160) {
  const h = size / 2;
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push([h + h * Math.sign(c) * Math.abs(c) ** (2 / n), h + h * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  return `M${pts.map((p) => `${f(p[0])} ${f(p[1])}`).join('L')}Z`;
}
