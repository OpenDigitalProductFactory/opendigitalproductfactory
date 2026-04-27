import { describe, expect, it } from "vitest";
import { getIntegrationConnectorProfile } from "./connector-factory";

describe("getIntegrationConnectorProfile", () => {
  it("infers a generic REST connector with API key auth and universal API call coverage", () => {
    const profile = getIntegrationConnectorProfile({
      name: "Stripe",
      slug: "stripe",
      category: "finance",
      tags: ["payments", "billing"],
    });

    expect(profile.metadataSource).toBe("inferred");
    expect(profile.supportsGenericConnector).toBe(true);
    expect(profile.authModes).toContain("api_key_header");
    expect(profile.transportModes).toContain("rest_json");
    expect(profile.capabilities).toContain("universal_api_call");
    expect(profile.capabilities).toContain("search");
  });

  it("prefers explicit DPF connector metadata when present", () => {
    const profile = getIntegrationConnectorProfile({
      name: "Microsoft Teams",
      slug: "microsoft-teams",
      category: "communication",
      tags: ["teams", "chat"],
      rawMetadata: {
        dpfConnectorProfile: {
          authModes: ["oauth_client_credentials"],
          transportModes: ["rest_json"],
          capabilities: ["list", "get", "webhook_trigger", "polling_trigger", "universal_api_call"],
          supportsGenericConnector: true,
        },
      },
    });

    expect(profile.metadataSource).toBe("explicit");
    expect(profile.authModes).toEqual(["oauth_client_credentials"]);
    expect(profile.transportModes).toEqual(["rest_json"]);
    expect(profile.capabilities).toContain("webhook_trigger");
    expect(profile.capabilities).not.toContain("create");
  });
});
