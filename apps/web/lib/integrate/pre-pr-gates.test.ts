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
