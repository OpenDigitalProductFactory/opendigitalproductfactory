import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { renderSpy } = vi.hoisted(() => ({ renderSpy: vi.fn() }));

vi.mock("@/lib/shared/markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/shared/markdown")>();
  return {
    ...actual,
    renderMarkdown: (...args: Parameters<typeof actual.renderMarkdown>) => {
      renderSpy();
      return actual.renderMarkdown(...args);
    },
  };
});

import { MarkdownHtml, clearMarkdownHtmlMemo } from "./MarkdownHtml";
import type { RenderMarkdownOptions } from "@/lib/shared/markdown";

const OPTIONS: RenderMarkdownOptions = { classes: { p: "m-0" } };

const thread = Array.from({ length: 50 }, (_, i) =>
  `Message ${i}\n\n| a | b |\n|---|---|\n| ${i} | **bold** |\n\n\`\`\`ts\nconst x${i} = ${i};\n\`\`\``,
);

function renderThread(memoize: boolean) {
  return renderToStaticMarkup(
    <>
      {thread.map((source, i) => (
        <MarkdownHtml key={i} source={source} options={OPTIONS} memoize={memoize} />
      ))}
    </>,
  );
}

describe("MarkdownHtml memoization (BI-EDE2AF6F)", () => {
  beforeEach(() => {
    renderSpy.mockClear();
    clearMarkdownHtmlMemo();
  });

  it("re-runs markdown-it for every finished message on every render without memoize", () => {
    for (let pass = 0; pass < 6; pass++) renderThread(false);
    expect(renderSpy).toHaveBeenCalledTimes(300);
  });

  it("renders each finished message once across re-renders when memoized", () => {
    const first = renderThread(true);
    for (let pass = 0; pass < 5; pass++) expect(renderThread(true)).toBe(first);
    expect(renderSpy).toHaveBeenCalledTimes(50);
  });

  it("produces byte-identical output to the unmemoized render", () => {
    expect(renderThread(true)).toBe(renderThread(false));
  });

  it("re-renders when the source changes or the options object differs", () => {
    renderToStaticMarkup(<MarkdownHtml source="one" options={OPTIONS} memoize />);
    renderToStaticMarkup(<MarkdownHtml source="two" options={OPTIONS} memoize />);
    renderToStaticMarkup(<MarkdownHtml source="one" options={{ ...OPTIONS }} memoize />);
    expect(renderSpy).toHaveBeenCalledTimes(3);
  });

  it("does not memoize a call that passes no options object", () => {
    renderToStaticMarkup(<MarkdownHtml source="plain" memoize />);
    renderToStaticMarkup(<MarkdownHtml source="plain" memoize />);
    expect(renderSpy).toHaveBeenCalledTimes(2);
  });
});
