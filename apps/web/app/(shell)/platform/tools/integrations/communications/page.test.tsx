import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import CommunicationsPage from "./page";

describe("CommunicationsPage", () => {
  it("renders provider readiness groups for the communication fabric", async () => {
    const html = renderToStaticMarkup(await CommunicationsPage());

    expect(html).toContain("Communications");
    expect(html).toContain("DPF-owned baseline");
    expect(html).toContain("Enterprise real-time");
    expect(html).toContain("Field and local messaging");
    expect(html).toContain("Telegram");
    expect(html).toContain("WhatsApp Business");
  });
});
