/**
 * TAK Architecture Document Generator
 *
 * Renders Mermaid diagrams to PNG and assembles a professional
 * Word document (.docx) with embedded diagrams, styled tables,
 * and proper heading hierarchy.
 *
 * Usage:  node docs/architecture/generate-tak-docx.mjs
 * Output: docs/architecture/Trusted-AI-Kernel-Architecture.docx
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  WidthType,
  AlignmentType,
  BorderStyle,
  ShadingType,
  PageBreak,
  TableOfContents,
  StyleLevel,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
  Tab,
  TabStopType,
  TabStopPosition,
  ExternalHyperlink,
  convertInchesToTwip,
} from "docx";

// ── Paths ──────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, "..", "..");
const ARCH_DIR = resolve(import.meta.dirname);
const DIAGRAMS_DIR = join(ARCH_DIR, "tak-diagrams");
const PNG_DIR = join(DIAGRAMS_DIR, "png");
const OUTPUT = join(ARCH_DIR, "Trusted-AI-Kernel-Architecture.docx");

// ── Colours ────────────────────────────────────────────────────────

const NAVY = "1e3a5f";
const DARK_BLUE = "0d47a1";
const MID_BLUE = "1565c0";
const LIGHT_BLUE = "e8f0fe";
const WHITE = "ffffff";
const LIGHT_GRAY = "f5f5f5";
const DARK_GRAY = "333333";
const ACCENT_GREEN = "2e7d32";
const ACCENT_ORANGE = "f57f17";
const ACCENT_RED = "c62828";

// ── Step 1: Render Mermaid diagrams to PNG ─────────────────────────

function findChrome() {
  // Look in the standard Puppeteer cache for a Chrome install
  const cacheDir = join(homedir(), ".cache", "puppeteer", "chrome");
  if (!existsSync(cacheDir)) return null;
  const versions = readdirSync(cacheDir).filter((d) => d.startsWith("win64-"));
  if (versions.length === 0) return null;
  versions.sort().reverse(); // newest first
  const exe = join(cacheDir, versions[0], "chrome-win64", "chrome.exe");
  return existsSync(exe) ? exe : null;
}

function renderDiagrams() {
  if (!existsSync(PNG_DIR)) mkdirSync(PNG_DIR, { recursive: true });

  const chromePath = findChrome();
  const env = { ...process.env };
  if (chromePath) {
    env.PUPPETEER_EXECUTABLE_PATH = chromePath;
    console.log(`Using Chrome: ${chromePath}`);
  }

  const mmdFiles = readdirSync(DIAGRAMS_DIR).filter((f) => f.endsWith(".mmd"));
  console.log(`Rendering ${mmdFiles.length} Mermaid diagrams...`);

  for (const file of mmdFiles) {
    const input = join(DIAGRAMS_DIR, file);
    const output = join(PNG_DIR, file.replace(".mmd", ".png"));
    console.log(`  ${file} -> png`);
    try {
      execSync(
        `pnpm exec mmdc -i "${input}" -o "${output}" -t neutral -b white -w 1200 -s 2`,
        { cwd: ROOT, stdio: "pipe", timeout: 60_000, env },
      );
    } catch (err) {
      console.error(`  WARN: Failed to render ${file}: ${err.stderr?.toString().split("\n")[0] || err.message}`);
    }
  }
  console.log("Diagrams rendered.\n");
}

// ── Helpers ────────────────────────────────────────────────────────

function loadPng(name) {
  const p = join(PNG_DIR, name);
  if (!existsSync(p)) return null;
  return readFileSync(p);
}

function heading(level, text) {
  const map = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
  };
  return new Paragraph({
    heading: map[level] || HeadingLevel.HEADING_2,
    spacing: { before: level === 1 ? 400 : 240, after: 120 },
    children: [new TextRun({ text, bold: true, font: "Segoe UI", size: level === 1 ? 36 : level === 2 ? 28 : level === 3 ? 24 : 22, color: NAVY })],
  });
}

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    alignment: opts.align || AlignmentType.LEFT,
    children: [new TextRun({ text, font: "Segoe UI", size: 21, color: DARK_GRAY, ...opts })],
  });
}

function bold(text) {
  return new TextRun({ text, bold: true, font: "Segoe UI", size: 21, color: DARK_GRAY });
}

function normal(text) {
  return new TextRun({ text, font: "Segoe UI", size: 21, color: DARK_GRAY });
}

function richPara(runs, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    alignment: opts.align || AlignmentType.LEFT,
    children: runs,
  });
}

function bullet(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 60 },
    bullet: { level: opts.level || 0 },
    children: [new TextRun({ text, font: "Segoe UI", size: 21, color: DARK_GRAY })],
  });
}

function richBullet(runs, opts = {}) {
  return new Paragraph({
    spacing: { after: 60 },
    bullet: { level: opts.level || 0 },
    children: runs,
  });
}

function numberedItem(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 60 },
    numbering: { reference: "tak-numbering", level: 0 },
    children: [new TextRun({ text, font: "Segoe UI", size: 21, color: DARK_GRAY })],
  });
}

function image(pngName, widthInches = 6.5, heightInches = 4) {
  const data = loadPng(pngName);
  if (!data) return para(`[Diagram not rendered: ${pngName}]`, { italics: true });
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    alignment: AlignmentType.CENTER,
    children: [
      new ImageRun({
        data,
        transformation: {
          width: convertInchesToTwip(widthInches) / 15,
          height: convertInchesToTwip(heightInches) / 15,
        },
        type: "png",
      }),
    ],
  });
}

function figureCaption(text) {
  return new Paragraph({
    spacing: { after: 200 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, italics: true, font: "Segoe UI", size: 18, color: "666666" })],
  });
}

function spacer() {
  return new Paragraph({ spacing: { after: 80 }, children: [] });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

// ── Table builder ──────────────────────────────────────────────────

const CELL_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
  left: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
  right: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
};

function headerCell(text, widthPct) {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.SOLID, color: NAVY },
    borders: CELL_BORDER,
    children: [new Paragraph({
      spacing: { before: 60, after: 60 },
      children: [new TextRun({ text, bold: true, font: "Segoe UI", size: 19, color: WHITE })],
    })],
  });
}

function cell(text, widthPct, opts = {}) {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: opts.shading ? { type: ShadingType.SOLID, color: opts.shading } : undefined,
    borders: CELL_BORDER,
    children: [new Paragraph({
      spacing: { before: 40, after: 40 },
      children: [new TextRun({ text, font: "Segoe UI", size: 19, color: DARK_GRAY, bold: opts.bold })],
    })],
  });
}

function richCell(runs, widthPct, opts = {}) {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: opts.shading ? { type: ShadingType.SOLID, color: opts.shading } : undefined,
    borders: CELL_BORDER,
    children: [new Paragraph({
      spacing: { before: 40, after: 40 },
      children: runs,
    })],
  });
}

function makeTable(headers, rows, colWidths) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => headerCell(h, colWidths[i])),
  });
  const dataRows = rows.map((row, ri) =>
    new TableRow({
      children: row.map((c, i) =>
        cell(c, colWidths[i], { shading: ri % 2 === 1 ? LIGHT_GRAY : undefined }),
      ),
    }),
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });
}

// ── Document assembly ──────────────────────────────────────────────

function buildDocument() {
  console.log("Building DOCX...");

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Segoe UI", size: 21, color: DARK_GRAY },
        },
        heading1: {
          run: { font: "Segoe UI", size: 36, bold: true, color: NAVY },
          paragraph: { spacing: { before: 400, after: 160 } },
        },
        heading2: {
          run: { font: "Segoe UI", size: 28, bold: true, color: NAVY },
          paragraph: { spacing: { before: 300, after: 120 } },
        },
        heading3: {
          run: { font: "Segoe UI", size: 24, bold: true, color: DARK_BLUE },
          paragraph: { spacing: { before: 240, after: 100 } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: "tak-numbering",
          levels: [
            {
              level: 0,
              format: NumberFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [
      // ── Cover page ─────────────────────────────────────────
      {
        properties: {
          page: {
            margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.2), right: convertInchesToTwip(1.2) },
          },
        },
        children: [
          spacer(), spacer(), spacer(), spacer(), spacer(),
          spacer(), spacer(), spacer(), spacer(), spacer(),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [new TextRun({ text: "TRUSTED AI KERNEL", font: "Segoe UI", size: 56, bold: true, color: NAVY })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 80 },
            children: [new TextRun({ text: "(TAK)", font: "Segoe UI", size: 44, bold: true, color: MID_BLUE })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
            children: [new TextRun({ text: "Architecture Reference Document", font: "Segoe UI", size: 28, color: DARK_GRAY })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [new TextRun({ text: "Open Digital Product Factory", font: "Segoe UI", size: 24, color: MID_BLUE })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 40 },
            children: [new TextRun({ text: `Version 1.0  |  ${new Date().toISOString().slice(0, 10)}`, font: "Segoe UI", size: 20, color: "666666" })],
          }),
          spacer(), spacer(), spacer(), spacer(),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "The governance and execution substrate for trusted AI agent operations", font: "Segoe UI", size: 22, italics: true, color: DARK_GRAY })],
          }),
          pageBreak(),
        ],
      },

      // ── Table of Contents ──────────────────────────────────
      {
        properties: {
          page: {
            margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.2), right: convertInchesToTwip(1.2) },
          },
        },
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: "Trusted AI Kernel (TAK) Architecture", font: "Segoe UI", size: 16, color: "999999", italics: true })],
            })],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: "Page ", font: "Segoe UI", size: 16, color: "999999" }), new TextRun({ children: [PageNumber.CURRENT], font: "Segoe UI", size: 16, color: "999999" })],
            })],
          }),
        },
        children: [
          heading(1, "Table of Contents"),
          new TableOfContents("Table of Contents", {
            hyperlink: true,
            headingStyleRange: "1-3",
            stylesWithLevels: [
              new StyleLevel("Heading1", 1),
              new StyleLevel("Heading2", 2),
              new StyleLevel("Heading3", 3),
            ],
          }),
          para("Note: Update the Table of Contents in Word by right-clicking it and selecting 'Update Field'."),
          pageBreak(),

          // ── Section: What This Document Is ──────────────────
          heading(1, "What This Document Is"),
          richPara([
            normal("This document describes the architecture of the "),
            bold("Trusted AI Kernel"),
            normal(" (TAK) -- the governance and execution substrate that sits between human operators and AI agents in Open Digital Product Factory. TAK is not a separate product. It is the set of layered enforcement mechanisms, routing logic, audit infrastructure, and immutable directives that make it safe to let AI agents act on behalf of humans inside a business platform."),
          ]),
          para("The purpose of documenting TAK explicitly is twofold:"),
          richBullet([bold("For this project: "), normal("To give operators, auditors, and developers a single place to understand how human authority flows through the system, how agent actions are constrained, and how every action is recorded.")]),
          richBullet([bold("For anyone building agentic systems: "), normal("To provide a reference architecture that can be studied, forked, and adapted. Every component described here is implemented in this codebase and can be inspected directly.")]),

          spacer(),
          heading(2, "Core Principle"),
          new Paragraph({
            spacing: { before: 120, after: 200 },
            alignment: AlignmentType.CENTER,
            shading: { type: ShadingType.SOLID, color: LIGHT_BLUE },
            children: [new TextRun({ text: "  Humans hold authority.  Agents hold capability.  The kernel mediates.  ", font: "Segoe UI", size: 28, bold: true, color: NAVY })],
          }),
          para("An agent may have the technical capability to call any tool, but TAK ensures it can only exercise authority that has been explicitly granted by a human, scoped to a context, and recorded for audit. No agent in this system acts without a traceable chain of authority back to a human decision."),
          pageBreak(),

          // ── Section 1: Human-Agent Interaction ──────────────
          heading(1, "1. The Human-Agent Interaction Model"),

          heading(2, "1.1 Platform Roles (Tier 1 -- Immutable)"),
          para("Six governance roles map to IT4IT v3.0.1 value stream authority domains. These are hard-coded and cannot be created, renamed, or deleted at runtime:"),
          spacer(),
          makeTable(
            ["Role ID", "Title", "Authority Domain"],
            [
              ["HR-000", "CDIO / Executive Sponsor", "Strategic direction, executive escalation, full platform access"],
              ["HR-100", "Portfolio Manager", "Portfolio governance, investment allocation (IT4IT Evaluate SS5.1)"],
              ["HR-200", "Digital Product Manager", "Product lifecycle, backlog, delivery (Explore SS5.2 through Release SS5.5)"],
              ["HR-300", "Enterprise Architect", "Architecture guardrails, technology standards"],
              ["HR-400", "ITFM Director", "Financial governance, cost allocation"],
              ["HR-500", "Operations Manager", "SLA, incident response, operational continuity (Operate SS5.7)"],
            ],
            [15, 25, 60],
          ),
          spacer(),
          para("Every user is assigned exactly one platform role. The role determines which capabilities the user can exercise (32 capabilities defined in the permissions module)."),

          heading(2, "1.2 Business Model Roles (Tier 2 -- Extensible)"),
          para("When a digital product is created and a business model is attached (SaaS, Marketplace, E-commerce, etc.), a set of product-specific roles becomes available. Eight business model templates ship with the platform, each defining four specialized roles (32 total). These roles are:"),
          bullet("Scoped to a specific product, not platform-wide"),
          bullet("Assigned to users who already hold a platform role"),
          bullet("Governed by their own HITL tier (default: Tier 2)"),
          bullet("Escalation-linked to a platform governance role (usually HR-200)"),

          heading(2, "1.3 The AI Coworker"),
          para("Every page in the platform shell has a conversational AI coworker panel. The coworker is not a single agent -- it is a contextual agent resolver that selects the right agent identity, tool set, and system directives based on the current route, the user's role, and the resolved agent for that route."),
          richBullet([bold("Conversational mode: "), normal("The user asks questions; the agent reasons and responds")]),
          richBullet([bold("Action-oriented mode: "), normal("The agent proposes tool calls, which execute immediately or require approval")]),
          pageBreak(),

          // ── Section 2: Layered Authority ────────────────────
          heading(1, "2. Layered Authority Resolution"),
          para("TAK enforces authority through five layers. Each layer narrows what is possible. No layer can widen permissions granted by a layer above it."),
          spacer(),
          image("02-authority-layers.png", 6.5, 5.5),
          figureCaption("Figure 1: Five-layer authority resolution stack"),
          spacer(),

          heading(2, "How Effective Permissions Are Computed"),
          para("For any given (user, agent, tool) triple, the effective permission is:"),
          spacer(),
          makeTable(
            ["Check", "Formula"],
            [
              ["User Allowed", "tool.requiredCapability is null OR user.platformRole is in PERMISSIONS[capability].roles"],
              ["Agent Allowed", "tool.name is not in TOOL_TO_GRANTS OR agent.grants includes a required grant"],
              ["Effective", "userAllowed AND agentAllowed"],
            ],
            [25, 75],
          ),
          spacer(),
          para("A tool is only available if both the human and the agent are authorized. This is the fundamental invariant of TAK: the agent cannot exceed the human's authority, and the human cannot force the agent to act outside its granted scope."),
          pageBreak(),

          // ── Section 3: TAK Overview Diagram ─────────────────
          heading(1, "3. Architecture Overview"),
          image("01-tak-overview.png", 6.5, 5),
          figureCaption("Figure 2: TAK architecture -- human authority flows through the kernel to constrained agent execution"),
          pageBreak(),

          // ── Section 4: Request Routing ──────────────────────
          heading(1, "4. Request Routing"),

          heading(2, "4.1 Route Context Resolution"),
          para("When a user navigates to a page, the route context map resolves domain, sensitivity, tools, and skills:"),
          spacer(),
          makeTable(
            ["Property", "Purpose"],
            [
              ["domain", "Human-readable domain name (e.g., 'Employee Management')"],
              ["sensitivity", "Data classification: public, internal, confidential, restricted"],
              ["domainContext", "Multi-sentence guidance injected into the agent's system prompt"],
              ["domainTools", "Array of tool names available on this route"],
              ["skills", "Quick-action buttons (label + pre-built prompt) shown in the UI"],
            ],
            [20, 80],
          ),
          spacer(),
          para("Resolution uses longest prefix match: /build/feature/123 resolves to the /build context, inheriting its 30+ build tools and five-phase workflow guidance."),

          heading(2, "4.2 The Agentic Loop"),
          image("03-agentic-loop.png", 6, 5),
          figureCaption("Figure 3: Agentic loop with safety guards"),
          spacer(),
          para("The loop includes three safety mechanisms:"),
          richBullet([bold("Repetition detector: "), normal("Breaks the loop if the same tool with identical arguments is called 3+ times")]),
          richBullet([bold("Fabrication detector: "), normal("Catches when the agent claims completion without having called the required tools")]),
          richBullet([bold("Narration detector: "), normal("Identifies when the agent describes code instead of calling tools to write it")]),

          heading(2, "4.3 Tool Execution Modes"),
          makeTable(
            ["Mode", "Behavior", "Use Case"],
            [
              ["immediate", "Execute synchronously during the loop", "Read operations, queries, analysis"],
              ["proposal", "Break the loop; return approval card to user", "Creating records, modifying data, deploying"],
            ],
            [15, 45, 40],
          ),
          pageBreak(),

          // ── Section 5: End-to-End Request Flow ──────────────
          heading(1, "5. End-to-End Request Flow"),
          para("The following sequence diagram shows the complete path of a user request through TAK:"),
          image("07-request-flow.png", 6.5, 4.5),
          figureCaption("Figure 4: Complete request flow -- from user message to tool execution to audit recording"),
          pageBreak(),

          // ── Section 6: Delegation & Escalation ──────────────
          heading(1, "6. Agent Delegation and Escalation"),

          heading(2, "6.1 Delegation Chain"),
          para("Agents form a hierarchy. Orchestrator agents (Tier 1-2) delegate to specialist agents (Tier 3+). A delegated agent cannot exceed the grants of its delegator."),
          image("04-delegation-chain.png", 6.5, 5.5),
          figureCaption("Figure 5: Agent delegation hierarchy with HITL tiers and human escalation paths"),

          heading(2, "6.2 HITL Tiers"),
          image("10-hitl-tiers.png", 6, 4.5),
          figureCaption("Figure 6: Human-In-The-Loop tier decision flow"),
          spacer(),
          makeTable(
            ["Tier", "Label", "Behavior"],
            [
              ["0", "Blocked", "Agent cannot act. Human must decide directly."],
              ["1", "Approve Before", "Agent proposes; human must approve before execution."],
              ["2", "Review After", "Agent acts immediately; human reviews asynchronously."],
              ["3", "Autonomous", "Agent acts and logs; no mandatory human review."],
            ],
            [10, 20, 70],
          ),
          spacer(),
          para("HITL tiers are enforced through the execution mode system: Tier 0-1 agents have their side-effect tools forced into proposal mode. Tier 2-3 agents may execute immediately, but all actions are recorded."),
          pageBreak(),

          // ── Section 7: Inference Providers ──────────────────
          heading(1, "7. Inference Provider Routing"),
          para("The AI inference layer abstracts over multiple providers through a unified interface:"),
          spacer(),
          makeTable(
            ["Auth Method", "Use Case"],
            [
              ["api_key", "Header-based authentication (Anthropic, OpenAI)"],
              ["oauth2_client_credentials", "Bearer token from credential service"],
              ["oauth2_authorization_code", "Authorization code flow"],
              ["none", "Local/self-hosted providers (Ollama, Docker Model Runner)"],
            ],
            [30, 70],
          ),
          spacer(),
          para("Every inference call logs token consumption and computed cost in the TokenUsage table, attributed to the specific agent, provider, and route context."),
          pageBreak(),

          // ── Section 8: MCP & Skills ─────────────────────────
          heading(1, "8. MCP, Skills, and External Tool Integration"),
          image("05-mcp-model.png", 6.5, 4.5),
          figureCaption("Figure 7: MCP client-server model with tool evaluation pipeline"),
          spacer(),

          heading(2, "8.1 Platform Tools as MCP Surface"),
          para("The platform's 100+ tools are defined using a schema compatible with the Model Context Protocol (MCP), organized into functional categories:"),
          spacer(),
          makeTable(
            ["Category", "Examples", "Typical Mode"],
            [
              ["Backlog", "create_backlog_item, update_backlog_item, query_backlog", "proposal"],
              ["Portfolio", "create_digital_product, update_lifecycle", "proposal / immediate"],
              ["Build/Sandbox", "launch_sandbox, generate_code, run_sandbox_tests", "immediate"],
              ["Deploy", "deploy_feature, schedule_promotion, create_release_bundle", "proposal"],
              ["Employee/HR", "create_employee, query_employees", "proposal / immediate"],
              ["Compliance", "prefill_onboarding_wizard, search_knowledge", "immediate"],
              ["Web/External", "search_public_web, fetch_public_website", "immediate"],
              ["Codebase", "read_project_file, propose_file_change", "immediate / proposal"],
              ["Evaluation", "evaluate_tool, evaluate_page, generate_ux_test", "immediate"],
            ],
            [18, 52, 30],
          ),

          heading(2, "8.2 MCP Client-Server Model"),
          richBullet([bold("As MCP Server: "), normal("POST /api/mcp/tools and /api/mcp/call -- subject to all TAK authority checks")]),
          richBullet([bold("As MCP Client: "), normal("Namespaced tools (e.g., slack:send_message) are routed to external MCP servers")]),

          heading(2, "8.3 Tool Evaluation Pipeline"),
          para("Before any external tool is adopted, it must pass a 6-agent evaluation pipeline:"),
          bullet("Security Auditor (AGT-190) -- vulnerability and supply chain analysis"),
          bullet("Architecture Reviewer -- fit with platform patterns"),
          bullet("Compliance Checker -- regulatory implications"),
          bullet("Integration Analyst -- API compatibility and failure modes"),
          bullet("Risk Scorer -- aggregate risk band assignment"),
          bullet("Verdict Synthesizer -- approve, conditionally approve, or reject"),
          pageBreak(),

          // ── Section 9: Audit Trail ──────────────────────────
          heading(1, "9. Audit Trail and Continuous Improvement"),
          image("06-audit-trail.png", 6.5, 4.5),
          figureCaption("Figure 8: Three audit surfaces feeding continuous improvement analytics"),
          spacer(),

          heading(2, "9.1 Three Audit Surfaces"),
          makeTable(
            ["Surface", "Table", "Key Fields"],
            [
              ["Tool Execution Log", "ToolExecution", "agentId, userId, toolName, parameters, result, success, durationMs, routeContext"],
              ["Action Proposals", "AgentActionProposal", "proposalId, status lifecycle, decidedById, resultEntityId, gitCommitHash"],
              ["Authorization Decisions", "AuthorizationDecisionLog", "actorType, delegationGrantId, decision (allow/deny), rationale JSON"],
            ],
            [22, 22, 56],
          ),
          spacer(),
          para("Recording is fire-and-forget (async insert after executeTool returns) so it never blocks the response path."),

          heading(2, "9.2 Continuous Improvement Loop"),
          para("Audit data feeds back into platform improvement through pattern analysis:"),
          bullet("Which tools fail most often? (reliability targets)"),
          bullet("Which agents have grants they never use? (over-provisioning)"),
          bullet("Which proposals get rejected most? (agent misalignment)"),
          bullet("Which routes consume the most tokens? (cost optimization)"),
          spacer(),
          para("Adjustments include tuning agent grants, updating system prompts, switching providers, adding/removing skills, and adjusting HITL tiers."),
          pageBreak(),

          // ── Section 10: Immutable Directives ────────────────
          heading(1, "10. Immutable Directives"),
          image("08-directive-injection.png", 6.5, 5),
          figureCaption("Figure 9: Directive assembly and injection -- immutable at runtime, recomputed on delegation"),
          spacer(),

          heading(2, "10.1 Directive Sources"),
          makeTable(
            ["Source", "Content", "Mutability"],
            [
              ["Platform directives", "Never fabricate, never exceed grants, always propose side-effects", "Immutable. Code deployment only."],
              ["Route domain context", "Domain-specific guidance, required fields, behavioral boundaries", "Immutable per route definition."],
              ["Sensitivity constraints", "Data handling rules per classification level", "Immutable. Derived from route map."],
              ["Agent identity", "Name, role, value stream, canonical greeting", "Immutable. Defined in registry."],
              ["Directive Policy Class", "Approval mode, risk band, config constraints", "Admin-mutable only."],
            ],
            [20, 45, 35],
          ),

          heading(2, "10.2 What Directives Enforce"),
          richBullet([bold("Tool boundary: "), normal("Agent can only call tools in its filtered set")]),
          richBullet([bold("Execution mode: "), normal("Agent cannot convert proposals to immediate execution")]),
          richBullet([bold("Fabrication prohibition: "), normal("Must call tools to act; claims without tool calls trigger retry")]),
          richBullet([bold("Narration prohibition: "), normal("Must act, not describe what it would do")]),
          richBullet([bold("Sensitivity compliance: "), normal("Data handling rules injected per classification level")]),
          richBullet([bold("Identity consistency: "), normal("Canonical greeting, no persona switching")]),
          richBullet([bold("Incomplete information: "), normal("Must ask for missing fields, never guess")]),

          heading(2, "10.3 How Directives Survive Delegation"),
          para("When Agent A delegates to Agent B, directives are recomputed from scratch for Agent B's context. The delegated agent never sees the delegator's system prompt. It receives its own identity, its own grants (a subset), and the inherited sensitivity level. This prevents directive leakage across the delegation chain."),
          pageBreak(),

          // ── Section 11: Security ────────────────────────────
          heading(1, "11. Security Properties"),

          heading(2, "11.1 Defense in Depth"),
          makeTable(
            ["Layer", "Protection"],
            [
              ["Route context", "Only domain-relevant tools are presented to the agent"],
              ["User capabilities", "Role-based access prevents tools outside their authority"],
              ["Agent grants", "Tool-to-grant mapping prevents tools outside agent scope"],
              ["Execution mode", "Side-effect tools require explicit human approval"],
              ["Fabrication detection", "Agent cannot claim completion without tool evidence"],
              ["Audit trail", "Every action recorded with full context for forensic review"],
              ["Delegation constraints", "Delegated agents cannot exceed delegator's authority"],
              ["Sensitivity classification", "Data handling rules injected based on route sensitivity"],
            ],
            [25, 75],
          ),

          heading(2, "11.2 Threat Mitigations"),
          makeTable(
            ["Threat", "Mitigation"],
            [
              ["Agent acts beyond authority", "Grant intersection: effective = user AND agent"],
              ["Agent fabricates results", "Fabrication detector + forced retry with tool-call nudge"],
              ["Agent stuck in loop", "Repetition detector (3x identical) + time/iteration limits"],
              ["Unauthorized data access", "Role-based capability check + sensitivity filtering"],
              ["Deploy without approval", "Proposal mode forces human gate for all deploy tools"],
              ["No accountability", "Full audit: ToolExecution + Proposals + AuthorizationDecisionLog"],
              ["Vulnerable external tool", "6-agent Tool Evaluation Pipeline before adoption"],
              ["System prompt leakage", "Server-side injection; agent cannot access raw prompt"],
              ["Delegation circumvention", "Recomputed authority from own grants, not delegator's"],
            ],
            [28, 72],
          ),

          heading(2, "11.3 Known Gaps (Roadmap)"),
          richBullet([bold("Cross-agent prompt injection: "), normal("Output sanitization at delegation boundaries (planned)")]),
          richBullet([bold("Token-based cost attacks: "), normal("Per-user and per-route token budgets (planned)")]),
          richBullet([bold("Stale delegation grants: "), normal("Event-driven grant invalidation on role change (planned)")]),
          pageBreak(),

          // ── Section 12: IT4IT Mapping ───────────────────────
          heading(1, "12. Mapping to IT4IT v3.0.1"),
          image("09-it4it-mapping.png", 6.5, 4),
          figureCaption("Figure 10: IT4IT value streams mapped to TAK components"),
          spacer(),
          makeTable(
            ["IT4IT Value Stream", "TAK Component"],
            [
              ["Evaluate (SS5.1)", "Portfolio route context, investment capability gates, HR-100 authority domain"],
              ["Explore (SS5.2)", "EA route context, architecture tools, HR-300 authority domain"],
              ["Integrate (SS5.3)", "Build Studio route, sandbox tools, AGT-ORCH-300 delegation chain"],
              ["Deploy (SS5.4)", "Deploy tools (proposal mode), AGT-ORCH-400, release gates"],
              ["Release (SS5.5)", "Service catalog tools, release bundling, promotion scheduling"],
              ["Consume (SS5.6)", "Customer route context, AGT-ORCH-600, usage analytics"],
              ["Operate (SS5.7)", "Ops route context, SLA tools, HR-500 authority domain, AGT-ORCH-700"],
            ],
            [25, 75],
          ),
          pageBreak(),

          // ── Section 13: Reference Architecture ──────────────
          heading(1, "13. Using TAK as a Reference Architecture"),

          heading(2, "13.1 Portable Patterns"),
          richBullet([bold("Role-capability-grant triple: "), normal("Define human roles with capabilities, agent identities with grants, compute effective permissions as the intersection.")]),
          richBullet([bold("Execution mode separation: "), normal("Distinguish immediate (safe) tools from proposal (side-effect) tools. Declare mode in the tool definition, never let the model decide.")]),
          richBullet([bold("Fire-and-forget audit: "), normal("Record every tool call asynchronously after execution. Never block the response path for logging.")]),
          richBullet([bold("Route-based context injection: "), normal("Scope tools to the domain the user is working in. Reduces prompt size, improves accuracy, limits blast radius.")]),
          richBullet([bold("Fabrication detection: "), normal("Check whether the model claims completion without calling appropriate tools. Simple pattern match, catches a common failure mode.")]),
          richBullet([bold("Delegation with authority narrowing: "), normal("When one agent delegates to another, recompute authority from scratch. Never pass the delegator's full context.")]),

          heading(2, "13.2 Key Files to Study"),
          makeTable(
            ["File", "What It Demonstrates"],
            [
              ["apps/web/lib/agentic-loop.ts", "Complete agentic loop with all safety guards"],
              ["apps/web/lib/permissions.ts", "Role-capability mapping and the can() function"],
              ["apps/web/lib/agent-grants.ts", "Tool-to-grant mapping and intersection check"],
              ["apps/web/lib/mcp-tools.ts", "Tool registry with 100+ tools, schemas, modes"],
              ["apps/web/lib/route-context-map.ts", "Route-to-agent-context resolution"],
              ["apps/web/lib/ai-inference.ts", "Provider-agnostic inference with token tracking"],
              ["apps/web/lib/endpoint-test-registry.ts", "Behavioral probes for agent quality"],
              ["packages/db/prisma/schema.prisma", "Data model for agents, governance, delegation, audit"],
              ["packages/db/data/agent_registry.json", "43 agents with grants, tiers, delegation chains"],
            ],
            [38, 62],
          ),
          pageBreak(),

          // ── Summary ─────────────────────────────────────────
          heading(1, "Summary"),
          para("The Trusted AI Kernel is not a product -- it is an architecture pattern implemented in production code. It solves the fundamental problem of agentic systems: how do you let AI agents act on behalf of humans without losing control, accountability, or auditability?"),
          spacer(),
          para("TAK's answer is five interlocking mechanisms:"),
          spacer(),
          makeTable(
            ["#", "Mechanism", "Description"],
            [
              ["1", "Layered authority resolution", "Human roles, agent grants, and execution modes compose to determine what any (human, agent, tool) triple can do"],
              ["2", "Immutable directives", "Behavioral constraints injected server-side that the agent cannot override or circumvent"],
              ["3", "Proposal gates", "Consequential actions require explicit human approval before execution"],
              ["4", "Complete audit trail", "Every tool call, proposal, decision, and token expenditure is recorded with full context"],
              ["5", "Delegation with narrowing", "Agents can delegate to other agents, but authority only narrows, never widens"],
            ],
            [5, 22, 73],
          ),
          spacer(),
          para("These mechanisms are general-purpose. They do not depend on a specific LLM provider, tool set, or business domain. They can be adopted individually or as a complete system by anyone building agentic applications where trust, accountability, and human oversight matter."),
        ],
      },
    ],
  });

  return doc;
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  renderDiagrams();
  const doc = buildDocument();
  const buffer = await Packer.toBuffer(doc);
  writeFileSync(OUTPUT, buffer);
  console.log(`\nDone! Output: ${OUTPUT}`);
  console.log(`File size: ${(buffer.length / 1024).toFixed(0)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
