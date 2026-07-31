// Build-lifecycle tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the core build-execution lifecycle tools out of the mcp-tools.ts
// executeTool switch: initializing the build workspace, kicking off ideate/
// scout research, saving the feature brief, running the verify-phase preflight,
// running UX tests, extracting and deploying the sandbox diff, opening the
// portal PR, and registering the shipped product + epic. Handlers reproduce
// the former switch cases verbatim — same lazy imports, same branches, same
// return shapes — so behaviour is identical over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source. The
// handler implementations live in sibling modules (build-lifecycle-handlers.ts
// and build-ship-handlers.ts) so no single file exceeds the module-size cap;
// they import the shared Build Studio helpers rather than replicating them.

import type { ToolDefinition } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import {
  updateFeatureBrief,
  registerDigitalProductFromBuild,
  createBuildEpic,
  verificationPreflight,
  startBuild,
  runUxTest,
  startIdeateResearch,
  startScoutResearch,
} from "@/lib/mcp/build-lifecycle-handlers";
import {
  deployFeature,
  createPortalPr,
} from "@/lib/mcp/build-ship-handlers";

const definitions: ToolDefinition[] = [
  {
    name: "update_feature_brief",
    description: "Save the Feature Brief for the current build. Build ID is auto-resolved.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Feature title" },
        description: { type: "string", description: "Plain-language feature description" },
        portfolioContext: { type: "string", description: "Portfolio slug that owns this feature. For internal platform/meta work (a change to Build Studio, the portal, or platform tooling itself) pass an empty string rather than forcing a customer-facing portfolio." },
        targetRoles: { type: "array", items: { type: "string" }, description: "Roles that will use this feature. For internal platform/meta work use internal operator roles (e.g. platform operator, admin) — never customer." },
        inputs: { type: "array", items: { type: "string" }, description: "User inputs the feature accepts" },
        dataNeeds: { type: "string", description: "What data the feature stores" },
        acceptanceCriteria: { type: "array", items: { type: "string" }, description: "What done looks like. Every requirement the user stated explicitly (exact formats, examples, behaviors) MUST appear as its own criterion, preserved faithfully — never substitute a different format or behavior for one the user specified." },
        fixContext: {
          type: "object",
          description: "For fix builds (kind=fix): the defect diagnosis. reproSteps, rootCause, and fixApproach are all required before a fix build can advance to plan. Merged into any existing fixContext, so partial updates accumulate.",
          properties: {
            reproSteps: { type: "string", description: "How to reproduce the defect" },
            expected: { type: "string", description: "Expected behavior" },
            actual: { type: "string", description: "Actual (buggy) behavior" },
            rootCause: { type: "string", description: "Identified root cause (file/function + why)" },
            fixApproach: { type: "string", description: "Smallest correct fix + regression test" },
            severity: { type: "string" },
          },
        },
      },
      required: ["title", "description", "portfolioContext", "targetRoles", "dataNeeds", "acceptanceCriteria"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate"],
  },
  {
    name: "register_digital_product_from_build",
    description: "Register or update a DigitalProduct from the current build. Build ID is auto-resolved. Requires approval.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Product name" },
        portfolioSlug: { type: "string", description: "Portfolio slug to assign to" },
      },
      required: ["name", "portfolioSlug"],
    },
    requiredCapability: "manage_capabilities",
    sideEffect: true,
    buildPhases: ["ship"],
  },
  {
    name: "create_build_epic",
    description: "Create an Epic and backlog items for a shipped build. All IDs are auto-resolved.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Epic title" },
      },
      required: ["title"],
    },
    requiredCapability: "manage_capabilities",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ship"],
  },
  {
    name: "verification_preflight",
    description: "Deterministic verify-phase preflight. Returns MUST_ADVANCE (evidence already sufficient — do not re-test), BLOCKED (a prerequisite is missing — report it, do not fabricate a result), or CAN_TEST (proceed to functional verification). Call this BEFORE attempting verification so testability is a procedural verdict, not a judgment call.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["build", "review"],
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "start_build",
    description: "Initialize the build workspace. Call this ONCE at the start of the build phase. Verifies the sandbox container is running and creates a git branch for this build. If it returns 'not running', call diagnose_sandbox and use the returned recovery actions.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build. Supply it to drive a specific build when several builds are in-flight (e.g. an autonomous batch)." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["build"],
  },
  {
    name: "deploy_feature",
    description: "Extract the git diff from sandbox and deploy to the platform.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "manage_capabilities",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ship"],
  },
  {
    name: "create_portal_pr",
    description: "Publish a recoverable branch, validate its exact commit with the canonical PR-readiness contract, and create a pull request only when every build and repository gate passes. A blocked result returns the branch, commit, and actionable blockers without opening a PR.",
    inputSchema: {
      type: "object",
      properties: {
        readinessTrailers: {
          type: "string",
          description: "Reviewed PR decision trailers from the injected gate context, one per line. Pass only applicable trailers with final values.",
        },
      },
    },
    requiredCapability: "manage_capabilities",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ship"],
  },
  {
    name: "run_ux_test",
    description: "Run natural-language UX test cases against the sandbox using AI-powered browser automation (browser-use). Each test case is a plain English assertion that the AI agent verifies by driving a real browser. Returns structured pass/fail results with screenshots. NOTE: UX verification runs automatically on review-phase entry via build/review.verify — this tool is retained for ad-hoc manual invocations only and is not in the review phase's tool allowlist.",
    inputSchema: {
      type: "object",
      properties: {
        tests: {
          type: "array",
          items: { type: "string" },
          description: "Natural-language test assertions. If omitted, auto-generates from acceptance criteria.",
        },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    // Empty buildPhases — the Inngest handler owns UX verification during
    // review; leaving this in the review allowlist leads to duplicate runs.
    // Kept callable outside a build phase for Dev-mode / debugging use.
    buildPhases: [],
  },
  {
    name: "start_ideate_research",
    description: "Signal that you have enough context from the user to begin codebase research and draft the design document. Call this AFTER the user answers your questions (intent gate, reusability scope). The system will search the codebase, analyze patterns, and draft the design doc automatically. You do NOT need to call search_project_files or read_project_file yourself — this tool handles all research.",
    inputSchema: {
      type: "object",
      properties: {
        reusabilityScope: { type: "string", enum: ["one_off", "parameterizable", "already_generic"], description: "The user's reusability preference" },
        userContext: { type: "string", description: "Summary of what the user wants, including any answers to clarifying questions" },
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build (the ambient ideate conversation). Supply it to drive a specific build's research when several builds are in-flight (e.g. an autonomous 20-build batch)." },
      },
      required: ["reusabilityScope", "userContext"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate"],
  },
  {
    name: "start_scout_research",
    description: "Start a fast codebase scout + URL parse before asking clarification questions. Call this immediately after the user describes their feature. Returns immediately — results appear in Build Studio Context on the next turn.",
    inputSchema: {
      type: "object",
      properties: {
        externalUrls: {
          type: "array",
          items: { type: "string" },
          description: "Any URLs the user mentioned (website, design doc, reference). Will be fetched and parsed for domain structure.",
        },
      },
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate"],
  },
];


const handlers: Record<string, ToolPackHandler> = {
  update_feature_brief: (params, userId) => updateFeatureBrief(params, userId),
  register_digital_product_from_build: (params, userId) => registerDigitalProductFromBuild(params, userId),
  create_build_epic: (params, userId) => createBuildEpic(params, userId),
  verification_preflight: (params, userId) => verificationPreflight(params, userId),
  start_build: (params, userId, context) => startBuild(params, userId, context),
  deploy_feature: (params, userId) => deployFeature(params, userId),
  create_portal_pr: (params, userId) => createPortalPr(params, userId),
  run_ux_test: (params, userId, context) => runUxTest(params, userId, context),
  start_ideate_research: (params, userId, context) => startIdeateResearch(params, userId, context),
  start_scout_research: (params, userId, context) => startScoutResearch(params, userId, context),
};

export const buildLifecyclePack: ToolPack = {
  packId: "build-lifecycle",
  definitions,
  handlers,
  grants: {
    update_feature_brief: ["backlog_write"],
    register_digital_product_from_build: ["registry_read", "backlog_write"],
    create_build_epic: ["backlog_write"],
    verification_preflight: ["build_plan_write"],
    start_build: ["sandbox_execute"],
    deploy_feature: ["iac_execute"],
    create_portal_pr: ["sandbox_execute"],
    run_ux_test: ["file_read"],
    start_ideate_research: ["sandbox_execute", "file_read"],
    start_scout_research: ["sandbox_execute", "file_read", "web_search"],
  },
};
