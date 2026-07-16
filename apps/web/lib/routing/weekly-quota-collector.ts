// Opt-in, fail-closed collector for the claude-cli weekly subscription quota.
//
// This is the live half of the BI-779FA953 seam for the ONE provider whose read
// is a plain gated HTTP call (codex-cli, which needs a subprocess spawn, stays a
// documented seam). It is deliberately OFF by default and driven entirely by
// operator-declared config, which is how we honour "Never Assume — Verify"
// without a human in the loop: the code does nothing until an operator names the
// credentials path and flips the enable flag — i.e. the operator declares the
// runtime topology this build could not verify autonomously.
//
//   DPF_WEEKLY_QUOTA_COLLECT_ENABLED = "true"   — master switch (default: off)
//   DPF_CLAUDE_OAUTH_CREDS_PATH       = <path>   — where the CLI OAuth token lives
//   DPF_CLAUDE_CODE_UA                = <ua>      — optional User-Agent override
//
// Every failure path returns { collected: false } and records NOTHING — a failed
// or stale read must never masquerade as "plenty of quota" to the drain policy.

import { readFile } from "node:fs/promises";
import { parseOAuthUsageJson } from "./weekly-quota";
import { recordCliWeeklyQuota } from "./cli-pool-status";

const OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

export type WeeklyQuotaCollectResult = {
  collected: boolean;
  reason: string;
  /** The provider signal source when a snapshot was recorded. */
  source?: string;
};

/** Injectable dependencies so the collector is testable without real fs / network. */
export interface WeeklyQuotaCollectDeps {
  readCreds?: (path: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}

/**
 * Extract the OAuth access token from a Claude Code credentials file. Lenient
 * about shape (the CLI has used `{ claudeAiOauth: { accessToken } }` and flat
 * `{ accessToken }`); returns null when no token field is present.
 */
export function extractAccessToken(raw: string): string | null {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const nested = (j.claudeAiOauth as Record<string, unknown> | undefined) ?? undefined;
    const candidates = [nested?.accessToken, nested?.access_token, j.accessToken, j.access_token, j.token];
    for (const c of candidates) {
      if (typeof c === "string" && c.length > 0) return c;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read the claude-cli weekly subscription quota from /api/oauth/usage and record
 * it against the claude-cli pool. Opt-in + fail-closed (see module header).
 */
export async function collectClaudeCliWeeklyQuota(
  deps: WeeklyQuotaCollectDeps = {},
): Promise<WeeklyQuotaCollectResult> {
  const env = deps.env ?? process.env;

  if (env.DPF_WEEKLY_QUOTA_COLLECT_ENABLED !== "true") {
    return { collected: false, reason: "collection disabled (DPF_WEEKLY_QUOTA_COLLECT_ENABLED != true)" };
  }
  const credsPath = env.DPF_CLAUDE_OAUTH_CREDS_PATH;
  if (!credsPath) {
    return { collected: false, reason: "no creds path (DPF_CLAUDE_OAUTH_CREDS_PATH unset)" };
  }

  try {
    const readCreds = deps.readCreds ?? ((p: string) => readFile(p, "utf8"));
    const raw = await readCreds(credsPath);
    const token = extractAccessToken(raw);
    if (!token) return { collected: false, reason: "no access token in creds file" };

    const fetchImpl = deps.fetchImpl ?? fetch;
    const res = await fetchImpl(OAUTH_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        // REQUIRED — without a claude-code User-Agent the endpoint drops the
        // caller into an aggressively rate-limited bucket and 429s.
        "User-Agent": env.DPF_CLAUDE_CODE_UA ?? "claude-code/1.0.0",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { collected: false, reason: `oauth/usage HTTP ${res.status}` };

    const body = await res.json().catch(() => null);
    const snapshot = parseOAuthUsageJson(body, deps.now ?? new Date());
    if (!snapshot) return { collected: false, reason: "no weekly window in oauth/usage response" };

    await recordCliWeeklyQuota("claude-cli", "anthropic-sub", snapshot);
    return { collected: true, reason: "recorded weekly quota", source: snapshot.source };
  } catch (err) {
    // Fail closed — never record a partial/failed read.
    return { collected: false, reason: `error: ${err instanceof Error ? err.message : String(err)}` };
  }
}
