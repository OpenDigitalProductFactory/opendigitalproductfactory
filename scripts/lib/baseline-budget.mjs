// scripts/lib/baseline-budget.mjs
//
// BI-3F17B16B (Simplify & Strengthen W1, pass §2/§5 Tier-0 #1) — the shared
// owned-expiring-budget contract for ratchet baselines.
//
// THE PROBLEM: a frozen baseline legitimizes debt. The 2026-08-01 hardening
// plan's own top risk materialized on schedule — the application-boundary
// exception count sat at 65 unchanged for two weeks while cross-context
// imports grew. A baseline is only a *budget* when it has an owner who is
// accountable for shrinking it and an expiry date at which freeze becomes a
// failure instead of a habit.
//
// THE HOUSE SHAPE (established by the Batch-1/2/3 ratchets — see
// scripts/fk-index-coverage-baseline.json): every baseline carries
//   owner:  the accountable owning team (non-empty string)
//   expiry: YYYY-MM-DD — the date the budget must be re-reviewed and
//           re-committed by its owner; an expired budget FAILS CI.
//
// Two encodings, one contract:
//   JSON baselines — top-level "owner" and "expiry" string fields.
//   TXT baselines  — leading comment lines `# owner: <team>` and
//                    `# expiry: YYYY-MM-DD` (comment lines are already
//                    skipped by every line-oriented baseline parser, and
//                    first-occurrence-wins keeps union merges safe).
//
// Enforcement home: scripts/check-no-expired-baseline-budgets.mjs (the guard
// loop discovers it). Individual guards only need to PRESERVE the header on
// their --update path; they do not each re-implement expiry logic.

export const BUDGET_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function todayISO(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Validate an {owner, expiry} budget. Returns an array of failure strings
 * (empty = valid). `label` names the file in messages.
 */
export function validateBudget({ owner, expiry } = {}, { label = "baseline", today = todayISO() } = {}) {
  const failures = [];
  if (typeof owner !== "string" || !owner.trim()) {
    failures.push(`${label}: missing budget owner (add "owner": "<team>" / "# owner: <team>").`);
  }
  if (typeof expiry !== "string" || !BUDGET_DATE_RE.test(expiry)) {
    failures.push(`${label}: missing or malformed budget expiry (need YYYY-MM-DD).`);
  } else if (expiry < today) {
    failures.push(
      `${label}: budget EXPIRED on ${expiry} — the owner (${owner ?? "<unset>"}) must re-review the debt ` +
        `and recommit with a new expiry (shrink the baseline where possible; extending the date without ` +
        `review is the freeze this gate exists to stop).`,
    );
  }
  return failures;
}

/**
 * Parse `# owner: …` / `# expiry: …` from a line-oriented baseline's leading
 * comments. First occurrence wins (union merges can duplicate header lines).
 */
export function parseTxtBudgetHeader(text) {
  const meta = { owner: null, expiry: null };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("#")) {
      if (line) break; // header ends at the first non-comment content line
      continue;
    }
    const m = line.match(/^#\s*(owner|expiry)\s*:\s*(.+?)\s*$/i);
    if (m && meta[m[1].toLowerCase()] === null) meta[m[1].toLowerCase()] = m[2];
  }
  return meta;
}

/**
 * Serialize the budget header for a TXT baseline. `noteLines` are extra
 * comment lines (already without the leading `#`).
 */
export function formatTxtBudgetHeader({ owner, expiry, noteLines = [] }) {
  const lines = [`# owner: ${owner}`, `# expiry: ${expiry}`];
  for (const note of noteLines) lines.push(`# ${note}`);
  return `${lines.join("\n")}\n`;
}

/** Extract {owner, expiry} from a parsed JSON baseline object. */
export function readJsonBudget(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { owner: null, expiry: null };
  return { owner: parsed.owner ?? null, expiry: parsed.expiry ?? null };
}

/**
 * Read a JSON map baseline that may be either the legacy bare-map shape
 * (`{ "<path>": value }`) or the budget envelope
 * (`{ version, owner, expiry, note, files: { … } }`). Returns
 * `{ budget, files }`; legacy shape yields a null-field budget so callers can
 * keep working during conversion while the central guard flags the gap.
 */
export function readBudgetedFileMap(parsed) {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.files && typeof parsed.files === "object") {
    return { budget: readJsonBudget(parsed), files: parsed.files };
  }
  return { budget: { owner: null, expiry: null }, files: parsed ?? {} };
}

/** Serialize a file map into the budget envelope, preserving/defaulting meta. */
export function formatBudgetedFileMap(files, { owner, expiry, note } = {}) {
  const sorted = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
  const envelope = { version: 1, owner, expiry };
  if (note) envelope.note = note;
  envelope.files = sorted;
  return `${JSON.stringify(envelope, null, 2)}\n`;
}
