import { describe, expect, it } from "vitest";
import { resolveDoctoolsImage } from "./image";

const PINNED = `ghcr.io/o/dpf-doctools:v1.2.3@sha256:${"d".repeat(64)}`;

describe("resolveDoctoolsImage (BI-52E565DA)", () => {
  it("prefers the platform config over the environment", async () => {
    const other = `dpf-doctools@sha256:${"1".repeat(64)}`;
    expect(await resolveDoctoolsImage({ loadConfiguredImage: async () => PINNED, env: { DPF_DOCTOOLS_IMAGE: other } })).toEqual({
      status: "pinned",
      image: PINNED,
    });
  });

  it("falls back to DPF_DOCTOOLS_IMAGE when the config is unset or unreadable", async () => {
    expect(await resolveDoctoolsImage({ loadConfiguredImage: async () => undefined, env: { DPF_DOCTOOLS_IMAGE: PINNED } })).toEqual({
      status: "pinned",
      image: PINNED,
    });
    const unreadable = async () => {
      throw new Error("db down");
    };
    expect(await resolveDoctoolsImage({ loadConfiguredImage: unreadable, env: { DPF_DOCTOOLS_IMAGE: PINNED } })).toEqual({
      status: "pinned",
      image: PINNED,
    });
  });

  it("has no hardcoded default: nothing configured means not-configured", async () => {
    expect(
      await resolveDoctoolsImage({ loadConfiguredImage: async () => "  ", loadReleaseImage: async () => undefined, env: {} }),
    ).toEqual({ status: "not-configured" });
  });

  describe("the release-resolved pin (BI-9A2EC54A)", () => {
    const RELEASE = `ghcr.io/opendigitalproductfactory/dpf-doctools@sha256:${"e".repeat(64)}`;

    it("is used when neither the operator config nor the environment names an image", async () => {
      expect(
        await resolveDoctoolsImage({ loadConfiguredImage: async () => undefined, loadReleaseImage: async () => RELEASE, env: {} }),
      ).toEqual({ status: "pinned", image: RELEASE });
    });

    it("never overrides an operator or dev override", async () => {
      expect(
        await resolveDoctoolsImage({ loadConfiguredImage: async () => PINNED, loadReleaseImage: async () => RELEASE, env: {} }),
      ).toEqual({ status: "pinned", image: PINNED });
      expect(
        await resolveDoctoolsImage({
          loadConfiguredImage: async () => undefined,
          loadReleaseImage: async () => RELEASE,
          env: { DPF_DOCTOOLS_IMAGE: PINNED },
        }),
      ).toEqual({ status: "pinned", image: PINNED });
    });

    it("an unreadable release key degrades to not-configured, never an error", async () => {
      const unreadable = async () => {
        throw new Error("db down");
      };
      expect(
        await resolveDoctoolsImage({ loadConfiguredImage: async () => undefined, loadReleaseImage: unreadable, env: {} }),
      ).toEqual({ status: "not-configured" });
    });
  });

  it("marks a tag-only reference unpinned", async () => {
    expect(await resolveDoctoolsImage({ loadConfiguredImage: async () => "dpf-doctools:latest", env: {} })).toEqual({
      status: "unpinned",
      image: "dpf-doctools:latest",
    });
  });
});
