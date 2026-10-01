import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  analyzeApplicationBoundaries,
  validateBoundaryRegistry,
} from "./check-application-boundaries.mjs";

const contexts = {
  edge: {
    owner: "platform-edge",
    description: "Transport adapters.",
    allowedDependencies: ["application", "domain"],
  },
  application: {
    owner: "platform-application",
    description: "Use-case orchestration.",
    allowedDependencies: ["domain"],
  },
  domain: {
    owner: "platform-domain",
    description: "Transport-neutral policy.",
    allowedDependencies: [],
  },
};

function registry(overrides = {}) {
  return {
    version: 1,
    owner: "platform-architecture",
    expiry: "2099-01-01",
    root: "apps/web/lib",
    contexts,
    exceptions: [],
    ...overrides,
  };
}

async function withFixture(files, fn) {
  const root = await mkdtemp(join(tmpdir(), "dpf-application-boundaries-"));
  try {
    for (const [relativePath, body] of Object.entries(files)) {
      const full = join(root, relativePath);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, body, "utf8");
    }
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("registry rejects unknown dependencies and cycles", () => {
  const unknown = registry({
    contexts: {
      ...contexts,
      edge: { ...contexts.edge, allowedDependencies: ["missing"] },
    },
  });
  assert.match(validateBoundaryRegistry(unknown).join("\n"), /unknown context missing/);

  const cyclic = registry({
    contexts: {
      ...contexts,
      domain: { ...contexts.domain, allowedDependencies: ["edge"] },
    },
  });
  const cycleFailure = validateBoundaryRegistry(cyclic).join("\n");
  assert.match(cycleFailure, /cycle/i);
  assert.match(cycleFailure, /edge/);
  assert.match(cycleFailure, /application/);
  assert.match(cycleFailure, /domain/);
});

test("registry requires ownership and a documented context purpose", () => {
  const invalid = registry({
    contexts: {
      ...contexts,
      domain: { owner: "", description: "", allowedDependencies: [] },
    },
  });
  const failures = validateBoundaryRegistry(invalid).join("\n");
  assert.match(failures, /domain.*owner/i);
  assert.match(failures, /domain.*description/i);
});

test("registry requires an owned, unexpired global budget (BI-3F17B16B)", () => {
  const missing = registry({ owner: undefined, expiry: undefined });
  const failures = validateBoundaryRegistry(missing).join("\n");
  assert.match(failures, /registry budget: missing budget owner/);
  assert.match(failures, /registry budget: missing or malformed budget expiry/);

  const expired = registry({ expiry: "2026-01-01" });
  assert.match(
    validateBoundaryRegistry(expired, { today: "2026-08-18" }).join("\n"),
    /registry budget.*EXPIRED on 2026-01-01/,
  );
});

test("registry rejects expired architecture-debt exceptions", () => {
  const invalid = registry({
    exceptions: [{
      key: "apps/web/lib/domain/leak.ts|@/lib/edge/handler|edge",
      owner: "platform-domain",
      rationale: "Legacy edge awaiting removal.",
      reviewBy: "2026-01-01",
    }],
  });
  assert.match(
    validateBoundaryRegistry(invalid, { today: "2026-08-01" }).join("\n"),
    /review expired on 2026-01-01/,
  );
});

test("analyzer resolves alias and relative imports across governed contexts", async () => {
  await withFixture({
    "apps/web/lib/edge/alias.ts": 'import { run } from "@/lib/domain/run";\n',
    "apps/web/lib/application/relative.ts": 'export { policy } from "../domain/policy";\n',
    "apps/web/lib/domain/run.ts": "export const run = true;\n",
    "apps/web/lib/domain/policy.ts": "export const policy = true;\n",
  }, async (repoRoot) => {
    const result = await analyzeApplicationBoundaries({ repoRoot, registry: registry() });
    assert.equal(result.edges.length, 2);
    assert.deepEqual(result.newForbiddenEdges, []);
    assert.deepEqual(
      result.edges.map(({ sourceContext, targetContext }) => `${sourceContext}->${targetContext}`).sort(),
      ["application->domain", "edge->domain"],
    );
  });
});

test("analyzer rejects a new reverse dependency with an actionable edge key", async () => {
  await withFixture({
    "apps/web/lib/domain/leak.ts": 'import { handler } from "@/lib/edge/handler";\n',
    "apps/web/lib/edge/handler.ts": "export const handler = true;\n",
  }, async (repoRoot) => {
    const result = await analyzeApplicationBoundaries({ repoRoot, registry: registry() });
    assert.deepEqual(result.newForbiddenEdges, [{
      source: "apps/web/lib/domain/leak.ts",
      sourceContext: "domain",
      targetContext: "edge",
      specifier: "@/lib/edge/handler",
      key: "apps/web/lib/domain/leak.ts|@/lib/edge/handler|edge",
    }]);
  });
});

test("a documented exception freezes existing debt and becomes stale when the edge is removed", async () => {
  const exception = {
    key: "apps/web/lib/domain/leak.ts|@/lib/edge/handler|edge",
    owner: "platform-domain",
    rationale: "Characterized legacy edge; remove through BI-EXAMPLE.",
    reviewBy: "2026-11-01",
  };

  await withFixture({
    "apps/web/lib/domain/leak.ts": 'const handler = require("@/lib/edge/handler");\n',
  }, async (repoRoot) => {
    const current = await analyzeApplicationBoundaries({
      repoRoot,
      registry: registry({ exceptions: [exception] }),
    });
    assert.deepEqual(current.newForbiddenEdges, []);
    assert.deepEqual(current.staleExceptions, []);
  });

  await withFixture({
    "apps/web/lib/domain/clean.ts": "export const clean = true;\n",
  }, async (repoRoot) => {
    const shrunk = await analyzeApplicationBoundaries({
      repoRoot,
      registry: registry({ exceptions: [exception] }),
    });
    assert.deepEqual(shrunk.newForbiddenEdges, []);
    assert.deepEqual(shrunk.staleExceptions, [exception.key]);
  });
});

test("tests, declarations, and imports outside the governed context set are excluded", async () => {
  await withFixture({
    "apps/web/lib/domain/leak.test.ts": 'import "@/lib/edge/handler";\n',
    "apps/web/lib/domain/types.d.ts": 'import "@/lib/edge/handler";\n',
    "apps/web/lib/ungoverned/adapter.ts": 'import "@/lib/domain/policy";\n',
  }, async (repoRoot) => {
    const result = await analyzeApplicationBoundaries({ repoRoot, registry: registry() });
    assert.deepEqual(result.edges, []);
  });
});

// M11 step 2 PR-3: lib may not import the layers above it.
const outerLayers = {
  app: { owner: "web-application", path: "apps/web/app", description: "Routes." },
  components: { owner: "web-application", path: "apps/web/components", description: "UI components." },
};

let pinnedTs;
async function guardTs() {
  if (!pinnedTs) {
    const { loadPinnedGuardTypeScript } = await import("./lib/load-pinned-guard-typescript.mjs");
    pinnedTs = loadPinnedGuardTypeScript();
  }
  return pinnedTs;
}

test("registry validates outer layers", () => {
  const failures = validateBoundaryRegistry(registry({
    outerLayers: {
      domain: { owner: "x", path: "apps/web/domain", description: "Collides." },
      ui: { owner: "", path: "", description: "" },
    },
  })).join("\n");
  assert.match(failures, /Outer layer domain collides/);
  assert.match(failures, /Outer layer ui requires an owner/);
  assert.match(failures, /Outer layer ui requires a description/);
  assert.match(failures, /Outer layer ui requires a repository-relative path/);
  assert.deepEqual(validateBoundaryRegistry(registry({ outerLayers })), []);
});

test("analyzer flags every import kind from lib into app/ or components/", async () => {
  await withFixture({
    "apps/web/lib/domain/value.ts": 'import { NAV } from "@/components/admin/admin-nav";\n',
    "apps/web/lib/domain/type-only.ts": 'import type { Tile } from "@/components/shell/Tiles";\n',
    "apps/web/lib/domain/dynamic.ts": 'export const load = () => import("@/app/(shell)/page");\n',
    "apps/web/lib/domain/type-query.ts": 'export type T = import("../../components/twin/types").Twin;\n',
    "apps/web/lib/ungoverned/reexport.ts": 'export * from "@/components/ui/report-kit";\n',
  }, async (repoRoot) => {
    const result = await analyzeApplicationBoundaries({
      repoRoot,
      registry: registry({ outerLayers }),
      ts: await guardTs(),
    });
    assert.deepEqual(
      result.newForbiddenEdges.map(({ key }) => key),
      [
        "apps/web/lib/domain/dynamic.ts|@/app/(shell)/page|app",
        "apps/web/lib/domain/type-only.ts|@/components/shell/Tiles|components",
        "apps/web/lib/domain/type-query.ts|../../components/twin/types|components",
        "apps/web/lib/domain/value.ts|@/components/admin/admin-nav|components",
        "apps/web/lib/ungoverned/reexport.ts|@/components/ui/report-kit|components",
      ],
    );
  });
});

test("outer-layer pass ignores prompt text, tests, and lib-internal imports", async () => {
  await withFixture({
    "apps/web/lib/build/prompts.ts":
      'export const PROMPT = `- Spinner: import { Spinner } from "@/components/ui/Spinner"`;\n',
    "apps/web/lib/domain/view.test.ts": 'import { View } from "@/components/View";\n',
    "apps/web/lib/domain/clean.ts": 'import { nav } from "@/lib/navigation/admin-nav";\nimport { x } from "../app-like/x";\n',
  }, async (repoRoot) => {
    const result = await analyzeApplicationBoundaries({
      repoRoot,
      registry: registry({ outerLayers }),
      ts: await guardTs(),
    });
    assert.deepEqual(result.outerLayerEdges, []);
    assert.deepEqual(result.newForbiddenEdges, []);
  });
});

test("an owned exception freezes an outer-layer edge and goes stale once it is removed", async () => {
  const exception = {
    key: "apps/web/lib/domain/leak.ts|@/components/ui/View|components",
    owner: "web-application",
    rationale: "Needs a design decision; remove through BI-EXAMPLE.",
    reviewBy: "2099-01-01",
  };
  await withFixture({
    "apps/web/lib/domain/leak.ts": 'import { View } from "@/components/ui/View";\n',
  }, async (repoRoot) => {
    const result = await analyzeApplicationBoundaries({
      repoRoot,
      registry: registry({ outerLayers, exceptions: [exception] }),
      ts: await guardTs(),
    });
    assert.deepEqual(result.newForbiddenEdges, []);
    assert.deepEqual(result.staleExceptions, []);
  });
  await withFixture({
    "apps/web/lib/domain/leak.ts": "export const View = null;\n",
  }, async (repoRoot) => {
    const result = await analyzeApplicationBoundaries({
      repoRoot,
      registry: registry({ outerLayers, exceptions: [exception] }),
      ts: await guardTs(),
    });
    assert.deepEqual(result.staleExceptions, [exception.key]);
  });
});
