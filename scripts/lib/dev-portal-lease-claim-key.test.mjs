// scripts/lib/dev-portal-lease-claim-key.test.mjs
// Node built-in test runner: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const script = readFileSync(
  fileURLToPath(new URL("../dev-portal-lease.sh", import.meta.url)),
  "utf8",
);

const baseClaimKeyLine = script
  .split("\n")
  .find((l) => l.trim().startsWith("base_claim_key="));

// BI-D45898C0. The claim key is the server's idempotency key: environment-lease.ts
// does findUnique({ where: { claimKey } }). Keying it on the PID meant every
// invocation minted a new claim for the same preview, so a restart loop enqueued
// an unbounded set — ~35 waiting, one every ~31s, starving three unrelated
// pre-PR gates behind them.

test("the contributor-preview claim key identifies the resource, not the process", () => {
  assert.ok(baseClaimKeyLine, "base_claim_key assignment must exist");
  assert.match(baseClaimKeyLine, /\$\{WORKTREE_PATH\}/);
  assert.match(baseClaimKeyLine, /\$\{BRANCH\}/);
});

test("the claim key never carries the owner session id — that is what made re-claims unrecognisable", () => {
  assert.doesNotMatch(baseClaimKeyLine, /OWNER_SESSION_ID/);
});

test("the owner session id still travels as ownership, just not as identity of the claim", () => {
  // Attribution is still recorded; it simply must not key the claim.
  assert.match(script, /ownerSessionId/);
  assert.match(script, /OWNER_SESSION_ID="dev-portal-\$\$"/);
});

test("the terminal-retry suffix stays bounded, so the one remaining key-minting path cannot run away", () => {
  assert.match(script, /MAX_TERMINAL_CLAIM_ATTEMPTS/);
  assert.match(script, /terminal claim retry budget exhausted/);
});
