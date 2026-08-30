#!/usr/bin/env tsx
// dpf-verify-preflight — the executable step-zero of "functionally verify a
// feature on the live install."
//
// Spec: docs/superpowers/specs/2026-06-06-procedural-functional-verification-design.md
// Run:  pnpm verify:preflight -- [--portal-url <url>] [--feature-sha <sha>] [--json]
//
// This is the thin IO shim over the pure verdict core
// (apps/web/lib/verify/preflight.ts): it fetches the live install's served
// identity, resolves the feature commit, computes ancestry via git, then prints
// ONE verdict and ONE next action. It changes nothing — advancing the install
// or filing a blocker BI is the skill's job (dpf-verify-on-live-install), not
// this script's. tsx erases the core's `import type` at runtime, so the verdict
// logic stays single-sourced with the app + the unit tests.

import { execFileSync } from "node:child_process";
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

  // JSON to stdout (machine-readable for the skill); summary to stderr (human).
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.stderr.write(
    `\n[preflight] ${result.verdict} — ${result.reason}\n` +
      `[preflight] next: ${result.nextAction.kind} — ${result.nextAction.detail}\n`,
  );
  process.exit(EXIT_CODE[result.verdict]);
}

void main();
