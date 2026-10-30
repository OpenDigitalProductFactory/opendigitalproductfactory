import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), inventory: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/actions/work-capsules", () => ({ getDeliveryOutcomeData: mocks.load, getWorkControlData: mocks.inventory, createGovernedWorkAction: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/permissions", () => ({ can: () => false }));
vi.mock("@/lib/portal-context", () => ({ resolvePortalContextEnvelope: vi.fn() }));
import Page from "./page";
describe("Work outcomes route", () => {
    beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "user" } }); mocks.load.mockResolvedValue({ observations: [] }); mocks.inventory.mockResolvedValue({}); });
    it("loads outcomes on the server without loading git inventory for that view", async () => {
        await Page({ searchParams: Promise.resolve({ view: "outcomes", q: "repair", dimension: "campaign" }) });
        expect(mocks.load).toHaveBeenCalledWith({ query: "repair", dimension: "campaign" });
        expect(mocks.inventory).not.toHaveBeenCalled();
    });
    it("retains the existing default view", async () => {
        await Page({ searchParams: Promise.resolve({}) });
        expect(mocks.inventory).toHaveBeenCalledOnce();
        expect(mocks.load).not.toHaveBeenCalled();
    });
});
