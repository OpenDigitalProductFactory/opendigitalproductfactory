import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ListShell, PageShell } from "./PageShell";
import { DISCLOSURE_ATTR, LEAD_ATTR } from "@/lib/ux-budget/scope";
import { PRIMARY_ACTION_ATTR } from "@/lib/ux-budget/measure";

// BI-36CE8BAB. These tests pin the CONTRACT, not the styling: a shell is only
// worth having if the structural markers the route sweep measures are actually
// emitted, and if deferred content is genuinely deferred rather than merely
// visually hidden. The failure this whole epic exists to stop was a card grid
// that used `line-clamp-2` — the words stayed in the DOM and the route measured
// 5,349 of them.
//
// Rendered to static markup rather than through jsdom, deliberately: the sweep
// measures served HTML, so asserting on the same artifact keeps the test and the
// gate looking at the same thing.

/** Count non-overlapping occurrences of a needle. */
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("PageShell — the structural contract the sweep measures", () => {
  it("stamps the lead band so it can be measured", () => {
    const html = renderToStaticMarkup(
      <ListShell title="Skills" lead="What coworkers can do.">
        <p>body</p>
      </ListShell>,
    );
    expect(html).toContain(`${LEAD_ATTR}=""`);
    expect(html).toContain("What coworkers can do.");
  });

  it("renders exactly one h1 — the page's own name", () => {
    const html = renderToStaticMarkup(
      <ListShell title="Skills" lead="lead">
        <p>body</p>
      </ListShell>,
    );
    expect(count(html, "<h1")).toBe(1);
    expect(html).toContain(">Skills</h1>");
  });

  it("marks a primary action so 'the verb is buried' is measurable, not a matter of taste", () => {
    const html = renderToStaticMarkup(
      <ListShell
        title="Skills"
        lead="lead"
        actions={[
          { label: "Start", href: "/start", primary: true },
          { label: "Prompts", href: "/prompts" },
        ]}
      >
        <p>body</p>
      </ListShell>,
    );
    expect(count(html, `${PRIMARY_ACTION_ATTR}=""`)).toBe(1);
    expect(html).toContain("Start");
    expect(html).toContain("Prompts");
  });

  it("defers technical detail into a CLOSED disclosure, not a visual clamp", () => {
    const html = renderToStaticMarkup(
      <ListShell title="Skills" lead="lead" technicalDetails={<p>diagnostics</p>}>
        <p>body</p>
      </ListShell>,
    );
    expect(count(html, "<details")).toBe(1);
    expect(html).toContain(DISCLOSURE_ATTR);
    // Closed by default is the whole point: the sweep excises closed <details>,
    // so an open-by-default "disclosure" would defer nothing and score nothing.
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).toContain("diagnostics");
  });

  it("omits the disclosure entirely when there is no technical detail", () => {
    const html = renderToStaticMarkup(
      <ListShell title="Skills" lead="lead">
        <p>body</p>
      </ListShell>,
    );
    expect(html).not.toContain("<details");
  });

  it("shows the attention line only when something is actually wrong", () => {
    const quiet = renderToStaticMarkup(
      <ListShell title="Skills" lead="lead">
        <p>body</p>
      </ListShell>,
    );
    expect(quiet).not.toContain("drifted");

    const loud = renderToStaticMarkup(
      <ListShell title="Skills" lead="lead" attention={<>3 skills have drifted</>}>
        <p>body</p>
      </ListShell>,
    );
    expect(loud).toContain("3 skills have drifted");
  });

  it("records which reading contract the surface claims", () => {
    const html = renderToStaticMarkup(
      <PageShell kind="settings" title="Config" lead="lead">
        <p>body</p>
      </PageShell>,
    );
    expect(html).toContain('data-dpf-shell="settings"');
  });
});
