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
});

describe("TOOL_TO_GRANTS — Deploy / Release entries", () => {
  it("execute_promotion requires iac_execute", () => {
    expect(isToolAllowedByGrants("execute_promotion", ["iac_execute"])).toBe(true);
    expect(isToolAllowedByGrants("execute_promotion", ["sandbox_execute"])).toBe(false);
    expect(isToolAllowedByGrants("execute_promotion", [])).toBe(false);
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

  it("can still use backlog tools", () => {
    expect(isToolAllowedByGrants("create_backlog_item", plannerGrants)).toBe(true);
    expect(isToolAllowedByGrants("update_backlog_item", plannerGrants)).toBe(true);
    expect(isToolAllowedByGrants("reviewBuildPlan", plannerGrants)).toBe(true);
  });
});

describe("getToolGrantMapping reflects new entries", () => {
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
});
