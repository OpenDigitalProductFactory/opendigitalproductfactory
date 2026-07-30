// Tests for the gate-context pack (BI-2677A465).
//
// Two contracts under test. (1) buildGateContext derives constraints from the
// SAME registries CI enforces — each section fires exactly when its gate
// would. (2) Drift-guards: the dpf-skill-pack precheck hooks keep
// dependency-free mirrors of the canonical sensitivity constants (the pack is
// distributed outside this repo); these tests pin the mirrors' BEHAVIOR to
// the canonical exports so a divergence fails CI instead of silently letting
// a gate and its warning disagree.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

import { buildGateContext, formatGateContextMarkdown } from "./lib/gate-context.mjs";
import {
  NEW_SOURCE_FILE_RE,
  UI_CONTROL_RE,
  UX_EXCLUDE_RE,
} from "./lib/gate-sensitivity.mjs";
import { decide as specPlanDocDecide } from "../packages/dpf-skill-pack/hooks/spec-plan-doc-precheck.mjs";
import { decide as uxFitDecide } from "../packages/dpf-skill-pack/hooks/ux-fit-precheck.mjs";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const build = (changedFiles, extra = {}) =>
  buildGateContext({ changedFiles, repoRoot, ...extra });

// ── attestation trailers ─────────────────────────────────────────────────────

test("a new apps/web/lib module without a doc touch requires the Process-Spine attestation", () => {
  const ctx = build([{ path: "apps/web/lib/foo/new-capability.ts", status: "A" }]);
  const gates = ctx.trailers.map((t) => t.gate);
  assert.ok(gates.includes("Spec/Plan/Doc"), gates.join(","));
});

test("the same new module WITH a doc touch does not demand the trailer", () => {
  const ctx = build([
    { path: "apps/web/lib/foo/new-capability.ts", status: "A" },
    { path: "docs/testing/foo.md", status: "M" },
  ]);
  assert.ok(!ctx.trailers.some((t) => t.gate === "Spec/Plan/Doc"));
});

test("design-sensitive files require Design Grounding; plain scripts do not", () => {
  const sensitive = build([{ path: "apps/web/components/foo/Bar.tsx", status: "M" }]);
  assert.ok(sensitive.trailers.some((t) => t.gate === "Design Grounding"));
  const plain = build([{ path: "scripts/some-tool.mjs", status: "M" }]);
  assert.ok(!plain.trailers.some((t) => t.gate === "Design Grounding"));
});

test("a net-new page requires UX-Fit; an edited component gets the conditional form", () => {
  const newPage = build([{ path: "apps/web/app/things/page.tsx", status: "A" }]);
  const required = newPage.trailers.find((t) => t.gate === "UX-Fit");
  assert.equal(required?.level, "required");

  const edited = build([{ path: "apps/web/components/things/Panel.tsx", status: "M" }]);
  const conditional = edited.trailers.find((t) => t.gate === "UX-Fit");
  assert.equal(conditional?.level, "conditional");

  const testFile = build([{ path: "apps/web/components/things/Panel.test.tsx", status: "M" }]);
  assert.ok(!testFile.trailers.some((t) => t.gate === "UX-Fit"));
});

// BI-D967DEE0. This pack is injected into agent context BEFORE generation, so if it
// still advertised the retired trailer every agent would be pre-instructed to satisfy a
// dead mechanism — the exact prose/code drift the gate-context pack exists to prevent.
test("the UX-Fit constraint names the measured manifest, never the retired trailer", () => {
  const ctx = build([{ path: "apps/web/app/things/page.tsx", status: "A" }]);
  const uxFit = ctx.trailers.find((t) => t.gate === "UX-Fit");
  assert.ok(uxFit, "a net-new page must still carry a UX-Fit constraint");
  assert.match(uxFit.trailer, /\.ux-fit\.json$/);
  assert.doesNotMatch(uxFit.trailer, /UX-Fit-Decision:/);
  assert.match(uxFit.alternative, /sweep-measurement/);
  assert.match(uxFit.alternative, /RETIRED/);
});

test("schema changes surface the Data-Impact requirement and NAME the surface kind", () => {
  const ctx = build([{ path: "packages/db/prisma/schema.prisma", status: "M" }]);
  const dataImpact = ctx.trailers.find((t) => t.gate === "Data-Impact");
  assert.ok(dataImpact);
  // classifyChangedSurfaces returns kind strings; mapping .kind over them
  // rendered "changed: ;" — the kind must appear in the constraint text.
  assert.match(dataImpact.because, /changed: schema/);
});

// ── ratchets, artifacts, routes, migrations ──────────────────────────────────

test("a baselined module reports its frozen size cap; a new .ts module gets the absolute budget", () => {
  const ctx = build([
    { path: "apps/web/instrumentation.ts", status: "M" },
    { path: "apps/web/lib/foo/big-new-module.ts", status: "A" },
  ]);
  const baselined = ctx.moduleSize.find((m) => m.path === "apps/web/instrumentation.ts");
  assert.ok(baselined && baselined.capLines >= 800, JSON.stringify(ctx.moduleSize));
  const fresh = ctx.moduleSize.find((m) => m.path === "apps/web/lib/foo/big-new-module.ts");
  assert.equal(fresh?.capLines, 800);
});

test("docs changes report the doc-index derived artifact", () => {
  const ctx = build([{ path: "docs/testing/pre-pr-gate.md", status: "M" }]);
  assert.ok(ctx.derivedArtifacts.some((d) => d.id === "doc-index"), JSON.stringify(ctx.derivedArtifacts));
});

test("a net-new route lists the absolute budgets and four-companion checklist", () => {
  const ctx = build([{ path: "apps/web/app/brand-new-surface/page.tsx", status: "A" }]);
  const route = ctx.routes.find((r) => r.route === "/brand-new-surface");
  assert.equal(route?.status, "net-new");
  assert.ok(route.rules.some((rule) => rule.includes("route-manifest")));
});

test("a pre-existing baselined route reports its frozen word budget", () => {
  const ctx = build([{ path: "apps/web/app/admin/page.tsx", status: "M" }]);
  const route = ctx.routes.find((r) => r.route === "/admin");
  assert.equal(route?.status, "pre-existing");
  assert.ok(route.rules.some((rule) => /≤\d+ words/.test(rule)), JSON.stringify(route));
});

test("editing a committed migration is flagged blocking; a new migration gets the safety contract", () => {
  const edited = build([{ path: "packages/db/prisma/migrations/20260701000000_x/migration.sql", status: "M" }]);
  assert.ok(edited.migrations.some((m) => m.severity === "blocking" && m.rule.includes("IMMUTABLE")));
  const added = build([{ path: "packages/db/prisma/migrations/20260729000000_y/migration.sql", status: "A" }]);
  assert.ok(added.migrations.some((m) => m.rule.includes("migration-safety guard")));
});

// ── determinism + formatting ─────────────────────────────────────────────────

test("identical inputs produce byte-identical packs (no timestamps, no environment)", () => {
  const input = [
    { path: "apps/web/lib/foo/new-capability.ts", status: "A" },
    { path: "packages/db/prisma/schema.prisma", status: "M" },
  ];
  assert.equal(JSON.stringify(build(input)), JSON.stringify(build(input)));
});

test("an empty diff still renders the verification path", () => {
  const md = formatGateContextMarkdown(build([]));
  assert.match(md, /No gate-sensitive surfaces detected/);
  assert.match(md, /pregate:preflight/);
});

// ── skill-pack hook drift-guards ─────────────────────────────────────────────
// The hooks keep local mirrors of the canonical constants (deliberate
// distribution boundary). Pin their BEHAVIOR to the canonical exports.

const SPEC_PROBES = [
  "apps/web/lib/foo/thing.ts",
  "apps/web/app/x/page.tsx",
  "apps/web/app/api/x/route.ts",
  "packages/db/src/thing.ts",
  "packages/db/prisma/migrations/20260101000000_z/migration.sql",
  "apps/web/components/Panel.tsx",
  "scripts/tool.mjs",
  "docs/testing/foo.md",
];

test("spec-plan-doc hook mirror agrees with canonical NEW_SOURCE_FILE_RE on every probe", () => {
  for (const probe of SPEC_PROBES) {
    const canonical = NEW_SOURCE_FILE_RE.test(probe) && !UX_EXCLUDE_RE.test(probe);
    const hook = specPlanDocDecide("Write", { file_path: `${repoRoot}${probe}` }).remind;
    assert.equal(hook, canonical, `drift on ${probe}: hook=${hook} canonical=${canonical} — update the hook mirror or gate-sensitivity.mjs together`);
  }
});

const CONTROL_PROBES = [
  { text: '<input type="text" />', file: "apps/web/components/A.tsx" },
  { text: '<select>', file: "apps/web/components/B.tsx" },
  { text: '<textarea rows={3}>', file: "apps/web/components/C.tsx" },
  { text: 'type="number"', file: "apps/web/components/D.tsx" },
  { text: "<form onSubmit={x}>", file: "apps/web/components/E.tsx" },
  { text: "<div>plain</div>", file: "apps/web/components/F.tsx" },
];

test("ux-fit hook mirror agrees with canonical UI_CONTROL_RE on every probe", () => {
  for (const probe of CONTROL_PROBES) {
    const canonical = UI_CONTROL_RE.test(probe.text);
    const hook = uxFitDecide("Edit", { file_path: probe.file, new_string: probe.text }).remind;
    assert.equal(hook, canonical, `drift on ${JSON.stringify(probe.text)}: hook=${hook} canonical=${canonical}`);
  }
});

// ── CLI smoke ────────────────────────────────────────────────────────────────

test("gate-context CLI emits valid JSON for the live worktree", () => {
  const result = spawnSync(process.execPath, [join(repoRoot, "scripts", "gate-context.mjs"), "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const pack = JSON.parse(result.stdout);
  assert.equal(pack.schemaVersion, 1);
  assert.ok(Array.isArray(pack.trailers));
});
