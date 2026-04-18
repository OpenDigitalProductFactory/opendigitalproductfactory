import { describe, it, expect } from "vitest";
import { isToolAllowedByGrants, getToolGrantMapping } from "./agent-grants";

describe("TOOL_TO_GRANTS — Build / Sandbox entries", () => {
  it("write_sandbox_file requires sandbox_execute", () => {
    expect(isToolAllowedByGrants("write_sandbox_file", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("write_sandbox_file", ["backlog_write"])).toBe(false);
    expect(isToolAllowedByGrants("write_sandbox_file", [])).toBe(false);
  });

  it("validate_schema requires sandbox_execute", () => {
    expect(isToolAllowedByGrants("validate_schema", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("validate_schema", ["registry_read"])).toBe(false);
    expect(isToolAllowedByGrants("validate_schema", [])).toBe(false);
  });

  it("describe_model requires sandbox_execute", () => {
    expect(isToolAllowedByGrants("describe_model", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("describe_model", ["iac_execute"])).toBe(false);
    expect(isToolAllowedByGrants("describe_model", [])).toBe(false);
  });

  it("check_sandbox requires sandbox_execute", () => {
    expect(isToolAllowedByGrants("check_sandbox", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("check_sandbox", ["backlog_read"])).toBe(false);
  });

  it("start_sandbox requires sandbox_execute", () => {
    expect(isToolAllowedByGrants("start_sandbox", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("start_sandbox", [])).toBe(false);
  });

  it("start_build requires sandbox_execute", () => {
    expect(isToolAllowedByGrants("start_build", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("start_build", ["file_read"])).toBe(false);
  });

  it("create_portal_pr requires sandbox_execute", () => {
    expect(isToolAllowedByGrants("create_portal_pr", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("create_portal_pr", ["backlog_write"])).toBe(false);
  });
});

describe("TOOL_TO_GRANTS — Deploy / Release entries", () => {
  it("execute_promotion requires iac_execute", () => {
    expect(isToolAllowedByGrants("execute_promotion", ["iac_execute"])).toBe(true);
    expect(isToolAllowedByGrants("execute_promotion", ["sandbox_execute"])).toBe(false);
    expect(isToolAllowedByGrants("execute_promotion", [])).toBe(false);
  });
});

describe("TOOL_TO_GRANTS — Marketing entries", () => {
  it("get_marketing_summary requires marketing_read", () => {
    expect(isToolAllowedByGrants("get_marketing_summary", ["marketing_read"])).toBe(true);
    expect(isToolAllowedByGrants("get_marketing_summary", ["backlog_read"])).toBe(false);
    expect(isToolAllowedByGrants("get_marketing_summary", [])).toBe(false);
  });

  it("suggest_campaign_ideas requires marketing_read", () => {
    expect(isToolAllowedByGrants("suggest_campaign_ideas", ["marketing_read"])).toBe(true);
    expect(isToolAllowedByGrants("suggest_campaign_ideas", ["registry_read"])).toBe(false);
  });

  it("analyze_seo_opportunity requires marketing_read", () => {
    expect(isToolAllowedByGrants("analyze_seo_opportunity", ["marketing_read"])).toBe(true);
    expect(isToolAllowedByGrants("analyze_seo_opportunity", [])).toBe(false);
  });

  it("generate_custom_archetype requires marketing_write", () => {
    expect(isToolAllowedByGrants("generate_custom_archetype", ["marketing_write"])).toBe(true);
    expect(isToolAllowedByGrants("generate_custom_archetype", ["marketing_read"])).toBe(false);
  });
});

describe("TOOL_TO_GRANTS — Estate specialist entries", () => {
  it("summarize_estate_posture requires registry_read", () => {
    expect(isToolAllowedByGrants("summarize_estate_posture", ["registry_read"])).toBe(true);
    expect(isToolAllowedByGrants("summarize_estate_posture", ["telemetry_read"])).toBe(false);
  });

  it("validate_version_confidence requires registry_read", () => {
    expect(isToolAllowedByGrants("validate_version_confidence", ["registry_read"])).toBe(true);
    expect(isToolAllowedByGrants("validate_version_confidence", [])).toBe(false);
  });

  it("explain_blast_radius requires registry_read", () => {
    expect(isToolAllowedByGrants("explain_blast_radius", ["registry_read"])).toBe(true);
    expect(isToolAllowedByGrants("explain_blast_radius", ["ea_graph_read"])).toBe(false);
  });

  it("discovery_sweep requires telemetry_read", () => {
    expect(isToolAllowedByGrants("discovery_sweep", ["telemetry_read"])).toBe(true);
    expect(isToolAllowedByGrants("discovery_sweep", ["registry_read"])).toBe(false);
  });
});

describe("TOOL_TO_GRANTS — Admin entries", () => {
  it("admin_view_logs requires admin_read", () => {
    expect(isToolAllowedByGrants("admin_view_logs", ["admin_read"])).toBe(true);
    expect(isToolAllowedByGrants("admin_view_logs", ["file_read"])).toBe(false);
  });

  it("admin_restart_service requires admin_write", () => {
    expect(isToolAllowedByGrants("admin_restart_service", ["admin_write"])).toBe(true);
    expect(isToolAllowedByGrants("admin_restart_service", ["admin_read"])).toBe(false);
  });

  it("admin_run_command requires admin_write", () => {
    expect(isToolAllowedByGrants("admin_run_command", ["admin_write"])).toBe(true);
    expect(isToolAllowedByGrants("admin_run_command", [])).toBe(false);
  });
});

describe("default-deny: unmapped tools are blocked", () => {
  it("denies a tool not in TOOL_TO_GRANTS", () => {
    expect(isToolAllowedByGrants("totally_unknown_tool", ["backlog_read", "file_read"])).toBe(false);
  });

  it("denies even with wildcard-like grant list", () => {
    expect(isToolAllowedByGrants("nonexistent_tool", [
      "backlog_read", "backlog_write", "registry_read", "sandbox_execute",
      "file_read", "admin_read", "marketing_read",
    ])).toBe(false);
  });
});

describe("orchestrator with only build-plan grants cannot use sandbox tools", () => {
  const plannerGrants = ["build_plan_write", "backlog_write"];

  it("cannot use write_sandbox_file", () => {
    expect(isToolAllowedByGrants("write_sandbox_file", plannerGrants)).toBe(false);
  });

  it("cannot use validate_schema", () => {
    expect(isToolAllowedByGrants("validate_schema", plannerGrants)).toBe(false);
  });

  it("cannot use describe_model", () => {
    expect(isToolAllowedByGrants("describe_model", plannerGrants)).toBe(false);
  });

  it("cannot use execute_promotion", () => {
    expect(isToolAllowedByGrants("execute_promotion", plannerGrants)).toBe(false);
  });

  it("cannot use launch_sandbox", () => {
    expect(isToolAllowedByGrants("launch_sandbox", plannerGrants)).toBe(false);
  });

  it("cannot use marketing tools", () => {
    expect(isToolAllowedByGrants("get_marketing_summary", plannerGrants)).toBe(false);
    expect(isToolAllowedByGrants("suggest_campaign_ideas", plannerGrants)).toBe(false);
  });

  it("cannot use admin tools", () => {
    expect(isToolAllowedByGrants("admin_view_logs", plannerGrants)).toBe(false);
    expect(isToolAllowedByGrants("admin_run_command", plannerGrants)).toBe(false);
  });

  it("can still use backlog tools", () => {
    expect(isToolAllowedByGrants("create_backlog_item", plannerGrants)).toBe(true);
    expect(isToolAllowedByGrants("update_backlog_item", plannerGrants)).toBe(true);
    expect(isToolAllowedByGrants("reviewBuildPlan", plannerGrants)).toBe(true);
  });
});

describe("COO grants exclude sandbox tools", () => {
  // COO grants: backlog_read, backlog_write, file_read, registry_read, decision_record_create
  const cooGrants = ["backlog_read", "backlog_write", "file_read", "registry_read", "decision_record_create"];

  it("can use backlog and codebase tools", () => {
    expect(isToolAllowedByGrants("query_backlog", cooGrants)).toBe(true);
    expect(isToolAllowedByGrants("create_backlog_item", cooGrants)).toBe(true);
    expect(isToolAllowedByGrants("read_project_file", cooGrants)).toBe(true);
    expect(isToolAllowedByGrants("search_project_files", cooGrants)).toBe(true);
    expect(isToolAllowedByGrants("propose_improvement", cooGrants)).toBe(true);
  });

  it("cannot use sandbox tools", () => {
    expect(isToolAllowedByGrants("launch_sandbox", cooGrants)).toBe(false);
    expect(isToolAllowedByGrants("write_sandbox_file", cooGrants)).toBe(false);
    expect(isToolAllowedByGrants("check_sandbox", cooGrants)).toBe(false);
    expect(isToolAllowedByGrants("start_sandbox", cooGrants)).toBe(false);
    expect(isToolAllowedByGrants("start_build", cooGrants)).toBe(false);
  });

  it("cannot use admin tools", () => {
    expect(isToolAllowedByGrants("admin_view_logs", cooGrants)).toBe(false);
    expect(isToolAllowedByGrants("admin_run_command", cooGrants)).toBe(false);
  });

  it("cannot use marketing tools", () => {
    expect(isToolAllowedByGrants("get_marketing_summary", cooGrants)).toBe(false);
    expect(isToolAllowedByGrants("suggest_campaign_ideas", cooGrants)).toBe(false);
  });
});

describe("getToolGrantMapping reflects all entries", () => {
  it("includes write_sandbox_file mapped to sandbox_execute", () => {
    const mapping = getToolGrantMapping();
    expect(mapping["write_sandbox_file"]).toEqual(["sandbox_execute"]);
  });

  it("includes validate_schema mapped to sandbox_execute", () => {
    const mapping = getToolGrantMapping();
    expect(mapping["validate_schema"]).toEqual(["sandbox_execute"]);
  });

  it("includes describe_model mapped to sandbox_execute", () => {
    const mapping = getToolGrantMapping();
    expect(mapping["describe_model"]).toEqual(["sandbox_execute"]);
  });

  it("includes execute_promotion mapped to iac_execute", () => {
    const mapping = getToolGrantMapping();
    expect(mapping["execute_promotion"]).toEqual(["iac_execute"]);
  });

  it("includes marketing tools", () => {
    const mapping = getToolGrantMapping();
    expect(mapping["get_marketing_summary"]).toEqual(["marketing_read"]);
    expect(mapping["suggest_campaign_ideas"]).toEqual(["marketing_read"]);
    expect(mapping["analyze_seo_opportunity"]).toEqual(["marketing_read"]);
    expect(mapping["generate_custom_archetype"]).toEqual(["marketing_write"]);
  });

  it("includes admin tools", () => {
    const mapping = getToolGrantMapping();
    expect(mapping["admin_view_logs"]).toEqual(["admin_read"]);
    expect(mapping["admin_restart_service"]).toEqual(["admin_write"]);
    expect(mapping["admin_run_command"]).toEqual(["admin_write"]);
  });

  it("includes estate specialist tools", () => {
    const mapping = getToolGrantMapping();
    expect(mapping["summarize_estate_posture"]).toEqual(["registry_read"]);
    expect(mapping["validate_version_confidence"]).toEqual(["registry_read"]);
    expect(mapping["explain_blast_radius"]).toEqual(["registry_read"]);
    expect(mapping["discovery_sweep"]).toEqual(["telemetry_read"]);
  });

  it("includes hive mind tools", () => {
    const mapping = getToolGrantMapping();
    expect(mapping["assess_contribution"]).toEqual(["backlog_read"]);
    expect(mapping["contribute_to_hive"]).toEqual(["backlog_write"]);
    expect(mapping["apply_platform_update"]).toEqual(["admin_write"]);
  });
});
