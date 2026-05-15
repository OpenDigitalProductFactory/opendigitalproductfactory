import { describe, expect, it } from "vitest";

import { parseChannelBindingInput } from "./channel-bindings";

describe("parseChannelBindingInput", () => {
  it("normalizes supported channels and requires external subject", () => {
    const parsed = parseChannelBindingInput({
      principalId: "principal-1",
      channelType: "Microsoft Teams",
      providerKey: "microsoft365",
      externalSubject: " user@contoso.com ",
      allowedUrgencies: ["priority", "urgent"],
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.channelType).toBe("teams");
      expect(parsed.value.externalSubject).toBe("user@contoso.com");
      expect(parsed.value.allowedUrgencies).toEqual(["priority", "urgent"]);
    }
  });

  it("rejects unsupported channels", () => {
    const parsed = parseChannelBindingInput({
      principalId: "principal-1",
      channelType: "fax",
      providerKey: "fax",
      externalSubject: "555-1212",
      allowedUrgencies: ["urgent"],
    });

    expect(parsed).toEqual({ ok: false, error: "Unsupported channel: fax" });
  });

  it("rejects blank identity and binding fields", () => {
    expect(
      parseChannelBindingInput({
        principalId: " ",
        channelType: "telegram",
        providerKey: "telegram",
        externalSubject: "mark",
        allowedUrgencies: ["routine"],
      }),
    ).toEqual({ ok: false, error: "Principal is required." });

    expect(
      parseChannelBindingInput({
        principalId: "principal-1",
        channelType: "telegram",
        providerKey: " ",
        externalSubject: "mark",
        allowedUrgencies: ["routine"],
      }),
    ).toEqual({ ok: false, error: "Provider key is required." });

    expect(
      parseChannelBindingInput({
        principalId: "principal-1",
        channelType: "telegram",
        providerKey: "telegram",
        externalSubject: " ",
        allowedUrgencies: ["routine"],
      }),
    ).toEqual({ ok: false, error: "External subject is required." });
  });

  it("rejects bindings without a valid urgency", () => {
    const parsed = parseChannelBindingInput({
      principalId: "principal-1",
      channelType: "whatsapp",
      providerKey: "twilio",
      externalSubject: "+15551212",
      allowedUrgencies: ["soon-ish"],
    });

    expect(parsed).toEqual({
      ok: false,
      error: "At least one valid urgency is required.",
    });
  });
});
