import { describe, it, expect } from "vitest";
import { isToolAllowedByGrants, getAgentToolGrants, getToolGrantMapping } from "./agent-grants";

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
});
