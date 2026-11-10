#!/usr/bin/env node
// Rendered-backlog-pointer guard — BI-5BF97BAA.
//
// THE FAILURE THIS PREVENTS
//
// A surface renders a backlog identifier as the reader's next step, and the
// identifier names nothing. Seventeen references across the integrations and
// finance surfaces did exactly that: `nextBacklogItemId` strings hardcoded in
// source outlived the backlog reset of 2026-08-22 and kept printing ids that no
// query could resolve. `/platform/tools/integrations`, that route's QuickBooks
// page and `/finance` all offered a "what happens next" pointer aimed at an item
// the database did not hold.
//
// The reset is not the anomaly. 178 of the 233 backlog ids in the last 600
// commit subjects are gone too. The backlog is a resettable substrate; source is
// not. A commit subject is a record of its time and may name a dead id. A
// pointer offering the reader a next step may not.
//
// WHY THIS GUARD IS STATIC
//
// The obvious check — "does this id resolve?" — needs a database, and no CI
// workflow declares a Postgres service. scripts/check-no-ambient-host-tests.mjs
// exists because of BI-BFDCE0A9, where a test that reached for an ambient
// Postgres was green in CI and red in the DB-less local gate; the sanctioned
// answer is to self-gate and skip, which would leave this check inert exactly
// where it is meant to bite. So the resolve check lives in a DB-gated test
// (apps/web/lib/backlog/next-step-pointer.pg.test.ts) that runs where a database
// exists, and CI enforces the structural invariant instead:
//
//   A declared backlog pointer reaches a reader only through the resolver.
//
// The resolver (apps/web/lib/backlog/next-step-pointer.ts) returns a `label`
// that is honest in every case — the id when the item is filed, "Not filed"
// when a declared id names nothing, the stated intent when nothing is filed
// yet. A surface that renders `label` cannot print a dead identifier. A surface
// that reaches past it can, so reaching past it is what this guard refuses.
//
// THE RULES
//
//   1. no-legacy-field   `nextBacklogItemId` must not appear under apps/web.
//                        That is the field this defect lived in; the resolver's
//                        `nextStep: NextStepPointer` replaced it.
//   2. no-hardcoded-declaration
//                        A backlog id frozen into a NEXT-STEP field anywhere
//                        under apps/web. A literal is the only form that can
//                        outlive the item it names. An id read from a query
//                        resolves by construction, and an id in a PROVENANCE
//                        field records what justified a decision and stays true
//                        after the item is archived — neither is touched.
//   3. no-raw-render     No file under apps/web/app or apps/web/components may
//                        reach past the resolver for a declared pointer's raw id
//                        (`{x.nextStep.itemId}`), or hardcode a backlog id into
//                        copy a reader sees. Rendering goes through `.label`.
//
// A genuinely intentional finding can be annotated on, or immediately above, the
// line with `rendered-backlog-pointer: allow <reason>` — the exemption is
// stated, not silent.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const WEB = join(REPO_ROOT, "apps", "web");

/** Directories whose files render to a person. */
const RENDER_DIRS = ["app", "components"];

const ALLOW_MARKER = "rendered-backlog-pointer: allow";

/** The retired field name, in any position. */
const LEGACY_FIELD_RE = /\bnextBacklogItemId\b/;

/**
 * Reaching past the resolver for a declared pointer's raw id.
 *
 * Deliberately NOT "any rendered *backlogItemId". A backlog id that came from a
 * query resolves by construction — an escalation's linked item, a finding's
 * item, a feature brief's intake — and those surfaces are correct as they are.
 * What rots is an id FROZEN INTO SOURCE, which rule 2 catches at the point of
 * declaration rather than at every place it might later be printed.
 */
const RAW_RENDER_RE = /\{[^{}]*\bnextStep\.itemId[^{}]*\}/;

/** A backlog id, in either format the estate has used. */
const BACKLOG_ID = String.raw`BI-(?:[0-9A-F]{8}\b|[A-Z]{2,6}-[0-9A-Z]{4,})`;

/**
 * A backlog id frozen into a NEXT-STEP field: `nextStep: "BI-…"`. This is the
 * root shape of the defect — a literal is the only form that can outlive the
 * item it names, and a next step is a forward-looking promise that has to still
 * hold when someone reads it.
 *
 * Scoped to next-step fields on purpose. A backlog id in a PROVENANCE field —
 * `reviewRef`, `ratifiedBy.ref`, an evidence `ref` — records which item
 * justified a decision. That is backward-looking and stays true forever, even
 * after the item is archived. Flagging those would be an over-reporting measure,
 * which is a defect of its own.
 */
const NEXT_STEP_FIELDS = ["nextStep", "nextBacklogItemId", "nextItemId", "nextWorkflowItemId"];
const HARDCODED_DECLARATION_RE = new RegExp(
  String.raw`\b(?:${NEXT_STEP_FIELDS.join("|")})\s*:\s*"${BACKLOG_ID}[^"]*"`,
);

/**
 * A backlog id sitting in rendered copy — as element text (`<span>BI-…</span>`)
 * or as a rendered attribute (`value="BI-…"`).
 *
 * Deliberately NOT "any backlog id in a rendering file". Provenance ids in
 * comments are everywhere and are correct: a comment records which item a change
 * came from, which stays true after the item is archived. Only copy a reader
 * sees makes a promise that has to still hold.
 */
const JSX_TEXT_ID_RE = new RegExp(String.raw`>[^<>{}]*\b${BACKLOG_ID}`);
const JSX_ATTR_ID_RE = new RegExp(
  String.raw`\b(?:value|label|title|children|placeholder)=\{?"[^"]*\b${BACKLOG_ID}`,
);

/**
 * Drop comment text before matching, so a rule about a field is not tripped by
 * prose describing that field. Returns one entry per input line to keep line
 * numbers intact.
 */
export function stripComments(lines) {
  let inBlock = false;
  return lines.map((line) => {
    let out = "";
    let index = 0;
    while (index < line.length) {
      if (inBlock) {
        const end = line.indexOf("*/", index);
        if (end === -1) return out;
        inBlock = false;
        index = end + 2;
        continue;
      }
      const lineComment = line.indexOf("//", index);
      const blockComment = line.indexOf("/*", index);
      if (blockComment !== -1 && (lineComment === -1 || blockComment < lineComment)) {
        out += line.slice(index, blockComment);
        inBlock = true;
        index = blockComment + 2;
        continue;
      }
      if (lineComment !== -1) return out + line.slice(index, lineComment);
      return out + line.slice(index);
    }
    return out;
  });
}

export function listSourceFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist" || entry === ".turbo") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** True when the finding is explicitly exempted on its own line or the one above. */
export function isAllowed(lines, index) {
  const own = lines[index] ?? "";
  const above = index > 0 ? lines[index - 1] : "";
  return own.includes(ALLOW_MARKER) || above.includes(ALLOW_MARKER);
}

/**
 * Findings for one file. `rendering` says whether the file reaches a reader,
 * which is what makes a hardcoded id a defect rather than a note.
 */
export function findViolations({ file, text, rendering }) {
  const findings = [];
  const lines = text.split("\n");
  const code = stripComments(lines);

  code.forEach((line, index) => {
    if (isAllowed(lines, index)) return;

    if (LEGACY_FIELD_RE.test(line)) {
      findings.push({
        file,
        line: index + 1,
        rule: "no-legacy-field",
        detail: "nextBacklogItemId is retired — declare a NextStepPointer as nextStep",
      });
    }

    if (HARDCODED_DECLARATION_RE.test(line)) {
      findings.push({
        file,
        line: index + 1,
        rule: "no-hardcoded-declaration",
        detail: "a backlog id frozen into source outlives the item — state intent with openIntent()",
      });
    }

    if (!rendering) return;

    if (RAW_RENDER_RE.test(line)) {
      findings.push({
        file,
        line: index + 1,
        rule: "no-raw-render",
        detail: "render the resolved next step's label, not a declared backlog id",
      });
    } else if (JSX_TEXT_ID_RE.test(line) || JSX_ATTR_ID_RE.test(line)) {
      findings.push({
        file,
        line: index + 1,
        rule: "no-raw-render",
        detail: "a backlog id hardcoded into copy cannot be checked against the backlog",
      });
    }
  });

  return findings;
}

export function scan(webRoot = WEB) {
  const findings = [];
  const roots = [
    ...RENDER_DIRS.map((dir) => ({ dir: join(webRoot, dir), rendering: true })),
    { dir: join(webRoot, "lib"), rendering: false },
  ];

  for (const { dir, rendering } of roots) {
    for (const full of listSourceFiles(dir)) {
      const file = relative(REPO_ROOT, full).replace(/\\/g, "/");
      findings.push(...findViolations({ file, text: readFileSync(full, "utf8"), rendering }));
    }
  }

  return findings;
}

function main() {
  const findings = scan();

  if (findings.length === 0) {
    console.log("Rendered backlog pointers: every next step goes through the resolver.");
    return;
  }

  console.error("Rendered backlog pointer guard failed.\n");
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  [${finding.rule}]  ${finding.detail}`);
  }
  console.error(
    [
      "",
      "A next step reaches a reader only through the resolver in",
      "apps/web/lib/backlog/next-step-pointer.ts, whose `label` is honest whether the",
      "item is filed, missing, or not filed yet. Declare the step as a NextStepPointer,",
      "resolve it in the server component, and render `.label`.",
      "",
      `Deliberate exception: annotate the line with "${ALLOW_MARKER} <reason>".`,
    ].join("\n"),
  );
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
