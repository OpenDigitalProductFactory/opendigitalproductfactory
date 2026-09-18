// A scoped seed-fit answer must name the mechanism that enforces it (BI-B507DBD1).
//
// The Seed Contribution Fit gate already asks the right question with the right
// vocabulary. What it never asked was HOW an `archetype-scoped` answer would be
// enforced, and nothing downstream read the answer. So a change could truthfully
// answer "archetype-scoped" and ship globally, and nothing noticed.
//
// That is not hypothetical. In BI-C44EAEE6 the BIAN Service Landscape was scoped
// at SEED time (#4870 gated its element hierarchy on the install's archetype) and
// never scoped on READ, so a pet rescue's Enterprise Architecture page advertised
// a banking standard as ACTIVE with zero criteria. One half shipped, the other
// did not, and no gate looked at the pair.
//
// Two legitimate mechanisms exist in this codebase and both are in live use:
//
//   seed-gate   Do not put the content on the install at all. The seeder consults
//               an applicability rule before writing.
//               Live example: referenceModelAppliesToInstall.
//   read-scope  Ship it everywhere on purpose and filter at consumption. Each row
//               declares applicability and the read path evaluates it.
//               Live example: regulationApplies.
//
// Both are correct. Choosing between them is the author's call. NAMING the choice
// and pointing at the symbol that implements it is what makes the claim checkable
// by something other than a reviewer's memory.
//
// Why this shape and not an intake question: kernel decision DI-D17CAA32468F
// scored "derive, and say so when undecidable" at 10.83 against 3.56 for
// demanding an annotation up front. `principles/gate-coverage-matches-blast-radius`
// puts it plainly — "prefer a rule the gate can decide without anyone remembering
// to annotate", because "opt-in coverage reproduces the very 'somebody must
// remember' failure the gate exists to remove". This asks for one thing only, at
// the moment the author already has the answer in hand, and then VERIFIES it
// rather than trusting it.

/** How a scoped contribution is kept off the installs it does not serve. */
export const SCOPE_ENFORCEMENT_MECHANISMS = Object.freeze(["seed-gate", "read-scope"]);

const MECHANISM_SET = new Set(SCOPE_ENFORCEMENT_MECHANISMS);

/**
 * Decisions that CLAIM the content is limited to some archetypes or verticals.
 *
 * `global-default` claims the opposite and owes no mechanism. `parameterize-first`,
 * `install-local-only` and `reject-as-seed` are not merge-eligible, so the gate
 * stops on them before reaching this rule.
 */
export const SCOPED_SEED_FIT_DECISIONS = Object.freeze(["archetype-scoped", "vertical-scoped"]);

const SCOPED_SET = new Set(SCOPED_SEED_FIT_DECISIONS);

export function isScopedSeedFitDecision(decision) {
  return SCOPED_SET.has(String(decision ?? "").toLowerCase());
}

// Fenced blocks in a PR body are documentation, not attestation. The convergence
// gate learned this the hard way when its own PR failed on a quoted `<mode>`.
const FENCED_BLOCK_RE = /^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm;

/**
 * Read `mechanism=<m>` and `symbol=<s>` from the Seed-Fit-Decision line.
 *
 * Accepted on the same line as the decision, in either order:
 *   Seed-Fit-Decision: archetype-scoped mechanism=read-scope symbol=regulationApplies
 *
 * Returns nulls when absent, so the caller distinguishes "not stated" from
 * "stated wrongly" and can say which.
 */
export function parseSeedFitMechanism(prBody) {
  const unfenced = String(prBody ?? "").replace(FENCED_BLOCK_RE, "");
  const line = /Seed-Fit-Decision:[ \t]*([^\n]*)/i.exec(unfenced);
  if (!line) return { mechanism: null, symbol: null };
  const rest = line[1];
  const mechanism = /\bmechanism\s*=\s*([A-Za-z][\w-]*)/i.exec(rest);
  const symbol = /\bsymbol\s*=\s*([A-Za-z_$][\w$.]*)/i.exec(rest);
  return {
    mechanism: mechanism ? mechanism[1].toLowerCase() : null,
    symbol: symbol ? symbol[1] : null,
  };
}

/**
 * Which changed files actually reference the named symbol.
 *
 * This is the half that makes the claim evidence rather than assertion: an author
 * naming a symbol they did not wire is the exact BI-C44EAEE6 shape, where the
 * intent was documented in a comment and the read path never implemented it.
 *
 * `readFile` is injected and may throw for a deleted or binary path; that is
 * treated as "does not reference", never as a crash.
 */
export function findMechanismEvidence({ symbol, changedFiles, readFile }) {
  if (!symbol) return [];
  const needle = String(symbol);
  return (changedFiles ?? []).filter((file) => {
    try {
      return String(readFile(file)).includes(needle);
    } catch {
      return false;
    }
  });
}

/**
 * Does a scoped seed-fit answer carry an enforceable mechanism?
 *
 * Returns `{ ok, reason, mechanism, symbol, evidenceFiles }`. `reason` is a
 * machine-readable code; the caller renders the sentence, so this stays pure and
 * testable and the gate output stays in one place.
 */
/**
 * BI-4F1E9249: a scoped decision states its enforcement mechanism wherever the
 * decision itself is stated, so this reads the commit range and the PR body
 * together, exactly as evaluateSeedFitGate does.
 */
export function evaluateScopeMechanism({
  decision,
  commitMessages = "",
  prBody = "",
  changedFiles = [],
  readFile,
}) {
  if (!isScopedSeedFitDecision(decision)) {
    return { ok: true, reason: "not-a-scoped-decision", mechanism: null, symbol: null, evidenceFiles: [] };
  }

  const { mechanism, symbol } = parseSeedFitMechanism(
    [commitMessages, prBody].filter(Boolean).join("\n"),
  );

  if (!mechanism) {
    return { ok: false, reason: "missing-mechanism", mechanism: null, symbol, evidenceFiles: [] };
  }
  if (!MECHANISM_SET.has(mechanism)) {
    return { ok: false, reason: "unknown-mechanism", mechanism, symbol, evidenceFiles: [] };
  }
  if (!symbol) {
    return { ok: false, reason: "missing-symbol", mechanism, symbol: null, evidenceFiles: [] };
  }

  const evidenceFiles = findMechanismEvidence({ symbol, changedFiles, readFile });
  if (evidenceFiles.length === 0) {
    return { ok: false, reason: "symbol-not-in-diff", mechanism, symbol, evidenceFiles };
  }

  return { ok: true, reason: "mechanism-wired", mechanism, symbol, evidenceFiles };
}

/** The operator-facing sentence for a mechanism verdict. */
export function describeScopeMechanism(result) {
  switch (result.reason) {
    case "not-a-scoped-decision":
      return "Decision does not claim archetype or vertical scope; no enforcement mechanism is owed.";
    case "missing-mechanism":
      return (
        "A scoped decision must say how it is enforced. Add `mechanism=seed-gate` (do not put the content " +
        "on installs it does not serve) or `mechanism=read-scope` (ship it everywhere and filter at " +
        "consumption) to the Seed-Fit-Decision line, with `symbol=<the function that enforces it>`."
      );
    case "unknown-mechanism":
      return `mechanism=${result.mechanism} is not one of ${SCOPE_ENFORCEMENT_MECHANISMS.join(" | ")}.`;
    case "missing-symbol":
      return `mechanism=${result.mechanism} names no symbol. Add \`symbol=<the function that enforces it>\` so the claim can be checked.`;
    case "symbol-not-in-diff":
      return (
        `No changed file references \`${result.symbol}\`, so this change claims a scope it does not implement. ` +
        `That is the BI-C44EAEE6 shape: the seed half shipped and the read half did not.`
      );
    default:
      return `Enforced by ${result.mechanism} via ${result.symbol} (${result.evidenceFiles.length} file(s)).`;
  }
}
