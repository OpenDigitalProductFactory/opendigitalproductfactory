import { describe, expect, it } from "vitest";
import {
  applyShellPresentationMode,
  clearShellPresentationMode,
  resolveShellContentTop,
} from "@/components/shell/ShellPresentationMode";

function createStyleRecorder() {
  const values = new Map<string, string>();

  return {
    values,
    setProperty(name: string, value: string) {
      values.set(name, value);
    },
    removeProperty(name: string) {
      values.delete(name);
    },
  };
}

describe("ShellPresentationMode helpers", () => {
  it("applies and clears the shell presentation CSS variables", () => {
    const style = createStyleRecorder();

    applyShellPresentationMode(style, {
      frameMaxWidth: "1600px",
      contentMaxWidth: "none",
      pagePadding: "0px",
      bottomGap: "16px",
      contentTop: "112px",
    });

    expect(style.values.get("--shell-page-frame-max-width")).toBe("1600px");
    expect(style.values.get("--shell-page-content-max-width")).toBe("none");
    expect(style.values.get("--shell-page-padding")).toBe("0px");
    expect(style.values.get("--shell-page-bottom-gap")).toBe("16px");
    expect(style.values.get("--shell-content-top")).toBe("112px");

    clearShellPresentationMode(style);

    expect(style.values.size).toBe(0);
  });

  it("reads the shell content top when shell content is present", () => {
    const top = resolveShellContentTop({
      querySelector: () => ({
        getBoundingClientRect: () => ({ top: 112 }),
      }),
    });

    expect(top).toBe("112px");
  });

  it("falls back when shell content is missing", () => {
    const top = resolveShellContentTop({
      querySelector: () => null,
    });

    expect(top).toBe("16px");
  });
});
