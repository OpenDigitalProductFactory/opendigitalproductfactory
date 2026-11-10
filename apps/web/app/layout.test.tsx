import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { mockGetLocaleContext } = vi.hoisted(() => ({ mockGetLocaleContext: vi.fn() }));
vi.mock("@/lib/i18n/locale-context.server", () => ({ getLocaleContext: mockGetLocaleContext }));
vi.mock("@/components/ui/Dialog", () => ({ DialogHost: () => null }));
vi.mock("./globals.css", () => ({}));

import RootLayout from "./layout";

async function renderHtmlTag(): Promise<string> {
  const markup = renderToStaticMarkup(await RootLayout({ children: null }));
  return markup.slice(0, markup.indexOf(">") + 1);
}

describe("RootLayout lang/dir (AC-LANG-DIR)", () => {
  it("renders en-US / ltr for a viewer with no preference", async () => {
    mockGetLocaleContext.mockResolvedValue({ language: "en-US", dir: "ltr" });
    expect(await renderHtmlTag()).toBe('<html lang="en-US" dir="ltr">');
  });

  it("renders rtl when the viewer's locale is right-to-left (ar-XB preview)", async () => {
    mockGetLocaleContext.mockResolvedValue({ language: "ar-XB", dir: "rtl" });
    expect(await renderHtmlTag()).toBe('<html lang="ar-XB" dir="rtl">');
  });
});
