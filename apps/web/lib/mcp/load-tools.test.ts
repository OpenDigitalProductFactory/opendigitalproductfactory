import { describe, expect, it } from "vitest";

import {
  MCP_PROGRESSIVE_DISCLOSURE_INSTRUCTIONS,
  buildLoadToolsResult,
  buildLoadToolsStatus,
  buildUnknownToolResult,
  classifyLoadToolsNoMatch,
  type LoadToolsStatusFacts,
} from "./load-tools";
import type { ListingAuthority } from "./listing-authority";

describe("MCP progressive-disclosure bootstrap contract", () => {
  it("reports a known alias without grants as not-granted", () => {
    expect(classifyLoadToolsNoMatch(
      { names: ["list_work_capsules"] }, new Set(["list_workrooms"]), new Set(), new Set(),
    )).toEqual({ reason: "not-granted", requestedNames: ["list_work_capsules"] });
  });
  it("keeps the complete recovery workflow in the first 512 initialize characters", () => {
    const preamble = MCP_PROGRESSIVE_DISCLOSURE_INSTRUCTIONS.slice(0, 512);

    expect(MCP_PROGRESSIVE_DISCLOSURE_INSTRUCTIONS.length).toBeLessThanOrEqual(512);
    expect(preamble).toContain("load_tools");
    expect(preamble).toContain("names");
    expect(preamble).toContain("query");
    expect(preamble).toContain("tools/list");
    expect(preamble).toMatch(/programmatic tool catalog/i);
    expect(preamble).toMatch(/resource/i);
    expect(preamble).toMatch(/authorization/i);
  });

  it("explains the programmatic fallback when a host top-level registry stays stale", () => {
    const result = buildLoadToolsResult(
      [{ name: "create_epic", description: "Create a governed epic." }],
      ["create_epic"],
    );

    expect(result.structuredContent).toMatchObject({
      listChanged: true,
      recovery: {
        reListTools: true,
        programmaticCatalogFallback: true,
      },
    });
    expect(result.structuredContent.note).toMatch(/top-level registry/i);
    expect(result.structuredContent.note).toMatch(/programmatic tool catalog/i);
  });

  it("returns machine-readable unknown-tool recovery without calling it authorization", () => {
    const result = buildUnknownToolResult("totally_made_up_tool");

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: "unknown_tool",
      toolName: "totally_made_up_tool",
      recovery: { tool: "load_tools" },
    });
    expect(result.structuredContent.recovery).toHaveProperty("exactName");
    expect(result.structuredContent.recovery).toHaveProperty("intentQuery");
    expect(result.structuredContent.error).not.toBe("insufficient_token_scope");
  });

  it("distinguishes an unknown exact name from a known reviewer-only writer", () => {
    const known = new Set(["get_backlog_item", "record_initiative_design_review"]);
    const granted = new Set(["get_backlog_item"]);
    const unknown = buildLoadToolsResult([], [], classifyLoadToolsNoMatch(
      { names: ["record_initiative_plan_review"] }, known, granted, new Set(),
    ));
    const reviewerOnly = buildLoadToolsResult([], [], classifyLoadToolsNoMatch(
      { names: ["record_initiative_design_review"] }, known, granted, new Set(),
    ));

    expect(unknown.structuredContent.noMatch).toMatchObject({
      reason: "unknown-tool-name",
      requestedNames: ["record_initiative_plan_review"],
    });
    expect(reviewerOnly.structuredContent.noMatch).toMatchObject({
      reason: "reviewer-route-required",
      supportedEntryPoint: { toolName: "get_backlog_item" },
    });
  });

  // BI-7876699F: the author-satisfiable writer must not be classified as
  // reviewer-routed. `record_initiative_evidence` is the ONLY record_initiative_*
  // lane declared `independent: false`, with design-author among its accountable
  // roles — so a name-prefix test is wrong for exactly the tool an author needs
  // to close a delivery-small item, and it also masks the real reason by sitting
  // above the not-granted branch.
  it("does NOT call the author-satisfiable evidence writer reviewer-routed", () => {
    const known = new Set(["get_backlog_item", "record_initiative_evidence"]);
    const granted = new Set(["get_backlog_item", "record_initiative_evidence"]);
    const res = classifyLoadToolsNoMatch(
      { names: ["record_initiative_evidence"] }, known, granted, new Set(),
    );
    expect(res?.reason).not.toBe("reviewer-route-required");
  });

  it("reports not-granted, not reviewer-route-required, when the author lacks the evidence grant", () => {
    const known = new Set(["get_backlog_item", "record_initiative_evidence"]);
    const granted = new Set(["get_backlog_item"]);
    const res = classifyLoadToolsNoMatch(
      { names: ["record_initiative_evidence"] }, known, granted, new Set(),
    );
    // The operator must be told the truth: the grant is missing. Saying
    // "reviewer-route-required" sends them to a packet that issues no route.
    expect(res?.reason).toBe("not-granted");
  });

  it("still calls a genuinely independent reviewer writer reviewer-routed", () => {
    const known = new Set(["get_backlog_item", "record_initiative_design_review"]);
    const granted = new Set(["get_backlog_item"]);
    const res = classifyLoadToolsNoMatch(
      { names: ["record_initiative_design_review"] }, known, granted, new Set(),
    );
    expect(res?.reason).toBe("reviewer-route-required");
  });

  it("returns no no-match reason when discovery selected a tool", () => {
    expect(classifyLoadToolsNoMatch(
      { names: ["get_backlog_item"] }, new Set(["get_backlog_item"]), new Set(["get_backlog_item"]), new Set(["get_backlog_item"]),
    )).toBeUndefined();
  });
});

// BI-949FBBAE: load_tools answered only for the names it loaded. A request for
// four names that loaded one came back with no word about the other three, so a
// missing agent grant, a reviewer-only writer and a typo all read as silence.
describe("load_tools per-name status", () => {
  const GRANTS: Record<string, string[]> = {
    list_open_decision_reviews: ["registry_read"],
    record_initiative_evidence: ["initiative_evidence_write"],
    record_initiative_design_review: ["initiative_design_review"],
    record_initiative_post_implementation_review: ["initiative_design_review"],
    query_backlog: ["backlog_read"],
    list_workrooms: ["work_capsule_read"],
    admin_only_tool: ["admin_platform"],
  };
  const KNOWN = new Set(Object.keys(GRANTS));
  const anyOf = (name: string, held: string[]) => (GRANTS[name] ?? []).some((g) => held.includes(g));

  function facts(
    over: Partial<LoadToolsStatusFacts> & { tokenScopes?: string[] } = {},
  ): LoadToolsStatusFacts {
    const tokenScopes = over.tokenScopes ?? ["registry_read", "initiative_evidence_write", "backlog_read", "work_capsule_read"];
    const authority: ListingAuthority = over.authority ?? { agentBound: false };
    const tokenGrants = over.tokenGrants ?? ((name: string) => anyOf(name, tokenScopes));
    const roleAllows = over.roleAllows ?? (() => true);
    const authorizedNames = over.authorizedNames ?? new Set([...KNOWN].filter((name) =>
      tokenGrants(name) && roleAllows(name)
      && (!authority.agentBound || (!authority.blanketDeny && anyOf(name, authority.agentGrants)))));
    return {
      knownNames: KNOWN,
      authorizedNames,
      loadedToolNames: over.loadedToolNames ?? [...authorizedNames].sort(),
      tokenGrants,
      roleAllows,
      authority,
      isAllowedByGrants: anyOf,
      requiredGrants: (name) => GRANTS[name] ?? [],
    };
  }

  it("reports every requested name, not only the ones it loaded (the live repro)", () => {
    const names = [
      "record_initiative_evidence",
      "record_initiative_design_review",
      "record_initiative_post_implementation_review",
      "list_open_decision_reviews",
    ];
    const status = buildLoadToolsStatus({ names }, facts({
      authority: { agentBound: true, blanketDeny: false, agentGrants: ["registry_read"] },
    }));

    expect(status.map((entry) => entry.name)).toEqual(names);
    expect(status[0]).toMatchObject({
      serverHasTool: true, tokenGranted: true, agentGranted: false,
      loadedInSession: false, callableByName: false, reason: "agent-grant-missing",
    });
    expect(status[1]).toMatchObject({ reason: "reviewer-route-required", callableByName: false });
    expect(status[1].recovery).toBe(
      "The author dispatches the reviewer route from get_backlog_item; this tool is for the independent reviewer.",
    );
    expect(status[2]).toMatchObject({ reason: "reviewer-route-required" });
    expect(status[3]).toMatchObject({
      serverHasTool: true, tokenGranted: true, agentGranted: true,
      loadedInSession: true, callableByName: true, reason: null, recovery: null,
    });
  });

  it("names an unknown tool as unknown, never as an authorization failure", () => {
    const [entry] = buildLoadToolsStatus({ names: ["no_such_tool"] }, facts());
    expect(entry).toMatchObject({
      name: "no_such_tool", serverHasTool: false, tokenGranted: false,
      agentGranted: null, callableByName: false, reason: "unknown-tool-name",
    });
    expect(entry.recovery).toMatch(/search_tool_marketplace/);
  });

  it("reports token-scope-missing, naming the grants that would satisfy it", () => {
    const [entry] = buildLoadToolsStatus(
      { names: ["record_initiative_evidence"] },
      facts({ tokenScopes: ["registry_read"] }),
    );
    expect(entry).toMatchObject({ tokenGranted: false, agentGranted: null, reason: "token-scope-missing" });
    expect(entry.recovery).toMatch(/initiative_evidence_write/);
  });

  it("reports role-capability-missing when the token is fine but the person's role is not", () => {
    const [entry] = buildLoadToolsStatus(
      { names: ["query_backlog"] },
      facts({ roleAllows: (name) => name !== "query_backlog" }),
    );
    expect(entry).toMatchObject({ tokenGranted: true, callableByName: false, reason: "role-capability-missing" });
  });

  it("separates an agent-grant denial from a token-scope denial", () => {
    const status = buildLoadToolsStatus({ names: ["query_backlog", "admin_only_tool"] }, facts({
      authority: { agentBound: true, blanketDeny: false, agentGrants: ["registry_read"] },
    }));
    expect(status[0]).toMatchObject({ tokenGranted: true, agentGranted: false, reason: "agent-grant-missing" });
    expect(status[1]).toMatchObject({ tokenGranted: false, reason: "token-scope-missing" });
  });

  it("reports clearance-denied when the person's clearance does not cover the coworker", () => {
    const [entry] = buildLoadToolsStatus({ names: ["query_backlog"] }, facts({
      authority: { agentBound: true, blanketDeny: true, cause: "clearance-denied", agentGrants: ["backlog_read"] },
    }));
    expect(entry).toMatchObject({ tokenGranted: true, agentGranted: true, reason: "clearance-denied" });
    expect(entry.recovery).toMatch(/clearance/i);
  });

  it("treats an unresolvable acting coworker as holding no usable grant", () => {
    const [entry] = buildLoadToolsStatus({ names: ["query_backlog"] }, facts({
      authority: { agentBound: true, blanketDeny: true, cause: "agent-unresolved", agentGrants: ["backlog_read"] },
    }));
    expect(entry).toMatchObject({ agentGranted: false, reason: "agent-grant-missing" });
    expect(entry.recovery).toMatch(/not an active/i);
  });

  it("keeps a callable name that missed this call's batch limit honest: callable, not loaded, told to retry", () => {
    const [entry] = buildLoadToolsStatus({ names: ["query_backlog"] }, facts({ loadedToolNames: [] }));
    expect(entry).toMatchObject({ callableByName: true, loadedInSession: false, reason: null });
    expect(entry.recovery).toMatch(/load_tools again/);
  });

  it("de-duplicates repeated names and resolves a legacy alias to its canonical tool", () => {
    const status = buildLoadToolsStatus({ names: [" query_backlog ", "query_backlog", "list_work_capsules"] }, facts());
    expect(status).toHaveLength(2);
    expect(status[0]).toMatchObject({ name: "query_backlog", serverHasTool: true, reason: null });
    expect(status[1]).toMatchObject({ name: "list_work_capsules", serverHasTool: true, callableByName: true });
  });

  it("returns an empty status for a query-only request", () => {
    expect(buildLoadToolsStatus({ query: "backlog" }, facts())).toEqual([]);
  });

  it("populates noMatch for a partial match with only the unmatched names", () => {
    const names = ["list_open_decision_reviews", "record_initiative_design_review", "no_such_tool"];
    const noMatch = classifyLoadToolsNoMatch(
      { names }, KNOWN, new Set(["list_open_decision_reviews"]), new Set(["list_open_decision_reviews"]),
    );
    expect(noMatch).toEqual({
      reason: "unknown-tool-name",
      requestedNames: ["record_initiative_design_review", "no_such_tool"],
    });

    const result = buildLoadToolsResult(
      [{ name: "list_open_decision_reviews", description: "List open reviews." }],
      ["list_open_decision_reviews"],
      noMatch,
      buildLoadToolsStatus({ names }, facts()),
    );
    expect(result.structuredContent).toMatchObject({
      listChanged: true,
      newlyLoaded: [{ name: "list_open_decision_reviews" }],
      noMatch: { requestedNames: ["record_initiative_design_review", "no_such_tool"] },
    });
    expect((result.structuredContent.status as unknown[]).length).toBe(3);
    expect(result.structuredContent.note).toMatch(/status/);
  });

  it("classifies an agent-filtered name as not-granted, never intent-no-match", () => {
    // The route used to pass the token-scope list here while selecting from the
    // agent-filtered list, so an agent-grant denial read as "intent-no-match".
    const noMatch = classifyLoadToolsNoMatch({ names: ["query_backlog"] }, KNOWN, new Set(), new Set());
    expect(noMatch?.reason).toBe("not-granted");
  });

  it("does not list a callable name that only missed the batch limit in noMatch", () => {
    expect(classifyLoadToolsNoMatch(
      { names: ["query_backlog"] }, KNOWN, new Set(["query_backlog"]), new Set(),
    )).toBeUndefined();
  });
});
