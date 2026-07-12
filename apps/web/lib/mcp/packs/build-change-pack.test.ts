import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  featureBuildFindFirst: vi.fn(),
  featureBuildFindUnique: vi.fn(),
  featureBuildUpdate: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: {
      findFirst: (...a: unknown[]) => db.featureBuildFindFirst(...a),
      findUnique: (...a: unknown[]) => db.featureBuildFindUnique(...a),
      update: (...a: unknown[]) => db.featureBuildUpdate(...a),
    },
  },
}));

import { buildChangePack } from "./build-change-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = ["validate_schema", "set_change_disposition"];

beforeEach(() => {
  vi.clearAllMocks();
  db.featureBuildFindFirst.mockResolvedValue(null);
  db.featureBuildFindUnique.mockResolvedValue(null);
});

describe("build-change pack — registration", () => {
  it("exposes exactly the two change tools with a handler each (no handler-only asymmetry)", () => {
    expect(buildChangePack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(buildChangePack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of buildChangePack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants TOOL_TO_GRANTS for each tool", () => {
    expect(buildChangePack.grants.validate_schema).toEqual(["sandbox_execute"]);
    expect(buildChangePack.grants.set_change_disposition).toEqual(["backlog_write"]);

    expect(isToolAllowedByGrants("validate_schema", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("set_change_disposition", ["backlog_write"])).toBe(true);
  });

  it("marks set_change_disposition as side-effecting and validate_schema as not", () => {
    const byName = Object.fromEntries(buildChangePack.definitions.map((d) => [d.name, d]));
    expect(byName.validate_schema.sideEffect).toBe(false);
    expect(byName.set_change_disposition.sideEffect).toBe(true);
  });
});

describe("build-change pack — handler behavior (delegation preserved)", () => {
  it("validate_schema guards on no active build", async () => {
    const res = await buildChangePack.handlers.validate_schema({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("No active build.");
  });

  it("set_change_disposition guards on no active build", async () => {
    const res = await buildChangePack.handlers.set_change_disposition({ disposition: "private" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("No active build.");
  });

  it("set_change_disposition rejects an invalid disposition once a build resolves", async () => {
    db.featureBuildFindFirst.mockResolvedValue({ buildId: "FB-1" });
    const res = await buildChangePack.handlers.set_change_disposition({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Invalid disposition.");
    expect(db.featureBuildUpdate).not.toHaveBeenCalled();
  });
});
