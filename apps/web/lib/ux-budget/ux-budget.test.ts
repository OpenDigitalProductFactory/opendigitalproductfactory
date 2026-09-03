// BI-B9BE9A29 (EP-UX-SYSTEM L2) — budget module contract.
//
// The two assertions that earn this module: collapsed disclosure is NOT counted
// (progressive disclosure rewarded, never taxed), and a net-new route cannot be born
// as a wall of text (spec rev 2 D1 — a pure ratchet would let it).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AUDIENCE_READING_LEVELS,
  auditUxBudget,
  budgetFor,
  countDisclosureRegions,
  countPrimaryActions,
  countVisibleFields,
  defaultVisibleHtml,
  extractSubtrees,
  leadBandHtml,
  maxChoicesPerControl,
  measureUxBudget,
  meetsReadingLevel,
  readingLevelFor,
  removeSubtrees,
  shellForRoute,
  UX_BUDGETS,
  UX_SHELLS,
} from "./index";
import { countWords } from "../owner-first/ux-audit";
import { ROUTE_SWEEP_EXCLUSIONS } from "./route-shells";

describe("disclosure scoping — collapsed detail is excised, never taxed", () => {
  it("does not count words inside a collapsed <details>", () => {
    const html = `<div><p>visible words here</p><details><summary>More</summary><p>${"hidden ".repeat(50)}</p></details></div>`;
    expect(countWords(defaultVisibleHtml(html))).toBeLessThan(10);
  });

  it("DOES count words inside an open <details> — disclosure must be honest both ways", () => {
    const html = `<div><p>visible</p><details open><summary>More</summary><p>one two three four five</p></details></div>`;
    expect(countWords(defaultVisibleHtml(html))).toBeGreaterThan(5);
  });

  it("matches close tags by depth so nested markup cannot truncate the excision", () => {
    // The regression a naive regex causes: it stops at the first </div> and leaks
    // the tail of the collapsed subtree back into the measured scope.
    const html = `<details><div><div>LEAK</div></div></details><p>kept</p>`;
    const visible = defaultVisibleHtml(html);
    expect(visible).not.toContain("LEAK");
    expect(visible).toContain("kept");
  });

  it("excises data-dpf-disclosure regions unless explicitly open", () => {
    const collapsed = `<section data-dpf-disclosure><p>deferred detail</p></section><p>lead</p>`;
    const open = `<section data-dpf-disclosure open><p>deferred detail</p></section><p>lead</p>`;
    expect(defaultVisibleHtml(collapsed)).not.toContain("deferred detail");
    expect(defaultVisibleHtml(open)).toContain("deferred detail");
  });

  it("excises hidden and aria-hidden subtrees", () => {
    expect(defaultVisibleHtml(`<div hidden><p>no</p></div><p>yes</p>`)).not.toContain("no");
    expect(defaultVisibleHtml(`<div aria-hidden="true"><p>no</p></div><p>yes</p>`)).not.toContain("no");
  });

  it("drops script/style content so markup-shaped strings cannot inflate the count", () => {
    const html = `<script>const s = "<p>ghost words ghost words</p>";</script><p>real</p>`;
    expect(countWords(defaultVisibleHtml(html))).toBe(1);
  });

  it("counts disclosure regions whether collapsed or open", () => {
    expect(countDisclosureRegions(`<details><p>a</p></details><div data-dpf-disclosure><p>b</p></div>`)).toBe(2);
  });

  // BI-2B196D07. The canonical React constructs omit their deferred subtree from the
  // DOM when collapsed, so there is nothing to excise on arrival — only a visible
  // summary and a trigger. The trigger marker must therefore COUNT as a region while
  // staying in the measured scope, or the two attributes would be interchangeable and
  // marking a card would delete the summary the owner reads.
  it("counts a disclosure trigger as a region without excising its visible summary", () => {
    const html = `<article data-dpf-disclosure-trigger=""><h3>Record summary</h3></article>`;
    expect(countDisclosureRegions(html)).toBe(1);
    expect(defaultVisibleHtml(html)).toContain("Record summary");
  });

  it("still excises a data-dpf-disclosure region, so the two markers are not aliases", () => {
    const html = `<div data-dpf-disclosure><p>deferred body</p></div>`;
    expect(countDisclosureRegions(html)).toBe(1);
    expect(defaultVisibleHtml(html)).not.toContain("deferred body");
  });

  it("removeSubtrees leaves void elements alone rather than swallowing the rest", () => {
    const out = removeSubtrees(`<p>a</p><img src="x"><p>b</p>`, (t) => t.name === "img");
    expect(out).toContain("<p>a</p>");
    expect(out).toContain("<p>b</p>");
    expect(out).not.toContain("<img");
  });

  it("treats XHTML-style self-closing tags as void", () => {
    // The trailing slash lands in the captured attribute text now that the tag
    // pattern is greedy, so it must be detected there.
    const out = removeSubtrees(`<p>a</p><br/><p>b</p>`, (t) => t.name === "br");
    expect(out).toContain("<p>a</p>");
    expect(out).toContain("<p>b</p>");
    const found = extractSubtrees(`<img src="x" />`, (t) => t.name === "img");
    expect(found).toHaveLength(1);
  });

  it("does not backtrack exponentially on adjacent empty attribute values", () => {
    // CodeQL js/redos: an earlier `[^>]` catch-all let `""` match two ways, so this
    // input took exponential time. The branches are now mutually exclusive.
    const pathological = `<a${'""'.repeat(60)}>text</a>`;
    const started = performance.now();
    defaultVisibleHtml(pathological);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("still tolerates > inside a quoted attribute value", () => {
    const html = `<div title="a > b"><p>kept</p></div><details><p>gone</p></details>`;
    const visible = defaultVisibleHtml(html);
    expect(visible).toContain("kept");
    expect(visible).not.toContain("gone");
  });
});

describe("lead band", () => {
  it("extracts only the marked lead band", () => {
    const html = `<header data-dpf-lead><h1>Your day</h1></header><section><p>everything else</p></section>`;
    const lead = leadBandHtml(html);
    expect(lead).toContain("Your day");
    expect(lead).not.toContain("everything else");
  });

  it("reports no lead band when none is marked", () => {
    expect(measureUxBudget(`<p>nothing marked</p>`).hasLeadBand).toBe(false);
  });
});

describe("budget axes", () => {
  it("counts fields the owner must fill, not hidden or submit inputs", () => {
    const html = `<input type="hidden" name="csrf"><input type="text"><select></select><textarea></textarea><input type="submit">`;
    expect(countVisibleFields(html)).toBe(3);
  });

  it("prefers the explicit primary-action marker, falling back to submit buttons", () => {
    expect(countPrimaryActions(`<button data-dpf-primary-action>Go</button><button type="submit">x</button>`)).toBe(1);
    expect(countPrimaryActions(`<button type="submit">a</button><button type="submit">b</button>`)).toBe(2);
  });

  it("reports the largest single control's choice count (Hick's law)", () => {
    const html = `<select><option>1</option><option>2</option></select><select>${"<option>x</option>".repeat(9)}</select>`;
    expect(maxChoicesPerControl(html)).toBe(9);
  });

  it("flags owner setup pages that dump hundreds of closed choices into the visible DOM", () => {
    const html = `<main data-dpf-lead><p>Set business hours.</p><select aria-label="Timezone">${"<option>Zone</option>".repeat(200)}</select></main>`;
    const report = auditUxBudget(html, "settings", { routeStatus: "net-new", audience: "owner" });
    const finding = report.findings.find((f) => f.check === "choices-per-control");

    expect(finding?.ok).toBe(false);
    expect(finding?.severity).toBe("blocking");
    expect(finding?.detail).toContain("200 choices");
  });

  it("does not count a closed searchable picker as if its full corpus were visible", () => {
    const html = `<main><input role="combobox" value="(UTC-06:00) America/Chicago"><input type="hidden" name="timezone" value="America/Chicago"></main>`;
    expect(measureUxBudget(html).maxChoicesPerControl).toBe(0);
    expect(measureUxBudget(html).visibleFields).toBe(1);
  });

  it("does not fabricate a reading grade for an empty surface", () => {
    expect(measureUxBudget("<div></div>").readingGradeLevel).toBe(0);
  });

  // ── BI-0ED0F6B3 — the reading grade measures difficulty, not punctuation ──

  /** The /finance/mileage surface, in the markup shape that exposed the defect. */
  const LABEL_SURFACE = `<main><h1>Mileage</h1><p>3 to sort</p><a>See my drives</a>
    <table><tr><th>Date</th><th>Route</th><th>Miles</th><th>Sorted</th><th>Owed</th></tr></table>
    <ul><li>Business</li><li>Personal</li><li>Commute</li></ul></main>`;

  it("grades a surface of plain labels as plain", () => {
    // Every word here is ordinary English. Before the fix the whole page
    // collapsed into one "sentence" and graded in the teens.
    const grade = measureUxBudget(LABEL_SURFACE).readingGradeLevel;
    expect(grade).toBeLessThan(9);
  });

  it("cannot be gamed by punctuating the labels", () => {
    const stopped = LABEL_SURFACE.replace(/<\/(h1|p|a|th|li)>/g, ".</$1>");
    expect(measureUxBudget(stopped).readingGradeLevel).toBe(
      measureUxBudget(LABEL_SURFACE).readingGradeLevel,
    );
  });

  it("still fails a surface whose own words are dense", () => {
    const dense = `<main><h1>Infrastructure</h1><p>Optimization</p>
      <ul><li>Administrative</li><li>Documentation</li><li>Organizational</li></ul></main>`;
    expect(measureUxBudget(dense).readingGradeLevel).toBeGreaterThan(9);
  });

  it("scores the route's own copy, not the shell chrome around it", () => {
    const dense = `<main><h1>Infrastructure Optimization</h1>
      <p>Administrative documentation of organizational infrastructure.</p>
      <ul><li>Authorization</li><li>Diagnostics</li><li>Provisioning</li><li>Observability</li></ul>
      <p>Reconciliation of heterogeneous configuration repositories.</p></main>`;
    const chrome = `<header><a>Home</a><a>Work</a><a>Money</a></header><nav><ul><li>Jobs</li><li>Bills</li></ul></nav>`;
    // Adding a rail of short, easy nav labels must not dilute the page's grade.
    expect(measureUxBudget(chrome + dense).readingGradeLevel).toBe(
      measureUxBudget(dense).readingGradeLevel,
    );
  });

  it("keeps the whole surface when <main> does not hold the page's words", () => {
    // A landmark wrapped around a client shell or a mocked subtree carries a
    // word or two. Grading THAT would be worse than grading the chrome too.
    const scrap = `<header><h1>Date</h1><p>Route</p><p>Miles</p><p>Sorted</p></header><main><div>Infrastructure</div></main>`;
    expect(measureUxBudget(scrap).readingGradeLevel).toBe(
      measureUxBudget(scrap.replace(/<\/?main>/g, "")).readingGradeLevel,
    );
  });

  it("falls back to the whole surface when the shell marks no <main>", () => {
    const noMain = `<div><h1>Date</h1><p>Route</p></div>`;
    expect(measureUxBudget(noMain).readingGradeLevel).not.toBe(0);
  });
});

describe("reading tier resolves from audience and shell (BI-1DE6F69E, BI-0ED0F6B3)", () => {
  it("keeps the shell default for every audience without an override", () => {
    for (const audience of ["owner", "worker", "customer", "public", "auth-setup", "admin", "builder"] as const) {
      expect(readingLevelFor("detail", audience)).toBe("high-school");
      expect(readingLevelFor("cockpit", audience)).toBe("high-school");
    }
  });

  it("holds operator surfaces to the strict tier, the re-tier having been withdrawn", () => {
    // BI-1DE6F69E loosened admin/builder to college because EVERY /admin route
    // failed at 9. Those grades were produced by counting full stops, not
    // difficulty (BI-0ED0F6B3); corrected, /admin/graph-explorer reads 3.4 and
    // /admin 8.2. The premise is withdrawn, so the exception is too.
    expect(AUDIENCE_READING_LEVELS).toEqual({});
    expect(readingLevelFor("detail", "admin")).toBe("high-school");
    expect(readingLevelFor("list", "admin")).toBe("high-school");
    expect(readingLevelFor("detail", "builder")).toBe("high-school");
  });

  it("falls back to the shell default when no audience is supplied", () => {
    expect(readingLevelFor("detail")).toBe("high-school");
    expect(readingLevelFor("detail", null)).toBe("high-school");
  });

  it("only ever loosens — an already-permissive shell is never tightened", () => {
    // `unclassified` sits at college; an audience with no override must not pull it
    // back to high school.
    expect(UX_BUDGETS.unclassified.readingLevel).toBe("college");
    expect(readingLevelFor("unclassified", "customer")).toBe("college");
    expect(readingLevelFor("unclassified", "admin")).toBe("college");
  });

  it("holds an operator surface to grade 9, which the corrected measure lets it clear", () => {
    // The measured admin family after BI-0ED0F6B3: graph-explorer 3.4, cockpit
    // 6.4, data-stewardship 6.5, business-models 8.4, /admin 8.2 — all pass. The
    // family's remaining debt (archetypes 14.9) is a visible advisory finding.
    const budget = budgetFor("detail", "admin");
    expect(budget.readingLevel).toBe("high-school");
    for (const grade of [3.4, 6.4, 6.5, 8.2, 8.4]) {
      expect(meetsReadingLevel({ readingGradeLevel: grade } as never, budget.readingLevel)).toBe(true);
    }
    expect(meetsReadingLevel({ readingGradeLevel: 14.9 } as never, budget.readingLevel)).toBe(false);
  });

  it("does not loosen a customer-facing surface", () => {
    const budget = budgetFor("detail", "customer");
    expect(budget.readingLevel).toBe("high-school");
    expect(meetsReadingLevel({ readingGradeLevel: 11 } as never, budget.readingLevel)).toBe(false);
  });

  it("carries the audience on every generated shell row so the sweep can resolve it", () => {
    const registry = JSON.parse(
      readFileSync(resolve(__dirname, "route-shells.generated.json"), "utf8"),
    ) as { routes: { routePath: string; audience?: string }[] };
    expect(registry.routes.length).toBeGreaterThan(0);
    expect(registry.routes.filter((r) => !r.audience)).toEqual([]);
  });
});

describe("enforcement splits by route age (spec rev 2 D1)", () => {
  // A surface well over the cockpit budget, with no disclosure and no lead band.
  const wallOfText = `<main><p>${"word ".repeat(600)}</p></main>`;

  it("a NET-NEW route cannot be born as a wall of text — absolutes block", () => {
    const report = auditUxBudget(wallOfText, "cockpit", { routeStatus: "net-new" });
    expect(report.ok).toBe(false);
    const wordFinding = report.findings.find((f) => f.check === "default-visible-words");
    expect(wordFinding?.ok).toBe(false);
    expect(wordFinding?.severity).toBe("blocking");
  });

  it("the SAME surface on a pre-existing route reports advisory, not blocking", () => {
    const report = auditUxBudget(wallOfText, "cockpit", { routeStatus: "pre-existing" });
    const wordFinding = report.findings.find((f) => f.check === "default-visible-words");
    expect(wordFinding?.ok).toBe(false);
    expect(wordFinding?.severity).toBe("advisory");
    expect(report.advisoryFailures).toBeGreaterThan(0);
  });

  it("defers detail to satisfy the blocking anti-wall-of-text rule", () => {
    // Same word mass, but the bulk is deferred — this is the fix the budget rewards.
    const disclosed = `<main data-dpf-lead><p>short lead</p></main><details><p>${"word ".repeat(600)}</p></details>`;
    const report = auditUxBudget(disclosed, "cockpit", { routeStatus: "net-new" });
    expect(report.findings.find((f) => f.check === "deferred-detail")?.ok).toBe(true);
    expect(report.findings.find((f) => f.check === "default-visible-words")?.ok).toBe(true);
  });

  it("sub-legible controls block regardless of route age — WCAG, not calibration", () => {
    const tiny = `<p>short</p><button class="text-[9px]">x</button>`;
    for (const routeStatus of ["net-new", "pre-existing"] as const) {
      const report = auditUxBudget(tiny, "cockpit", { routeStatus });
      const f = report.findings.find((c) => c.check === "sub-legible-controls");
      expect(f?.ok, routeStatus).toBe(false);
      expect(f?.severity, routeStatus).toBe("blocking");
      expect(report.ok, routeStatus).toBe(false);
    }
  });

  it("a net-new route cannot claim pre-migration exemptions it never accrued", () => {
    const noMarker = `<main><p>short surface</p></main>`;
    const exempted = auditUxBudget(noMarker, "cockpit", {
      routeStatus: "net-new",
      exemptChecks: ["next-action-marker", "lead-band"],
    });
    expect(exempted.findings.find((f) => f.check === "next-action-marker")?.ok).toBe(false);

    const legacy = auditUxBudget(noMarker, "cockpit", {
      routeStatus: "pre-existing",
      exemptChecks: ["next-action-marker", "lead-band"],
    });
    const legacyFinding = legacy.findings.find((f) => f.check === "next-action-marker");
    expect(legacyFinding?.ok).toBe(true);
    expect(legacyFinding?.exempt).toBe(true);
  });
});

describe("primary action reachability (BI-D77BF495 — the self-upgrade lesson)", () => {
  // A page with its primary action inside a collapsed <details> — the exact shape
  // of the self-upgrade regression: the trigger is present but not visible on arrival.
  const buried = `<main data-dpf-lead><h1>Self-Upgrade</h1><p>Status here.</p><details><summary>Advanced</summary><button data-dpf-primary-action data-owner-first-next-action>Upgrade now</button></details></main>`;
  const reachable = `<main data-dpf-lead><h1>Self-Upgrade</h1><p>Status here.</p><button data-dpf-primary-action data-owner-first-next-action>Upgrade now</button><details><summary>Advanced</summary><p>logs</p></details></main>`;

  it("flags a primary action that is marked but hidden behind a collapse", () => {
    expect(measureUxBudget(buried).buriedPrimaryAction).toBe(1);
    expect(measureUxBudget(reachable).buriedPrimaryAction).toBe(0);
  });

  it("the word budget alone would REWARD burying it — this is why the axis exists", () => {
    // Fewer default-visible words when the action is hidden. The volume budget reads
    // that as an improvement; only the reachability axis catches the regression.
    expect(measureUxBudget(buried).defaultVisibleWords).toBeLessThan(
      measureUxBudget(reachable).defaultVisibleWords,
    );
  });

  it("blocks a net-new detail route whose primary action is buried", () => {
    const v = auditUxBudget(buried, "detail", { routeStatus: "net-new" });
    expect(v.ok).toBe(false);
    expect(v.findings.find((f) => f.check === "primary-action-reachable")?.ok).toBe(false);
  });

  it("passes the same route once the action is lifted into view", () => {
    const v = auditUxBudget(reachable, "detail", { routeStatus: "net-new" });
    expect(v.findings.find((f) => f.check === "primary-action-reachable")?.ok).toBe(true);
  });

  it("does not require reachability on shells where it does not apply (list/public)", () => {
    expect(auditUxBudget(buried, "list", { routeStatus: "net-new" }).findings.find((f) => f.check === "primary-action-reachable")?.ok).toBe(true);
    expect(auditUxBudget(buried, "public", { routeStatus: "net-new" }).findings.find((f) => f.check === "primary-action-reachable")?.ok).toBe(true);
  });

  it("a page with no marked primary action at all is not penalised", () => {
    expect(measureUxBudget(`<main><p>just content, no action</p></main>`).buriedPrimaryAction).toBe(0);
  });
});

describe("route → intended shell derivation", () => {
  it("derives shells from the existing audience/destination-kind registry", () => {
    expect(shellForRoute({ audience: "owner", destinationKind: "section-home" })).toBe("cockpit");
    expect(shellForRoute({ audience: "admin", destinationKind: "section-home" })).toBe("list");
    expect(shellForRoute({ audience: "owner", destinationKind: "detail" })).toBe("detail");
    expect(shellForRoute({ audience: "owner", destinationKind: "settings-config" })).toBe("settings");
    expect(shellForRoute({ audience: "owner", destinationKind: "workflow-step" })).toBe("form");
    expect(shellForRoute({ audience: "public", destinationKind: "detail" })).toBe("public");
    expect(shellForRoute({ audience: "auth-setup", destinationKind: "detail" })).toBe("form");
    expect(shellForRoute({ audience: "admin", destinationKind: "legacy-internal" })).toBe("unclassified");
  });

  it("settings/workflow shape wins over audience — a settings page is a settings page", () => {
    expect(shellForRoute({ audience: "public", destinationKind: "settings-config" })).toBe("settings");
  });
});

describe("generated route-shell registry", () => {
  const registry = JSON.parse(
    readFileSync(resolve(__dirname, "route-shells.generated.json"), "utf8"),
  ) as {
    pageRouteCount: number;
    migratedCount: number;
    summary: Record<string, number>;
    routes: {
      routePath: string;
      shell: string;
      migrated: boolean;
      exemptChecks: string[];
      sweepEligible: boolean;
      sweepExclusionReason?: string;
    }[];
  };

  const manifest = JSON.parse(
    readFileSync(resolve(__dirname, "../ea/route-manifest.json"), "utf8"),
  ) as { routes: { routePath: string; kind: string; redirectTo?: string }[] };

  it("covers exactly the non-redirect page routes in the route manifest", () => {
    const expected = manifest.routes
      .filter((r) => r.kind === "page" && !r.redirectTo)
      .map((r) => r.routePath)
      .sort();
    expect(registry.routes.map((r) => r.routePath).sort()).toEqual(expected);
  });

  it("assigns every route a known shell", () => {
    const known = new Set<string>(UX_SHELLS);
    expect(registry.routes.filter((r) => !known.has(r.shell))).toEqual([]);
  });

  it("records pre-migration debt rather than hiding it", () => {
    // The migration has begun (BI-36CE8BAB). Cohort 0 is `/platform/ai/skills`,
    // the worst-measured surface in the portal — 5,349 default-visible words
    // against a 450-word budget — chosen worst-first, which is the ordering the
    // league table exists to give.
    //
    // The invariant this test protects is unchanged: a route is either MIGRATED
    // (and therefore held to the full shell contract) or it carries its
    // exemptions EXPLICITLY. What must never happen is a route that is neither —
    // debt that passes because nobody wrote it down.
    const migrated = registry.routes.filter((r) => r.migrated);
    expect(migrated.map((r) => r.routePath)).toEqual(["/platform/ai/skills"]);
    expect(registry.migratedCount).toBe(migrated.length);

    // A migrated route has earned its way out of the exemptions.
    expect(migrated.every((r) => r.exemptChecks.length === 0)).toBe(true);
    // Everything not yet migrated still declares its debt.
    expect(
      registry.routes.filter((r) => !r.migrated).every((r) => r.exemptChecks.length > 0),
    ).toBe(true);
  });

  it("summary totals reconcile with the route list", () => {
    const sum = Object.values(registry.summary).reduce((a, b) => a + b, 0);
    expect(sum).toBe(registry.pageRouteCount);
    expect(registry.pageRouteCount).toBe(registry.routes.length);
  });

  it("accounts for every route as measurable or explicitly excluded", () => {
    expect(
      registry.routes.filter(
        (route) => route.sweepEligible === Boolean(route.sweepExclusionReason),
      ),
    ).toEqual([]);
    // 200 -> 197: three time/live-state routes joined the sweep exclusions under
    // BI-F2EC4699, each after being observed failing on code that changes no
    // rendered output. /workspace derives a calendar window from `new Date()`;
    // /ops/self-upgrade and /admin/scheduled-jobs render live orchestration state
    // that concurrent sessions and in-run crons mutate. All three are tracked for
    // re-inclusion by BI-0C6C2153 once the fixture pins the clock and isolates state.
    // 197 -> 198: /admin/graph-explorer (BI-89A149A9) is sweep-eligible — it renders
    // no wall-clock or live-orchestration state, only the graph mirror.
    // 198 -> 197: /platform/ai/operations-map joins the live-orchestration exclusions
    // above — it re-fetches live-edge-windowed orchestration state on a 45s timer, so
    // its frozen ariaSnapshot flips on untouched code (measured across six sweep runs
    // two days apart; see ROUTE_SWEEP_EXCLUSIONS for the run ids).
    // 197 -> 198: /employee/recruiting (BI-9CC44DC7) is sweep-eligible — a read-only
    // recruiting funnel over getRecruitingPipeline with a requisition filter; it renders
    // no wall-clock or live-orchestration state, only the deduped pipeline read model.
    // 198 -> 199: /platform/archetype-readiness is a static operator matrix sourced
    // from storefront-template metadata, so it is safe for the generic sweep.
    // 199 -> 200: /workforce (EP-COWORKER-IDENTITY-360) — the AI Coworkers directory,
    // a business-domain peer to /employee and /customer, reusing the roster read-model;
    // static, no wall-clock or live-orchestration state, so it is sweep-eligible.
    // 200 -> 201: /platform/tools/integrations/wordpress is a bounded operator detail
    // route over connection, projection, receipt, and drift read models; its measured
    // preview is deterministic and carries an explicit page-purpose contract.
    // 201 -> 202: /finance/mileage is a net-new driver-facing route (EP-MILEAGE-ABSORB)
    // — the surface that makes the mileage substrate reachable.
    // 205 -> 206: /workspace/cases/[caseKey] is the FIRST dynamic route the sweep
    // can measure (BI-DE67A3EC). Every "[param]" route was excluded outright
    // because nothing minted an id; the fixture now mints a deterministic work
    // case and publishes its path, so a detail surface is measurable at last.
    // Eligibility for a dynamic route is earned by that minting, not asserted —
    // an eligible-but-unresolved route fails the run rather than measuring a 404.
    // 206 -> 207: /storefront/animals/waiting (BI-899D7F00) — the adoption waiting
    // list, read-only over AdoptableAnimal.publishedAt. The first storefront route to
    // be measurable: the sweep fixture now provisions one pet-rescue storefront with
    // listed animals, which is the honest fixture context the storefront-setup-required
    // exclusions were waiting for. Its siblings keep their exclusion until each gets its own.
    // 207 -> 206: /storefront/setup joins setup-phase-only in the same PR — once the
    // fixture provisions a storefront the wizard navigates away and cannot be measured.
    expect(registry.routes.filter((route) => route.sweepEligible)).toHaveLength(206);
    // 110 -> 113: the three exclusions above. Product Direction then adds seven
    // explicitly classified dynamic routes, bringing the combined total to 120.
    // 120 -> 121: /platform/ai/operations-map.
    // 121 -> 122: /platform/ai/right-now (BI-1A68257F) joins the same wall-clock /
    // live-orchestration exclusion — it polls the live workforce set on a 12s timer.
    // 122 -> 123: /workforce/[agentId] (EP-COWORKER-IDENTITY-360) — the Coworker Identity
    // 360 detail page is a dynamic ([agentId]) route the generator auto-excludes with
    // reason "dynamic-fixture-required": the sweep cannot render it without a per-coworker
    // fixture, so it is not measured (not a live-state exclusion, a fixture one).
    // Redirect-only routes are omitted from the page registry. Parameterized redirect
    // detection removed five compatibility shims from this count in BI-7D2C4F02.
    // 120 -> 119: the mirror of the eligibility gain above — /workspace/cases/[caseKey]
    // left the excluded set when the fixture began minting its id.
    expect(registry.routes.filter((route) => !route.sweepEligible)).toHaveLength(120);
  });

  it("keeps contextual sweep exclusions explicit, valid, and non-stale", () => {
    const manifestRoutes = new Set(registry.routes.map((route) => route.routePath));
    expect(
      Object.keys(ROUTE_SWEEP_EXCLUSIONS).filter((routePath) => !manifestRoutes.has(routePath)),
    ).toEqual([]);

    for (const [routePath, reason] of Object.entries(ROUTE_SWEEP_EXCLUSIONS)) {
      expect(registry.routes.find((route) => route.routePath === routePath)).toMatchObject({
        sweepEligible: false,
        sweepExclusionReason: reason,
      });
    }
  });

  it("holds no frozen baseline for a route the sweep does not measure", () => {
    // BI-0C6C2153. The sweep only compares routes it measures, so a leftover
    // baseline entry for an EXCLUDED route is inert — and therefore invisible.
    // It stops being inert the moment the route is re-included: the sweep would
    // then diff a live measurement against a months-stale frozen structure and
    // report a regression that is really just the age of the entry. The prune
    // must happen at exclusion time, and #3719 already missed three routes once
    // (/admin/scheduled-jobs, /ops/self-upgrade, /workspace) while pruning the
    // other three in the same cohort. This test is why it cannot happen twice:
    // re-inclusion must go through a fresh freeze, never a resurrected one.
    const baseline = JSON.parse(
      readFileSync(resolve(__dirname, "route-budget-baseline.json"), "utf8"),
    ) as { routes: Record<string, unknown> };

    const excluded = new Set(
      registry.routes.filter((route) => !route.sweepEligible).map((route) => route.routePath),
    );
    expect(Object.keys(baseline.routes).filter((routePath) => excluded.has(routePath))).toEqual([]);
  });

  it("the committed registry is in sync with its generator", async () => {
    // The assertion `pnpm --filter web check:route-shells` makes in CI, repeated here
    // so staleness fails the REQUIRED Unit check too — not only the advisory workflow.
    const { build } = await import("../../scripts/build-route-shells");
    const regenerated = `${JSON.stringify(build(), null, 2)}\n`;
    expect(readFileSync(resolve(__dirname, "route-shells.generated.json"), "utf8")).toBe(regenerated);
  });
});
