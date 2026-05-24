// apps/web/components/build/OpenSandboxButton.test.tsx
//
// Pins the security + label contract the peer reviewer demanded:
//   R3: single shared link → never emit multiple anchors.
//   Mandatory rel="noopener noreferrer" when target="_blank".
//   Disabled visual + aria-disabled when sandboxUrl is empty.
//   Label format matches formatSandboxLabel(driver).

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OpenSandboxButton } from "./OpenSandboxButton";
import { BUILD_STUDIO_TEST_IDS } from "./build-studio-layout";

describe("OpenSandboxButton", () => {
  it("renders <a target=\"_blank\" rel=\"noopener noreferrer\"> — mandatory rel", () => {
    const html = renderToStaticMarkup(
      <OpenSandboxButton drivingBuildCode="FB-B33E84B5" sandboxUrl="http://localhost:5555" />,
    );
    expect(html).toMatch(/target="_blank"/);
    expect(html).toMatch(/rel="noopener noreferrer"/);
    expect(html).toMatch(/href="http:\/\/localhost:5555"/);
  });

  it('renders the canonical label format "Open live preview · driving: {code}"', () => {
    const html = renderToStaticMarkup(
      <OpenSandboxButton drivingBuildCode="FB-B33E84B5" sandboxUrl="http://localhost:5555" />,
    );
    expect(html).toContain("Open live preview");
    expect(html).toContain("driving: FB-B33E84B5");
  });

  it('renders "driving: idle" when no build is driving', () => {
    const html = renderToStaticMarkup(
      <OpenSandboxButton drivingBuildCode={null} sandboxUrl="http://localhost:5555" />,
    );
    expect(html).toContain("driving: idle");
  });

  it("emits data-driving for snapshot diffing", () => {
    const html = renderToStaticMarkup(
      <OpenSandboxButton drivingBuildCode="FB-CCC" sandboxUrl="http://localhost:5555" />,
    );
    expect(html).toContain('data-driving="FB-CCC"');
  });

  it("emits data-driving=\"idle\" when drivingBuildCode is null", () => {
    const html = renderToStaticMarkup(
      <OpenSandboxButton drivingBuildCode={null} sandboxUrl="http://localhost:5555" />,
    );
    expect(html).toContain('data-driving="idle"');
  });

  it("emits the canonical test ID on the wrapper", () => {
    const html = renderToStaticMarkup(
      <OpenSandboxButton drivingBuildCode="FB-X" sandboxUrl="http://localhost:5555" />,
    );
    expect(html).toContain(`data-testid="${BUILD_STUDIO_TEST_IDS.openSandbox}"`);
  });

  it("renders ONLY one anchor element (single-shared-link rule R3)", () => {
    const html = renderToStaticMarkup(
      <OpenSandboxButton drivingBuildCode="FB-X" sandboxUrl="http://localhost:5555" />,
    );
    const anchors = html.match(/<a[\s>]/g) ?? [];
    expect(anchors).toHaveLength(1);
  });

  it("renders a non-link <span role=\"link\" aria-disabled> when sandboxUrl is empty", () => {
    const html = renderToStaticMarkup(
      <OpenSandboxButton drivingBuildCode="FB-X" sandboxUrl="" />,
    );
    // Must not emit an <a> tag (no dangling href).
    expect(html).not.toMatch(/<a[\s>]/);
    // Must indicate disabled state to assistive tech.
    expect(html).toContain('role="link"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("cursor-not-allowed");
  });

  it("treats whitespace-only sandboxUrl as empty", () => {
    const html = renderToStaticMarkup(
      <OpenSandboxButton drivingBuildCode="FB-X" sandboxUrl="   " />,
    );
    expect(html).not.toMatch(/<a[\s>]/);
    expect(html).toContain('aria-disabled="true"');
  });

  it("uses DPF CSS variables only — no hex literals", () => {
    for (const url of ["http://localhost:5555", ""]) {
      const html = renderToStaticMarkup(
        <OpenSandboxButton drivingBuildCode="FB-X" sandboxUrl={url} />,
      );
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
      expect(html).toContain("var(--dpf-");
    }
  });

  it("includes focus-visible styling for keyboard users", () => {
    const html = renderToStaticMarkup(
      <OpenSandboxButton drivingBuildCode="FB-X" sandboxUrl="http://localhost:5555" />,
    );
    expect(html).toContain("focus-visible:outline-2");
    expect(html).toContain("focus-visible:outline-[var(--dpf-accent)]");
  });
});
