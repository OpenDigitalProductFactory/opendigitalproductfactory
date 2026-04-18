import { describe, expect, it } from "vitest";
import { BUILD_STUDIO_CONFIG_ROUTE_COPY } from "@/components/platform/build-studio-route-copy";

describe("Build Studio runtime route copy", () => {
  it("exposes configuration-oriented copy and a return path to the working studio", () => {
    expect(BUILD_STUDIO_CONFIG_ROUTE_COPY.title).toBe("Build Studio Runtime");
    expect(BUILD_STUDIO_CONFIG_ROUTE_COPY.description).toContain("configure how builds run");
    expect(BUILD_STUDIO_CONFIG_ROUTE_COPY.openStudioLabel).toBe("Open Build Studio");
    expect(BUILD_STUDIO_CONFIG_ROUTE_COPY.openStudioHref).toBe("/build");
  });
});
