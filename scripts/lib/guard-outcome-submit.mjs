// scripts/lib/guard-outcome-submit.mjs — submit the guard outcome spool
// through the existing `record_external_development_evidence` lane (BI-FEDD8F45).
//
// Kept apart from guard-outcome-record.mjs so the guard loop, which only
// spools, never reaches the MCP client. Pregate and the pre-push hook pass
// `submitSpool` to recordGuardRun. Never throws: no credential, CI, or a dead
// portal leaves the spool for the next flush.

import { FLUSH_TIMEOUT_MS, flushSpool } from "./guard-outcome-record.mjs";

export async function submitSpool({ directory, env = process.env, declarations = null, call } = {}) {
  if (env.CI === "true" || env.DPF_GUARD_OUTCOME_SUBMIT === "0") {
    return { submitted: 0, refused: [], pending: 0, error: "submit-disabled" };
  }
  try {
    let transport = call;
    if (!transport) {
      const [{ mcpCall }, { resolveMcpCredential }] = await Promise.all([
        import("./mcp-client.mjs"),
        import("./mcp-credential.mjs"),
      ]);
      const mcpUrl = env.DPF_MCP_URL || "http://127.0.0.1:3000/api/mcp/v1";
      let bearerToken;
      try {
        bearerToken = resolveMcpCredential({ mcpUrl, env }).bearer;
      } catch {
        return { submitted: 0, refused: [], pending: 0, error: "no-credential" };
      }
      // The existing external development evidence lane carries the runs
      // (DI-C7020CB136AA): no dedicated tool. A refusal of the whole call
      // (authorization, validation) keeps the spool pending.
      transport = async (args) => {
        const result = await mcpCall("record_external_development_evidence", {
          provider: "guard-outcome-runner",
          externalSessionId: "guard-outcomes",
          summary: `guard outcome runs (${args.records.length})`,
          routeContext: "/ops/gate-efficacy",
          guardOutcomes: args,
        }, { mcpUrl, bearerToken, timeoutMs: FLUSH_TIMEOUT_MS });
        if (result?.success === false) throw new Error(String(result.error ?? result.message ?? "refused"));
        return result?.data ?? result;
      };
    }
    return await flushSpool({ directory, declarations, call: transport });
  } catch (error) {
    return { submitted: 0, refused: [], pending: 0, error: String(error?.message ?? error).slice(0, 200) };
  }
}
