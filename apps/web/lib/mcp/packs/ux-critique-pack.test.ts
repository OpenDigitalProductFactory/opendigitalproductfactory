import { describe, expect, it } from "vitest";

import { uxCritiquePack } from "./ux-critique-pack";
import { TOOL_TO_GRANTS, expandGrants } from "@/lib/tak/agent-grants";
import { MCP_TOKEN_TEMPLATES } from "@/lib/mcp-token-scopes";

// BI-52839DEA follow-up. The corpus door shipped UNREACHABLE: capture required
// `registry_write`, which the `development` template — the coding-agent token —
// does not hold. So an external review session could read the corpus and never
// feed it, which is the entire capability the pack exists to provide. The tool
// was present, granted, registered, and dead.
//
// These tests pin REACHABILITY, not just registration. A grant entry existing
// proves nothing if no token a real caller holds can satisfy it.

const developmentGrants = expandGrants([
  ...(MCP_TOKEN_TEMPLATES.find((t) => t.id === "development")?.grants ?? []),
]);

describe("ux-critique pack — reachable from the surface it exists for", () => {
  it("lets a development-template token actually call capture", () => {
    const required = TOOL_TO_GRANTS.capture_ux_critique;
    expect(required, "capture_ux_critique must have a gating entry").toBeTruthy();
    // ANY-of semantics, matching getAvailableTools.
    expect(
      required.some((g) => developmentGrants.includes(g)),
      `capture_ux_critique requires ${JSON.stringify(required)} but the development ` +
        `token holds none of them — the tool would be silently denied to every ` +
        `Claude Code / Codex / Grok session, which is the only surface it is for`,
    ).toBe(true);
  });

  it("lets a development-template token read the corpus", () => {
    const required = TOOL_TO_GRANTS.search_ux_critique_corpus;
    expect(required.some((g) => developmentGrants.includes(g))).toBe(true);
  });

  it("does not hand coding agents blanket registry write to get there", () => {
    // The naive fix. `registry_write` would also unlock wiki_ingest,
    // publish_wiki_overlay_pages, create_knowledge_article, doc_save, doc_link,
    // doc_state_change, run_discovery_triage, attribute_entity_to_product,
    // dismiss_entity and resolve_portfolio_quality_issue — eleven tools of
    // authority to enable one.
    expect(developmentGrants).not.toContain("registry_write");
  });

  it("keeps existing broad-authority holders working via one-way implication", () => {
    // An employee_ea / admin token already holds registry_write and could write
    // the craft overlay directly, so narrowing must not revoke it.
    expect(expandGrants(["registry_write"])).toContain("critique_capture");
    // One-way: the narrow grant never widens back.
    expect(expandGrants(["critique_capture"])).not.toContain("registry_write");
  });

  it("mirrors TOOL_TO_GRANTS exactly — the pack must not advertise a grant the gate lacks", () => {
    for (const [tool, grants] of Object.entries(uxCritiquePack.grants ?? {})) {
      expect(TOOL_TO_GRANTS[tool], `${tool} missing from TOOL_TO_GRANTS`).toEqual(grants);
    }
  });
});

describe("ux-critique pack — the authority boundary", () => {
  it("declares capture as side-effecting and search as not", () => {
    const byName = Object.fromEntries(uxCritiquePack.definitions.map((d) => [d.name, d]));
    expect(byName.capture_ux_critique.sideEffect).toBe(true);
    expect(byName.search_ux_critique_corpus.sideEffect).toBe(false);
  });

  it("never exposes callerKind or verdictAuthority as caller-supplied input", () => {
    // The correctness boundary: an MCP caller is ALWAYS an agent, so a captured
    // entry can only ever be agent-proposed. If either became an input, a caller
    // could author a founder verdict and the judge would be calibrated against
    // its own output.
    const capture = uxCritiquePack.definitions.find((d) => d.name === "capture_ux_critique");
    const props = Object.keys(
      (capture?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {},
    );
    expect(props).not.toContain("callerKind");
    expect(props).not.toContain("verdictAuthority");
    // A verdict may only ever be PROPOSED.
    expect(props).toContain("proposedVerdict");
  });
});
