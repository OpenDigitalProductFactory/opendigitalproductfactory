import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layoutSource = readFileSync(
  new URL("./layout.tsx", import.meta.url),
  "utf8",
);

describe("portfolio layout mobile fit", () => {
  it("uses the shell's compact gutter and removes the taxonomy rail on narrow screens", () => {
    expect(layoutSource).toContain(
      'className="flex gap-0 -m-2 h-[calc(100vh-57px)] overflow-hidden sm:-m-6"',
    );
    expect(layoutSource).toContain(
      'className="hidden w-56 flex-shrink-0',
    );
    expect(layoutSource).toContain("sm:block");
    expect(layoutSource).toContain(
      'className="min-w-0 flex-1 overflow-y-auto p-2 sm:p-6"',
    );
  });
});
