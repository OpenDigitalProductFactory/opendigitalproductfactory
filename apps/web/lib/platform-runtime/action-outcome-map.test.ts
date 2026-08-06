import { describe, expect, it } from "vitest";
import { hasOutcomes, summarizeOutcomes } from "./action-outcome-map";

describe("summarizeOutcomes", () => {
  it("maps action tools to readable outcomes, biggest-first", () => {
    const out = summarizeOutcomes({
      create_backlog_item: 3,
      create_marketing_campaign: 1,
    });
    expect(out).toEqual([
      { label: "backlog items filed", count: 3, sensitive: false },
      { label: "campaign launched", count: 1, sensitive: false },
    ]);
  });

  it("singularizes a count of one", () => {
    expect(summarizeOutcomes({ create_backlog_item: 1 })[0].label).toBe("backlog item filed");
  });

  it("excludes read tools — they are lookups, not accomplishments", () => {
    expect(summarizeOutcomes({ get_backlog_item: 9, search_code_graph: 4, list_epics: 2 })).toEqual([]);
    expect(hasOutcomes({ get_backlog_item: 9 })).toBe(false);
  });

  it("excludes synthetic access-audit executions — not accomplishments (BI-A1B4BE05)", () => {
    expect(
      summarizeOutcomes({ external_access_permission_approval: 5, external_access_permission_request: 3 }),
    ).toEqual([]);
    expect(hasOutcomes({ external_access_permission_request: 3 })).toBe(false);
  });

  it("folds unmapped write tools into a single 'other actions' bucket", () => {
    const out = summarizeOutcomes({ create_backlog_item: 2, some_unmapped_write: 5 });
    expect(out).toContainEqual({ label: "other actions", count: 5, sensitive: false });
  });

  it("caps named outcomes and rolls the remainder into 'other actions'", () => {
    const out = summarizeOutcomes(
      {
        create_backlog_item: 5,
        create_battlecard: 4,
        create_asset_variant: 3,
        record_variant_result: 2,
        build_tracked_links: 1,
      },
      2,
    );
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ label: "other actions", count: 6, sensitive: false });
  });

  it("flags outcomes that touch sensitive data", () => {
    const out = summarizeOutcomes({ update_employee: 3, create_backlog_item: 2 });
    const hr = out.find((o) => o.label === "employee records updated");
    const bi = out.find((o) => o.label === "backlog items filed");
    expect(hr?.sensitive).toBe(true);
    expect(bi?.sensitive).toBe(false);
  });

  it("build/marketing work carries no sensitive flag; HR does", () => {
    const build = summarizeOutcomes({ create_portal_pr: 2, saveBuildEvidence: 3 });
    const hr = summarizeOutcomes({ run_payroll: 1, adjust_compensation: 2 });
    expect(build.every((o) => !o.sensitive)).toBe(true);
    expect(hr.every((o) => o.sensitive)).toBe(true);
  });
});
