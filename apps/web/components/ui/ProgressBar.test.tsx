import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("exposes determinate progressbar semantics", () => {
    const html = renderToStaticMarkup(<ProgressBar value={42} label="Uploading" />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-label="Uploading"');
    expect(html).toMatch(/width:42%/);
  });

  it("clamps out-of-range values", () => {
    expect(renderToStaticMarkup(<ProgressBar value={150} />)).toContain(
      'aria-valuenow="100"',
    );
    expect(renderToStaticMarkup(<ProgressBar value={-10} />)).toContain(
      'aria-valuenow="0"',
    );
  });

  it("omits aria-valuenow and shimmers when indeterminate", () => {
    const html = renderToStaticMarkup(<ProgressBar indeterminate />);
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain("aria-valuenow");
    expect(html).toContain("dpf-shimmer");
  });

  it("treats a missing value as indeterminate", () => {
    const html = renderToStaticMarkup(<ProgressBar />);
    expect(html).not.toContain("aria-valuenow");
    expect(html).toContain("dpf-shimmer");
  });

  it("uses token colors, never raw hex", () => {
    const html = renderToStaticMarkup(<ProgressBar value={50} />);
    expect(html).toMatch(/var\(--dpf-accent\)/);
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});
