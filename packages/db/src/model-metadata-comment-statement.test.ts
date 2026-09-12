import { describe, expect, it } from "vitest";

import {
  commentOnTableStatement,
  quoteSqlIdentifier,
  quoteSqlLiteral,
} from "../scripts/apply-model-metadata-comments";

// BI-EA61F512. The first cut emitted `COMMENT ON TABLE "x" IS $1` with a bind
// parameter. COMMENT ON is a PostgreSQL utility statement: it cannot be
// prepared, so that form fails at execution with `syntax error at or near
// "COMMENT"`. It shipped because --dry-run skipped the write entirely, so the
// only verification that ran was the path that could not fail. These tests pin
// the statement SHAPE without a database; the applier's dry-run now also
// executes and rolls back, so the real statement is exercised too.

describe("COMMENT ON statement construction (BI-EA61F512)", () => {
  it("inlines the payload as a quoted literal and never uses a bind parameter", () => {
    const sql = commentOnTableStatement("ToolExecution", 'dpf:{"lifecycle":"telemetry-bounded"}');
    expect(sql).toBe(`COMMENT ON TABLE "ToolExecution" IS 'dpf:{"lifecycle":"telemetry-bounded"}'`);
    expect(sql).not.toContain("$1");
  });

  it("writes NULL unquoted when clearing a stale comment", () => {
    expect(commentOnTableStatement("Widget", null)).toBe(`COMMENT ON TABLE "Widget" IS NULL`);
  });

  it("doubles single quotes in the payload so an apostrophe cannot terminate the literal", () => {
    expect(quoteSqlLiteral("it's fine")).toBe("'it''s fine'");
    const sql = commentOnTableStatement("T", `dpf:{"basis":"the operator's rule"}`);
    expect(sql).toBe(`COMMENT ON TABLE "T" IS 'dpf:{"basis":"the operator''s rule"}'`);
    // One opening and one closing quote only: the literal is not terminated early.
    expect(sql.split("'").length - 1).toBe(4);
  });

  it("doubles double quotes in the identifier", () => {
    expect(quoteSqlIdentifier('we"ird')).toBe('"we""ird"');
  });

  it("refuses an identifier carrying a NUL byte rather than truncating the statement", () => {
    expect(() => quoteSqlIdentifier(`bad${String.fromCharCode(0)}name`)).toThrow(/NUL byte/);
  });
});
