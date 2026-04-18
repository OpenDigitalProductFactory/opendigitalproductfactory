import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { codebaseAdapter } from "./codebase-adapter";

let tmpRoot: string;

function stageTailwindConfig(root: string, contents: string) {
  writeFileSync(join(root, "tailwind.config.ts"), contents);
}

function stageGlobalsCss(root: string, contents: string) {
  const stylesDir = join(root, "app");
  mkdirSync(stylesDir, { recursive: true });
  writeFileSync(join(stylesDir, "globals.css"), contents);
}

function stageShadcnComponent(root: string, name: string) {
  const dir = join(root, "components", "ui");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.tsx`),
    `export function ${name.charAt(0).toUpperCase() + name.slice(1)}() { return null; }\n`,
  );
}

describe("codebaseAdapter", () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "dpf-codebase-adapter-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("extracts palette, fonts, and component inventory from a staged codebase", async () => {
    stageTailwindConfig(
      tmpRoot,
      `import type { Config } from "tailwindcss";
export default {
  theme: {
    extend: {
      colors: {
        primary: "#336699",
        accent: "#f97316",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
} satisfies Config;
`,
    );
    stageGlobalsCss(
      tmpRoot,
      `:root {
  --color-background: #ffffff;
  --color-foreground: #111827;
}
`,
    );
    stageShadcnComponent(tmpRoot, "button");
    stageShadcnComponent(tmpRoot, "card");

    const result = await codebaseAdapter(tmpRoot);

    expect(result.palette?.primary).toBe("#336699");
    expect(result.typography?.families?.sans).toContain("Inter");
    expect(result.components?.library).toBe("shadcn");
    const names = (result.components?.inventory ?? []).map((c) => c.name).sort();
    expect(names).toEqual(["button", "card"]);
    expect(result.confidence?.overall ?? 0).toBeGreaterThan(0.3);
    expect(result.sources?.[0]?.kind).toBe("codebase");
  });

  it("returns an empty partial with gap when no codebase path is supplied (empty string)", async () => {
    const result = await codebaseAdapter("");

    expect(result.gaps).toContain("no-codebase-path");
    expect(result.palette).toBeUndefined();
    expect(result.components?.inventory ?? []).toHaveLength(0);
    expect(result.confidence?.overall).toBe(0);
  });

  it("returns an empty partial with gap when the path does not exist", async () => {
    const result = await codebaseAdapter(join(tmpRoot, "does-not-exist"));

    expect(result.gaps).toContain("codebase-path-missing");
    expect(result.palette).toBeUndefined();
    expect(result.confidence?.overall).toBe(0);
  });

  it("returns a partial with gaps when the path exists but has no tailwind/CSS/components", async () => {
    const result = await codebaseAdapter(tmpRoot);

    expect(result.gaps?.length ?? 0).toBeGreaterThan(0);
    expect(result.confidence?.overall ?? 0).toBeLessThan(0.3);
  });
});
