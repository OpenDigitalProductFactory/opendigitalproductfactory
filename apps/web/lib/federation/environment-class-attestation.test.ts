import { describe, expect, it } from "vitest";

import {
  ENVIRONMENT_CLASS_SAN_PREFIX,
  environmentClassSan,
  readAttestedEnvironmentClass,
} from "./environment-class-attestation";

describe("environmentClassSan", () => {
  it("names the class as a URN the CA certifies", () => {
    expect(environmentClassSan("development")).toBe(`${ENVIRONMENT_CLASS_SAN_PREFIX}development`);
    expect(environmentClassSan("production")).toBe("urn:dpf:environment-class:production");
  });
});

describe("readAttestedEnvironmentClass", () => {
  it("reads the one class URI from the certificate's SANs", () => {
    expect(readAttestedEnvironmentClass("DNS:dev.internal, URI:urn:dpf:environment-class:development, IP Address:192.168.0.20"))
      .toBe("development");
  });

  it("is unattested when the certificate names no class", () => {
    expect(readAttestedEnvironmentClass("DNS:dev.internal, IP Address:192.168.0.20")).toBeNull();
    expect(readAttestedEnvironmentClass(undefined)).toBeNull();
  });

  it("is unattested when the certificate names two classes or an unknown one", () => {
    expect(readAttestedEnvironmentClass("URI:urn:dpf:environment-class:development, URI:urn:dpf:environment-class:production")).toBeNull();
    expect(readAttestedEnvironmentClass("URI:urn:dpf:environment-class:staging")).toBeNull();
  });
});
