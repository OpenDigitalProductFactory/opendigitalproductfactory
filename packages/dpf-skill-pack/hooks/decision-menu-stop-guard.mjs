#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/decision-menu-stop-guard.mjs
//
// Stop guard (BI-E4DE3825) — the prose channel of Gate A.
//
// `consult-scopes-before-asking` is a commandment: before asking the operator to
// choose on a platform/build decision, consult the governed scope
// (principle_decide), act on a high-confidence answer, and escalate only on low
// confidence, a commandment conflict, or a damaging action. Gate A
// (decision-routing-guard.mjs) enforces this on the AskUserQuestion TOOL. An
// agent that types its menu as the closing prose of a turn never calls that
// tool, so nothing saw it: observed 2026-08-21 and again 2026-10-01, when an
// agent ended three turns with "you choose: 1… 2… 3…" over a gate decision that
// principle_decide then answered with high confidence.
//
// This guard reads the turn from the transcript at Stop. If the final reply
// puts two or more platform/build options to the operator, and nothing in the
// turn consulted the kernel, it blocks the stop once with the routing
// instruction, so the agent consults before handing back.
//
// Loop safety (BI-FC32F9A6 learned this the hard way): a blocking Stop hook
// re-prompts the model, whose next reply runs the hook again. `stop_hook_active`
// is honoured, but some hosts never set it, so the guard ALSO blocks at most
// once per user turn, recorded with an exclusive-create marker. That marker
// also makes the plugin and settings planes, which both fire, block only once.
//
// Fails OPEN on any error, outside a DPF host, and with DPF_ALLOW_DIRECT_ASK=1
// or an `[operator-owned]` / `[direct-ask]` tag in the reply.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inDpfAgentHost } from "./lib/hook-io.mjs";
import { BYPASS_TOKEN, hasDecisionSignal, hasLedgerMarker } from "./lib/decision-signals.mjs";

// A line that hands the choice to the operator.
const CHOICE_CUE =
  /\b(?:which (?:would you|do you|should (?:i|we))|your (?:call|choice|decision)|you (?:choose|pick|decide)|(?:choose|pick|decide) (?:one|between|which)|would you (?:like|prefer|rather)|do you want me to|let me know (?:which|whether|if)|(?:i|we) need (?:a|your) (?:decision|choice)|what (?:i|we) need from you|need you to (?:choose|decide|pick)|options?\s*(?:\([^)]*\))?\s*[:—–-]\s*$|how (?:would|do) you want)/i;

// An enumerated option line: "1. …", "2) …", "A. …", "- **Option B** …", "**Option 2:** …".
const OPTION_LINE = /^\s*(?:(?:\d{1,2}|[A-Da-d])[.)]\s+\S|[-*]\s+\*\*option\b|\*\*option\s+\w+)/i;

// A choice written as a sentence rather than a list: "either authorize X, or clear Y".
const EITHER_OR = /\beither\b[^.?!\n]{3,}?,?\s+or\b/i;

const GUIDANCE =
  "Decision-routing gate, prose channel (BI-E4DE3825): this reply puts a platform/build decision to the operator as a list of options, and nothing in this turn consulted the kernel. " +
  "`consult-scopes-before-asking` is a commandment. Run principle_decide (dpf-decision-via-kernel) on these options now and act on a high-confidence recommendation instead of asking. " +
  "Hand the choice back only if the kernel returns low confidence or a commandment conflict, or the action is damaging (outward, irreversible, authority), and then cite the ledger (interactionId, composite, margin). " +
  "If this is genuinely operator-owned (naming, branding, business strategy), add `[operator-owned]` to the reply. This gate blocks once per turn.";

/** Text of a message content field (string or block array). */
function blockText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

function isToolResultEntry(entry) {
  const content = entry?.message?.content;
  return Array.isArray(content) && content.some((b) => b?.type === "tool_result");
}

/** A user entry that opens a new turn: real input, not a tool result or injected meta. */
function isTurnBoundary(entry) {
  return entry?.type === "user" && !entry?.isMeta && !isToolResultEntry(entry);
}

function toolUses(entry) {
  const content = entry?.message?.content;
  return Array.isArray(content) ? content.filter((b) => b?.type === "tool_use") : [];
}

function consultsKernel(use) {
  const name = String(use?.name ?? "");
  if (/principle_decide$/i.test(name)) return true;
  if (name === "Skill") {
    const skill = String(use?.input?.skill ?? "");
    return /dpf-(?:decision-via-kernel|compare-options)$/.test(skill);
  }
  return false;
}

/**
 * Parse transcript JSONL into the current turn: the user entry that opened it,
 * whether any tool call consulted the kernel, and the final reply text (the
 * assistant text after the turn's last tool result).
 * @param {string} jsonl
 */
export function readTurn(jsonl) {
  const entries = [];
  for (const line of String(jsonl).split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // a partial trailing line is normal while the transcript is written
    }
  }
  let start = -1;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (isTurnBoundary(entries[i])) {
      start = i;
      break;
    }
  }
  const turn = entries.slice(start + 1);
  const consulted = turn.some((e) => e?.type === "assistant" && toolUses(e).some(consultsKernel));
  let finalParts = [];
  for (const entry of turn) {
    if (isToolResultEntry(entry)) {
      finalParts = [];
      continue;
    }
    if (entry?.type === "assistant") {
      const text = blockText(entry?.message?.content);
      if (text) finalParts.push(text);
    }
  }
  const opener = start >= 0 ? entries[start] : null;
  return {
    turnId: String(opener?.uuid ?? opener?.promptId ?? `index-${start}`),
    consulted,
    finalText: finalParts.join("\n"),
  };
}

/**
 * Pure decision on a final reply. Exported for tests.
 * @param {{ finalText: string, consulted: boolean }} turn
 * @param {Record<string, string|undefined>} env
 * @returns {{ block: boolean, reason?: string }}
 */
export function decideStop(turn, env = {}) {
  if (env.DPF_ALLOW_DIRECT_ASK === "1") return { block: false };
  if (turn.consulted) return { block: false };
  const text = String(turn.finalText ?? "");
  if (!text.trim()) return { block: false };
  if (BYPASS_TOKEN.test(text)) return { block: false };
  if (hasLedgerMarker(text)) return { block: false }; // consulted, now surfacing the ledger

  const lines = text.split("\n");
  const cueIndex = lines.findIndex((l) => CHOICE_CUE.test(l));
  if (cueIndex < 0) return { block: false };
  // Options are presented with or just after the hand-off; a list earlier in
  // the reply (steps taken, a status table) is not a menu.
  const menu = lines.slice(cueIndex, cueIndex + 30);
  const options = menu.filter((l) => OPTION_LINE.test(l)).length
    + menu.filter((l) => EITHER_OR.test(l)).length * 2;
  if (options < 2) return { block: false };
  if (!hasDecisionSignal(menu.join("\n"))) return { block: false };
  return { block: true, reason: GUIDANCE };
}

/** Claim the one block this turn may get. False when it was already used (by either plane). */
export function claimTurnBlock(sessionId, turnId, dir = join(tmpdir(), "dpf-decision-menu-stop-guard")) {
  const key = createHash("sha256").update(`${sessionId}\u0000${turnId}`).digest("hex").slice(0, 32);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, key), new Date().toISOString(), { flag: "wx" });
    return true;
  } catch {
    return false; // EEXIST: already blocked this turn; any other error: fail open
  }
}

function main() {
  let payload;
  try {
    const raw = readFileSync(0, "utf8");
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    process.exit(0);
  }
  if (payload?.stop_hook_active === true || payload?.stopHookActive === true) process.exit(0);
  const cwd = payload?.cwd ?? payload?.workspaceRoot;
  if (!inDpfAgentHost(cwd)) process.exit(0);
  const transcriptPath = payload?.transcript_path ?? payload?.transcriptPath;
  if (typeof transcriptPath !== "string" || !transcriptPath) process.exit(0);

  let turn;
  try {
    turn = readTurn(readFileSync(transcriptPath, "utf8"));
  } catch {
    process.exit(0);
  }
  const verdict = decideStop(turn, process.env);
  if (!verdict.block) process.exit(0);
  const sessionId = String(payload?.session_id ?? payload?.sessionId ?? transcriptPath);
  if (!claimTurnBlock(sessionId, turn.turnId)) process.exit(0);

  process.stdout.write(JSON.stringify({ decision: "block", reason: verdict.reason }));
  process.exit(0);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("decision-menu-stop-guard.mjs")) {
  main();
}
