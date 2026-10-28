import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeliveryAgreementView } from "@/lib/work-management/delivery-agreement";
import { WorkroomDeliveryAgreement } from "./WorkroomDeliveryAgreement";
vi.mock("@/lib/i18n/t.server", () => ({ getT: async () => {
  return (key: string, args?: MessageArgs) => translate("en-US", "deliveryAgreements", key as MessageKey<"deliveryAgreements">, args);
} }));
import { translate, type MessageKey, type MessageArgs } from "@dpf/i18n";
const view: DeliveryAgreementView = { originalObjective: "Intake reaches its owner", capturedAt: "2026-10-25T12:00:00Z",
  basis: "created", acceptance: { digest: "sha256:criteria", criteria: ["Owner receives the original request"] }, objectiveChanged: true,
  disposition: "in-progress", context: { state: "checked", checkedAt: "2026-10-25T12:00:00Z", peerRef: "Customer 0",
    guidanceState: "unavailable", reason: "Guidance access denied. Delivery owner must retrieve a permitted source.", sourceRefs: ["federation-link:LINK-1"] },
  handoff: null, followOnRefs: [] };
describe("Workroom delivery agreement", () => {
  it("keeps the original agreement and source warning behind one accessible disclosure", async () => {
    const html = renderToStaticMarkup(await WorkroomDeliveryAgreement({ view }));
    expect(html).toContain("Delivery details");
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Owner receives the original request");
    expect(html).toContain("Guidance access denied");
    expect(html).toContain("outcome text changed");
    expect(html).not.toContain("Delivered");
  });
  it("shows delivered with evidence and separately tracked follow-on work", async () => {
    const html = renderToStaticMarkup(await WorkroomDeliveryAgreement({ view: { ...view, disposition: "delivered", followOnRefs: ["BI-NEXT"],
      handoff: { schemaVersion: 1, completedAt: "2026-10-25T13:00:00Z", baselineId: "BASE-1", evidenceRefs: ["OE-1"],
        summary: "Intake verified in the portal", followOnRefs: ["BI-NEXT"] } } }));
    expect(html).toContain("Delivered");
    expect(html).toContain("OE-1");
    expect(html).toContain("Tracked separately");
    expect(html).toContain('href="/ops/backlog/BI-NEXT"');
  });
  it("does not imply delivery from a closed status without a handoff", async () => {
    const html = renderToStaticMarkup(await WorkroomDeliveryAgreement({ view: { ...view, disposition: "closed-without-handoff" } }));
    expect(html).toContain("Completion handoff missing");
    expect(html).not.toContain("Delivered");
  });
  it("adds no invented delivery history for a legacy room", async () => {
    expect(renderToStaticMarkup(await WorkroomDeliveryAgreement({ view: null }))).toBe("");
  });
});
