#!/usr/bin/env tsx
// dpf-verify-preflight â€” the executable step-zero of "functionally verify a
// feature on the live install."
//
// Spec: docs/superpowers/specs/2026-06-06-procedural-functional-verification-design.md
// Run:  pnpm verify:preflight -- [--portal-url <url>] [--feature-sha <sha>] [--json]
//
// This is the thin IO shim over the pure verdict core
// (apps/web/lib/verify/preflight.ts): it fetches the live install's served
// identity, resolves the feature commit, computes ancestry via git, then prints
// ONE verdict and ONE next action. It changes nothing â€” advancing the install
// or filing a blocker BI is the skill's job (dpf-verify-on-live-install), not
// this script's. tsx erases the core's `import type` at runtime, so the verdict
// logic stays single-sourced with the app + the unit tests.

import { execFileSync } from "node:child_process";
import { resolveHostMcpTrust, runWithHostMcpTrust } from "./lib/mcp-host-trust.mjs";
import {
  computePreflightVerdict,
  type PreflightInput,
  type PreflightResult,
} from "../apps/web/lib/verify/preflight";
import {
  classifyImageVersion,
  type ImageVersion,
} from "../apps/web/lib/platform/image-version";

type Args = { portalUrl: string; featureSha: string | null; json: boolean };

function parseArgs(argv: string[]): Args {
  const out: Args = {
    portalUrl: "http://localhost:3000",
    featureSha: null,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--portal-url") out.portalUrl = argv[++i] ?? out.portalUrl;
    else if (a === "--feature-sha") out.featureSha = argv[++i] ?? null;
    else if (a === "--json") out.json = true;
  }
  return out;
}

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

/** True if `ancestor` is an ancestor-or-equal of `descendant`; null if uncomputable. */
function isAncestor(ancestor: string, descendant: string): boolean | null {
  // Both commits must exist locally, else ancestry is genuinely unknown.
  if (git(["cat-file", "-e", `${ancestor}^{commit}`]) === null) return null;
  if (git(["cat-file", "-e", `${descendant}^{commit}`]) === null) return null;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      stdio: "ignore",
    });
    return true; // exit 0 => is ancestor
  } catch (err) {
    // exit 1 => not an ancestor; any other code => uncomputable
    const code = (err as { status?: number }).status;
    return code === 1 ? false : null;
  }
}

async function fetchServedImage(
  portalUrl: string,
): Promise<{ reachable: boolean; image: ImageVersion | null }> {
  const endpoint = `${portalUrl.replace(/\/$/, "")}/api/platform/image-version`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(endpoint, { signal: ctrl.signal });
    if (!res.ok) return { reachable: true, image: null };
    const body = (await res.json()) as {
      present?: boolean;
      version?: string | null;
      source?: string | null;
    };
    if (!body.present || !body.version) return { reachable: true, image: null };
    // Trust the endpoint's classification, but re-derive defensively so the CLI
    // and the endpoint can never disagree on shape.
    return {
      reachable: true,
      image: { raw: body.version, source: classifyImageVersion(body.version) },
    };
  } catch {
    return { reachable: false, image: null };
  } finally {
    clearTimeout(timer);
  }
}

const EXIT_CODE: Record<PreflightResult["verdict"], number> = {
  "CAN-TEST": 0,
  "MUST-ADVANCE": 10,
  BLOCKED: 20,
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const featureSha = args.featureSha ?? git(["rev-parse", "HEAD"]);
  if (!featureSha) {
    process.stderr.write(
      "[preflight] Could not resolve a feature commit (no --feature-sha and git rev-parse HEAD failed).\n",
    );
    process.exit(20);
  }

  const { reachable, image } = await fetchServedImage(args.portalUrl);
  const featureContainedInServed =
    image && image.source === "git-sha"
      ? isAncestor(featureSha, image.raw)
      : null;

  const input: PreflightInput = {
    portalReachable: reachable,
    servedImage: image,
    featureSha,
    featureContainedInServed,
    // This CLI ships with and executes from the source checkout. The server
    // adapter is the only surface allowed to derive a consumer host profile.
    installHostKind: "source",
  };
  const result = computePreflightVerdict(input);

  report(result);
  process.exit(EXIT_CODE[result.verdict]);
}

function report(result: PreflightResult): void {
  // Keep the existing machine-readable verdict and human summary on every path.
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.stderr.write(
    `\n[preflight] ${result.verdict} â€” ${result.reason}\n` +
      `[preflight] next: ${result.nextAction.kind} â€” ${result.nextAction.detail}\n`,
  );
}

// Saved trust must be loaded at Node startup before fetch. Reuse the existing
// launcher rather than changing the trust store or disabling TLS validation.
const requested = parseArgs(process.argv.slice(2));
void runWithHostMcpTrust(main, {
  resolveImpl: (options: Record<string, unknown> = {}) => resolveHostMcpTrust({
    ...options,
    // This command verifies the requested portal, not an ambient MCP endpoint.
    mcpUrl: new URL("/api/mcp/v1", requested.portalUrl).href,
  }),
}).then((status: unknown) => {
  if (typeof status === "number") process.exitCode = status;
}).catch((error: unknown) => {
  const failure = error as { message?: string; hostTrustPrerequisite?: boolean };
  const result = computePreflightVerdict({
    portalReachable: false, servedImage: null,
    featureSha: requested.featureSha ?? git(["rev-parse", "HEAD"]) ?? "unknown",
    featureContainedInServed: null, installHostKind: "source",
  });
  result.reason = failure.hostTrustPrerequisite
    ? `Live verification transport prerequisite failed: ${failure.message ?? "unknown trust error"}`
    : "Live verification execution outcome is unavailable; no passing verdict was recorded.";
  result.nextAction.detail = failure.hostTrustPrerequisite
    ? "Restore the selected authorized trust or endpoint using the diagnostic above, then rerun preflight. Do not disable certificate verification."
    : "Preserve the execution diagnostic and investigate the launcher before retrying; do not infer runtime health.";
  report(result);
  process.exitCode = EXIT_CODE.BLOCKED;
});
