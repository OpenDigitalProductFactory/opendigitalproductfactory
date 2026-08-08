import { describe, expect, it } from "vitest";

import { backlogPrismaWhere } from "./backlog-adapter-filter";

describe("backlogPrismaWhere (BI-9DB20C39)", () => {
  it("pushes the closed active status set into Prisma for the default grid lens", () => {
    expect(
      backlogPrismaWhere({
        conditions: [
          {
            field: "status",
            operator: "in",
            value: ["triaging", "open", "in-progress"],
          },
        ],
        logic: "and",
      }),
    ).toEqual({ status: { in: ["triaging", "open", "in-progress"] } });
  });

  it("does not push down an OR or an unrelated filter whose semantics Prisma cannot mirror", () => {
    expect(
      backlogPrismaWhere({
        conditions: [
          { field: "status", operator: "eq", value: "open" },
          { field: "title", operator: "contains", value: "grid" },
        ],
        logic: "or",
      }),
    ).toBeUndefined();
    expect(
      backlogPrismaWhere({
        conditions: [{ field: "title", operator: "contains", value: "grid" }],
        logic: "and",
      }),
    ).toBeUndefined();
  });
});
