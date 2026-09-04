// apps/web/lib/prompt-assembler.test.ts
// TDD RED → GREEN tests for the composable system prompt assembler.

import { describe, expect, it, vi } from "vitest";
import { assembleSystemPrompt, assembleSystemPromptWithProvenance } from "./prompt-assembler";
import type { PromptInput } from "./prompt-assembler";

vi.mock("./prompt-loader", () => ({
  loadPrompts: vi.fn(async (refs: Array<{ category: string; slug: string; fallback?: string }>) => {
    return new Map(refs.map((ref) => [`${ref.category}/${ref.slug}`, ref.fallback ?? ""]));
  }),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const fullInput: PromptInput = {
  hrRole: "HR-100",
  grantedCapabilities: ["view_portfolio", "view_inventory", "manage_backlog"],
  deniedCapabilities: ["manage_users", "manage_provider_connections"],
  mode: "act",
  sensitivity: "internal",
  domainContext: "The user is viewing the portfolio tree with 4 root nodes.",
  domainTools: ["search_products", "create_backlog_item"],
  routeData: '{"portfolioId":"p-123","nodeName":"Foundational"}',
  attachmentContext: "Attached file: quarterly-report.pdf (3 pages)",
};

const minimalInput: PromptInput = {
  hrRole: "HR-300",
  grantedCapabilities: ["view_portfolio"],
  deniedCapabilities: [],
  mode: "advise",
  sensitivity: "public",
  domainContext: "General workspace view.",
  domainTools: [],
  routeData: null,
  attachmentContext: null,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the index of a substring within a string, or -1 if not found. */
function indexOf(haystack: string, needle: string): number {
  return haystack.indexOf(needle);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("assembleSystemPrompt", () => {
  // Test 1: All 7 blocks appear in correct order
  it("places all blocks in correct order: identity → mode → authority → sensitivity → domain → route → attachments", async () => {
    const prompt = await assembleSystemPrompt(fullInput);

    const identityIdx = indexOf(prompt, "digital product management");
    const modeIdx = indexOf(prompt, "Mode: ACT");
    const authorityIdx = indexOf(prompt, "HR-100");
    const sensitivityIdx = indexOf(prompt, "classified INTERNAL");
    const domainIdx = indexOf(prompt, "portfolio tree");
    const routeIdx = indexOf(prompt, "--- PAGE DATA ---");
    const attachIdx = indexOf(prompt, "quarterly-report.pdf");

    // All blocks must be present
    expect(identityIdx).toBeGreaterThanOrEqual(0);
    expect(modeIdx).toBeGreaterThanOrEqual(0);
    expect(authorityIdx).toBeGreaterThanOrEqual(0);
    expect(sensitivityIdx).toBeGreaterThanOrEqual(0);
    expect(domainIdx).toBeGreaterThanOrEqual(0);
    expect(routeIdx).toBeGreaterThanOrEqual(0);
    expect(attachIdx).toBeGreaterThanOrEqual(0);

    // Strict ordering: static blocks (identity, mode) then dynamic (authority, sensitivity, domain, route, attach)
    expect(identityIdx).toBeLessThan(modeIdx);
    expect(modeIdx).toBeLessThan(authorityIdx);
    expect(authorityIdx).toBeLessThan(sensitivityIdx);
    expect(sensitivityIdx).toBeLessThan(domainIdx);
    expect(domainIdx).toBeLessThan(routeIdx);
    expect(routeIdx).toBeLessThan(attachIdx);
  });

  // BI-15FE2F07 (working-memory Slice 2): pre-rendered working notes land in
  // Block 5 (domain), after wiki recall and before route data.
  it("injects working notes into Block 5 when present", async () => {
    const notes = "\nYOUR WORKING NOTES:\n- [technique] retry-flow: escalate after 2 failures";
    const prompt = await assembleSystemPrompt({ ...fullInput, wikiContext: "WIKI CONTEXT HERE", workingNotes: notes });

    const wikiIdx = indexOf(prompt, "WIKI CONTEXT HERE");
    const notesIdx = indexOf(prompt, "YOUR WORKING NOTES:");
    const routeIdx = indexOf(prompt, "--- PAGE DATA ---");
    expect(notesIdx).toBeGreaterThanOrEqual(0);
    expect(wikiIdx).toBeLessThan(notesIdx); // below wiki recall
    expect(notesIdx).toBeLessThan(routeIdx); // still within Block 5, before route data
  });

  it("is a strict no-op when workingNotes is null or omitted", async () => {
    const withNull = await assembleSystemPrompt({ ...minimalInput, workingNotes: null });
    const without = await assembleSystemPrompt(minimalInput);
    expect(withNull).not.toContain("YOUR WORKING NOTES:");
    // Omitting the field produces the identical prompt as passing null.
    expect(withNull).toBe(without);
  });

  // BI-45514C4E: extra context sections (form-assist / Build Studio) append
  // after attachments (Block 8), so the unified path reaches legacy parity.
  it("appends extraSections after attachments when present", async () => {
    const prompt = await assembleSystemPrompt({
      ...fullInput,
      extraSections: ["--- BUILD STUDIO CONTEXT ---\nPhase: ideate", "FORM ASSIST INSTRUCTION"],
    });
    const attachIdx = indexOf(prompt, "quarterly-report.pdf");
    const buildIdx = indexOf(prompt, "BUILD STUDIO CONTEXT");
    const formIdx = indexOf(prompt, "FORM ASSIST INSTRUCTION");
    expect(buildIdx).toBeGreaterThan(attachIdx);
    expect(formIdx).toBeGreaterThan(buildIdx);
  });

  it("is a strict no-op when extraSections is empty or omitted", async () => {
    const withEmpty = await assembleSystemPrompt({ ...minimalInput, extraSections: [] });
    const without = await assembleSystemPrompt(minimalInput);
    expect(withEmpty).toBe(without);
  });

  it("skips empty-string entries in extraSections", async () => {
    const prompt = await assembleSystemPrompt({ ...minimalInput, extraSections: ["", "REAL SECTION", ""] });
    expect(prompt).toContain("REAL SECTION");
    expect(prompt).not.toContain("\n\n\n\n"); // no blank-section padding
  });

  // Test 2: Advise mode text is injected correctly
  it("injects advise mode text when mode is 'advise'", async () => {
    const prompt = await assembleSystemPrompt(minimalInput);

    expect(prompt).toContain("Mode: ADVISE");
    expect(prompt).toContain("You may read, search, analyze, and recommend");
    expect(prompt).toContain("You must not create, update, or delete anything");
    expect(prompt).toContain("suggest switching to Act mode");
    expect(prompt).not.toContain("Mode: ACT");
  });

  // Test 2b: Decision-routing governance block is present, positioned between
  // identity and mode (static, cacheable), and carries the WWMD/WWWD/WSID
  // routing contract. Regression guard for the coworker decision-routing gap.
  it("injects the decision-routing governance block between identity and mode", async () => {
    const prompt = await assembleSystemPrompt(fullInput);

    expect(prompt).toContain("DECISION ROUTING — CONSULT GOVERNANCE BEFORE YOU PROPOSE OR ASK.");
    // The three surfaces must all be named so the coworker can route.
    expect(prompt).toContain("principle_decide"); // WWMD / founder kernel
    expect(prompt).toContain("what would WE do"); // WWWD / org stance
    expect(prompt).toContain("competent-professional answer for your discipline"); // WSID / craft
    // Non-inherit boundary: platform doctrine is advisory to a business call.
    expect(prompt).toContain("platform doctrine is advisory to a business decision, not binding");

    const identityIdx = indexOf(prompt, "digital product management");
    const routingIdx = indexOf(prompt, "DECISION ROUTING —");
    const modeIdx = indexOf(prompt, "Mode: ACT");
    expect(identityIdx).toBeGreaterThanOrEqual(0);
    expect(identityIdx).toBeLessThan(routingIdx);
    expect(routingIdx).toBeLessThan(modeIdx);
  });

  // Test 2b: The limitation-response contract sits between decision-routing and
  // mode, and instructs the coworker to propose the enabler + ask one yes/no
  // rather than dead-ending or deflecting. Regression guard for the "AI Ops
  // Engineer could only summarize / punted to System Admin" failure mode.
  it("injects the limitation-response contract between decision-routing and mode", async () => {
    const prompt = await assembleSystemPrompt(fullInput);

    expect(prompt).toContain("WHEN YOU HIT A LIMITATION — PROPOSE THE ENABLER, NEVER DEAD-END.");
    // The anti-dead-end + anti-deflect stance must be explicit.
    expect(prompt).toContain("ask an administrator");
    expect(prompt).toContain("single yes/no go-ahead");

    const routingIdx = indexOf(prompt, "DECISION ROUTING —");
    const limitationIdx = indexOf(prompt, "WHEN YOU HIT A LIMITATION —");
    const modeIdx = indexOf(prompt, "Mode: ACT");
    expect(routingIdx).toBeGreaterThanOrEqual(0);
    expect(routingIdx).toBeLessThan(limitationIdx);
    expect(limitationIdx).toBeLessThan(modeIdx);
  });

  // Test 3: Act mode text is injected correctly
  it("injects act mode text when mode is 'act'", async () => {
    const prompt = await assembleSystemPrompt(fullInput);

    expect(prompt).toContain("Mode: ACT");
    expect(prompt).toContain("You may execute any tool the employee's role authorizes");
    expect(prompt).toContain("All actions are logged");
    expect(prompt).toContain("Prefer the most direct path");
    expect(prompt).toContain("the employee chose Act mode because they trust you to act");
    expect(prompt).not.toContain("Mode: ADVISE");
  });

  // Test 4: Granted and denied capabilities are listed
  it("lists granted and denied capabilities in the authority block", async () => {
    const prompt = await assembleSystemPrompt(fullInput);

    expect(prompt).toContain("view_portfolio");
    expect(prompt).toContain("view_inventory");
    expect(prompt).toContain("manage_backlog");
    expect(prompt).toContain("manage_users");
    expect(prompt).toContain("manage_provider_connections");
    // Authority framing
    expect(prompt).toContain("authorized to:");
    expect(prompt).toContain("NOT authorized to:");
    expect(prompt).toContain("Never exceed it");
  });

  // Test 5: Sensitivity level is capitalized and present
  it("includes sensitivity level capitalized in the sensitivity block", async () => {
    const prompt = await assembleSystemPrompt(fullInput);
    expect(prompt).toContain("classified INTERNAL");

    const restrictedInput: PromptInput = {
      ...fullInput,
      sensitivity: "restricted",
    };
    const restrictedPrompt = await assembleSystemPrompt(restrictedInput);
    expect(restrictedPrompt).toContain("classified RESTRICTED");

    const confidentialInput: PromptInput = {
      ...fullInput,
      sensitivity: "confidential",
    };
    const confidentialPrompt = await assembleSystemPrompt(confidentialInput);
    expect(confidentialPrompt).toContain("classified CONFIDENTIAL");
  });

  // Test 6: Domain tools are listed
  it("lists domain tools in the domain context block", async () => {
    const prompt = await assembleSystemPrompt(fullInput);

    expect(prompt).toContain("Available domain tools:");
    expect(prompt).toContain("search_products");
    expect(prompt).toContain("create_backlog_item");
  });

  // Test 7: PLATFORM_PREAMBLE behavioral rules are present
  it("includes PLATFORM_PREAMBLE behavioral rules in the identity block", async () => {
    const prompt = await assembleSystemPrompt(fullInput);

    expect(prompt).toContain("NEVER claim you did something");
    expect(prompt).toContain("approval card IS");
    expect(prompt).toContain("propose_improvement");
    expect(prompt).toContain("OPERATING PRINCIPLES");
  });

  // Test 8: Route data block omitted when null
  it("omits route data block when routeData is null", async () => {
    const prompt = await assembleSystemPrompt(minimalInput);

    expect(prompt).not.toContain("--- PAGE DATA ---");
  });

  // Test 9: Route data block included when present
  it("includes route data block when routeData is present", async () => {
    const prompt = await assembleSystemPrompt(fullInput);

    expect(prompt).toContain("--- PAGE DATA ---");
    expect(prompt).toContain("portfolioId");
    expect(prompt).toContain("p-123");
  });

  // Test 10: Attachment block included when present
  it("includes attachment block when attachmentContext is present", async () => {
    const prompt = await assembleSystemPrompt(fullInput);

    expect(prompt).toContain("quarterly-report.pdf");
    expect(prompt).toContain("3 pages");
  });

  // Additional: attachment block omitted when null
  it("omits attachment block when attachmentContext is null", async () => {
    const prompt = await assembleSystemPrompt(minimalInput);

    // The minimal input has no attachment context, so no attachment content should appear
    expect(prompt).not.toContain("quarterly-report.pdf");
  });

  // Additional: domain tools omitted when empty
  it("omits domain tools line when domainTools is empty", async () => {
    const prompt = await assembleSystemPrompt(minimalInput);

    expect(prompt).not.toContain("Available domain tools:");
  });

  // Additional: empty denied capabilities handled gracefully
  it("handles empty denied capabilities list", async () => {
    const prompt = await assembleSystemPrompt(minimalInput);

    // Should still have the authority block with the role
    expect(prompt).toContain("HR-300");
    expect(prompt).toContain("authorized to:");
  });

  // EP-SELF-DEV-002: Anti-fabrication rule (rule 15)
  it("includes anti-fabrication rule (rule 15)", async () => {
    const prompt = await assembleSystemPrompt(fullInput);
    expect(prompt).toContain("NEVER claim you did something you didn't do");
  });

  // EP-SELF-DEV-002: Evidence-first action rule
  it("includes evidence-first action rule", async () => {
    const prompt = await assembleSystemPrompt(fullInput);
    expect(prompt).toContain(
      "start with the most relevant evidence-gathering or action tool",
    );
  });

  it("includes calm under pressure and anti-reward-hacking guidance", async () => {
    const prompt = await assembleSystemPrompt(fullInput);
    expect(prompt).toContain("Stay calm under pressure");
    expect(prompt).toContain(
      "Do NOT game tests, acceptance criteria, approval flows, or tooling",
    );
  });

  it("guides coworkers to query the tool marketplace for unavailable tools", async () => {
    const prompt = await assembleSystemPrompt(fullInput);
    expect(prompt).toContain("TOOL MARKETPLACE");
    expect(prompt).toContain("search_tool_marketplace");
    expect(prompt).toContain("unconfigured");
    expect(prompt).toContain("ungranted");
  });

  it("directs coworkers to quietly advance the next logical step from context", async () => {
    const prompt = await assembleSystemPrompt(fullInput);

    expect(prompt).toContain("NEXT LOGICAL STEP");
    expect(prompt).toContain("overall thread direction");
    expect(prompt).toContain("one concrete next move");
    expect(prompt).toContain("Do not turn this into a sales pitch");
  });

  it("includes the cross-surface interaction closeout contract", async () => {
    const prompt = await assembleSystemPrompt(fullInput);

    expect(prompt).toContain("COWORKER INTERACTION CONTRACT");
    expect(prompt).toContain("Status:");
    expect(prompt).toContain("Evidence:");
    expect(prompt).toContain("Next action:");
    expect(prompt).toContain("Owner:");
    expect(prompt).toContain("Never ask the human to run terminal commands");
  });

  // ─── EP-WIKI-001 §7: wikiContext injection in Block 5 ─────────────────────

  it("omits the wiki block when wikiContext is null or undefined", async () => {
    const prompt = await assembleSystemPrompt(fullInput);
    expect(prompt).not.toContain("RELEVANT WIKI CONTEXT");
  });

  it("renders wikiContext inside Block 5, after domainContext and before domain tools", async () => {
    const wikiBlock =
      "RELEVANT WIKI CONTEXT:\n- entities/digital-product (entity, kernel) — A digital product is...";
    const prompt = await assembleSystemPrompt({ ...fullInput, wikiContext: wikiBlock });

    const domainIdx = indexOf(prompt, "portfolio tree");
    const wikiIdx = indexOf(prompt, "RELEVANT WIKI CONTEXT");
    const toolsIdx = indexOf(prompt, "Available domain tools");

    expect(domainIdx).toBeGreaterThanOrEqual(0);
    expect(wikiIdx).toBeGreaterThanOrEqual(0);
    expect(toolsIdx).toBeGreaterThanOrEqual(0);
    expect(domainIdx).toBeLessThan(wikiIdx);
    expect(wikiIdx).toBeLessThan(toolsIdx);
  });

  it("places wikiContext on the dynamic side of the cache boundary", async () => {
    const wikiBlock = "RELEVANT WIKI CONTEXT:\n- stances/x (stance, kernel) — body";
    const prompt = await assembleSystemPrompt({ ...minimalInput, wikiContext: wikiBlock });
    const boundaryIdx = indexOf(prompt, "DYNAMIC_BOUNDARY");
    const wikiIdx = indexOf(prompt, "RELEVANT WIKI CONTEXT");
    expect(boundaryIdx).toBeGreaterThanOrEqual(0);
    expect(boundaryIdx).toBeLessThan(wikiIdx);
  });

  // ─── WSID Phase 3: professionContext injection in Block 5 ──────────────────

  it("omits the profession corpus block when professionContext is null or undefined", async () => {
    const prompt = await assembleSystemPrompt(fullInput);
    expect(prompt).not.toContain("PROFESSION CORPUS");
  });

  it("renders professionContext in Block 5 ABOVE generic wiki recall (corpus outranks wiki)", async () => {
    const professionBlock =
      "PROFESSION CORPUS — Software Engineer (your professional knowledge base; cite pages by their slug):";
    const wikiBlock = "RELEVANT WIKI CONTEXT:\n- entities/x (entity, kernel) — body";
    const prompt = await assembleSystemPrompt({
      ...fullInput,
      professionContext: professionBlock,
      wikiContext: wikiBlock,
    });

    const domainIdx = indexOf(prompt, "portfolio tree");
    const professionIdx = indexOf(prompt, "PROFESSION CORPUS");
    const wikiIdx = indexOf(prompt, "RELEVANT WIKI CONTEXT");
    const toolsIdx = indexOf(prompt, "Available domain tools");

    expect(domainIdx).toBeGreaterThanOrEqual(0);
    expect(professionIdx).toBeGreaterThanOrEqual(0);
    expect(wikiIdx).toBeGreaterThanOrEqual(0);
    // domain context → profession corpus → generic wiki recall → domain tools
    expect(domainIdx).toBeLessThan(professionIdx);
    expect(professionIdx).toBeLessThan(wikiIdx);
    expect(wikiIdx).toBeLessThan(toolsIdx);
  });

  it("places professionContext on the dynamic side of the cache boundary", async () => {
    const prompt = await assembleSystemPrompt({
      ...minimalInput,
      professionContext: "PROFESSION CORPUS — QA Engineer: ...",
    });
    const boundaryIdx = indexOf(prompt, "DYNAMIC_BOUNDARY");
    const professionIdx = indexOf(prompt, "PROFESSION CORPUS");
    expect(boundaryIdx).toBeGreaterThanOrEqual(0);
    expect(boundaryIdx).toBeLessThan(professionIdx);
  });

  // ─── Block 5 governed Hermes learning Slice 1: coworker skills ──────────────

  it("renders an Available coworker skills block when skills are supplied", async () => {
    const prompt = await assembleSystemPrompt({
      ...minimalInput,
      skills: [
        { skillId: "build-page", label: "Build a Page", description: "Scaffold a new route page." },
        { skillId: "review-pr", label: "Review PR", description: "Walk a PR diff." },
      ],
    });
    expect(prompt).toContain("Available coworker skills:");
    expect(prompt).toContain("- build-page: Build a Page - Scaffold a new route page.");
    expect(prompt).toContain("- review-pr: Review PR - Walk a PR diff.");
  });

  it("omits the skills block when no skills are supplied", async () => {
    const prompt = await assembleSystemPrompt(minimalInput);
    expect(prompt).not.toContain("Available coworker skills:");
  });

  it("omits the skills block when an empty skills array is supplied", async () => {
    const prompt = await assembleSystemPrompt({ ...minimalInput, skills: [] });
    expect(prompt).not.toContain("Available coworker skills:");
  });

  it("places the skills block on the dynamic side of the cache boundary, after domain tools", async () => {
    const prompt = await assembleSystemPrompt({
      ...fullInput,
      skills: [{ skillId: "x", label: "X", description: "Does X." }],
    });
    const boundaryIdx = indexOf(prompt, "DYNAMIC_BOUNDARY");
    const toolsIdx = indexOf(prompt, "Available domain tools");
    const skillsIdx = indexOf(prompt, "Available coworker skills");
    expect(boundaryIdx).toBeLessThan(skillsIdx);
    expect(toolsIdx).toBeLessThan(skillsIdx);
  });

  it("leaves existing domain tools behavior unchanged when skills are also present", async () => {
    const prompt = await assembleSystemPrompt({
      ...fullInput,
      skills: [{ skillId: "x", label: "X", description: "Does X." }],
    });
    expect(prompt).toContain("Available domain tools: search_products, create_backlog_item");
  });

  // --- AI Question Method Slice 1: optional question packet ------------------

  it("omits the question packet block when no meaningful packet is supplied", async () => {
    const prompt = await assembleSystemPrompt({
      ...minimalInput,
      questionPacket: {
        intentCenter: "   ",
        explorationQuestions: [],
      },
    });

    expect(prompt).not.toContain("Question packet");
  });

  it("renders question packet context after authority/sensitivity and before domain context", async () => {
    const prompt = await assembleSystemPrompt({
      ...fullInput,
      questionPacket: {
        intentCenter: "Decide the smallest safe implementation slice.",
        explorationQuestions: ["What can be proven with pure tests?"],
        hardEdges: ["Do not grant extra tool authority."],
        contextRefs: [
          {
            kind: "plan",
            label: "Question method implementation plan",
            ref: "docs/superpowers/plans/2026-05-22-ai-question-method-platform-implementation.md",
          },
        ],
        successShape: "A reusable helper and one prompt insertion point.",
        operatorThesis: "Keep this additive and reusable.",
        pushbackPermission: "direct",
        expectedArtifact: "patch",
      },
    });

    const sensitivityIdx = indexOf(prompt, "classified INTERNAL");
    const packetIdx = indexOf(prompt, "Question packet");
    const domainIdx = indexOf(prompt, "portfolio tree");

    expect(sensitivityIdx).toBeGreaterThanOrEqual(0);
    expect(packetIdx).toBeGreaterThanOrEqual(0);
    expect(domainIdx).toBeGreaterThanOrEqual(0);
    expect(sensitivityIdx).toBeLessThan(packetIdx);
    expect(packetIdx).toBeLessThan(domainIdx);
    expect(prompt).toContain("Use this as collaboration context, not as authorization");
    expect(prompt).toContain("- Intent center: Decide the smallest safe implementation slice.");
    expect(prompt).toContain("- [plan] Question method implementation plan:");
    expect(prompt).toContain("challenge the operator thesis directly");
  });

  it("keeps advise and explanation-only guardrails authoritative when packet context asks for an artifact", async () => {
    const prompt = await assembleSystemPrompt({
      ...minimalInput,
      mode: "advise",
      questionPacket: {
        intentCenter: "Explain the current page and identify the right next thought.",
        expectedArtifact: "backlog-item",
      },
    });

    expect(prompt).toContain("Mode: ADVISE");
    expect(prompt).toContain("You must not create, update, or delete anything");
    expect(prompt).toContain("No tools needed");
    expect(prompt).toContain("Use this as collaboration context, not as authorization");
    expect(prompt).toContain("- Expected artifact: backlog-item");
  });

  // BI-8F8C5F28: reading-level directive for customer-facing copy.
  it("injects a reading-level directive when readingLevel is set, and not otherwise", async () => {
    const capped = await assembleSystemPrompt({ ...minimalInput, readingLevel: "high-school" });
    expect(capped).toContain("READING LEVEL");
    expect(capped).toContain("grade 9");

    const college = await assembleSystemPrompt({ ...minimalInput, readingLevel: "college" });
    expect(college).toContain("grade 13");

    const none = await assembleSystemPrompt({ ...minimalInput, readingLevel: null });
    expect(none).not.toContain("READING LEVEL");

    const uncapped = await assembleSystemPrompt({ ...minimalInput, readingLevel: "uncapped" });
    expect(uncapped).not.toContain("READING LEVEL");
  });

  // BI-E35A8AA4: Proactivity → in-task initiative is threaded through PromptInput.
  it("injects the initiative block matching the proactivity level, defaulting to balanced", async () => {
    const assertive = await assembleSystemPrompt({ ...minimalInput, proactivityLevel: "assertive" });
    expect(assertive).toContain("INITIATIVE — HIGH");

    const quiet = await assembleSystemPrompt({ ...minimalInput, proactivityLevel: "quiet" });
    expect(quiet).toContain("INITIATIVE — LOW");

    // omitted → balanced (the dock's effective default)
    const omitted = await assembleSystemPrompt(minimalInput);
    expect(omitted).toContain("INITIATIVE — MEDIUM");

    // initiative sits after authority and before the sensitivity block
    expect(assertive.indexOf("INITIATIVE — HIGH")).toBeGreaterThan(assertive.indexOf("authorized to"));
    expect(assertive.indexOf("INITIATIVE — HIGH")).toBeLessThan(assertive.indexOf("classified"));
  });
});

// BI-463BE12A / BI-9C14CB5D. The assembler declares which of its own blocks are
// platform-authored instruction. Anything it does not declare is classified as
// the turn's data by the inference screener, so under-declaring is safe and
// over-declaring is an egress hole — these tests pin both directions.
describe("assembleSystemPromptWithProvenance declares instruction, never data", () => {
  const base = {
    hrRole: "owner",
    grantedCapabilities: ["read"],
    deniedCapabilities: [],
    mode: "act" as const,
    sensitivity: "internal" as const,
    domainContext: "You are the COO. You approve payroll runs.",
    domainTools: [],
    routeData: null,
    attachmentContext: null,
  };

  it("declares its static contract blocks", async () => {
    const assembled = await assembleSystemPromptWithProvenance(base);

    expect(assembled.instructionSpans.length).toBeGreaterThan(0);
    for (const span of assembled.instructionSpans) {
      expect(assembled.text).toContain(span);
    }
  });

  it("does NOT declare retrieved context as instruction", async () => {
    const assembled = await assembleSystemPromptWithProvenance({
      ...base,
      wikiContext: "WIKI: Dana Whitfield earns 125000.",
      workingNotes: "NOTES: invoice 88213 is overdue.",
      professionContext: "CORPUS: payroll practice.",
      routeData: "PAGE: salary 125000",
      attachmentContext: "ATTACHMENT: payroll register",
      extraSections: ["EXTRA: bank account 021000021"],
    });

    const declared = assembled.instructionSpans.join("\n");
    for (const leak of ["WIKI:", "NOTES:", "CORPUS:", "PAGE:", "ATTACHMENT:", "EXTRA:"]) {
      expect(declared).not.toContain(leak);
    }
  });

  it("does NOT declare the caller's domainContext on its own initiative", async () => {
    // domainContext arrives as one string that may concatenate the persona with
    // retrieved knowledge and semantic memory. Only the caller can split it, so
    // the assembler must wait to be told rather than guess.
    const assembled = await assembleSystemPromptWithProvenance(base);

    expect(assembled.instructionSpans.join("\n")).not.toContain("You approve payroll runs");
  });

  it("passes through spans the caller declares", async () => {
    const persona = "You are the COO. You approve payroll runs.";
    const assembled = await assembleSystemPromptWithProvenance({
      ...base,
      instructionSpans: [persona],
    });

    expect(assembled.instructionSpans).toContain(persona);
  });

  it("keeps assembleSystemPrompt returning the same text", async () => {
    const [text, assembled] = await Promise.all([
      assembleSystemPrompt(base),
      assembleSystemPromptWithProvenance(base),
    ]);

    expect(text).toBe(assembled.text);
  });
});
