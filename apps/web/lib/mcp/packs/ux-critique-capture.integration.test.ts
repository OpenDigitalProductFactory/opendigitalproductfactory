import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "@/lib/mcp-tool-types";

// Real handler -> capture validation -> overlay writer -> wiki-store helpers.
// Only storage and framework/network boundaries are substituted, not actions.
const fixture = vi.hoisted(() => ({
  pages: [] as Array<Record<string, unknown>>,
  revisions: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(() => { throw new Error("No browser cache context"); }) }));
vi.mock("@/lib/wiki/page-links", () => ({ syncWikiPageLinks: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock("@/lib/wiki/craft-override-promotion", () => ({ promoteCraftOverrideOnPublish: vi.fn() }));
vi.mock("@/lib/wiki/embed-published-overlay", () => ({ embedPublishedOverlayPage: vi.fn() }));
vi.mock("@/lib/media", () => ({ attachMedia: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {
  organization: { findFirst: async () => ({ id: "fixture-org" }) },
  wikiPage: {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => fixture.pages.find(p =>
      Object.entries(where).every(([key, value]) => p[key] === value)) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (fixture.pages.some(p => p.organizationId === data.organizationId && p.slug === data.slug)) {
        throw Object.assign(new Error("Unique organization/slug constraint"), { code: "P2002" });
      }
      const page = { ...data, id: `fixture-page-${fixture.pages.length}`, updatedAt: new Date("2026-10-30T00:00:00Z") };
      fixture.pages.push(page); return page;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const page = fixture.pages.find(p => p.id === where.id)!; Object.assign(page, data); return page;
    },
    findMany: async () => fixture.pages,
  },
  wikiPageRevision: {
    findFirst: async () => fixture.revisions.at(-1) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => { fixture.revisions.push(data); return data; },
  },
} }));

import { uxCritiquePack } from "./ux-critique-pack";
import { revalidatePath } from "next/cache";
const params = { title: "Expense route fixture", route: "/finance/spend", lens: "hierarchy",
  finding: "The personal-expense card opens a review list without a claim entry action.", proposedVerdict: "change-needed" };
const context: ToolExecutionContext = { agentId: "fixture-agent", governedSource: "external-jsonrpc",
  userContext: { userId: "fixture-user", platformRole: "HR-000", isSuperuser: false } };
const capture = (input: Record<string, unknown> = params, ctx: ToolExecutionContext | undefined = context) =>
  uxCritiquePack.handlers.capture_ux_critique(input, "fixture-user", ctx);
beforeEach(() => { fixture.pages.length = 0; fixture.revisions.length = 0; vi.mocked(revalidatePath).mockClear(); });

describe("native no-cookie critique capture boundary", () => {
  it("saves and reads back the same scoped draft with authenticated authorship", async () => {
    const result = await capture();
    expect(result, JSON.stringify(result)).toMatchObject({ success: true });
    expect(fixture.pages).toHaveLength(1);
    expect(fixture.pages[0]).toMatchObject({ organizationId: "fixture-org", status: "draft", isKernel: false });
    expect(fixture.revisions[0]).toMatchObject({ createdById: "fixture-user", createdByAgentId: "fixture-agent" });
    expect(revalidatePath).not.toHaveBeenCalled();
    const read = await uxCritiquePack.handlers.search_ux_critique_corpus({ route: params.route }, "fixture-user", context);
    expect(JSON.stringify(read)).toContain(params.finding);
    expect(JSON.stringify(read)).toContain('"calibrationEligible":false');
  });
  it.each([
    {},
    { ...context, agentId: undefined },
    { ...context, userContext: { userId: "other-user", platformRole: "HR-000", isSuperuser: false } },
    { ...context, userContext: { userId: "fixture-user", platformRole: null, isSuperuser: false } },
  ])("refuses missing or mismatched server authority before writes", async (ctx) => {
    expect(await capture(params, ctx)).toMatchObject({ success: false });
    expect(fixture.pages).toHaveLength(0);
    expect(fixture.revisions).toHaveLength(0);
  });
  it("ignores caller-selected actor, organization, publication and human verdict authority", async () => {
    expect(await capture({ ...params, userId: "victim", organizationId: "other-org", callerKind: "human",
      verdictAuthority: "founder", status: "published", pageId: "kernel-page" })).toMatchObject({ success: true });
    expect(fixture.pages[0]).toMatchObject({ organizationId: "fixture-org", status: "draft", isKernel: false,
      metadata: { verdictAuthority: "agent-proposed" } });
    expect(fixture.revisions[0].createdById).toBe("fixture-user");
  });
  it("retains critique validation before persistence", async () => {
    expect(await capture({ ...params, finding: "feels cluttered" })).toMatchObject({ success: false });
    expect(fixture.pages).toHaveLength(0);
  });
  it.each(["draft", "published"])("never replaces an existing %s finding with the same title", async (status) => {
    const existing = { id: "fixture-reviewed", organizationId: "fixture-org",
      slug: "craft/ux-design/expense-route-fixture", status, isKernel: false,
      title: params.title, body: "An earlier human observation must remain intact.",
      metadata: { verdictAuthority: "founder" } };
    fixture.pages.push({ ...existing });
    expect(await capture()).toMatchObject({ success: false });
    expect(fixture.pages).toEqual([existing]);
    expect(fixture.revisions).toHaveLength(0);
  });
});
