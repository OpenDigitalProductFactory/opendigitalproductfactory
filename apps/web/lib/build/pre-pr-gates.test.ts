import { describe, expect, it } from "vitest";

import { runPrePRGates } from "./pre-pr-gates";

describe("runPrePRGates — destructive-ops gate", () => {
  it("blocks on a destructive migration", () => {
    const destructiveDiff = `diff --git a/prisma/migrations/20260513_drop/migration.sql b/prisma/migrations/20260513_drop/migration.sql
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/prisma/migrations/20260513_drop/migration.sql
@@ -0,0 +1,1 @@
+DROP TABLE users;
`;
    const result = runPrePRGates(destructiveDiff);
    expect(result.canProceed).toBe(false);
    const destructiveGate = result.gates.find((g) => g.gate === "destructive-ops");
    expect(destructiveGate?.verdict).toBe("block");
    expect(destructiveGate?.findings.join("\n")).toMatch(/DROP TABLE/i);
  });

  it("blocks when the destructive migration is one of several files in the diff", () => {
    // Regression for the multi-file case: extractAddedLinesForFile previously
    // truncated to the first newline, so a migration that wasn't the first
    // block would still be missed.
    const diff = `diff --git a/apps/web/lib/foo.ts b/apps/web/lib/foo.ts
index aaa..bbb 100644
--- a/apps/web/lib/foo.ts
+++ b/apps/web/lib/foo.ts
@@ -1,2 +1,3 @@
 export const x = 1;
+export const y = 2;
 export const z = 3;
diff --git a/prisma/migrations/20260513_truncate/migration.sql b/prisma/migrations/20260513_truncate/migration.sql
new file mode 100644
index 0000000..2222222
--- /dev/null
+++ b/prisma/migrations/20260513_truncate/migration.sql
@@ -0,0 +1,2 @@
+TRUNCATE TABLE sessions;
+DROP COLUMN legacy_id;
`;
    const result = runPrePRGates(diff);
    expect(result.canProceed).toBe(false);
    const destructiveGate = result.gates.find((g) => g.gate === "destructive-ops");
    expect(destructiveGate?.verdict).toBe("block");
    expect(destructiveGate?.findings.some((f) => /TRUNCATE/i.test(f))).toBe(true);
    expect(destructiveGate?.findings.some((f) => /DROP\s+COLUMN/i.test(f))).toBe(true);
  });

  it("passes on a benign additive migration", () => {
    const diff = `diff --git a/prisma/migrations/20260513_add_col/migration.sql b/prisma/migrations/20260513_add_col/migration.sql
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/prisma/migrations/20260513_add_col/migration.sql
@@ -0,0 +1,1 @@
+ALTER TABLE users ADD COLUMN nickname TEXT;
`;
    const result = runPrePRGates(diff);
    const destructiveGate = result.gates.find((g) => g.gate === "destructive-ops");
    expect(destructiveGate?.verdict).toBe("pass");
    expect(destructiveGate?.findings).toHaveLength(0);
  });

  it("ignores destructive keywords that only appear in removed lines", () => {
    // Lines starting with "-" are removals — the gate should only scan added lines.
    const diff = `diff --git a/prisma/migrations/20260513_edit/migration.sql b/prisma/migrations/20260513_edit/migration.sql
index 4444444..5555555 100644
--- a/prisma/migrations/20260513_edit/migration.sql
+++ b/prisma/migrations/20260513_edit/migration.sql
@@ -1,2 +1,1 @@
-DROP TABLE old_thing;
 CREATE TABLE new_thing (id TEXT PRIMARY KEY);
`;
    const result = runPrePRGates(diff);
    const destructiveGate = result.gates.find((g) => g.gate === "destructive-ops");
    expect(destructiveGate?.verdict).toBe("pass");
  });
});

describe("runPrePRGates — dependency-audit gate", () => {
  it("flags a new dependency added mid-block (trailing comma)", () => {
    // Mid-block adds have a trailing comma. The previous regex anchored on `"$`,
    // so it missed every dep entry that wasn't the last in its block — i.e. most
    // adds in practice. This is the real case the gate needs to catch.
    const diff = `diff --git a/package.json b/package.json
index aaaaaaa..bbbbbbb 100644
--- a/package.json
+++ b/package.json
@@ -10,4 +10,5 @@
     "react": "^18.2.0",
+    "lodash": "^4.17.21",
     "next": "^14.0.0",
     "zod": "^3.22.0"
   },
`;
    const result = runPrePRGates(diff);
    const depGate = result.gates.find((g) => g.gate === "dependency-audit");
    expect(depGate?.verdict).toBe("warn");
    expect(depGate?.findings.some((f) => /lodash@\^4\.17\.21/.test(f))).toBe(true);
  });

  it("flags a new dependency added at the end of a block (no trailing comma)", () => {
    const diff = `diff --git a/package.json b/package.json
index aaaaaaa..bbbbbbb 100644
--- a/package.json
+++ b/package.json
@@ -10,5 +10,6 @@
     "react": "^18.2.0",
     "next": "^14.0.0",
-    "zod": "^3.22.0"
+    "zod": "^3.22.0",
+    "lodash": "^4.17.21"
   },
`;
    const result = runPrePRGates(diff);
    const depGate = result.gates.find((g) => g.gate === "dependency-audit");
    expect(depGate?.verdict).toBe("warn");
    expect(depGate?.findings.some((f) => /lodash@\^4\.17\.21/.test(f))).toBe(true);
    // zod's reformat (added a trailing comma) is not a new dep — must not warn.
    expect(depGate?.findings.some((f) => /zod/.test(f))).toBe(false);
  });

  it("does not warn on a version bump (paired - and + for the same key)", () => {
    // A bump line looks identical to a new add in isolation. The gate must
    // pair the `-` and `+` for the same key and treat that as a bump, not a
    // new dependency.
    const diff = `diff --git a/package.json b/package.json
index aaaaaaa..bbbbbbb 100644
--- a/package.json
+++ b/package.json
@@ -10,5 +10,5 @@
     "react": "^18.2.0",
-    "next": "^14.0.0",
+    "next": "^14.1.0",
     "zod": "^3.22.0"
   },
`;
    const result = runPrePRGates(diff);
    const depGate = result.gates.find((g) => g.gate === "dependency-audit");
    expect(depGate?.verdict).toBe("pass");
    expect(depGate?.findings).toHaveLength(0);
  });

  it("treats a name change as a new add (different key on the + side)", () => {
    // A renamed dep removes one key and adds a different key — the new key
    // has no matching `-` line, so it should be flagged as a new dependency.
    const diff = `diff --git a/package.json b/package.json
index aaaaaaa..bbbbbbb 100644
--- a/package.json
+++ b/package.json
@@ -10,5 +10,5 @@
     "react": "^18.2.0",
-    "moment": "^2.29.0",
+    "dayjs": "^1.11.0",
     "zod": "^3.22.0"
   },
`;
    const result = runPrePRGates(diff);
    const depGate = result.gates.find((g) => g.gate === "dependency-audit");
    expect(depGate?.verdict).toBe("warn");
    expect(depGate?.findings.some((f) => /dayjs@\^1\.11\.0/.test(f))).toBe(true);
    expect(depGate?.findings.some((f) => /moment/.test(f))).toBe(false);
  });

  it("passes when a dependency is only removed", () => {
    const diff = `diff --git a/package.json b/package.json
index aaaaaaa..bbbbbbb 100644
--- a/package.json
+++ b/package.json
@@ -10,5 +10,4 @@
     "react": "^18.2.0",
-    "lodash": "^4.17.21",
     "next": "^14.0.0",
     "zod": "^3.22.0"
   },
`;
    const result = runPrePRGates(diff);
    const depGate = result.gates.find((g) => g.gate === "dependency-audit");
    expect(depGate?.verdict).toBe("pass");
    expect(depGate?.findings).toHaveLength(0);
  });

  it("passes when no package.json files are in the diff", () => {
    const diff = `diff --git a/apps/web/lib/foo.ts b/apps/web/lib/foo.ts
index aaa..bbb 100644
--- a/apps/web/lib/foo.ts
+++ b/apps/web/lib/foo.ts
@@ -1,1 +1,2 @@
 export const x = 1;
+export const y = 2;
`;
    const result = runPrePRGates(diff);
    const depGate = result.gates.find((g) => g.gate === "dependency-audit");
    expect(depGate?.verdict).toBe("pass");
  });
});

describe("runPrePRGates — architecture gate", () => {
  it("warns on a deep relative import (4+ levels up)", () => {
    const diff = `diff --git a/apps/web/lib/foo.ts b/apps/web/lib/foo.ts
index aaa..bbb 100644
--- a/apps/web/lib/foo.ts
+++ b/apps/web/lib/foo.ts
@@ -1,1 +1,2 @@
 export const x = 1;
+import { bar } from "../../../../packages/db/bar";
`;
    const result = runPrePRGates(diff);
    const archGate = result.gates.find((g) => g.gate === "architecture");
    expect(archGate?.verdict).toBe("warn");
    expect(archGate?.findings.some((f) => /Deep relative import/.test(f))).toBe(true);
    expect(archGate?.findings.some((f) => /apps\/web\/lib\/foo\.ts/.test(f))).toBe(true);
  });

  it("passes on a shallow relative import (3 levels or fewer)", () => {
    const diff = `diff --git a/apps/web/lib/foo.ts b/apps/web/lib/foo.ts
index aaa..bbb 100644
--- a/apps/web/lib/foo.ts
+++ b/apps/web/lib/foo.ts
@@ -1,1 +1,2 @@
 export const x = 1;
+import { bar } from "../../../bar";
`;
    const result = runPrePRGates(diff);
    const archGate = result.gates.find((g) => g.gate === "architecture");
    expect(archGate?.verdict).toBe("pass");
    expect(archGate?.findings).toHaveLength(0);
  });

  it("ignores deep relative imports that only appear in removed lines", () => {
    // The deep-import scan should only see added lines. A removal of a deep
    // import is exactly the kind of cleanup the gate is supposed to encourage.
    const diff = `diff --git a/apps/web/lib/foo.ts b/apps/web/lib/foo.ts
index aaa..bbb 100644
--- a/apps/web/lib/foo.ts
+++ b/apps/web/lib/foo.ts
@@ -1,2 +1,2 @@
-import { bar } from "../../../../packages/db/bar";
+import { bar } from "@/lib/db/bar";
 export const x = 1;
`;
    const result = runPrePRGates(diff);
    const archGate = result.gates.find((g) => g.gate === "architecture");
    expect(archGate?.verdict).toBe("pass");
  });

  it("warns on a file in an unexpected top-level directory", () => {
    const diff = `diff --git a/random-dir/foo.ts b/random-dir/foo.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/random-dir/foo.ts
@@ -0,0 +1,1 @@
+export const x = 1;
`;
    const result = runPrePRGates(diff);
    const archGate = result.gates.find((g) => g.gate === "architecture");
    expect(archGate?.verdict).toBe("warn");
    expect(archGate?.findings.some((f) => /Unexpected directory: random-dir\/foo\.ts/.test(f))).toBe(true);
  });

  it("does not warn on a root-level file (no slash in path)", () => {
    // The `file.includes("/")` guard exempts top-level files like README.md
    // and tsconfig.json — they have no top-dir to check.
    const diff = `diff --git a/README.md b/README.md
index aaa..bbb 100644
--- a/README.md
+++ b/README.md
@@ -1,1 +1,2 @@
 # DPF
+New line.
`;
    const result = runPrePRGates(diff);
    const archGate = result.gates.find((g) => g.gate === "architecture");
    expect(archGate?.verdict).toBe("pass");
  });

  it("allows files in every recognized top-level directory", () => {
    // Smoke test: at least one file from each ALLOWED_TOP_DIRS entry should
    // not produce an "Unexpected directory" finding. If someone removes an
    // entry from ALLOWED_TOP_DIRS without realizing portals use it, this fails.
    const recognized = [
      "apps/web/lib/foo.ts",
      "packages/db/foo.ts",
      "prisma/schema.prisma",
      "scripts/foo.ts",
      "prompts/foo.prompt.md",
      "skills/foo.skill.md",
      "docs/foo.md",
      "e2e/foo.spec.ts",
      "services/foo.ts",
      "public/foo.svg",
    ];
    const diff = recognized
      .map(
        (path) => `diff --git a/${path} b/${path}
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/${path}
@@ -0,0 +1,1 @@
+x
`,
      )
      .join("");

    const result = runPrePRGates(diff);
    const archGate = result.gates.find((g) => g.gate === "architecture");
    expect(archGate?.findings.some((f) => /Unexpected directory/.test(f))).toBe(false);
  });
});

describe("runPrePRGates — security-scan gate", () => {
  it("blocks on a hardcoded API key", () => {
    // Critical findings in security-scan should flip the gate to "block" and
    // make canProceed false. The api_key pattern has no fileFilter so any
    // file with the right shape trips it.
    const diff = `diff --git a/apps/web/lib/config.ts b/apps/web/lib/config.ts
index aaa..bbb 100644
--- a/apps/web/lib/config.ts
+++ b/apps/web/lib/config.ts
@@ -1,1 +1,2 @@
 export const x = 1;
+const api_key = "AKIAIOSFODNN7EXAMPLEKEY";
`;
    const result = runPrePRGates(diff);
    expect(result.canProceed).toBe(false);
    const secGate = result.gates.find((g) => g.gate === "security-scan");
    expect(secGate?.verdict).toBe("block");
    expect(secGate?.findings.some((f) => /\[critical\].*secrets/.test(f))).toBe(true);
  });

  it("blocks on dangerouslySetInnerHTML in a .tsx file", () => {
    const diff = `diff --git a/apps/web/components/Foo.tsx b/apps/web/components/Foo.tsx
index aaa..bbb 100644
--- a/apps/web/components/Foo.tsx
+++ b/apps/web/components/Foo.tsx
@@ -1,1 +1,2 @@
 export const x = 1;
+return <div dangerouslySetInnerHTML={{ __html: userInput }} />;
`;
    const result = runPrePRGates(diff);
    const secGate = result.gates.find((g) => g.gate === "security-scan");
    expect(secGate?.verdict).toBe("block");
    expect(secGate?.findings.some((f) => /\[critical\].*xss/.test(f))).toBe(true);
  });

  it("warns (does not block) on direct innerHTML assignment", () => {
    // innerHTML = is "warning" severity — gate should be "warn", canProceed stays true.
    const diff = `diff --git a/apps/web/lib/foo.ts b/apps/web/lib/foo.ts
index aaa..bbb 100644
--- a/apps/web/lib/foo.ts
+++ b/apps/web/lib/foo.ts
@@ -1,1 +1,2 @@
 export const x = 1;
+el.innerHTML = userText;
`;
    const result = runPrePRGates(diff);
    expect(result.canProceed).toBe(true);
    const secGate = result.gates.find((g) => g.gate === "security-scan");
    expect(secGate?.verdict).toBe("warn");
    expect(secGate?.findings.some((f) => /\[warning\].*xss/.test(f))).toBe(true);
  });

  it("warns on a Stripe/GitHub-style API token prefix", () => {
    // The sk-/ghp_/xoxb- prefix pattern is "warning" severity with no fileFilter.
    const diff = `diff --git a/docs/example.md b/docs/example.md
index aaa..bbb 100644
--- a/docs/example.md
+++ b/docs/example.md
@@ -1,1 +1,2 @@
 # Example
+Use the token sk-abc123XYZdef456GHI for testing.
`;
    const result = runPrePRGates(diff);
    const secGate = result.gates.find((g) => g.gate === "security-scan");
    expect(secGate?.verdict).toBe("warn");
    expect(secGate?.findings.some((f) => /API token/.test(f))).toBe(true);
  });

  it("passes on a clean diff with no flagged patterns", () => {
    const diff = `diff --git a/apps/web/lib/foo.ts b/apps/web/lib/foo.ts
index aaa..bbb 100644
--- a/apps/web/lib/foo.ts
+++ b/apps/web/lib/foo.ts
@@ -1,1 +1,2 @@
 export const x = 1;
+export const y = x + 2;
`;
    const result = runPrePRGates(diff);
    const secGate = result.gates.find((g) => g.gate === "security-scan");
    expect(secGate?.verdict).toBe("pass");
    expect(secGate?.findings).toHaveLength(0);
  });

  it("does not flag dangerouslySetInnerHTML outside .ts/.tsx files (fileFilter honored)", () => {
    // The dangerouslySetInnerHTML pattern is gated by /\.tsx?$/. Putting the
    // string in a .md file should not trip the security gate.
    const diff = `diff --git a/docs/react-guide.md b/docs/react-guide.md
index aaa..bbb 100644
--- a/docs/react-guide.md
+++ b/docs/react-guide.md
@@ -1,1 +1,2 @@
 # React
+Avoid dangerouslySetInnerHTML in components.
`;
    const result = runPrePRGates(diff);
    const secGate = result.gates.find((g) => g.gate === "security-scan");
    expect(secGate?.verdict).toBe("pass");
  });

  it("ignores critical patterns that only appear in removed lines", () => {
    // Same symmetry as the destructive-ops and architecture gates: a removal
    // of a vulnerable line is exactly the kind of cleanup the gate should reward.
    const diff = `diff --git a/apps/web/lib/foo.ts b/apps/web/lib/foo.ts
index aaa..bbb 100644
--- a/apps/web/lib/foo.ts
+++ b/apps/web/lib/foo.ts
@@ -1,2 +1,1 @@
-const api_key = "AKIAIOSFODNN7EXAMPLEKEY";
 export const x = 1;
`;
    const result = runPrePRGates(diff);
    const secGate = result.gates.find((g) => g.gate === "security-scan");
    expect(secGate?.verdict).toBe("pass");
  });
});

describe("runPrePRGates — architecture gate (rename detection)", () => {
  it("warns when a file is RENAMED into an unexpected directory", () => {
    // Renames have different `a/` and `b/` paths in the `diff --git` header.
    // The old extractor only captured the `a/` (source) path, so moving a file
    // from a recognized dir (apps/) to an unrecognized one (random-dir/) was
    // silently allowed.
    const diff = `diff --git a/apps/web/lib/foo.ts b/random-dir/foo.ts
similarity index 100%
rename from apps/web/lib/foo.ts
rename to random-dir/foo.ts
`;
    const result = runPrePRGates(diff);
    const archGate = result.gates.find((g) => g.gate === "architecture");
    expect(archGate?.verdict).toBe("warn");
    expect(archGate?.findings.some((f) => /Unexpected directory: random-dir\/foo\.ts/.test(f))).toBe(true);
  });

  it("does not warn when a file is renamed BETWEEN two recognized directories", () => {
    const diff = `diff --git a/apps/web/lib/foo.ts b/packages/db/foo.ts
similarity index 100%
rename from apps/web/lib/foo.ts
rename to packages/db/foo.ts
`;
    const result = runPrePRGates(diff);
    const archGate = result.gates.find((g) => g.gate === "architecture");
    expect(archGate?.verdict).toBe("pass");
  });
});

describe("runPrePRGates — BI-E9CD1B92 minimal-diff smoke test", () => {
  // BI-E9CD1B92 surfaced as "S?.filter is not a function" from create_portal_pr.
  // Root cause was downstream in mcp-tools.ts acceptance handling, but lock in
  // that the gate orchestrator itself never throws on a clean single-file token
  // replacement diff — the exact shape that triggered the original report.
  it("processes a clean single-file UI token replacement without throwing", () => {
    const diff = `diff --git a/apps/web/components/my-queue/MyQueue.tsx b/apps/web/components/my-queue/MyQueue.tsx
index 1111111..2222222 100644
--- a/apps/web/components/my-queue/MyQueue.tsx
+++ b/apps/web/components/my-queue/MyQueue.tsx
@@ -10,7 +10,7 @@ export function MyQueue() {
   return (
     <div className="my-queue">
-      <h1>Queue</h1>
+      <h1>My Queue</h1>
     </div>
   );
 }
`;
    expect(() => runPrePRGates(diff)).not.toThrow();
    const result = runPrePRGates(diff);
    expect(result.canProceed).toBe(true);
    expect(result.requiresHumanReview).toBe(false);
    expect(result.gates.every((g) => g.verdict === "pass")).toBe(true);
  });
});

describe("runPrePRGates — UI quality gate (BI-66656F61)", () => {
  it("warns (never blocks) on a hardcoded color in a .tsx diff, and requires human review", () => {
    const diff = `diff --git a/apps/web/components/Card.tsx b/apps/web/components/Card.tsx
index 111..222 100644
--- a/apps/web/components/Card.tsx
+++ b/apps/web/components/Card.tsx
@@ -1,3 +1,4 @@
   return (
+    <div style={{ color: "#4ade80" }} onClick={go}>hi</div>
   );
`;
    const result = runPrePRGates(diff);
    const ui = result.gates.find((g) => g.gate.startsWith("UI Quality"));
    expect(ui?.verdict).toBe("warn");
    expect(ui?.findings.length).toBeGreaterThan(0);
    expect(result.canProceed).toBe(true); // advisory — never blocks
    expect(result.requiresHumanReview).toBe(true);
  });

  it("passes a token-compliant .tsx diff", () => {
    const diff = `diff --git a/apps/web/components/Ok.tsx b/apps/web/components/Ok.tsx
index 111..222 100644
--- a/apps/web/components/Ok.tsx
+++ b/apps/web/components/Ok.tsx
@@ -1,2 +1,3 @@
+    <div className="text-[var(--dpf-text)]">ok</div>
`;
    const ui = runPrePRGates(diff).gates.find((g) => g.gate.startsWith("UI Quality"));
    expect(ui?.verdict).toBe("pass");
  });

  it("ignores non-UI files", () => {
    const diff = `diff --git a/apps/web/lib/foo.ts b/apps/web/lib/foo.ts
index 111..222 100644
--- a/apps/web/lib/foo.ts
+++ b/apps/web/lib/foo.ts
@@ -1,2 +1,3 @@
+  const c = "#ffffff";
`;
    const ui = runPrePRGates(diff).gates.find((g) => g.gate.startsWith("UI Quality"));
    expect(ui?.verdict).toBe("pass");
  });
});
