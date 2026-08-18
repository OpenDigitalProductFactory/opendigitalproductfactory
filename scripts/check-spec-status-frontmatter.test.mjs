// scripts/check-spec-status-frontmatter.test.mjs
// BI-79BCE3F2 — the spec/plan status & supersession convention linter.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  VALID_STATUSES,
  parsePathBaseline,
  parseStatusFrontmatter,
  validateSpecFrontmatter,
} from "./check-spec-status-frontmatter.mjs";

const exists = () => true;
const missing = () => false;

test("the convention is the closed four-value set", () => {
  assert.deepEqual(VALID_STATUSES, ["draft", "active", "binding", "superseded"]);
});

test("parseStatusFrontmatter reads status + supersededBy from a leading YAML block", () => {
  const fm = parseStatusFrontmatter("---\nstatus: superseded\nsupersededBy: docs/superpowers/specs/new.md\n---\n# Title\n");
  assert.deepEqual(fm, { present: true, status: "superseded", supersededBy: "docs/superpowers/specs/new.md" });
});

test("no frontmatter, unterminated frontmatter, and mid-file '---' are all absent", () => {
  assert.equal(parseStatusFrontmatter("# Title\nstatus: active\n").present, false);
  assert.equal(parseStatusFrontmatter("---\nstatus: active\n# never closed").present, false);
  assert.equal(parseStatusFrontmatter("# Title\n\n---\nstatus: active\n---\n").present, false);
});

test("quoted values are unwrapped; other frontmatter keys are ignored", () => {
  const fm = parseStatusFrontmatter('---\nrelatedCode:\n  - docker-compose.yml\nstatus: "binding"\n---\n');
  assert.equal(fm.status, "binding");
});

test("a validated file without frontmatter fails (grandfathered untouched files never reach validation)", () => {
  assert.match(
    validateSpecFrontmatter("docs/superpowers/specs/x.md", "# Old spec\n", { successorExists: exists }).join("\n"),
    /missing status frontmatter/,
  );
});

test("an invalid status value fails on a validated file", () => {
  assert.match(
    validateSpecFrontmatter("docs/superpowers/specs/x.md", "---\nstatus: Shipped\n---\n", { successorExists: exists }).join("\n"),
    /invalid status "Shipped"/,
  );
});

test("supersededBy requires status: superseded and an existing successor", () => {
  const wrongStatus = "---\nstatus: active\nsupersededBy: docs/superpowers/specs/new.md\n---\n";
  const failures = validateSpecFrontmatter("docs/superpowers/specs/x.md", wrongStatus, { successorExists: exists });
  assert.match(failures.join("\n"), /only legal with status: superseded/);

  const dangling = "---\nstatus: superseded\nsupersededBy: docs/superpowers/specs/gone.md\n---\n";
  assert.match(
    validateSpecFrontmatter("docs/superpowers/specs/x.md", dangling, { successorExists: missing }).join("\n"),
    /names a missing file/,
  );

  const ok = "---\nstatus: superseded\nsupersededBy: docs/superpowers/specs/new.md\n---\n";
  assert.deepEqual(
    validateSpecFrontmatter("docs/superpowers/specs/x.md", ok, { successorExists: exists }),
    [],
  );
});

test("superseded without a successor is legal (retired with no replacement)", () => {
  assert.deepEqual(
    validateSpecFrontmatter("docs/superpowers/specs/x.md", "---\nstatus: superseded\n---\n", { successorExists: missing }),
    [],
  );
});

test("every valid status value passes on a must-carry file", () => {
  for (const status of VALID_STATUSES) {
    assert.deepEqual(
      validateSpecFrontmatter("docs/superpowers/plans/x.md", `---\nstatus: ${status}\n---\n`, { successorExists: exists }),
      [],
      status,
    );
  }
});

test("parsePathBaseline skips the budget header and blank lines", () => {
  const baseline = parsePathBaseline("# owner: platform-architecture\n# expiry: 2026-11-16\n\ndocs/superpowers/specs/a.md\ndocs/superpowers/plans/b.md\n");
  assert.equal(baseline.size, 2);
  assert.ok(baseline.has("docs/superpowers/specs/a.md"));
});
