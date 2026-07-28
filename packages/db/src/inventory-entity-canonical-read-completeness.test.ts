import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..", "..", "..");
const sourceRoots = [
  resolve(repoRoot, "packages", "db", "src"),
  resolve(repoRoot, "apps", "web"),
];
const guardedMethods = new Set(["aggregate", "count", "findFirst", "findMany", "groupBy"]);

type UnguardedRead = {
  file: string;
  line: number;
  method: string;
};

function inventoryEntityReadsWithoutCanonicalPredicate(): UnguardedRead[] {
  const files = sourceRoots.flatMap((root) =>
    ts.sys.readDirectory(root, [".ts", ".tsx"], undefined, undefined),
  );
  const findings: UnguardedRead[] = [];

  for (const file of files) {
    const normalized = file.replaceAll("\\", "/");
    if (
      normalized.includes("/generated/")
      || normalized.includes("/node_modules/")
      || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)
    ) {
      continue;
    }

    const text = readFileSync(file, "utf8");
    if (!text.includes("inventoryEntity.")) continue;
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && guardedMethods.has(node.expression.name.text)
        && ts.isPropertyAccessExpression(node.expression.expression)
        && node.expression.expression.name.text === "inventoryEntity"
      ) {
        const callText = node.getText(source);
        if (
          !callText.includes("INVENTORY_ENTITY_CANONICAL_WHERE")
          && !callText.includes("mergedIntoId")
        ) {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source));
          findings.push({
            file: relative(repoRoot, file).replaceAll("\\", "/"),
            line: position.line + 1,
            method: node.expression.name.text,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return findings;
}

describe("InventoryEntity canonical-read completeness", () => {
  it("keeps superseded tombstones out of every default list, count, and projection read", () => {
    const findings = inventoryEntityReadsWithoutCanonicalPredicate();
    expect(
      findings,
      findings
        .map(({ file, line, method }) => `${file}:${line} inventoryEntity.${method}`)
        .join("\n"),
    ).toEqual([]);
  });
});
