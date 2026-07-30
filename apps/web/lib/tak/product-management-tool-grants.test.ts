import { describe, expect, it } from "vitest";
import { isToolAllowedByGrants } from "./agent-grants";
import { PRODUCT_OUTCOME_WRITE_TOOLS } from "./product-management-tool-grants";

describe("product-management tool grants", () => {
  it("keeps every objective and observation write on backlog_write", () => {
    for (const tool of PRODUCT_OUTCOME_WRITE_TOOLS) {
      expect(isToolAllowedByGrants(tool, ["backlog_write"]), tool).toBe(true);
      expect(isToolAllowedByGrants(tool, ["backlog_read"]), tool).toBe(false);
    }
  });
});
