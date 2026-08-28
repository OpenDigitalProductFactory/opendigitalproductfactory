import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Button, ButtonLink } from "./Button";

describe("Button", () => {
  it("renders a real <button> defaulting to type='button' (never accidental submit)", () => {
    const html = renderToStaticMarkup(<Button>Save</Button>);
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain("Save");
  });

  it("primary pairs the accent fill with the on-accent label token, never text-white", () => {
    const html = renderToStaticMarkup(<Button variant="primary">Go</Button>);
    expect(html).toContain("bg-[var(--dpf-accent)]");
    expect(html).toContain("text-[var(--dpf-on-accent)]");
    expect(html).not.toContain("text-white");
  });

  it("danger pairs the error fill with the on-accent label token", () => {
    const html = renderToStaticMarkup(<Button variant="danger">Delete</Button>);
    expect(html).toContain("bg-[var(--dpf-error)]");
    expect(html).toContain("text-[var(--dpf-on-accent)]");
  });

  it("secondary and ghost stay on surface/text tokens with no solid accent fill", () => {
    const secondary = renderToStaticMarkup(<Button variant="secondary">Back</Button>);
    expect(secondary).toContain("border-[var(--dpf-border)]");
    expect(secondary).toContain("bg-[var(--dpf-surface-2)]");
    const ghost = renderToStaticMarkup(<Button variant="ghost">More</Button>);
    expect(ghost).not.toContain("bg-[var(--dpf-accent)]");
    expect(ghost).toContain("text-[var(--dpf-text)]");
  });

  it("sizes map sm/md and never leak raw hex", () => {
    const sm = renderToStaticMarkup(<Button size="sm">S</Button>);
    expect(sm).toContain("px-3 py-1.5 text-xs");
    const md = renderToStaticMarkup(<Button size="md">M</Button>);
    expect(md).toContain("px-4 py-2 text-sm");
    expect(md).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("forwards native props (type=submit, disabled, aria-*) and merges className", () => {
    const html = renderToStaticMarkup(
      <Button type="submit" disabled aria-label="Submit form" className="w-full">
        Submit
      </Button>,
    );
    expect(html).toContain('type="submit"');
    expect(html).toContain("disabled");
    expect(html).toContain('aria-label="Submit form"');
    expect(html).toContain("w-full");
    expect(html).toContain("focus-visible:outline-2");
  });

  it("renders navigation actions as real links with the shared button treatment", () => {
    const html = renderToStaticMarkup(<ButtonLink href="/export">Export</ButtonLink>);
    expect(html).toContain('href="/export"');
    expect(html).toContain("bg-[var(--dpf-accent)]");
    expect(html).toContain("text-[var(--dpf-on-accent)]");
    expect(html).not.toContain("<button");
  });
});
