import assert from "node:assert/strict";
import { test } from "node:test";

import { decide } from "./ux-fit-precheck.mjs";

// ── reminds when a UI control is added to a user-facing surface ───────────────

test("reminds when a Write adds an <input> to an apps/web .tsx", () => {
  const v = decide("Write", {
    file_path: "apps/web/components/platform/Foo.tsx",
    content: '<input type="text" />',
  });
  assert.equal(v.remind, true);
});

test("reminds on a raw numeric input added via Edit (the #2004 mistake)", () => {
  const v = decide("Edit", {
    file_path: "apps/web/app/(shell)/x/page.tsx",
    new_string: '<input type="number" min={1024} />',
  });
  assert.equal(v.remind, true);
});

test("reminds on <select> added via MultiEdit", () => {
  const v = decide("MultiEdit", {
    file_path: "apps/web/components/Bar.tsx",
    edits: [{ new_string: "<select>" }],
  });
  assert.equal(v.remind, true);
});

test("reminds when a button, link, or disclosure trigger is added", () => {
  const probes = [
    "<button type=\"button\">Save</button>",
    "<a href=\"/customer\">Customer</a>",
    "<Link href=\"/workspace\">Workspace</Link>",
    "<details>",
    "<summary>Advanced</summary>",
    "<SubmitButton pending={pending} />",
    "<DropdownMenuTrigger asChild>",
    "<div role=\"button\" onClick={open}>Open</div>",
    "<PanelHeader aria-expanded={open}>",
    "<section data-dpf-disclosure>",
  ];

  for (const new_string of probes) {
    const v = decide("Edit", {
      file_path: "apps/web/app/(shell)/x/page.tsx",
      new_string,
    });
    assert.equal(v.remind, true, `expected UX fit reminder for ${new_string}`);
  }
});

test("handles Windows backslash paths", () => {
  const v = decide("Write", {
    file_path: "apps\\web\\components\\Foo.tsx",
    content: "<form>",
  });
  assert.equal(v.remind, true);
});

// ── stays quiet where it should ──────────────────────────────────────────────

test("does NOT remind for non-UI files", () => {
  assert.equal(decide("Write", { file_path: "apps/web/lib/util.ts", content: "<input />" }).remind, false);
  assert.equal(decide("Edit", { file_path: "scripts/foo.mjs", new_string: "<input />" }).remind, false);
});

test("does NOT remind for test / spec / stories files", () => {
  assert.equal(decide("Write", { file_path: "apps/web/components/Foo.test.tsx", content: "<input />" }).remind, false);
  assert.equal(decide("Write", { file_path: "apps/web/components/Foo.stories.tsx", content: "<input />" }).remind, false);
});

test("does NOT remind when the edit adds no user-facing control", () => {
  assert.equal(decide("Edit", { file_path: "apps/web/components/Foo.tsx", new_string: "const x = 1;" }).remind, false);
});

test("ignores non-edit tools", () => {
  assert.equal(decide("Bash", { command: "ls" }).remind, false);
  assert.equal(decide("Read", { file_path: "apps/web/components/Foo.tsx" }).remind, false);
});
