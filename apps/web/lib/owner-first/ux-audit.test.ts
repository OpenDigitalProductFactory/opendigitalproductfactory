import { describe, it, expect } from "vitest";
import {
  auditOwnerFirst,
  countControls,
  countGenericDecisionLabels,
  countSmallControls,
  countTechnicalDetail,
  countWords,
  visibleText,
  visibleUtterances,
  hasOwnerFirstNextAction,
  measureOwnerFirst,
  OWNER_FIRST_NEXT_ACTION_ATTR,
  OWNER_FIRST_SUMMARY_THRESHOLDS,
} from "./ux-audit";

describe("owner-first UX metrics", () => {
  it("counts visible words, decoding entities and ignoring tags", () => {
    // renderToStaticMarkup escapes apostrophes to &#x27; — the count must not
    // split a word on the entity.
    expect(countWords("<p>You&#x27;re all set for today</p>")).toBe(5);
    expect(countWords("<div></div>")).toBe(0);
  });

  it("counts links and buttons as controls", () => {
    const html = `<a href="/a">A</a><button>B</button><A href="/c">C</A>`;
    expect(countControls(html)).toBe(3);
  });

  it("flags sub-legible controls by their type scale", () => {
    const html = `<a class="text-[9px]">tiny</a><a class="text-sm min-h-9">ok</a>`;
    expect(countSmallControls(html)).toBe(1);
  });

  it("counts generic decision labels and repeated Technical detail", () => {
    const html = `<p>Make this business decision?</p><p>Make this business decision?</p><p>Technical detail</p><p>Technical detail</p>`;
    expect(countGenericDecisionLabels(html)).toBe(2);
    expect(countTechnicalDetail(html)).toBe(2);
  });

  it("detects a stamped owner-first next action", () => {
    expect(hasOwnerFirstNextAction(`<a ${OWNER_FIRST_NEXT_ACTION_ATTR}="x">go</a>`)).toBe(true);
    expect(hasOwnerFirstNextAction(`<a href="/x">go</a>`)).toBe(false);
  });
});

describe("auditOwnerFirst", () => {
  it("passes a clean owner-first band and fails a subsystem-dashboard band", () => {
    const clean = `
      <section>
        <h2>Guest follow-up</h2>
        <p>Guests waiting on you first.</p>
        <a ${OWNER_FIRST_NEXT_ACTION_ATTR}="reservations" class="text-xs min-h-9" href="/customer/funnel">Review reservations</a>
      </section>`;
    const cleanResult = auditOwnerFirst(clean);
    expect(cleanResult.ok).toBe(true);

    // Mirror the live audit's overloaded finding: repeated generic labels,
    // repeated Technical detail, tiny controls, and no owner-first next action.
    const overloaded = `
      <section>
        <p>Make this business decision?</p>
        <p>Make this business decision?</p>
        <p>Technical detail</p>
        <p>Technical detail</p>
        <a class="text-[9px]" href="/x">deep link</a>
      </section>`;
    const overloadedResult = auditOwnerFirst(overloaded);
    expect(overloadedResult.ok).toBe(false);
    const failed = overloadedResult.findings.filter((f) => !f.ok).map((f) => f.check);
    expect(failed).toContain("generic-decision-labels");
    expect(failed).toContain("repeated-technical-detail");
    expect(failed).toContain("small-controls");
    expect(failed).toContain("owner-first-next-action");
  });

  it("measureOwnerFirst reports every signal at once", () => {
    const metrics = measureOwnerFirst(
      `<a ${OWNER_FIRST_NEXT_ACTION_ATTR}="x" href="/x">go</a>`,
    );
    expect(metrics).toMatchObject({
      controlCount: 1,
      genericDecisionLabelCount: 0,
      technicalDetailCount: 0,
      hasOwnerFirstNextAction: true,
    });
  });

  it("exposes usable default thresholds for a summary band", () => {
    expect(OWNER_FIRST_SUMMARY_THRESHOLDS.maxGenericDecisionLabels).toBe(0);
    expect(OWNER_FIRST_SUMMARY_THRESHOLDS.requireOwnerFirstNextAction).toBe(true);
  });
});

describe("visibleUtterances (BI-0ED0F6B3)", () => {
  it("gives each block-level element its own utterance", () => {
    const html = `<h1>Mileage</h1><table><tr><th>Date</th><th>Route</th><th>Miles</th></tr></table><button>See my drives</button>`;
    expect(visibleUtterances(html)).toEqual([
      "Mileage",
      "Date",
      "Route",
      "Miles",
      "See my drives",
    ]);
  });

  it("keeps inline markup inside one utterance", () => {
    const html = `<p>Read the <a href="/x"><strong>setup guide</strong></a> before you start.</p>`;
    expect(visibleUtterances(html)).toEqual(["Read the setup guide before you start."]);
  });

  it("breaks on <br>", () => {
    expect(visibleUtterances("<p>Business<br>Personal</p>")).toEqual(["Business", "Personal"]);
  });

  it("covers the same words as visibleText", () => {
    const html = `<nav><a>Home</a></nav><main><h2>Owed</h2><p>Three drives &amp; two routes.</p></main>`;
    expect(visibleUtterances(html).join(" ").split(/\s+/)).toEqual(visibleText(html).split(/\s+/));
  });

  it("drops comments and yields nothing for empty markup", () => {
    expect(visibleUtterances("<div><!-- note --></div>")).toEqual([]);
  });
});
