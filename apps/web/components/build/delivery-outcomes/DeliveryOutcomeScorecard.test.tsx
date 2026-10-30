import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { projectDeliveryOutcomes } from "@/lib/delivery-outcomes/projection";
import { DeliveryOutcomeScorecard } from "./DeliveryOutcomeScorecard";
import {measureUxBudget} from "@/lib/ux-budget/measure";
const fixture = () => projectDeliveryOutcomes({ now: new Date("2026-10-29T12:00:00Z"), rooms: [], activities: [], verifications: [], runs: [], tasks: [], tools: [], queue: [], pullRequests: [], sources: [] });
describe("Delivery outcome scorecard", () => {
    it("keeps the fixture arrival bounded and detail controls disclosed",()=>{
        const html=renderToStaticMarkup(<DeliveryOutcomeScorecard data={fixture()}/>);
        const metrics=measureUxBudget(html);
        expect(metrics.defaultVisibleWords).toBeLessThanOrEqual(100);
        expect(metrics.visibleFields).toBe(0);
        expect(metrics.subLegibleControls).toBe(0);
        expect(metrics.buriedPrimaryAction).toBe(0);
        expect(metrics.disclosureRegions).toBeGreaterThanOrEqual(4);
    });
    it("renders explicit empty cohort with accessible sources and no invented success", () => {
        const html = renderToStaticMarkup(<DeliveryOutcomeScorecard data={fixture()}/>);
        expect(html).toContain("Delivery outcomes");
        expect(html).toContain("No visible Workrooms");
        expect(html).toContain("Unavailable");
        expect(html).toContain("Cohort and sources");
        expect(html).toContain('href="/build/work"');
        expect(html).not.toContain("100%");
    });
    it.each(["partial", "failed"] as const)("keeps %s source state distinct from zero productivity", state => {
        const data = fixture();
        data.state = state;
        data.sources = [{ key: "rooms", state: "failed", count: 0, observedAt: data.observedAt, note: "Read unavailable" }];
        const html = renderToStaticMarkup(<DeliveryOutcomeScorecard data={data}/>);
        expect(html).toContain(state === "failed" ? "Read unavailable" : "Partial coverage");
        expect(html).toContain("Unavailable");
    });
    it("uses semantic report tables and bounded URL filters without auto-prompt actions", () => {
        const html = renderToStaticMarkup(<DeliveryOutcomeScorecard data={fixture()}/>);
        expect(html).toContain("<table");
        expect(html).toContain("<summary");
        expect(html).toContain('name="q"');
        expect(html).toContain('value="outcomes"');
        expect(html).toContain("API-equivalent estimate");
        expect(html).toContain("Invoiced spend");
        expect(html).not.toContain("onclick");
    });
});
