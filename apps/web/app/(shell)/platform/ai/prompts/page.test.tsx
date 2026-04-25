import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/prompt-admin", () => ({
  getPromptCatalog: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/components/admin/PromptManager", () => ({
  PromptManager: () => <div>prompt-manager</div>,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("AiPromptsPage", () => {
  it("renders prompt management under AI Operations", async () => {
    const { default: AiPromptsPage } = await import("./page");
    const html = renderToStaticMarkup(await AiPromptsPage());

    expect(html).toContain("AI Operations");
    expect(html).toContain(">Prompts<");
    expect(html).toContain('href="/platform/ai/skills"');
    expect(html).toContain("prompt-manager");
  });
});
