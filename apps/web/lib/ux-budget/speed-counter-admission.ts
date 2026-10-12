// Admission for sweep speed counters (BI-BDB43823). A counter may gate a PR
// only after it is (1) identical on every route across two passes on the same
// tree and (2) rank-correlated with lab wall-clock time (Spearman rho >= 0.5
// against navigationAndSettleMs). Anything else is rejected with its reason,
// so nobody climbs a flaky or meaningless hill.

import { SPEED_COUNTERS, type SpeedCounterName, type SpeedCounters } from "./speed-counters";

export const MIN_RHO = 0.5;
export const MIN_ROUTES = 8;

export type PassSample = { routePath: string; counters: SpeedCounters; navigationAndSettleMs: number };

export type CounterVerdict = {
  counter: SpeedCounterName;
  status: "admitted" | "rejected";
  repeatable: boolean;
  mismatchedRoutes: string[];
  rho: number | null;
  n: number;
  reason: string;
};

/** Average ranks (1-based), ties share the mean rank. */
function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  let k = 0;
  while (k < order.length) {
    let j = k;
    while (j + 1 < order.length && order[j + 1].v === order[k].v) j++;
    const mean = (k + j) / 2 + 1;
    for (let m = k; m <= j; m++) out[order[m].i] = mean;
    k = j + 1;
  }
  return out;
}

/** Spearman rank correlation; null when either side has no variance. */
export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export function admitCounters(passA: PassSample[], passB: PassSample[]): CounterVerdict[] {
  const byRouteB = new Map(passB.map((s) => [s.routePath, s]));
  const paired = passA
    .map((a) => ({ a, b: byRouteB.get(a.routePath) }))
    .filter((p): p is { a: PassSample; b: PassSample } => p.b !== undefined);

  return SPEED_COUNTERS.map((counter) => {
    const mismatchedRoutes = paired
      .filter(({ a, b }) => a.counters[counter] !== b.counters[counter])
      .map(({ a }) => a.routePath)
      .sort();
    const repeatable = mismatchedRoutes.length === 0;
    const xs = paired.map(({ a }) => a.counters[counter]);
    const ys = paired.map(({ a, b }) => (a.navigationAndSettleMs + b.navigationAndSettleMs) / 2);
    const rho = spearman(xs, ys);
    const n = paired.length;
    const rounded = rho === null ? null : Math.round(rho * 1000) / 1000;

    let reason: string;
    let status: CounterVerdict["status"] = "rejected";
    if (!repeatable) {
      reason = `not repeatable: differs between two passes on ${mismatchedRoutes.length} route(s)`;
    } else if (n < MIN_ROUTES) {
      reason = `too few routes to judge (${n} < ${MIN_ROUTES})`;
    } else if (rho === null) {
      reason = "no variance across routes, so it cannot track wall-clock time";
    } else if (rho < MIN_RHO) {
      reason = `does not track wall-clock time (Spearman rho ${rounded} < ${MIN_RHO})`;
    } else {
      status = "admitted";
      reason = `repeatable on ${n} routes and tracks wall-clock time (Spearman rho ${rounded} >= ${MIN_RHO})`;
    }
    return { counter, status, repeatable, mismatchedRoutes, rho: rounded, n, reason };
  });
}
