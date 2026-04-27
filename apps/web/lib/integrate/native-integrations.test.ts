import { describe, expect, it } from "vitest";
import { getNativeIntegrationDescriptor } from "./native-integrations";

describe("getNativeIntegrationDescriptor", () => {
  it("infers ADP as a native enterprise integration", () => {
    const descriptor = getNativeIntegrationDescriptor({
      name: "ADP Workforce Now",
      slug: "adp-workforce-now",
      category: "hr",
      tags: ["adp", "payroll"],
    });

    expect(descriptor).toEqual({
      integrationKey: "adp",
      label: "ADP Workforce Now",
      route: "/platform/tools/integrations/adp",
      activationKind: "native_setup",
      metadataSource: "inferred",
    });
  });

  it("prefers explicit native integration metadata when present", () => {
    const descriptor = getNativeIntegrationDescriptor({
      name: "ADP Payroll",
      slug: "custom-adp",
      category: "hr",
      tags: ["payroll"],
      rawMetadata: {
        dpfNativeIntegration: {
          integrationKey: "adp",
          label: "ADP Workforce Now",
          route: "/platform/tools/integrations/adp",
          activationKind: "native_setup",
        },
      },
    });

    expect(descriptor?.metadataSource).toBe("explicit");
    expect(descriptor?.route).toBe("/platform/tools/integrations/adp");
  });
});
