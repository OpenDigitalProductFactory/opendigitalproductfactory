import { beforeAll, describe, expect, it, vi } from "vitest";
import { seedEaArchimate4 } from "../../../../packages/db/src/seed-ea-archimate4";
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: async () => ({ id: "verification-test" }) }));
vi.mock("@/lib/govern/permissions", () => ({ can: () => true }));
vi.mock("@/lib/install/environment-class", () => ({ loadEnvironmentClassResolution: async () => ({ environmentClass: "test" }) }));
import { verifyArchetypeProjectionTool } from "./verify-archetype-projection";
const database = process.env.DATABASE_URL ? describe : describe.skip;
database("deployed projection verification using PostgreSQL", () => {
  beforeAll(async () => { await seedEaArchimate4(); }, 30_000);
  it("uses production reconciliation for the complete lifecycle and rolls the fixture back", async () => {
    const result = await verifyArchetypeProjectionTool({}, "verification-test");
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ fixtureRolledBack: true, definitionCount: 16 });
    expect((result.data as { lifecycleEventIds: string[] }).lifecycleEventIds).toHaveLength(2);
  }, 40_000);
});
