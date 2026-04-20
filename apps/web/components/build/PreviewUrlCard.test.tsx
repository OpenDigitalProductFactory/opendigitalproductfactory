import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PreviewUrlCard } from "@/components/build/PreviewUrlCard";

describe("PreviewUrlCard", () => {
  it("renders the empty state while sandbox is not running", () => {
    const html = renderToStaticMarkup(
      <PreviewUrlCard buildId="FB-TEST-1" phase="plan" sandboxPort={null} />,
    );
    expect(html).toContain("Preview will be available once the Build phase starts");
    expect(html).not.toContain("Open http://");
    expect(html).toContain("preview-url-card");
  });

  it("renders the shipped-complete message when phase is complete", () => {
    const html = renderToStaticMarkup(
      <PreviewUrlCard buildId="FB-TEST-2" phase="complete" sandboxPort={3035} />,
    );
    expect(html).toContain("Feature has been shipped");
  });

  it("renders a host-URL link and Copy button when sandbox is running", () => {
    const html = renderToStaticMarkup(
      <PreviewUrlCard buildId="FB-TEST-3" phase="build" sandboxPort={3035} />,
    );
    expect(html).toContain("Preview in your browser");
    expect(html).toContain("http://localhost:3035");
    // Open-in-new-tab link must have noopener noreferrer for window.opener safety
    expect(html).toMatch(/target="_blank"[^>]*rel="noopener noreferrer"/);
    expect(html).toContain("Copy URL");
    // Status dot implied by the sandbox-running label
    expect(html).toContain("Sandbox running");
  });

  it("still shows the preview link during review and ship phases", () => {
    const reviewHtml = renderToStaticMarkup(
      <PreviewUrlCard buildId="FB-TEST-4" phase="review" sandboxPort={3037} />,
    );
    expect(reviewHtml).toContain("http://localhost:3037");

    const shipHtml = renderToStaticMarkup(
      <PreviewUrlCard buildId="FB-TEST-5" phase="ship" sandboxPort={3038} />,
    );
    expect(shipHtml).toContain("http://localhost:3038");
  });
});
