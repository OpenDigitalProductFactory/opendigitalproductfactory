import { describe, expect, it } from "vitest";

import {
  COMMUNICATION_CHANNELS,
  COMMUNICATION_DELIVERY_STATUSES,
  isCommunicationChannel,
  normalizeCommunicationChannel,
} from "./channel-types";

describe("communication channel types", () => {
  it("includes DPF-owned and external employee communication channels", () => {
    expect(COMMUNICATION_CHANNELS).toEqual([
      "in-app",
      "push",
      "email",
      "teams",
      "slack",
      "whatsapp",
      "telegram",
      "webhook",
    ]);
  });

  it("normalizes legacy and display channel labels", () => {
    expect(normalizeCommunicationChannel("in_app")).toBe("in-app");
    expect(normalizeCommunicationChannel("Microsoft Teams")).toBe("teams");
    expect(normalizeCommunicationChannel("WhatsApp Business")).toBe("whatsapp");
  });

  it("rejects unknown channel labels", () => {
    expect(isCommunicationChannel("fax")).toBe(false);
    expect(normalizeCommunicationChannel("fax")).toBeNull();
  });

  it("declares delivery states used by adapter results", () => {
    expect(COMMUNICATION_DELIVERY_STATUSES).toContain("queued");
    expect(COMMUNICATION_DELIVERY_STATUSES).toContain("sent");
    expect(COMMUNICATION_DELIVERY_STATUSES).toContain("failed");
  });
});
