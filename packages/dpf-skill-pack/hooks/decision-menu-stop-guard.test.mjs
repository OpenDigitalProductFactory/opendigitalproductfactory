// BI-E4DE3825: Gate A's prose channel. Fixtures are shaped on the 2026-10-01
// session where an agent closed three turns with operator menus over a gate
// decision without consulting the kernel, and on the replies it gave that are
// NOT menus (status reports, click-through steps, a menu after consulting).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { claimTurnBlock, decideStop, readTurn } from "./decision-menu-stop-guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

const MENU = `I've taken this as far as the rules let me. The branch is still not pushed.

**Options.** You choose:
1. **Clear the stale fail evidence for commit a041a2e0ae1c**, then I rerun pregate and push.
2. **Authorize pushing with --no-verify**, skipping the local gate this once.
3. **Prioritize BI-C1121FFB** and push once it's fixed.`;

const EITHER_OR = `Not yet.

**What I need from you**
- **The push:** either authorize the recorded "gate infrastructure unavailable" override for this one push, or have the stale gate record cleared so I can rerun the gate.`;

const STATUS = `Yes. Everything this thread set out to do is delivered.

1. Design and plan are done.
2. PR #5868 merged.

Do you want me to turn on the app's Auto-fix for this PR?`;

const STEPS = `I've opened it in the browser pane.

1. In that pane, find the card titled "Authorize this coworker change?".
2. Click **Authorize** if that matches what you want.`;

const NAMING = `Which name do you prefer for the coworker? Your choice:
1. Atlas
2. Nova`;

const turn = (finalText, consulted = false) => ({ finalText, consulted, turnId: "t" });

test("blocks a numbered platform-decision menu with no kernel consultation", () => {
  assert.equal(decideStop(turn(MENU)).block, true);
});

test("blocks an either/or delivery decision written as a sentence", () => {
  assert.equal(decideStop(turn(EITHER_OR)).block, true);
});

test("allows the same menu when the turn consulted principle_decide", () => {
  assert.equal(decideStop(turn(MENU, true)).block, false);
});

test("allows a menu that cites the ledger (a legitimate low-confidence escalation)", () => {
  assert.equal(decideStop(turn(`${MENU}\n\nprinciple_decide DI-9D40DD9CEB58: margin 0.05, low confidence.`)).block, false);
});

test("allows status reports, yes/no offers, click-through steps and operator-owned naming", () => {
  for (const text of [STATUS, STEPS, NAMING]) assert.equal(decideStop(turn(text)).block, false, text.slice(0, 40));
});

test("honors the [operator-owned] tag and DPF_ALLOW_DIRECT_ASK", () => {
  assert.equal(decideStop(turn(`${MENU}\n[operator-owned]`)).block, false);
  assert.equal(decideStop(turn(MENU), { DPF_ALLOW_DIRECT_ASK: "1" }).block, false);
});

function line(obj) {
  return JSON.stringify(obj);
}

function transcript({ consult = false, finalText = MENU } = {}) {
  return [
    line({ type: "user", uuid: "u-1", message: { role: "user", content: "earlier turn" } }),
    line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "old reply. You choose:\n1. a migration\n2. a schema" }] } }),
    line({ type: "user", uuid: "u-2", message: { role: "user", content: "do what's needed to continue" } }),
    line({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Checking the gate." },
          consult
            ? { type: "tool_use", id: "c1", name: "mcp__plugin_dpf-platform_dpf__principle_decide", input: {} }
            : { type: "tool_use", id: "c1", name: "Bash", input: { command: "pnpm run pregate:status" } },
        ],
      },
    }),
    line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "ok" }] } }),
    line({ type: "user", isMeta: true, message: { role: "user", content: "<system-reminder>injected</system-reminder>" } }),
    line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: finalText }] } }),
  ].join("\n");
}

test("readTurn scopes to the current turn, its final reply and any kernel consultation", () => {
  const plain = readTurn(transcript());
  assert.equal(plain.turnId, "u-2");
  assert.equal(plain.consulted, false);
  assert.equal(plain.finalText, MENU);
  assert.equal(readTurn(transcript({ consult: true })).consulted, true);
  assert.equal(readTurn(`${transcript()}\n{"partial":`).finalText, MENU, "a partial trailing line is ignored");
});

test("claimTurnBlock allows exactly one block per session turn (both hook planes fire)", () => {
  const dir = mkdtempSync(join(tmpdir(), "menu-guard-"));
  assert.equal(claimTurnBlock("s1", "u-2", dir), true);
  assert.equal(claimTurnBlock("s1", "u-2", dir), false);
  assert.equal(claimTurnBlock("s1", "u-3", dir), true);
  assert.equal(claimTurnBlock("s2", "u-2", dir), true);
});

function runHook(payload, env = {}) {
  return spawnSync(process.execPath, [join(here, "decision-menu-stop-guard.mjs")], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, DPF_ALLOW_DIRECT_ASK: "", TMPDIR: mkdtempSync(join(tmpdir(), "menu-guard-tmp-")), ...env },
  });
}

test("end to end: blocks once in a DPF checkout, then lets the turn end", () => {
  const dir = mkdtempSync(join(tmpdir(), "menu-guard-tx-"));
  const transcriptPath = join(dir, "t.jsonl");
  writeFileSync(transcriptPath, transcript());
  const env = { TMPDIR: mkdtempSync(join(tmpdir(), "menu-guard-tmp-")) };
  const payload = { hook_event_name: "Stop", session_id: "s-e2e", transcript_path: transcriptPath, cwd: repoRoot };
  const first = runHook(payload, env);
  assert.equal(first.status, 0);
  assert.equal(JSON.parse(first.stdout).decision, "block");
  const second = runHook(payload, env);
  assert.equal(second.stdout, "", "the second Stop in the same turn is not blocked");
  assert.equal(runHook({ ...payload, stop_hook_active: true }).stdout, "");
});

test("end to end: inert outside a DPF host and on unreadable input", () => {
  const dir = mkdtempSync(join(tmpdir(), "menu-guard-out-"));
  const transcriptPath = join(dir, "t.jsonl");
  writeFileSync(transcriptPath, transcript());
  assert.equal(runHook({ session_id: "s", transcript_path: transcriptPath, cwd: dir }).stdout, "");
  assert.equal(runHook({ session_id: "s", transcript_path: join(dir, "missing.jsonl"), cwd: repoRoot }).stdout, "");
});
