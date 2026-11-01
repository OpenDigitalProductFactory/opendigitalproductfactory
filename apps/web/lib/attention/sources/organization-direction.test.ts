import { describe, expect, it, vi } from "vitest";
import {
  DIRECTION_ROUTE,
  loadOrganizationDirectionItems,
  organizationDirectionToAttentionItem,
} from "./organization-direction";

function db(state: {
  org?: { id: string } | null;
  bc?: { mission?: string | null; vision?: string | null } | null;
  outcomeCount?: number;
}) {
  return {
    organization: { findFirst: vi.fn(async () => (state.org === undefined ? { id: "org-1" } : state.org)) },
    businessContext: { findUnique: vi.fn(async () => state.bc ?? null) },
    instanceOutcome: { count: vi.fn(async () => state.outcomeCount ?? 0) },
  } as unknown as Parameters<typeof loadOrganizationDirectionItems>[0];
}

describe("organization-direction attention source (BI-916216E7 AC-4)", () => {
  it("raises exactly one item when nothing is recorded", async () => {
    const items = await loadOrganizationDirectionItems(db({}), new Date("2026-10-28T00:00:00Z"));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "organization-direction",
      source: "organization-direction",
      deepLink: DIRECTION_ROUTE,
      audience: { operator: true },
    });
  });

  it("still raises one item when only part is missing, and names what is missing", async () => {
    const items = await loadOrganizationDirectionItems(db({ bc: { mission: "M", vision: "V" }, outcomeCount: 0 }));
    expect(items).toHaveLength(1);
    expect(items[0]!.context).toMatch(/outcomes/i);
    expect(items[0]!.context).not.toMatch(/mission/i);
  });

  it("raises nothing once mission, vision and an outcome are recorded", async () => {
    expect(await loadOrganizationDirectionItems(db({ bc: { mission: "M", vision: "V" }, outcomeCount: 2 }))).toEqual([]);
  });

  it("raises nothing before an organization exists", async () => {
    expect(await loadOrganizationDirectionItems(db({ org: null }))).toEqual([]);
  });

  it("links straight to the Direction panel and is never irreversible", () => {
    const item = organizationDirectionToAttentionItem(["vision"], "2026-10-28T00:00:00.000Z");
    expect(item.actions[0]).toMatchObject({ kind: "open-in-context", href: DIRECTION_ROUTE });
    expect(item.triage.irreversible).toBe(false);
  });
});
