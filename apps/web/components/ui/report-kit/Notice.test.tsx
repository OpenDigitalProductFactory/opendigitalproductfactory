import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Notice } from "./Notice";

describe("Notice", () => {
  it("renders title and body", () => {
    const html = renderToStaticMarkup(
      <Notice variant="info" title="Heads up">
        Something to know.
      </Notice>,
    );
    expect(html).toContain("Heads up");
    expect(html).toContain("Something to know.");
    expect(html).toContain('role="note"');
  });

  it("maps variants to the right intent", () => {
    expect(renderToStaticMarkup(<Notice variant="info">x</Notice>)).toContain(
      'data-intent="info"',
    );
    expect(renderToStaticMarkup(<Notice variant="warn">x</Notice>)).toContain(
      'data-intent="warning"',
    );
    expect(renderToStaticMarkup(<Notice variant="success">x</Notice>)).toContain(
      'data-intent="success"',
    );
    expect(renderToStaticMarkup(<Notice variant="error">x</Notice>)).toContain(
      'data-intent="danger"',
    );
  });

  it("colors the left border from the intent token — no hex", () => {
    const html = renderToStaticMarkup(<Notice variant="error">Broken</Notice>);
    expect(html).toContain("var(--dpf-error)");
    expect(html).toContain("border-left-width:4px");
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("hides the icon when icon={false}", () => {
    const html = renderToStaticMarkup(
      <Notice variant="info" icon={false}>
        No glyph
      </Notice>,
    );
    expect(html).not.toContain("ℹ");
  });
});
