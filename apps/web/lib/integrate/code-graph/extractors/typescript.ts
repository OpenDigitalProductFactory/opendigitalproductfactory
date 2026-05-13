import ts from "typescript";

import type {
  CodeGraphEdgeFact,
  CodeGraphExtraction,
  CodeGraphExtractor,
  CodeGraphNodeFact,
} from "../types";

const EXTRACTOR = "typescript-ast-v1";
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);

type Input = {
  graphKey: string;
  filePath: string;
  sourceText: string;
};

function lineFor(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function moduleKey(graphKey: string, moduleName: string, filePath: string): string {
  if (moduleName.startsWith(".")) {
    const base = filePath.split("/").slice(0, -1).join("/");
    return `${graphKey}:module:${base}/${moduleName.replace(/^\.\//, "")}`.replace(/\/+/g, "/");
  }
  return `${graphKey}:module:${moduleName}`;
}

function moduleName(moduleName: string): string {
  return moduleName.replace(/^\.\//, "");
}

function declarationName(node: ts.Node): string | null {
  if (
    (
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node)
    ) &&
    node.name
  ) {
    return node.name.text;
  }
  return null;
}

export function extractTypeScriptFacts(input: Input): CodeGraphExtraction {
  const sourceFile = ts.createSourceFile(input.filePath, input.sourceText, ts.ScriptTarget.Latest, true);
  const fileKey = `${input.graphKey}:${input.filePath}`;
  const nodes: CodeGraphNodeFact[] = [];
  const edges: CodeGraphEdgeFact[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const toKey = moduleKey(input.graphKey, node.moduleSpecifier.text, input.filePath);
      nodes.push({
        graphKey: input.graphKey,
        kind: "ExternalModule",
        key: toKey,
        name: moduleName(node.moduleSpecifier.text),
        filePath: input.filePath,
        startLine: lineFor(sourceFile, node.getStart(sourceFile)),
        endLine: lineFor(sourceFile, node.getEnd()),
        extractor: EXTRACTOR,
      });
      edges.push({
        graphKey: input.graphKey,
        kind: "IMPORTS",
        fromKey: fileKey,
        toKey,
        filePath: input.filePath,
        startLine: lineFor(sourceFile, node.getStart(sourceFile)),
        endLine: lineFor(sourceFile, node.getEnd()),
        confidence: "exact",
        extractor: EXTRACTOR,
      });
    }

    const name = declarationName(node);
    const exported = ts.canHaveModifiers(node) && Boolean(
      ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
    );
    if (
      name &&
      exported &&
      (
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node)
      )
    ) {
      const symbolKey = `${input.graphKey}:symbol:${input.filePath}:${name}`;
      nodes.push({
        graphKey: input.graphKey,
        kind: "CodeSymbol",
        key: symbolKey,
        name,
        filePath: input.filePath,
        startLine: lineFor(sourceFile, node.getStart(sourceFile)),
        endLine: lineFor(sourceFile, node.getEnd()),
        extractor: EXTRACTOR,
      });
      edges.push({
        graphKey: input.graphKey,
        kind: "DEFINES",
        fromKey: fileKey,
        toKey: symbolKey,
        filePath: input.filePath,
        startLine: lineFor(sourceFile, node.getStart(sourceFile)),
        endLine: lineFor(sourceFile, node.getEnd()),
        confidence: "exact",
        extractor: EXTRACTOR,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { nodes, edges };
}

export const typeScriptExtractor: CodeGraphExtractor = {
  name: "typescript",
  version: "v1",
  matches(filePath) {
    const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
    return SOURCE_EXTENSIONS.has(extension);
  },
  extract: extractTypeScriptFacts,
};
