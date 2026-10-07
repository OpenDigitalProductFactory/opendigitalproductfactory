// The promoter subprocess budget, in a module with no host-only imports, so a
// queue function (the self-upgrade prebuild) can read it without pulling the
// Docker-only promoter graph into a server bundle (BI-98AF1066).

/** Default hard budget for the promoter subprocess: 25 min (env-overridable). */
export function resolvePromoterTimeoutMs(params: { timeoutMs?: number }): number {
  if (typeof params.timeoutMs === "number" && params.timeoutMs > 0) return params.timeoutMs;
  const env = Number(process.env.DPF_PROMOTER_TIMEOUT_MS);
  if (Number.isFinite(env) && env > 0) return env;
  return 25 * 60 * 1000;
}
