import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";

import {
  probeWhatsAppBusiness,
  resolveWhatsAppGraphApiBaseUrl,
  WhatsAppBusinessApiError,
} from "./client";

describe("resolveWhatsAppGraphApiBaseUrl", () => {
  const original = process.env.FACEBOOK_GRAPH_API_BASE_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.FACEBOOK_GRAPH_API_BASE_URL;
    } else {
      process.env.FACEBOOK_GRAPH_API_BASE_URL = original;
    }
  });

  it("defaults to the public Graph API host", () => {
    delete process.env.FACEBOOK_GRAPH_API_BASE_URL;
    expect(resolveWhatsAppGraphApiBaseUrl()).toBe("https://graph.facebook.com");
  });

  it("honors the shared Meta Graph base URL override", () => {
    process.env.FACEBOOK_GRAPH_API_BASE_URL = "http://integration-test-harness:8700";
    expect(resolveWhatsAppGraphApiBaseUrl()).toBe("http://integration-test-harness:8700");
  });
});

describe("probeWhatsAppBusiness", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  it("returns phone readiness and localized template catalog", async () => {
    const pool = mockAgent.get("https://graph.facebook.com");
    pool
      .intercept({
        path: (value) =>
          value.startsWith("/v21.0/waba-123/phone_numbers?") &&
          value.includes("fields=id%2Cdisplay_phone_number%2Cverified_name%2Cquality_rating%2Ccode_verification_status%2Cplatform_type"),
        method: "GET",
      })
      .reply(200, {
        data: [
          {
            id: "phone-456",
            display_phone_number: "+1 512-555-0100",
            verified_name: "Acme Austin",
            quality_rating: "GREEN",
            code_verification_status: "VERIFIED",
            platform_type: "CLOUD_API",
          },
        ],
      });
    pool
      .intercept({
        path: (value) =>
          value.startsWith("/v21.0/waba-123/message_templates?") &&
          value.includes("fields=id%2Cname%2Clanguage%2Cstatus%2Ccategory%2Ccomponents"),
        method: "GET",
      })
      .reply(200, {
        data: [
          {
            id: "template-1",
            name: "appointment_reminder",
            language: "en_US",
            status: "APPROVED",
            category: "UTILITY",
            components: [{ type: "BODY", text: "Reminder for {{1}}" }],
          },
          {
            id: "template-2",
            name: "promo_es",
            language: "es_MX",
            status: "PENDING",
            category: "MARKETING",
            components: [{ type: "BODY", text: "Oferta local {{1}}" }],
          },
        ],
      });

    const result = await probeWhatsAppBusiness({
      accessToken: "meta-token",
      wabaId: "waba-123",
      phoneNumberId: "phone-456",
      dispatcher: mockAgent,
    });

    expect(result.phoneNumber.displayPhoneNumber).toBe("+1 512-555-0100");
    expect(result.phoneNumber.qualityRating).toBe("GREEN");
    expect(result.templates).toHaveLength(2);
    expect(result.templates[0]).toMatchObject({
      name: "appointment_reminder",
      language: "en_US",
      status: "APPROVED",
    });
    expect(result.localeSummary).toEqual([
      { language: "en_US", approved: 1, pending: 0, rejected: 0 },
      { language: "es_MX", approved: 0, pending: 1, rejected: 0 },
    ]);
  });

  it("throws a redacted error when Meta rejects the token", async () => {
    mockAgent
      .get("https://graph.facebook.com")
      .intercept({
        path: (value) => value.startsWith("/v21.0/waba-123/phone_numbers?"),
        method: "GET",
      })
      .reply(403, {
        error: { message: "Token includes super-secret-meta-token" },
      });

    await expect(
      probeWhatsAppBusiness({
        accessToken: "super-secret-meta-token",
        wabaId: "waba-123",
        phoneNumberId: "phone-456",
        dispatcher: mockAgent,
      }),
    ).rejects.toThrow(WhatsAppBusinessApiError);

    await expect(
      probeWhatsAppBusiness({
        accessToken: "super-secret-meta-token",
        wabaId: "waba-123",
        phoneNumberId: "phone-456",
        dispatcher: mockAgent,
      }),
    ).rejects.not.toThrow(/super-secret-meta-token/);
  });
});
