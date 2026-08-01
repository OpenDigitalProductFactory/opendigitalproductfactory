import { describe, it, expect } from "vitest";
import {
  GRANT_IMPLICATIONS,
  expandGrants,
  isToolAllowedByGrants,
  getAgentToolGrants,
  getToolGrantMapping,
  knownGrantKeys,
  COWORKER_READ_BASELINE_GRANTS,
} from "./agent-grants";

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

  it("provision_build_engine (runs an install in the sandbox) requires sandbox_execute", () => {
    expect(isToolAllowedByGrants("provision_build_engine", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("provision_build_engine", ["work_capsule_read"])).toBe(false);
    expect(isToolAllowedByGrants("provision_build_engine", [])).toBe(false);
  });

  it("reconcile_build_engines (may run installs in the sandbox) requires sandbox_execute", () => {
    expect(isToolAllowedByGrants("reconcile_build_engines", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("reconcile_build_engines", ["work_capsule_read"])).toBe(false);
    expect(isToolAllowedByGrants("reconcile_build_engines", [])).toBe(false);
  });

  it("start_build requires sandbox_execute", () => {
    expect(isToolAllowedByGrants("start_build", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("start_build", ["file_read"])).toBe(false);
  });

  it("create_portal_pr requires sandbox_execute", () => {
    expect(isToolAllowedByGrants("create_portal_pr", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("create_portal_pr", ["backlog_write"])).toBe(false);
  });

  it("diagnose_sandbox is available to sandbox executors and read-only build observers", () => {
    expect(isToolAllowedByGrants("diagnose_sandbox", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("diagnose_sandbox", ["work_capsule_read"])).toBe(true);
    expect(isToolAllowedByGrants("diagnose_sandbox", ["backlog_read"])).toBe(false);
  });

  it("recover_sandbox requires sandbox execution authority", () => {
    expect(isToolAllowedByGrants("recover_sandbox", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("recover_sandbox", ["work_capsule_read"])).toBe(false);
    expect(isToolAllowedByGrants("recover_sandbox", [])).toBe(false);
  });

  it("Build Studio observer tools require read-only work capsule access", () => {
    const tools = [
      "get_build_engine_readiness",
      "get_build_progress_visibility",
      "get_build_sandbox_state",
      "get_build_dispatch_history",
      "get_build_scoped_verification",
      "list_build_activity_since",
    ];

    for (const tool of tools) {
      expect(isToolAllowedByGrants(tool, ["work_capsule_read"])).toBe(true);
      expect(isToolAllowedByGrants(tool, ["sandbox_execute"])).toBe(false);
      expect(isToolAllowedByGrants(tool, ["backlog_read"])).toBe(false);
    }
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

  it("save_marketing_review requires marketing_write", () => {
    expect(isToolAllowedByGrants("save_marketing_review", ["marketing_write"])).toBe(true);
    expect(isToolAllowedByGrants("save_marketing_review", ["marketing_read"])).toBe(false);
  });

  it("marketing work product tools require marketing_write", () => {
    const tools = [
      "create_marketing_campaign_brief",
      "create_marketing_asset_task",
      "draft_marketing_asset",
      "record_marketing_kpi_checkpoint",
      "create_marketing_automation_candidate",
    ];

    for (const tool of tools) {
      expect(isToolAllowedByGrants(tool, ["marketing_write"])).toBe(true);
      expect(isToolAllowedByGrants(tool, ["marketing_read"])).toBe(false);
    }
  });

  it("customer-advisor's read-only marketing grant can use read marketing tools", () => {
    const customerAdvisorGrants = [
      "consumer_read",
      "registry_read",
      "backlog_read",
      "backlog_write",
      "marketing_read",
    ];

    expect(isToolAllowedByGrants("get_marketing_summary", customerAdvisorGrants)).toBe(true);
    expect(isToolAllowedByGrants("suggest_campaign_ideas", customerAdvisorGrants)).toBe(true);
    expect(isToolAllowedByGrants("analyze_seo_opportunity", customerAdvisorGrants)).toBe(true);
    expect(isToolAllowedByGrants("generate_custom_archetype", customerAdvisorGrants)).toBe(false);
  });

  it("storefront-advisor grants do not permit marketing tools", () => {
    const storefrontAdvisorGrants = [
      "consumer_read",
      "registry_read",
      "backlog_read",
      "backlog_write",
    ];

    expect(isToolAllowedByGrants("get_marketing_summary", storefrontAdvisorGrants)).toBe(false);
    expect(isToolAllowedByGrants("suggest_campaign_ideas", storefrontAdvisorGrants)).toBe(false);
    expect(isToolAllowedByGrants("analyze_seo_opportunity", storefrontAdvisorGrants)).toBe(false);
    expect(isToolAllowedByGrants("generate_custom_archetype", storefrontAdvisorGrants)).toBe(false);
  });
});

describe("TOOL_TO_GRANTS — Finance entries", () => {
  it("get_finance_period_summary requires the finance reporting grant", () => {
    expect(isToolAllowedByGrants("get_finance_period_summary", ["financial_report_create"])).toBe(true);
    expect(isToolAllowedByGrants("get_finance_period_summary", ["budget_read"])).toBe(false);
    expect(isToolAllowedByGrants("get_finance_period_summary", ["registry_read"])).toBe(false);
    expect(isToolAllowedByGrants("get_finance_period_summary", [])).toBe(false);
  });
});

describe("TOOL_TO_GRANTS — Estate specialist entries", () => {
  it("summarize_estate_posture requires registry_read", () => {
    expect(isToolAllowedByGrants("summarize_estate_posture", ["registry_read"])).toBe(true);
    expect(isToolAllowedByGrants("summarize_estate_posture", ["telemetry_read"])).toBe(false);
  });

  it("review_estate_identity requires registry_read", () => {
    expect(isToolAllowedByGrants("review_estate_identity", ["registry_read"])).toBe(true);
    expect(isToolAllowedByGrants("review_estate_identity", ["telemetry_read"])).toBe(false);
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

  it("run_discovery_triage requires registry_write", () => {
    expect(isToolAllowedByGrants("run_discovery_triage", ["registry_write"])).toBe(true);
    expect(isToolAllowedByGrants("run_discovery_triage", ["registry_read"])).toBe(false);
  });

  it("run_hive_scout_ingest requires backlog_write", () => {
    expect(isToolAllowedByGrants("run_hive_scout_ingest", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("run_hive_scout_ingest", ["registry_read"])).toBe(false);
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

describe("TOOL_TO_GRANTS — Licensing compliance entries", () => {
  it("save_licensing_investigation requires policy_write", () => {
    expect(isToolAllowedByGrants("save_licensing_investigation", ["policy_write"])).toBe(true);
    expect(isToolAllowedByGrants("save_licensing_investigation", ["registry_read"])).toBe(false);
  });

  it("create_licensing_readiness_issue requires policy_write", () => {
    expect(isToolAllowedByGrants("create_licensing_readiness_issue", ["policy_write"])).toBe(true);
    expect(isToolAllowedByGrants("create_licensing_readiness_issue", ["backlog_write"])).toBe(false);
  });

  it("licensing specialist grants allow licensing write tools", () => {
    const licensingSpecialistGrants = getAgentToolGrants("licensing-specialist");
    expect(licensingSpecialistGrants).toContain("policy_write");
    expect(isToolAllowedByGrants("save_licensing_investigation", licensingSpecialistGrants ?? [])).toBe(true);
    expect(isToolAllowedByGrants("create_licensing_readiness_issue", licensingSpecialistGrants ?? [])).toBe(true);
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

describe("TOOL_TO_GRANTS — Tool marketplace entries", () => {
  it("search_tool_marketplace requires registry_read", () => {
    expect(isToolAllowedByGrants("search_tool_marketplace", ["registry_read"])).toBe(true);
    expect(isToolAllowedByGrants("search_tool_marketplace", ["web_search"])).toBe(false);
  });

  it("coworker self-assessment tools require registry_read", () => {
    const tools = [
      "get_my_coworker_profile",
      "assess_my_capabilities",
      "submit_coworker_capability_need",
      "list_my_capability_needs",
    ];

    for (const tool of tools) {
      expect(isToolAllowedByGrants(tool, ["registry_read"])).toBe(true);
      expect(isToolAllowedByGrants(tool, ["backlog_write"])).toBe(false);
    }
  });
});

describe("TOOL_TO_GRANTS — Backlog hygiene entries", () => {
  it("generic epic tools require backlog_write", () => {
    expect(isToolAllowedByGrants("create_epic", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("update_epic", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("create_epic", ["backlog_read"])).toBe(false);
    expect(isToolAllowedByGrants("update_epic", ["backlog_read"])).toBe(false);
  });

  it("retire_backlog_item requires backlog_write without broader triage authority", () => {
    expect(isToolAllowedByGrants("retire_backlog_item", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("retire_backlog_item", ["backlog_read"])).toBe(false);
    expect(isToolAllowedByGrants("retire_backlog_item", ["backlog_triage"])).toBe(false);
  });
});

describe("TOOL_TO_GRANTS - Work Capsule entries", () => {
  it("read tools require work_capsule_read", () => {
    expect(isToolAllowedByGrants("list_work_capsules", ["work_capsule_read"])).toBe(true);
    expect(isToolAllowedByGrants("get_work_capsule", ["work_capsule_read"])).toBe(true);
    expect(isToolAllowedByGrants("list_work_capsules", ["backlog_read"])).toBe(false);
  });

  it("write tools require work_capsule_write", () => {
    expect(isToolAllowedByGrants("create_work_capsule", ["work_capsule_write"])).toBe(true);
    expect(isToolAllowedByGrants("plan_capsule_worktree", ["work_capsule_write"])).toBe(true);
    expect(isToolAllowedByGrants("record_capsule_evidence", ["work_capsule_write"])).toBe(true);
    expect(isToolAllowedByGrants("heartbeat_capsule", ["work_capsule_read"])).toBe(false);
    expect(isToolAllowedByGrants("plan_capsule_worktree", ["work_capsule_read"])).toBe(false);
  });

  it("adoption requires work_capsule_adopt", () => {
    expect(isToolAllowedByGrants("adopt_worktree", ["work_capsule_adopt"])).toBe(true);
    expect(isToolAllowedByGrants("adopt_worktree", ["work_capsule_write"])).toBe(false);
  });
});

describe("TOOL_TO_GRANTS - External development coordination entries", () => {
  it("evidence recording tools require backlog_write", () => {
    expect(isToolAllowedByGrants("record_external_development_evidence", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("review_semantic_change", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("record_local_integration_result", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("record_external_development_evidence", ["registry_read"])).toBe(false);
    expect(isToolAllowedByGrants("review_semantic_change", ["view_platform"])).toBe(false);
    expect(isToolAllowedByGrants("record_local_integration_result", ["work_capsule_write"])).toBe(false);
  });

  it("nonproduction environment lease tools require work capsule coordination grants", () => {
    expect(isToolAllowedByGrants("list_nonprod_environment_leases", ["work_capsule_read"])).toBe(true);
    expect(isToolAllowedByGrants("claim_nonprod_environment_lease", ["work_capsule_write"])).toBe(true);
    expect(isToolAllowedByGrants("release_nonprod_environment_lease", ["work_capsule_write"])).toBe(true);
    expect(isToolAllowedByGrants("claim_nonprod_environment_lease", ["sandbox_execute"])).toBe(false);
    expect(isToolAllowedByGrants("release_nonprod_environment_lease", ["work_capsule_read"])).toBe(false);
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
    expect(mapping["save_marketing_review"]).toEqual(["marketing_write"]);
    expect(mapping["create_marketing_campaign_brief"]).toEqual(["marketing_write"]);
    expect(mapping["create_marketing_asset_task"]).toEqual(["marketing_write"]);
    expect(mapping["draft_marketing_asset"]).toEqual(["marketing_write"]);
    expect(mapping["record_marketing_kpi_checkpoint"]).toEqual(["marketing_write"]);
    expect(mapping["create_marketing_automation_candidate"]).toEqual(["marketing_write"]);
    expect(mapping["generate_custom_archetype"]).toEqual(["marketing_write"]);
  });

  it("includes finance tools", () => {
    const mapping = getToolGrantMapping();
    expect(mapping["get_finance_period_summary"]).toEqual(["financial_report_create"]);
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
    expect(mapping["review_estate_identity"]).toEqual(["registry_read"]);
    expect(mapping["validate_version_confidence"]).toEqual(["registry_read"]);
    expect(mapping["explain_blast_radius"]).toEqual(["registry_read"]);
    expect(mapping["discovery_sweep"]).toEqual(["telemetry_read"]);
    expect(mapping["run_discovery_triage"]).toEqual(["registry_write"]);
    expect(mapping["run_hive_scout_ingest"]).toEqual(["backlog_write"]);
  });

  it("includes hive mind tools", () => {
    const mapping = getToolGrantMapping();
    expect(mapping["assess_contribution"]).toEqual(["backlog_read"]);
    expect(mapping["contribute_to_hive"]).toEqual(["backlog_write"]);
    expect(mapping["apply_platform_update"]).toEqual(["admin_write"]);
  });

  it("includes code graph tools", () => {
    const mapping = getToolGrantMapping();
    expect(mapping["get_code_graph_freshness"]).toEqual(["code_graph_read"]);
    expect(mapping["inspect_build_code_impact"]).toEqual(["code_graph_read"]);
    expect(mapping["search_code_graph"]).toEqual(["code_graph_read"]);
    expect(mapping["trace_code_surface"]).toEqual(["code_graph_read"]);
    expect(mapping["find_related_tests"]).toEqual(["code_graph_read"]);
  });
});

describe("agent registry grant lookup", () => {
  it("resolves routed coworker persona slugs as well as canonical registry ids", () => {
    expect(getAgentToolGrants("marketing-specialist")).toEqual(
      expect.arrayContaining(["marketing_read", "marketing_write"]),
    );
    expect(getAgentToolGrants("AGT-WS-MARKETING")).toEqual(
      expect.arrayContaining(["marketing_read", "marketing_write"]),
    );
  });

  it("lets the finance specialist use public web research when External Access is enabled", () => {
    const financeGrants = getAgentToolGrants("finance-agent");

    expect(financeGrants).toEqual(expect.arrayContaining(["web_search"]));
    expect(isToolAllowedByGrants("search_public_web", financeGrants ?? [])).toBe(true);
    expect(isToolAllowedByGrants("fetch_public_website", financeGrants ?? [])).toBe(true);
  });

  it("lets the finance specialist use the direct finance period summary tool", () => {
    const financeGrants = getAgentToolGrants("finance-agent");

    expect(financeGrants).toEqual(expect.arrayContaining(["financial_report_create"]));
    expect(isToolAllowedByGrants("get_finance_period_summary", financeGrants ?? [])).toBe(true);
  });

  it("lets the finance specialist drive browser-use for authenticated billing evidence", () => {
    const financeGrants = getAgentToolGrants("finance-agent");

    expect(financeGrants).toEqual(expect.arrayContaining(["browser_drive"]));
    expect(isToolAllowedByGrants("mcp-browser-use__browse_open", financeGrants ?? [])).toBe(true);
    expect(isToolAllowedByGrants("mcp-browser-use__browse_extract", financeGrants ?? [])).toBe(true);
    expect(isToolAllowedByGrants("mcp-browser-use__browse_screenshot", financeGrants ?? [])).toBe(true);
    expect(isToolAllowedByGrants("mcp-browser-use__browse_act", financeGrants ?? [])).toBe(true);
    expect(isToolAllowedByGrants("mcp-browser-use__browse_close", financeGrants ?? [])).toBe(true);
  });

  it("lets the build specialist use the read-only code graph tools", () => {
    const bySlug = getAgentToolGrants("build-specialist");
    const byRegistryId = getAgentToolGrants("AGT-WS-BUILD");

    expect(bySlug).toEqual(expect.arrayContaining(["code_graph_read"]));
    expect(byRegistryId).toEqual(expect.arrayContaining(["code_graph_read"]));
    expect(isToolAllowedByGrants("get_code_graph_freshness", bySlug ?? [])).toBe(true);
    expect(isToolAllowedByGrants("inspect_build_code_impact", bySlug ?? [])).toBe(true);
    expect(isToolAllowedByGrants("search_code_graph", bySlug ?? [])).toBe(true);
    expect(isToolAllowedByGrants("trace_code_surface", bySlug ?? [])).toBe(true);
    expect(isToolAllowedByGrants("find_related_tests", bySlug ?? [])).toBe(true);
  });

  it("lets the build specialist drive Build Studio screen controls", () => {
    const grants = getAgentToolGrants("build-specialist");

    expect(grants).toEqual(expect.arrayContaining(["coworker_screen_read", "coworker_screen_drive"]));
    expect(isToolAllowedByGrants("screen_describe", grants ?? [])).toBe(true);
    expect(isToolAllowedByGrants("screen_select_entity", grants ?? [])).toBe(true);
    expect(isToolAllowedByGrants("screen_navigate", grants ?? [])).toBe(true);
  });

  it("lets the admin assistant use read-only admin and backlog tools from the registry seed", () => {
    const grants = getAgentToolGrants("admin-assistant");

    expect(grants).toEqual(expect.arrayContaining(["admin_read", "admin_write", "backlog_read", "backlog_write"]));
    expect(isToolAllowedByGrants("admin_query_db", grants ?? [])).toBe(true);
    expect(isToolAllowedByGrants("admin_read_file", grants ?? [])).toBe(true);
    expect(isToolAllowedByGrants("create_backlog_item", grants ?? [])).toBe(true);
  });
});

// Pseudo-User Contract Phase 1 (BI-B2F7ABF5) — grant implications + finer
// build-scoped grants. Verifies backwards-compat (existing roles still work)
// and forward correctness (new finer grants resolve, do not over-grant).
describe("GRANT_IMPLICATIONS — Pseudo-User Contract (BI-B2F7ABF5)", () => {
  it("expandGrants is a no-op for grants with no implications", () => {
    expect(expandGrants(["sandbox_execute"])).toEqual(["sandbox_execute"]);
    expect(expandGrants(["registry_read", "file_read"])).toEqual(["registry_read", "file_read"]);
  });

  it("expandGrants adds build_evidence + build_phase_advance when backlog_write is held", () => {
    const expanded = expandGrants(["backlog_write"]);
    expect(expanded).toContain("backlog_write");
    expect(expanded).toContain("build_evidence");
    expect(expanded).toContain("build_phase_advance");
  });

  it("expandGrants adds build_lifecycle when build_promote is held", () => {
    const expanded = expandGrants(["build_promote"]);
    expect(expanded).toContain("build_promote");
    expect(expanded).toContain("build_lifecycle");
  });

  it("implications are one-way — build_evidence does NOT imply backlog_write", () => {
    const expanded = expandGrants(["build_evidence"]);
    expect(expanded).not.toContain("backlog_write");
    expect(expanded).not.toContain("build_phase_advance");
  });

  it("expandGrants does not duplicate implied grants already held explicitly", () => {
    const expanded = expandGrants(["backlog_write", "build_evidence"]);
    // expandGrants returns an array of unique entries.
    expect(expanded.filter((g) => g === "build_evidence")).toHaveLength(1);
  });

  it("GRANT_IMPLICATIONS is readonly at the type layer", () => {
    // Smoke: the exported constant carries the expected mappings. We don't
    // mutate it at runtime (it's TS readonly + frozen by convention).
    expect(GRANT_IMPLICATIONS).toMatchObject({
      backlog_write: expect.arrayContaining(["build_evidence", "build_phase_advance"]),
      build_promote: expect.arrayContaining(["build_lifecycle"]),
    });
  });
});

describe("Refactored build-scoped tools — backwards compat via implications", () => {
  // Tools refactored from backlog_write → build_evidence (BI-B2F7ABF5).
  it("record_execution_evidence accepts the new build_evidence grant", () => {
    expect(isToolAllowedByGrants("record_execution_evidence", ["build_evidence"])).toBe(true);
  });

  it("record_execution_evidence still accepts the legacy backlog_write via implications", () => {
    expect(isToolAllowedByGrants("record_execution_evidence", ["backlog_write"])).toBe(true);
  });

  it("record_execution_evidence still denies an unrelated grant", () => {
    expect(isToolAllowedByGrants("record_execution_evidence", ["registry_read"])).toBe(false);
    expect(isToolAllowedByGrants("record_execution_evidence", ["build_lifecycle"])).toBe(false);
  });

  it("save_build_notes and saveBuildEvidence accept build_evidence or legacy backlog_write", () => {
    for (const tool of ["save_build_notes", "saveBuildEvidence"]) {
      expect(isToolAllowedByGrants(tool, ["build_evidence"])).toBe(true);
      expect(isToolAllowedByGrants(tool, ["backlog_write"])).toBe(true);
      expect(isToolAllowedByGrants(tool, ["build_phase_advance"])).toBe(false);
    }
  });

  // Tools refactored from backlog_write → build_phase_advance (BI-B2F7ABF5).
  it("approve_decomposition accepts build_phase_advance or legacy backlog_write", () => {
    expect(isToolAllowedByGrants("approve_decomposition", ["build_phase_advance"])).toBe(true);
    expect(isToolAllowedByGrants("approve_decomposition", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("approve_decomposition", ["build_evidence"])).toBe(false);
  });

  it("propose_build_decomposition and record_decomposition_override follow the same pattern", () => {
    for (const tool of ["propose_build_decomposition", "record_decomposition_override"]) {
      expect(isToolAllowedByGrants(tool, ["build_phase_advance"])).toBe(true);
      expect(isToolAllowedByGrants(tool, ["backlog_write"])).toBe(true);
      expect(isToolAllowedByGrants(tool, ["registry_read"])).toBe(false);
    }
  });

  // Tools refactored from build_promote → build_lifecycle (BI-B2F7ABF5).
  it("promote_to_build_studio accepts build_lifecycle or legacy build_promote", () => {
    expect(isToolAllowedByGrants("promote_to_build_studio", ["build_lifecycle"])).toBe(true);
    expect(isToolAllowedByGrants("promote_to_build_studio", ["build_promote"])).toBe(true);
    expect(isToolAllowedByGrants("promote_to_build_studio", ["backlog_write"])).toBe(false);
  });

  it("process_backlog_for_build_studio accepts build_lifecycle or legacy build_promote", () => {
    expect(isToolAllowedByGrants("process_backlog_for_build_studio", ["build_lifecycle"])).toBe(true);
    expect(isToolAllowedByGrants("process_backlog_for_build_studio", ["build_promote"])).toBe(true);
  });

  // BI-297863B2: governed self-abandon shares promote's grant — same authority
  // that lets an agent bring a build INTO Build Studio also lets it free its
  // own stalled/superseded WIP slot.
  it("abandon_stalled_build accepts build_lifecycle or legacy build_promote, not a lesser grant", () => {
    expect(isToolAllowedByGrants("abandon_stalled_build", ["build_lifecycle"])).toBe(true);
    expect(isToolAllowedByGrants("abandon_stalled_build", ["build_promote"])).toBe(true);
    expect(isToolAllowedByGrants("abandon_stalled_build", ["backlog_write"])).toBe(false);
    expect(isToolAllowedByGrants("abandon_stalled_build", [])).toBe(false);
  });

  // Tools NOT refactored — should remain on their original grants.
  it("record_external_development_evidence still requires backlog_write directly", () => {
    expect(isToolAllowedByGrants("record_external_development_evidence", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("record_external_development_evidence", ["build_evidence"])).toBe(false);
  });

  it("update_backlog_item_status keeps backlog_write (not yet split for build-scope)", () => {
    expect(isToolAllowedByGrants("update_backlog_item_status", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("update_backlog_item_status", ["build_phase_advance"])).toBe(false);
  });
});

describe("Build-evidence-scoped coworker — narrow grant does not overreach", () => {
  // A future coworker token issued with ONLY build_evidence (the goal of the
  // refactor) must be able to record evidence but must NOT be able to e.g.
  // create new backlog items or mutate non-build backlog state.
  const buildEvidenceOnly = ["build_evidence"];

  it("can call build-evidence tools", () => {
    expect(isToolAllowedByGrants("record_execution_evidence", buildEvidenceOnly)).toBe(true);
    expect(isToolAllowedByGrants("save_build_notes", buildEvidenceOnly)).toBe(true);
    expect(isToolAllowedByGrants("saveBuildEvidence", buildEvidenceOnly)).toBe(true);
  });

  it("cannot call broader backlog mutation tools", () => {
    expect(isToolAllowedByGrants("create_backlog_item", buildEvidenceOnly)).toBe(false);
    expect(isToolAllowedByGrants("create_epic", buildEvidenceOnly)).toBe(false);
    expect(isToolAllowedByGrants("update_backlog_item_status", buildEvidenceOnly)).toBe(false);
    expect(isToolAllowedByGrants("retire_backlog_item", buildEvidenceOnly)).toBe(false);
  });

  it("cannot call build-phase-advance tools (different finer grant)", () => {
    expect(isToolAllowedByGrants("approve_decomposition", buildEvidenceOnly)).toBe(false);
    expect(isToolAllowedByGrants("propose_build_decomposition", buildEvidenceOnly)).toBe(false);
  });

  it("cannot call build-lifecycle tools (different finer grant)", () => {
    expect(isToolAllowedByGrants("promote_to_build_studio", buildEvidenceOnly)).toBe(false);
  });
});

describe("Existing coworkers — no behavior regression from the refactor", () => {
  // The COO grants set (already covered above for sandbox denial) — confirm
  // it ALSO retains access to the refactored build-evidence and build-phase
  // tools via the backlog_write implication. This is the critical
  // backwards-compat invariant.
  const cooGrants = ["backlog_read", "backlog_write", "file_read", "registry_read", "decision_record_create"];

  it("COO retains access to record_execution_evidence", () => {
    expect(isToolAllowedByGrants("record_execution_evidence", cooGrants)).toBe(true);
  });

  it("COO retains access to approve_decomposition", () => {
    expect(isToolAllowedByGrants("approve_decomposition", cooGrants)).toBe(true);
  });

  it("COO retains access to save_build_notes / saveBuildEvidence", () => {
    expect(isToolAllowedByGrants("save_build_notes", cooGrants)).toBe(true);
    expect(isToolAllowedByGrants("saveBuildEvidence", cooGrants)).toBe(true);
  });

  it("COO still cannot call build-lifecycle (build_promote not in their set)", () => {
    // Sanity: backlog_write does NOT imply build_lifecycle (separate finer grant).
    expect(isToolAllowedByGrants("promote_to_build_studio", cooGrants)).toBe(false);
  });
});

describe("TOOL_TO_GRANTS — Browser-driving entries (EP-BROWSER-DRIVE, Verdict 5)", () => {
  it("browse_act (side-effecting) requires browser_drive, not browser_read", () => {
    for (const tool of ["mcp-browser-use__browse_act", "browse_act"]) {
      expect(isToolAllowedByGrants(tool, ["browser_drive"])).toBe(true);
      // browser_read alone is NOT enough to drive — the whole point of the split.
      expect(isToolAllowedByGrants(tool, ["browser_read"])).toBe(false);
      expect(isToolAllowedByGrants(tool, [])).toBe(false);
      expect(isToolAllowedByGrants(tool, ["backlog_write"])).toBe(false);
    }
  });

  it("read tools require browser_read, and browser_drive satisfies them via implication", () => {
    const tools = ["mcp-browser-use__browse_open", "mcp-browser-use__browse_extract", "mcp-browser-use__browse_screenshot", "mcp-browser-use__browse_close", "mcp-browser-use__browse_run_tests", "browse_open", "browse_extract", "browse_screenshot", "browse_close", "browse_run_tests"];
    for (const tool of tools) {
      expect(isToolAllowedByGrants(tool, ["browser_read"])).toBe(true);
      // browser_drive implies browser_read, so a driver can also read.
      expect(isToolAllowedByGrants(tool, ["browser_drive"])).toBe(true);
      expect(isToolAllowedByGrants(tool, [])).toBe(false);
    }
  });

  it("browse_run_tests stays QA-scoped on browser_read, never browser_drive", () => {
    expect(isToolAllowedByGrants("mcp-browser-use__browse_run_tests", ["browser_read"])).toBe(true);
    expect(isToolAllowedByGrants("browse_run_tests", ["browser_read"])).toBe(true);
  });

  it("GRANT_IMPLICATIONS is one-way: browser_drive implies browser_read, not the reverse", () => {
    expect(GRANT_IMPLICATIONS["browser_drive"]).toEqual(["browser_read"]);
    expect(expandGrants(["browser_drive"])).toContain("browser_read");
    expect(expandGrants(["browser_read"])).not.toContain("browser_drive");
  });

  it("the namespaced browser tools are present in the grant mapping (so they don't default-deny)", () => {
    const map = getToolGrantMapping();
    expect(map["mcp-browser-use__browse_act"]).toEqual(["browser_drive"]);
    expect(map["browse_act"]).toEqual(["browser_drive"]);
    expect(map["browse_open"]).toEqual(["browser_read"]);
  });
});

// BI-FD7E4D72 — every coworker gets a read-only baseline so it can see its
// page's coordination data and read the docs, source, and code graph. The
// coworker path (agent-coworker.ts) unions this set with the agent's own grants
// before tool gating in getAvailableTools.
describe("COWORKER_READ_BASELINE_GRANTS — page visibility + docs/source/code-graph reads", () => {
  it("is read-only: only *_read grants plus file_read", () => {
    for (const g of COWORKER_READ_BASELINE_GRANTS) {
      expect(g === "file_read" || g.endsWith("_read")).toBe(true);
    }
  });

  it("unlocks the page coordination, docs, source, and code-graph read tools", () => {
    const baseline = [...COWORKER_READ_BASELINE_GRANTS];
    expect(isToolAllowedByGrants("get_runtime_coordination_map", baseline)).toBe(true);
    expect(isToolAllowedByGrants("list_nonprod_environment_leases", baseline)).toBe(true);
    expect(isToolAllowedByGrants("doc_search", baseline)).toBe(true);
    expect(isToolAllowedByGrants("doc_load", baseline)).toBe(true);
    expect(isToolAllowedByGrants("read_project_file", baseline)).toBe(true);
    expect(isToolAllowedByGrants("search_project_files", baseline)).toBe(true);
    expect(isToolAllowedByGrants("read_source_at_version", baseline)).toBe(true);
    expect(isToolAllowedByGrants("search_code_graph", baseline)).toBe(true);
    expect(isToolAllowedByGrants("trace_code_surface", baseline)).toBe(true);
    expect(isToolAllowedByGrants("find_related_tests", baseline)).toBe(true);
    expect(isToolAllowedByGrants("search_knowledge", baseline)).toBe(true);
    expect(isToolAllowedByGrants("wiki_query", baseline)).toBe(true);
  });

  it("does NOT unlock any write, sandbox, deploy, or admin authority", () => {
    const baseline = [...COWORKER_READ_BASELINE_GRANTS];
    expect(isToolAllowedByGrants("create_backlog_item", baseline)).toBe(false);
    expect(isToolAllowedByGrants("update_backlog_item", baseline)).toBe(false);
    expect(isToolAllowedByGrants("write_sandbox_file", baseline)).toBe(false);
    expect(isToolAllowedByGrants("launch_sandbox", baseline)).toBe(false);
    expect(isToolAllowedByGrants("claim_nonprod_environment_lease", baseline)).toBe(false);
    expect(isToolAllowedByGrants("register_runtime_target", baseline)).toBe(false);
    expect(isToolAllowedByGrants("execute_promotion", baseline)).toBe(false);
    expect(isToolAllowedByGrants("admin_run_command", baseline)).toBe(false);
  });

  it("lifts the ops coordinator (AGT-WS-OPS) from backlog-only to page-visible when unioned", () => {
    const opsGrants = getAgentToolGrants("AGT-WS-OPS") ?? [];
    // Before: the backlog-scoped agent (backlog_read/backlog_write/registry_read)
    // cannot see the runtime coordination map, the code graph, or the source.
    // (Note: doc_search/doc_load are already reachable via its registry_read —
    // TOOL_TO_GRANTS is ANY-of — so the docs were never the gap; the page's own
    // coordination data and the code graph were.)
    expect(isToolAllowedByGrants("get_runtime_coordination_map", opsGrants)).toBe(false);
    expect(isToolAllowedByGrants("list_nonprod_environment_leases", opsGrants)).toBe(false);
    expect(isToolAllowedByGrants("search_code_graph", opsGrants)).toBe(false);
    expect(isToolAllowedByGrants("trace_code_surface", opsGrants)).toBe(false);
    expect(isToolAllowedByGrants("read_project_file", opsGrants)).toBe(false);

    // After: union with the coworker read baseline (what getAvailableTools does).
    const merged = Array.from(new Set([...opsGrants, ...COWORKER_READ_BASELINE_GRANTS]));
    expect(isToolAllowedByGrants("get_runtime_coordination_map", merged)).toBe(true);
    expect(isToolAllowedByGrants("list_nonprod_environment_leases", merged)).toBe(true);
    expect(isToolAllowedByGrants("search_code_graph", merged)).toBe(true);
    expect(isToolAllowedByGrants("trace_code_surface", merged)).toBe(true);
    expect(isToolAllowedByGrants("read_project_file", merged)).toBe(true);
    expect(isToolAllowedByGrants("doc_search", merged)).toBe(true);
    // But its own backlog-write authority is preserved, not lost.
    expect(isToolAllowedByGrants("create_backlog_item", merged)).toBe(true);
  });
});

describe("knownGrantKeys — closed grant vocabulary for the per-coworker editor", () => {
  const keys = knownGrantKeys();

  it("is non-empty, sorted, and de-duplicated", () => {
    expect(keys.length).toBeGreaterThan(20);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes the read baseline and representative tool/implication grants", () => {
    for (const g of COWORKER_READ_BASELINE_GRANTS) expect(keys).toContain(g);
    // A grant that only appears as a TOOL_TO_GRANTS value.
    expect(keys).toContain("sandbox_execute");
    // Both endpoints of an implication (coarse key + the finer implied grant).
    expect(keys).toContain("backlog_write");
    expect(keys).toContain("build_evidence");
  });

  it("only contains grants the runtime actually understands (every key authorizes ≥1 tool, is a baseline, or is an implication endpoint)", () => {
    const mapping = getToolGrantMapping();
    const authorizing = new Set<string>(COWORKER_READ_BASELINE_GRANTS);
    for (const grants of Object.values(mapping)) for (const g of grants) authorizing.add(g);
    for (const [coarse, implied] of Object.entries(GRANT_IMPLICATIONS)) {
      authorizing.add(coarse);
      for (const g of implied) authorizing.add(g);
    }
    for (const k of keys) expect(authorizing.has(k)).toBe(true);
  });
});

describe("web_search roster — outward-facing roles hold it, internal/governance roles do not", () => {
  // Roles whose expected outcome depends on public-internet information the
  // platform does not already hold (market/competitor/vendor/standards/docs
  // research). If any of these regresses, the coworker's web-access toggle
  // silently becomes a no-op again.
  const WEB_RESEARCH_ROLES = [
    "marketing-specialist",
    "external-catalog-scout",
    "inventory-specialist",
    "portfolio-advisor",
    "gap-analysis-agent",
    "security-auditor-agent",
    "sbom-management-agent",
    "build-software-engineer",
    "build-frontend-engineer",
    "build-data-architect",
    "ea-architect",
    "ux-accessibility-agent",
    "investment-analysis-agent",
    "hr-specialist",
  ];

  // Internal-only, governance, or egress-sensitive roles that must NOT reach the
  // public web (privacy, security-estate, or pure internal coordination).
  const NO_WEB_ROLES = [
    "data-governance-agent",
    "soc-triage-analyst",
    "soc-investigator",
    "soc-threat-hunter",
    "soc-incident-commander",
    "coo-orchestrator",
    "governance-orchestrator",
    "evidence-chain-agent",
    "constraint-validation-agent",
  ];

  it.each(WEB_RESEARCH_ROLES)("%s holds web_search and can use public web tools", (role) => {
    const grants = getAgentToolGrants(role);
    expect(grants, `${role} not found in registry`).toBeTruthy();
    expect(grants).toContain("web_search");
    expect(isToolAllowedByGrants("search_public_web", grants ?? [])).toBe(true);
    expect(isToolAllowedByGrants("fetch_public_website", grants ?? [])).toBe(true);
  });

  it.each(NO_WEB_ROLES)("%s does NOT hold web_search", (role) => {
    const grants = getAgentToolGrants(role);
    expect(grants, `${role} not found in registry`).toBeTruthy();
    expect(grants).not.toContain("web_search");
    expect(isToolAllowedByGrants("search_public_web", grants ?? [])).toBe(false);
  });
});
