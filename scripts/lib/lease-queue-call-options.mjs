// One budget for lease coordination; ordinary MCP probes retain their default.
export function resolveLeaseQueueTimeoutMs(env = process.env) {
  const value = Number(env.DPF_GATE_MCP_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 60_000;
}

export function leaseQueueCallOptions(mcpUrl, bearerToken, { env = process.env, remainingMs = Infinity } = {}) {
  const timeoutMs = Math.min(resolveLeaseQueueTimeoutMs(env), remainingMs);
  if (!(timeoutMs > 0)) throw new Error("lease_call_deadline_exhausted");
  return { mcpUrl, bearerToken, timeoutMs };
}
