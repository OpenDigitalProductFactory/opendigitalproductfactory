import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/locale-preferences", () => ({ saveLocalePreferences: vi.fn() }));

import { LocalePreferencesPanel } from "./LocalePreferencesPanel";

describe("LocalePreferencesPanel", () => {
  it("arrives collapsed: the summary shows current values, the selects are not rendered", () => {
    const html = renderToStaticMarkup(
      <LocalePreferencesPanel preferredLanguage={null} timeZone="America/New_York" viewerIsAdmin={false} />,
    );
    expect(html).toContain("Language and region");
    expect(html).toContain("Organization default · America/New York");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("locale-pref-timezone");
    expect(html).not.toContain("<option");
  });
});
