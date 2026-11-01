import ts from "typescript";

function isServerReference(expression: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expression)) return isServerReference(expression.expression);
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return isServerReference(expression.right);
  }
  return ts.isIdentifier(expression) && expression.text === "createServerReference"
    || ts.isPropertyAccessExpression(expression) && expression.name.text === "createServerReference"
    || ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)
      && expression.argumentExpression.text === "createServerReference";
}

/** Parse only supplied public client code. No module resolution, file reads or execution. */
export function publicClientActionExport(content: string, id: string): string | null {
  if (!/^[a-f0-9]{40,64}$/.test(id) || content.length > 8 * 1024 * 1024) return null;
  try {
    const fileName = "/public-client.js";
    const source = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
    const options: ts.CompilerOptions = { allowJs: true, noLib: true, noResolve: true, noEmit: true, target: ts.ScriptTarget.Latest };
    const host = ts.createCompilerHost(options);
    host.getCurrentDirectory = () => "/";
    host.getDefaultLibFileName = () => "/unavailable.d.ts";
    host.getSourceFile = name => name === fileName ? source : undefined;
    host.readFile = name => name === fileName ? content : undefined;
    host.fileExists = name => name === fileName;
    host.directoryExists = name => name === "/";
    host.getDirectories = () => [];
    host.realpath = name => name;
    host.writeFile = () => {};
    const program = ts.createProgram([fileName], options, host);
    if (program.getSyntacticDiagnostics(source).length) return null;
    const names = new Set<string>();
    let malformed = false;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isServerReference(node.expression)) {
        const first = node.arguments[0], last = node.arguments[node.arguments.length - 1];
        if (first && ts.isStringLiteral(first) && first.text === id) {
          if (node.arguments.length !== 5 || !last || !ts.isStringLiteral(last) || !/^[A-Za-z_$][\w$]*$/.test(last.text)) malformed = true;
          else names.add(last.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return !malformed && names.size === 1 ? [...names][0]! : null;
  } catch { return null; }
}
