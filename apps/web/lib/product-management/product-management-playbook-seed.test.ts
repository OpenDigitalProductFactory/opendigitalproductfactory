import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCT_MANAGEMENT_PLAYBOOKS } from "./product-management-playbook";

function repoRoot(): string {
  const candidates = [
    process.env.DPF_REPO_ROOT,
    process.cwd(),
    resolve(process.cwd(), "..", ".."),
  ].filter((value): value is string => Boolean(value));
  const root = candidates.find((candidate) =>
    existsSync(join(candidate, "skills", "product-management")),
  );
  if (!root) throw new Error("DPF repository root was not found.");
  return root;
}

function inlineArray(body: string, key: string): string[] {
  const match = body.match(new RegExp(`^${key}: \\[([^\\]]*)\\]$`, "m"));
  return match
    ? match[1]!
        .split(",")
        .map((value) => value.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)
    : [];
}

describe("product-management skill and prompt seeds", () => {
  it("packages one existing-coworker skill per typed recipe", () => {
    const root = repoRoot();
    for (const recipe of PRODUCT_MANAGEMENT_PLAYBOOKS) {
      const path = join(
        root,
        "skills",
        "product-management",
        `${recipe.id}.skill.md`,
      );
      expect(existsSync(path), recipe.id).toBe(true);
      const body = readFileSync(path, "utf8");
      expect(body).toContain(`name: ${recipe.id}`);
      expect(body).toContain("category: product-management");
      expect(body).toContain('assignTo: ["portfolio-advisor"]');
      expect(inlineArray(body, "allowedTools")).toEqual([
        ...recipe.allowedTools,
      ]);
      expect(body).toMatch(/Do not|Never|do not/);
    }
  });

  it("declares only tools implemented by a registered MCP pack", () => {
    const root = repoRoot();
    const packsDir = join(root, "apps", "web", "lib", "mcp", "packs");
    const packSource = readdirSync(packsDir)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => readFileSync(join(packsDir, name), "utf8"))
      .join("\n");
    for (const tool of new Set(
      PRODUCT_MANAGEMENT_PLAYBOOKS.flatMap((recipe) => [
        ...recipe.allowedTools,
      ]),
    )) {
      expect(packSource, tool).toContain(`name: "${tool}"`);
    }
  });

  it("seeds one DB-overridable prompt for the shared runtime boundary", () => {
    const path = join(
      repoRoot(),
      "prompts",
      "product-management",
      "product-operating-loop.prompt.md",
    );
    const body = readFileSync(path, "utf8");
    expect(body).toContain("name: product-operating-loop");
    expect(body).toContain("category: product-management");
    expect(body).toContain("Derived briefs and roadmaps");
    expect(body).toContain("Do not invent teams");
  });
});
