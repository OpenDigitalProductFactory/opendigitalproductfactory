import ts from "typescript";

import type { CodeGraphExtraction, CodeGraphExtractor, CodeGraphExtractorInput } from "../types";

const EXTRACTOR = "tests-ast-v1";
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

function lineFor(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function normalizePath(value: string): string {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function dirname(filePath: string): string {
  return filePath.split("/").slice(0, -1).join("/");
}

function basename(filePath: string): string {
  return filePath.split("/").at(-1) ?? filePath;
}

function hasSourceExtension(filePath: string): boolean {
  return SOURCE_EXTENSIONS.some((extension) => filePath.endsWith(extension));
}

function withSourceExtension(filePath: string): string {
  return hasSourceExtension(filePath) ? filePath : `${filePath}.ts`;
}

function normalizeRuntimeSpecifierExtension(sourcePath: string, testFilePath: string): string {
  if (!/\.(test|spec)\.tsx?$/.test(testFilePath)) {
    return sourcePath;
  }
  if (sourcePath.endsWith(".jsx")) {
    return `${sourcePath.slice(0, -4)}.tsx`;
  }
  if (sourcePath.endsWith(".js")) {
    return `${sourcePath.slice(0, -3)}.ts`;
  }
  return sourcePath;
}

function resolveSourceImport(specifier: string, testFilePath: string): string | null {
  if (specifier.startsWith(".")) {
    return normalizeRuntimeSpecifierExtension(withSourceExtension(normalizePath(`${dirname(testFilePath)}/${specifier}`)), testFilePath);
  }
  if (specifier.startsWith("@/")) {
    return normalizeRuntimeSpecifierExtension(withSourceExtension(normalizePath(`apps/web/${specifier.slice(2)}`)), testFilePath);
  }
  return null;
}

function fallbackSourcePath(testFilePath: string): string {
  const fileName = basename(testFilePath);
  const stem = fileName
    .replace(/\.test\.[^.]+$/, "")
    .replace(/\.spec\.[^.]+$/, "");
  return normalizePath(`${dirname(testFilePath)}/${stem}.ts`);
}

export function extractTestFileFacts(input: CodeGraphExtractorInput): CodeGraphExtraction {
  const testFileKey = `${input.graphKey}:test:${input.filePath}`;
  const sourceFile = ts.createSourceFile(input.filePath, input.sourceText, ts.ScriptTarget.Latest, true);
  const nodes: CodeGraphExtraction["nodes"] = [{
    graphKey: input.graphKey,
    kind: "TestFile",
    key: testFileKey,
    name: basename(input.filePath),
    filePath: input.filePath,
    startLine: 1,
    endLine: Math.max(input.sourceText.split("\n").length, 1),
    extractor: EXTRACTOR,
  }];
  const edges: CodeGraphExtraction["edges"] = [];
  let exactEdgeCount = 0;

  function addEdge(sourcePath: string, confidence: "exact" | "heuristic", line: number | null): void {
    exactEdgeCount += confidence === "exact" ? 1 : 0;
    edges.push({
      graphKey: input.graphKey,
      kind: "TESTED_BY",
      fromKey: testFileKey,
      toKey: `${input.graphKey}:${sourcePath}`,
      filePath: input.filePath,
      startLine: line,
      endLine: line,
      confidence,
      extractor: EXTRACTOR,
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const sourcePath = resolveSourceImport(node.moduleSpecifier.text, input.filePath);
      if (sourcePath && !sourcePath.endsWith(".test.ts") && !sourcePath.endsWith(".spec.ts")) {
        addEdge(sourcePath, "exact", lineFor(sourceFile, node.getStart(sourceFile)));
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  if (exactEdgeCount === 0) {
    addEdge(fallbackSourcePath(input.filePath), "heuristic", null);
  }

  return { nodes, edges };
}

export const testExtractor: CodeGraphExtractor = {
  name: "tests",
  version: "v1",
  matches(filePath) {
    return /\.(test|spec)\.[jt]sx?$/.test(filePath);
  },
  extract: extractTestFileFacts,
};
