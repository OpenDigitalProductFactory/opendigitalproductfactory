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
    expect(await resolveDoctoolsImage({ loadConfiguredImage: async () => "  ", env: {} })).toEqual({ status: "not-configured" });
  });

  it("marks a tag-only reference unpinned", async () => {
    expect(await resolveDoctoolsImage({ loadConfiguredImage: async () => "dpf-doctools:latest", env: {} })).toEqual({
      status: "unpinned",
      image: "dpf-doctools:latest",
    });
  });
});
