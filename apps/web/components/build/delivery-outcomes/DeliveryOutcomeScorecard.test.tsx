import { DEFAULT_LOCALE, namespaceMessages, translate } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { projectDeliveryOutcomes } from "@/lib/delivery-outcomes/projection";
import { DeliveryOutcomeScorecard } from "./DeliveryOutcomeScorecard";
import { measureUxBudget } from "@/lib/ux-budget/measure";
const render = (data: ReturnType<typeof projectDeliveryOutcomes>, language = DEFAULT_LOCALE, formatLocale = DEFAULT_LOCALE) => renderToStaticMarkup(<MessagesProvider locale={language} messages={{ workrooms: namespaceMessages(language, "workrooms") }}><DeliveryOutcomeScorecard data={data} formatLocale={formatLocale}/></MessagesProvider>);
const fixture = () => projectDeliveryOutcomes({ now: new Date("2026-10-29T12:00:00Z"), rooms: [], activities: [], verifications: [], runs: [], tasks: [], tools: [], queue: [], pullRequests: [], sources: [] });
describe("Delivery outcome scorecard", () => {
    it("uses the viewer's messages and number locale without rounding a small cost to zero", () => {
        const data = projectDeliveryOutcomes({ now: new Date("2026-10-29T12:00:00Z"), rooms: [{
                    id: "room1", capsuleId: "WC-1", title: "Recorded fixture", status: "working", repositoryFullName: "org/repo", headBranch: "feat/one", headSha: "a".repeat(40), backlogItemId: null, epicId: null, executorKind: "codex-desktop", executorRef: "thread1", featureBuildId: null, taskRunId: null, createdAt: new Date("2026-10-20"), claimedAt: new Date("2026-10-20"), updatedAt: new Date("2026-10-20"), pullRequestNumber: null,
                }], activities: [], verifications: [], runs: [], tasks: [], tools: [], queue: [], pullRequests: [], sources: [{ key: "tools", state: "failed", count: 0, observedAt: "2026-10-29T12:00:00Z", note: "readUnavailable" }] });
        data.observations[0].economy.exclusive.inputTokens = 1234;
        data.observations[0].economy.exclusive.apiEquivalentUsd = 0.000123;
        const html = render(data, "en-XA", "de-DE");
        expect(html).toContain(translate("en-XA", "workrooms", "outcomes.title"));
        expect(html).toContain(translate("en-XA", "workrooms", "outcomes.notes.readUnavailable"));
        expect(html).toContain("1.234");
        expect(html).toContain("0,000123");
        expect(html).not.toContain("workrooms.outcomes.");
    });
    it("keeps the fixture arrival bounded and detail controls disclosed", () => {
        const html = render(fixture());
        const metrics = measureUxBudget(html);
        expect(metrics.defaultVisibleWords).toBeLessThanOrEqual(100);
        expect(metrics.visibleFields).toBe(0);
        expect(metrics.subLegibleControls).toBe(0);
        expect(metrics.buriedPrimaryAction).toBe(0);
        expect(metrics.disclosureRegions).toBeGreaterThanOrEqual(4);
    });
    it("renders explicit empty cohort with accessible sources and no invented success", () => {
        const html = render(fixture());
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
        data.sources = [{ key: "rooms", state: "failed", count: 0, observedAt: data.observedAt, note: "readUnavailable" }];
        const html = render(data);
        expect(html).toContain(state === "failed" ? "Read unavailable" : "Partial coverage");
        expect(html).toContain("Unavailable");
    });
    it("uses semantic report tables and bounded URL filters without auto-prompt actions", () => {
        const html = render(fixture());
        expect(html).toContain("<table");
        expect(html).toContain("<summary");
        expect(html).toContain('name="q"');
        expect(html).toContain('value="outcomes"');
        expect(html).toContain("API-equivalent estimate");
        expect(html).toContain("Invoiced spend");
        expect(html).not.toContain("onclick");
    });
});
