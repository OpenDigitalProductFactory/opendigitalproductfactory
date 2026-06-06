import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("lazy-node bundle boundary", () => {
  const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "lazy-node.ts");
  const source = readFileSync(sourcePath, "utf8");

  it("loads Node built-ins through static node: imports instead of a dynamic require resolver", () => {
    expect(source).toContain('from "node:fs"');
    expect(source).toContain('from "node:child_process"');
    expect(source).not.toContain("new Function");
    expect(source).not.toContain("return require(mod)");
  });
});
