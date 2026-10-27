// Test-only direct Node child. Keep the TS6 compiler API and diagnostics
// identical to emit.test.ts's former in-process helper; import no app runtime.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

function webCompilerOptions(webRoot) {
  const configPath = join(webRoot, "tsconfig.json");
  const read = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, webRoot, undefined, configPath);
  return { ...parsed.options, noEmit: true, incremental: false, tsBuildInfoFile: undefined, plugins: [] };
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if (!input || input.schemaVersion !== 1 || typeof input.webRoot !== "string"
    || typeof input.tempDir !== "string" || !Array.isArray(input.roots) || !input.roots.length
    || !input.roots.every(root => typeof root === "string" && root.length > 0)) {
    throw new Error("Invalid compiler child input.");
  }
  const program = ts.createProgram(input.roots, webCompilerOptions(input.webRoot));
  // A public shape type must not pull live specialist selection/authorization
  // into this offline compiler. Preserve the invariant from E27 d33af451.
  const liveRuntime = program.getSourceFiles().map(file => file.fileName.replaceAll("\\", "/"))
    .filter(file => /\/change-review\/(?:live-specialist-selection|review-specialist-preparation)\.ts$/.test(file));
  if (liveRuntime.length) throw new Error(`Work-shape type checking loaded live specialist runtime: ${liveRuntime.join(", ")}`);
  const diagnostics = [];
  for (const root of input.roots) {
    const sourceFile = program.getSourceFile(root);
    if (!sourceFile) throw new Error(`tsc did not load ${root}`);
    for (const diagnostic of [...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)]) {
      const at = diagnostic.start === undefined ? "" : `:${sourceFile.getLineAndCharacterOfPosition(diagnostic.start).line + 1}`;
      diagnostics.push(`${root.slice(input.tempDir.length + 1)}${at} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`);
    }
  }
  process.stdout.write(JSON.stringify({ schemaVersion: 1, diagnostics }));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
