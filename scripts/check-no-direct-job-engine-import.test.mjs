// Tests for the job-engine facade ratchet (plan 2026-09-08 move M3, phase 1).
// Run: node --test scripts/check-no-direct-job-engine-import.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  ALLOWLIST,
  FACADE_DIR,
  findEngineImports,
  findStaleAllowlist,
  isEngineSpecifier,
  scanRepo,
} from "./check-no-direct-job-engine-import.mjs";

function withFixture(files, fn) {
  const root = mkdtempSync(join(tmpdir(), "job-engine-facade-"));
  try {
    for (const [path, body] of Object.entries(files)) {
      const full = join(root, ...path.split("/"));
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, body);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("engine specifiers: the package, its subpaths, the old client and the adapter", () => {
  for (const s of [
    "inngest",
    "inngest/next",
    "inngest/types",
    "@inngest/realtime",
    "@/lib/queue/inngest-client",
    "../inngest-client",
    "./inngest-client",
    "@/lib/jobs/inngest-adapter",
  ]) {
    assert.equal(isEngineSpecifier(s), true, s);
  }
  for (const s of [
    "@/lib/jobs",
    "@/lib/jobs/triggers",
    "@/lib/jobs/serve",
    "@/lib/operate/inngest-retention/constants",
    "@/lib/queue/inngest-self-registration",
    "inngest-like",
  ]) {
    assert.equal(isEngineSpecifier(s), false, s);
  }
});

test("flags static, type, re-export, dynamic, require and mock imports", () => {
  const body = [
    'import { Inngest } from "inngest";',
    'import type { Jsonify } from "inngest/types";',
    'export { inngest } from "@/lib/queue/inngest-client";',
    'const { inngest } = await import("../inngest-client");',
    'const x = require("inngest");',
    'vi.mock("@/lib/queue/inngest-client", () => ({}));',
    'import { inngestClient } from "@/lib/jobs/inngest-adapter";',
  ].join("\n");
  assert.deepEqual(findEngineImports(body).map((h) => h.line), [1, 2, 3, 4, 5, 6, 7]);
});

test("flags the closing line of a multi-line import", () => {
  const body = 'import {\n  cron,\n  Inngest,\n} from "inngest";\n';
  assert.deepEqual(findEngineImports(body).map((h) => h.line), [4]);
});

test("ignores the facade, comments, and look-alike modules", () => {
  const body = [
    'import { jobs } from "@/lib/jobs";',
    'import { cron } from "@/lib/jobs/triggers";',
    '// import { inngest } from "@/lib/queue/inngest-client";',
    ' * vi.mock("inngest")',
    'import { run } from "@/lib/operate/inngest-retention/run";',
    'const url = "http://inngest:8288/health";',
  ].join("\n");
  assert.deepEqual(findEngineImports(body), []);
});

test("scanRepo exempts the facade directory and reports everything else", () => {
  withFixture(
    {
      [`${FACADE_DIR}inngest-adapter.ts`]: 'import { Inngest } from "inngest";\n',
      [`${FACADE_DIR}serve.ts`]: 'import { serve } from "inngest/next";\n',
      "apps/web/lib/queue/functions/job.ts": 'import { cron } from "inngest";\n',
      "apps/web/lib/actions/send.test.ts": 'vi.mock("@/lib/queue/inngest-client", () => ({}));\n',
      "apps/web/lib/actions/ok.ts": 'import { jobs } from "@/lib/jobs";\n',
      "apps/web/node_modules/x/index.js": 'require("inngest");\n',
      "packages/db/src/x.ts": 'import { Inngest } from "inngest";\n',
    },
    (root) => {
      assert.deepEqual(
        scanRepo(root).map((v) => v.file).sort(),
        [
          "apps/web/lib/actions/send.test.ts",
          "apps/web/lib/queue/functions/job.ts",
          "packages/db/src/x.ts",
        ],
      );
    },
  );
});

test("allowlist is closed and empty", () => {
  assert.equal(ALLOWLIST.size, 0);
});

test("repo: nothing outside the job facade imports the engine", () => {
  assert.deepEqual(scanRepo(), []);
  assert.deepEqual(findStaleAllowlist(), []);
});
