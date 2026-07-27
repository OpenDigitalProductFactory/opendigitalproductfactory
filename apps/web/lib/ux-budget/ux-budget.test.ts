// BI-B9BE9A29 (EP-UX-SYSTEM L2) — budget module contract.
//
// The two assertions that earn this module: collapsed disclosure is NOT counted
// (progressive disclosure rewarded, never taxed), and a net-new route cannot be born
// as a wall of text (spec rev 2 D1 — a pure ratchet would let it).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  auditUxBudget,
  countDisclosureRegions,
  countPrimaryActions,
  countVisibleFields,
  defaultVisibleHtml,
  extractSubtrees,
  leadBandHtml,
  maxChoicesPerControl,
  measureUxBudget,
  removeSubtrees,
  shellForRoute,
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

  it("does not fabricate a reading grade for an empty surface", () => {
    expect(measureUxBudget("<div></div>").readingGradeLevel).toBe(0);
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
    // Nothing has adopted an L1 shell yet (shells are Phase 2, BI-36CE8BAB), so every
    // route must carry its exemptions explicitly. When this starts failing, the
    // migration has begun — update MIGRATED_ROUTES, do not weaken the check.
    expect(registry.migratedCount).toBe(0);
    expect(registry.routes.every((r) => r.exemptChecks.length > 0)).toBe(true);
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
    expect(registry.routes.filter((route) => route.sweepEligible)).toHaveLength(201);
    expect(registry.routes.filter((route) => !route.sweepEligible)).toHaveLength(107);
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

  it("the committed registry is in sync with its generator", async () => {
    // The assertion `pnpm --filter web check:route-shells` makes in CI, repeated here
    // so staleness fails the REQUIRED Unit check too — not only the advisory workflow.
    const { build } = await import("../../scripts/build-route-shells");
    const regenerated = `${JSON.stringify(build(), null, 2)}\n`;
    expect(readFileSync(resolve(__dirname, "route-shells.generated.json"), "utf8")).toBe(regenerated);
  });
});
