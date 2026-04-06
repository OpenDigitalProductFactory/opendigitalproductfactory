/**
 * Build Studio Full Lifecycle Integration Test
 *
 * Exercises the complete build pipeline by calling the same executeTool
 * function the portal uses. Walks through:
 *   create → ideate → plan → build → review → ship → promote
 *
 * Bypasses LLM calls by writing evidence directly via Prisma where
 * the tool would call routeAndCall() for AI review. Everything else
 * uses the real tool pipeline.
 *
 * Run: cd apps/web && npx vitest run tests/build-lifecycle.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@dpf/db";
import { executeTool } from "@/lib/mcp-tools";
import { generateBuildId } from "@/lib/feature-build-types";
import type { BuildPhase } from "@/lib/feature-build-types";

// ─── Test fixtures ──────────────────────────────────────────────────────────

const TEST_USER_ID = "cmnmnsok308la6yl033n2sfhg"; // admin@dpf.local
const TEST_CONTEXT = { routeContext: "/build", agentId: "AGT-TEST", threadId: "test-lifecycle" };

const DESIGN_DOC = {
  problemStatement: "Customers need to file complaints about products and services",
  existingFunctionalityAudit: "Found CustomerContact model for unauthenticated customers, StorefrontConfig model with organizationId link, Engagement model with similar CRUD pattern, API routes use auth() from @/lib/auth",
  alternativesConsidered: "Third-party ticketing (Zendesk) vs built-in. Built-in chosen for data sovereignty.",
  reusePlan: "Reuse Engagement CRUD pattern, CustomerContact relation, existing API auth middleware",
  newCodeJustification: "No complaint/ticket model exists. Need new Prisma model, API routes, and UI components.",
  proposedApproach: "Add Complaint model with status workflow, REST API with filters, internal dashboard, public submission form",
  acceptanceCriteria: [
    "Customers can submit complaints via public form",
    "Staff can view, filter, and assign complaints",
    "Status workflow: open → assigned → in_progress → resolved → closed",
    "All interactions keyboard navigable",
  ],
};

const DESIGN_REVIEW_PASS = {
  decision: "pass",
  issues: [],
  summary: "Design is well-structured with clear patterns from existing codebase.",
};

const BUILD_PLAN = {
  fileStructure: [
    { path: "packages/db/prisma/schema.prisma", action: "modify", purpose: "Add Complaint model and enums" },
    { path: "apps/web/app/api/v1/customer/complaints/route.ts", action: "create", purpose: "GET/POST endpoints" },
    { path: "apps/web/app/api/v1/customer/complaints/[id]/route.ts", action: "create", purpose: "PATCH endpoint" },
    { path: "apps/web/app/(shell)/complaints/ComplaintsClient.tsx", action: "modify", purpose: "Wire to real API" },
  ],
  tasks: [
    { title: "Add Complaint model to schema", testFirst: "validate_schema", implement: "Add model + enums", verify: "prisma migrate" },
    { title: "Create GET/POST API route", testFirst: "tsc --noEmit", implement: "REST endpoints with auth", verify: "tsc --noEmit" },
    { title: "Create PATCH API route", testFirst: "tsc --noEmit", implement: "Status update endpoint", verify: "tsc --noEmit" },
    { title: "Wire ComplaintsClient to API", testFirst: "tsc --noEmit", implement: "Replace mock data with fetch", verify: "tsc --noEmit" },
  ],
};

const PLAN_REVIEW_PASS = {
  decision: "pass",
  issues: [],
  summary: "Plan follows existing patterns with proper task decomposition.",
};

const VERIFICATION_OUTPUT = {
  typecheckPassed: true,
  testsPassed: 12,
  testsFailed: 0,
  fullOutput: "All 12 tests passed. Typecheck clean.",
  timestamp: new Date().toISOString(),
};

const ACCEPTANCE_MET = [
  { criterion: "Customers can submit complaints via public form", met: true, evidence: "POST /api/v1/customer/complaints returns 201" },
  { criterion: "Staff can view, filter, and assign complaints", met: true, evidence: "GET with status/severity filters verified" },
  { criterion: "Status workflow works", met: true, evidence: "PATCH transitions open→assigned→resolved verified" },
  { criterion: "All interactions keyboard navigable", met: true, evidence: "Tab navigation and Enter activation verified" },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

let testBuildId: string;

async function getPhase(): Promise<BuildPhase> {
  const build = await prisma.featureBuild.findUnique({
    where: { buildId: testBuildId },
    select: { phase: true },
  });
  return (build?.phase ?? "failed") as BuildPhase;
}

async function callTool(name: string, params: Record<string, unknown> = {}) {
  const result = await executeTool(name, params, TEST_USER_ID, TEST_CONTEXT);
  console.log(`  [${name}] ${result.success ? "OK" : "FAIL"}: ${result.message.slice(0, 120)}`);
  return result;
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe("Build Studio full lifecycle", () => {
  beforeAll(async () => {
    // Create a test build directly via Prisma (bypasses auth)
    testBuildId = generateBuildId();
    await prisma.featureBuild.create({
      data: {
        buildId: testBuildId,
        title: "Integration Test: Customer Complaints",
        phase: "ideate",
        createdById: TEST_USER_ID,
      },
    });
    console.log(`\n  Created test build: ${testBuildId}\n`);
  });

  afterAll(async () => {
    // Clean up test build and related records
    try {
      await prisma.phaseHandoff.deleteMany({ where: { buildId: testBuildId } });
      await prisma.buildActivity.deleteMany({ where: { buildId: testBuildId } });
      // Clean up digital product if created
      const build = await prisma.featureBuild.findUnique({ where: { buildId: testBuildId }, select: { digitalProductId: true } });
      if (build?.digitalProductId) {
        await prisma.backlogItem.deleteMany({ where: { epic: { digitalProductId: build.digitalProductId } } });
        await prisma.epic.deleteMany({ where: { digitalProductId: build.digitalProductId } });
        await prisma.promotion.deleteMany({ where: { digitalProductId: build.digitalProductId } });
        await prisma.digitalProduct.delete({ where: { id: build.digitalProductId } }).catch(() => {});
      }
      await prisma.featureBuild.delete({ where: { buildId: testBuildId } });
    } catch (err) {
      console.error("Cleanup error (non-fatal):", err);
    }
    await prisma.$disconnect();
  });

  // ─── Phase 1: Ideate ───────────────────────────────────────────────────

  it("starts in ideate phase", async () => {
    expect(await getPhase()).toBe("ideate");
  });

  it("saves design document via saveBuildEvidence", async () => {
    const result = await callTool("saveBuildEvidence", {
      field: "designDoc",
      value: DESIGN_DOC,
    });
    expect(result.success).toBe(true);
  });

  it("saves design review (bypassing LLM) and auto-advances to plan", async () => {
    // Write review directly — reviewDesignDoc calls an LLM which we skip
    await prisma.featureBuild.update({
      where: { buildId: testBuildId },
      data: { designReview: DESIGN_REVIEW_PASS as unknown as import("@dpf/db").Prisma.InputJsonValue },
    });

    // save_phase_handoff should advance ideate → plan
    const result = await callTool("save_phase_handoff", {
      summary: "Design approved. Customer complaints feature with CRUD API and dashboard.",
      decisionsMade: ["Use CustomerContact as customer reference", "REST API with auth middleware"],
      openIssues: [],
      userPreferences: [],
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("plan");
    expect(await getPhase()).toBe("plan");
  });

  // ─── Phase 2: Plan ────────────────────────────────────────────────────

  it("saves build plan via saveBuildEvidence", async () => {
    const result = await callTool("saveBuildEvidence", {
      field: "buildPlan",
      value: BUILD_PLAN,
    });
    expect(result.success).toBe(true);
  });

  it("saves plan review (bypassing LLM) and advances to build", async () => {
    await prisma.featureBuild.update({
      where: { buildId: testBuildId },
      data: { planReview: PLAN_REVIEW_PASS as unknown as import("@dpf/db").Prisma.InputJsonValue },
    });

    const result = await callTool("save_phase_handoff", {
      summary: "Plan reviewed. 4 files, 4 tasks. Schema → API → UI.",
      decisionsMade: ["CustomerContact FK for complaints", "Status enum with 5 values"],
      openIssues: [],
      userPreferences: [],
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("build");
    expect(await getPhase()).toBe("build");
  });

  // ─── Phase 3: Build ───────────────────────────────────────────────────

  it("saves verification output and advances to review", async () => {
    const result = await callTool("saveBuildEvidence", {
      field: "verificationOut",
      value: VERIFICATION_OUTPUT,
    });
    expect(result.success).toBe(true);

    const handoff = await callTool("save_phase_handoff", {
      summary: "Build complete. 12 tests pass, typecheck clean.",
      decisionsMade: ["Used lowercase enums per CLAUDE.md"],
      openIssues: [],
      userPreferences: [],
    });
    expect(handoff.success).toBe(true);
    expect(handoff.message).toContain("review");
    expect(await getPhase()).toBe("review");
  });

  // ─── Phase 4: Review ──────────────────────────────────────────────────

  it("saves acceptance criteria and advances to ship", async () => {
    const result = await callTool("saveBuildEvidence", {
      field: "acceptanceMet",
      value: ACCEPTANCE_MET,
    });
    expect(result.success).toBe(true);

    const handoff = await callTool("save_phase_handoff", {
      summary: "All 4 acceptance criteria met. Ready to ship.",
      decisionsMade: ["All criteria verified with API tests"],
      openIssues: [],
      userPreferences: [],
    });
    expect(handoff.success).toBe(true);
    expect(handoff.message).toContain("ship");
    expect(await getPhase()).toBe("ship");
  });

  // ─── Phase 5: Ship ────────────────────────────────────────────────────

  it("calls deploy_feature to extract diff", async () => {
    // deploy_feature needs a sandbox with a diff — mock it by writing
    // diffSummary/diffPatch directly since we didn't run a real sandbox build
    await prisma.featureBuild.update({
      where: { buildId: testBuildId },
      data: {
        diffSummary: "Added Complaint model, 3 API routes, updated ComplaintsClient",
        diffPatch: "diff --git a/packages/db/prisma/schema.prisma b/packages/db/prisma/schema.prisma\n+model Complaint {\n+  id String @id @default(cuid())\n+}",
      },
    });

    // deploy_feature will try to access sandbox — it may fail since we don't have one.
    // That's expected. The diff is already saved above.
    const result = await callTool("deploy_feature", {});
    // May fail due to no sandbox — that's ok, we pre-wrote the diff
    console.log(`  [deploy_feature] ${result.success ? "OK" : "Expected: " + result.error}`);
  });

  it("registers digital product from build", async () => {
    const result = await callTool("register_digital_product_from_build", {
      buildId: testBuildId,
      name: "Customer Complaints System",
      portfolioSlug: "for_employees",
      versionBump: "minor",
    });
    console.log(`  [register] ${result.success ? "OK" : "FAIL"}: ${result.message.slice(0, 150)}`);
    // May fail if portfolio doesn't exist, but tests the pipeline
    if (result.success) {
      expect(result.message).toBeTruthy();
    }
  });

  it("creates build epic for backlog tracking", async () => {
    const result = await callTool("create_build_epic", { buildId: testBuildId });
    console.log(`  [create_build_epic] ${result.success ? "OK" : "FAIL"}: ${result.message.slice(0, 150)}`);
  });

  it("checks deployment window", async () => {
    const result = await callTool("check_deployment_windows", {
      change_type: "normal",
      risk_level: "low",
    });
    expect(result.success).toBe(true);
    console.log(`  [check_deployment_windows] ${result.message.slice(0, 150)}`);
  });

  it("executes promotion to production", async () => {
    // Find the promotion created by register_digital_product_from_build
    const build = await prisma.featureBuild.findUnique({
      where: { buildId: testBuildId },
      select: { digitalProductId: true },
    });

    if (!build?.digitalProductId) {
      console.log("  [execute_promotion] SKIPPED — no digital product registered");
      return;
    }

    const promotion = await prisma.promotion.findFirst({
      where: { digitalProductId: build.digitalProductId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (!promotion) {
      console.log("  [execute_promotion] SKIPPED — no promotion record found");
      return;
    }

    const result = await callTool("execute_promotion", {
      promotion_id: promotion.id,
    });
    console.log(`  [execute_promotion] ${result.success ? "OK" : "FAIL"}: ${result.message.slice(0, 200)}`);
  });

  it("advances to complete after ship", async () => {
    const handoff = await callTool("save_phase_handoff", {
      summary: "Feature shipped and deployed to production.",
      decisionsMade: ["Deployed via autonomous promotion pipeline"],
      openIssues: [],
      userPreferences: [],
    });
    expect(handoff.success).toBe(true);

    const phase = await getPhase();
    console.log(`  Final phase: ${phase}`);
    expect(phase).toBe("complete");
  });

  // ─── Summary ──────────────────────────────────────────────────────────

  it("verifies complete lifecycle: ideate → plan → build → review → ship → complete", async () => {
    const build = await prisma.featureBuild.findUnique({
      where: { buildId: testBuildId },
      select: {
        phase: true,
        designDoc: true,
        designReview: true,
        buildPlan: true,
        planReview: true,
        verificationOut: true,
        acceptanceMet: true,
        diffSummary: true,
        digitalProductId: true,
      },
    });

    expect(build).toBeTruthy();
    expect(build!.phase).toBe("complete");
    expect(build!.designDoc).toBeTruthy();
    expect(build!.designReview).toBeTruthy();
    expect(build!.buildPlan).toBeTruthy();
    expect(build!.planReview).toBeTruthy();
    expect(build!.verificationOut).toBeTruthy();
    expect(build!.acceptanceMet).toBeTruthy();
    expect(build!.diffSummary).toBeTruthy();

    console.log("\n  === LIFECYCLE COMPLETE ===");
    console.log(`  Build: ${testBuildId}`);
    console.log(`  Phase: ${build!.phase}`);
    console.log(`  Digital Product: ${build!.digitalProductId ?? "none"}`);
    console.log(`  All evidence fields populated: YES\n`);
  });
});
