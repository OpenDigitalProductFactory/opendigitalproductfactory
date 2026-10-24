import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ aggregate: vi.fn(), page: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "owner", isSuperuser: false } }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/attention/aggregate", () => ({ loadAttentionItems: mocks.aggregate, filterAttentionForAudience: (items: unknown[]) => items }));
vi.mock("@/lib/attention/sources/coworker-envelope", () => ({ loadCoworkerEnvelopePage: mocks.page }));
vi.mock("@/lib/quality/escalation-hygiene-runner", () => ({ runEscalationHygiene: async () => {} }));
vi.mock("@/lib/coworker/approval-outcome-store", () => ({ loadApprovalOutcomes: async () => [] }));
vi.mock("@/lib/attention/weekly-digest-preferences", () => ({ loadWeeklyDigestDisposition: async () => null }));
vi.mock("@/lib/i18n/t.server", () => ({ getT: async () => (key: string) => key }));
vi.mock("@/components/attention/ApprovalOutcomeHistory", () => ({ ApprovalOutcomeHistory: () => null }));
vi.mock("@/components/attention/AttentionInbox", () => ({ AttentionInbox: (props: unknown) => <pre>{JSON.stringify(props)}</pre> }));
import Inbox from "./page";

beforeEach(() => { mocks.aggregate.mockResolvedValue({ items: [], failedSources: [] }); });
describe("approval queue page wiring", () => {
  it("uses one scoped queue page and carries its real total and traversal position", async () => {
    mocks.page.mockResolvedValue({ items: [], total: 30, nextCursor: "next" });
    const html = renderToStaticMarkup(await Inbox({ searchParams: Promise.resolve({ approvalsBefore: "position" }) }));
    expect(mocks.aggregate).toHaveBeenLastCalledWith({}, expect.objectContaining({ delegatingUserId: "owner", includeCoworkerEnvelopes: false }));
    expect(mocks.page).toHaveBeenLastCalledWith({}, "owner", expect.any(Number), "position");
    expect(html).toContain("&quot;total&quot;:30");
    expect(html).toContain("&quot;browsingOlder&quot;:true");
  });
  it("propagates a failed queue read without inventing an empty successful page", async () => {
    mocks.page.mockRejectedValueOnce(new Error("unavailable"));
    const html = renderToStaticMarkup(await Inbox({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("&quot;approvalQueue&quot;:null");
    expect(html).toContain("&quot;failedSources&quot;:[&quot;coworker-envelope&quot;]");
  });
});
