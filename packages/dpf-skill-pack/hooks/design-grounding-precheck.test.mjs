import assert from "node:assert/strict";
import { test } from "node:test";

import { decide } from "./design-grounding-precheck.mjs";

test("reminds on UX route page edits", () => {
  const v = decide("Edit", {
    file_path: "apps/web/app/(shell)/platform/ai/founder-review/page.tsx",
    new_string: "<section>Where work lives</section>",
  });
  assert.equal(v.remind, true);
});

test("reminds on attention and work-management substrate edits", () => {
  assert.equal(
    decide("Edit", {
      file_path: "apps/web/lib/attention/aggregate.ts",
      new_string: "export const x = 1;",
    }).remind,
    true,
  );
  assert.equal(
    decide("Write", {
      file_path: "apps/web/lib/work-management/new-projector.ts",
      content: "export const x = 1;",
    }).remind,
    true,
  );
});

test("reminds on process-spine hook edits", () => {
  const v = decide("MultiEdit", {
    file_path: "packages/dpf-skill-pack/hooks/hooks.json",
    edits: [{ old_string: "x", new_string: "design-grounding-precheck.mjs" }],
  });
  assert.equal(v.remind, true);
});

test("normalizes absolute paths", () => {
  const v = decide("Edit", {
    file_path: "/Users/markbodman/dpf-worktrees/x/apps/web/components/attention/AttentionInbox.tsx",
    new_string: "<div />",
  });
  assert.equal(v.remind, true);
});

test("stays quiet for tests, generated files, unrelated source, and non-write tools", () => {
  assert.equal(
    decide("Edit", {
      file_path: "apps/web/lib/attention/aggregate.test.ts",
      new_string: "expect(x).toBe(y)",
    }).remind,
    false,
  );
  assert.equal(
    decide("Edit", {
      file_path: "apps/web/lib/math.ts",
      new_string: "export const add = 1;",
    }).remind,
    false,
  );
  assert.equal(
    decide("Read", {
      file_path: "apps/web/components/Foo.tsx",
    }).remind,
    false,
  );
});
