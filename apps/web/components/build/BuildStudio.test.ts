import { describe, expect, it } from "vitest";
import {
  BUILD_STUDIO_TEST_IDS,
  getBuildStudioGraphPanelClassName,
  getBuildStudioShellClassName,
  getBuildStudioSidebarClassName,
} from "@/components/build/build-studio-layout";

describe("build-studio-layout", () => {
  it("keeps the studio shell immersive without viewport-coupled sizing", () => {
    expect(getBuildStudioShellClassName()).toContain("flex");
    expect(getBuildStudioShellClassName()).toContain("min-h-full");
    expect(getBuildStudioShellClassName()).not.toContain("100vh");
  });

  it("keeps the graph panel container-driven instead of using old fullscreen math", () => {
    expect(getBuildStudioGraphPanelClassName()).toContain("min-h-[420px]");
    expect(getBuildStudioGraphPanelClassName()).toContain("flex-1");
    expect(getBuildStudioGraphPanelClassName()).not.toContain("100vh");
  });

  it("uses narrower desktop sidebar widths and stable shell test ids", () => {
    expect(getBuildStudioSidebarClassName(true)).toContain("xl:w-[320px]");
    expect(getBuildStudioSidebarClassName(true)).not.toContain("lg:w-[360px]");
    expect(getBuildStudioSidebarClassName(false)).toContain("w-0");
    expect(BUILD_STUDIO_TEST_IDS.shell).toBe("build-studio-shell");
    expect(BUILD_STUDIO_TEST_IDS.graphPanel).toBe("build-studio-graph-panel");
  });
});
