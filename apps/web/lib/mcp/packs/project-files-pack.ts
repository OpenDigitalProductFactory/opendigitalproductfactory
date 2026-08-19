// Project-files & codebase-manifest tool pack — BI-2B7EE073.
//
// Drains the self-contained "project file access and codebase manifest" domain
// out of the mcp-tools.ts executeTool switch: the five tools a coworker uses to
// list a project directory, read a project file, search project files for a
// pattern, and generate/read the codebase manifest (SBOM). Each handler
// lazy-imports the same service the former switch case used and reproduces its
// body verbatim, so behaviour is identical when the tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import { prisma } from "@dpf/db";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "list_project_directory",
    description: "List files and directories in a project directory. Use '.' or empty string for project root. Helps discover the project structure.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative directory path from project root (use '.' for root)" },
      },
      required: ["path"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan"],
  },
  {
    name: "read_project_file",
    description: "Read a file from the project codebase. Use a path relative to the project root (forward slashes). Cannot access .env, credentials, or node_modules.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path from project root" },
        startLine: { type: "number", description: "Start line (1-based, optional)" },
        endLine: { type: "number", description: "End line (optional)" },
      },
      required: ["path"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan"],
  },
  {
    name: "search_project_files",
    description: "Search the project codebase for a text pattern. The query parameter is the text to search for (e.g. 'voucher', 'student'). The glob parameter is an OPTIONAL file type filter (e.g. '*.ts'). Do NOT combine them — use query='voucher' and glob='*.prisma' as separate parameters, NOT query='voucher:*.prisma'.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text or regex pattern to search for (e.g. 'voucher', 'Student', 'registration'). This is NOT a file path or glob." },
        glob: { type: "string", description: "Optional file type filter (e.g. '*.ts', '*.prisma', '*.tsx'). Do NOT put search terms here." },
        maxResults: { type: "number", description: "Maximum results (default 20)" },
      },
      required: ["query"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan"],
  },
  {
    name: "generate_codebase_manifest",
    description: "Generate or refresh the codebase manifest (SBOM). Reads package.json, the prisma/schema folder, directory structure, and the base manifest template to produce a current snapshot. Dev-only.",
    inputSchema: {
      type: "object",
      properties: {
        version: { type: "string", description: "Version label (default: 'dev')" },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "read_codebase_manifest",
    description: "Read the codebase manifest (SBOM) for a specific version. Returns the structured JSON with modules, capabilities, dependencies, and statistics. Works in both dev and production.",
    inputSchema: {
      type: "object",
      properties: {
        version: { type: "string", description: "Version to read (default: latest or deployed)" },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
];

async function listProjectDirectoryHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { listProjectDirectory } = await import("@/lib/build/codebase-tools");
  const result = await listProjectDirectory(String(params.path ?? "."));
  if ("error" in result) return { success: false, error: result.error, message: result.error };
  const summary = result.entries.map((e) => `${e.type === "dir" ? "[dir]" : "     "} ${e.path}`).join("\n");
  return { success: true, message: summary || "Empty directory", data: { entries: result.entries } };
}

async function readProjectFileHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { readProjectFile } = await import("@/lib/build/codebase-tools");
  const opts: { startLine?: number; endLine?: number } = {};
  if (typeof params.startLine === "number") opts.startLine = params.startLine;
  if (typeof params.endLine === "number") opts.endLine = params.endLine;
  const result = await readProjectFile(String(params.path ?? ""), opts);
  if ("error" in result) return { success: false, error: result.error, message: result.error };
  return { success: true, message: result.content, data: { content: result.content } };
}

async function searchProjectFilesHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { searchProjectFiles } = await import("@/lib/build/codebase-tools");
  let query = String(params.query ?? "");
  const opts: { glob?: string; maxResults?: number } = {};

  // Auto-fix: model often combines query and glob into one string
  // e.g. "registration:**/*.prisma" or "voucher:*.ts"
  const colonGlobMatch = query.match(/^([^:]+):(\*\*?\/.+|\*\.[a-z]+)$/);
  if (colonGlobMatch) {
    query = colonGlobMatch[1]!.trim();
    opts.glob = colonGlobMatch[2]!.trim();
    console.log(`[search_project_files] Auto-split combined query: ${JSON.stringify(params.query)} → query=${JSON.stringify(query)} glob=${JSON.stringify(opts.glob)}`);
  }

  if (typeof params.glob === "string" && !opts.glob) opts.glob = params.glob;
  if (typeof params.maxResults === "number") opts.maxResults = params.maxResults;
  const result = await searchProjectFiles(query, opts);
  if ("error" in result) return { success: false, error: result.error, message: result.error };
  const summary = result.results.map((r) => `${r.path}:${r.line}: ${r.text}`).join("\n");
  if (!summary) {
    return {
      success: true,
      message: `No matches found for "${params.query}"${params.glob ? ` in ${params.glob} files` : ""}. ${params.glob ? "Try searching without a glob filter, or try a different query term. " : ""}If this is a new feature with no existing code, proceed with saveBuildEvidence to save your design — do NOT search again with the same query.`,
      data: { results: [] },
    };
  }
  return { success: true, message: summary, data: { results: result.results } };
}

async function generateCodebaseManifestHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { isDevInstance } = await import("@/lib/build/codebase-tools");
  if (!isDevInstance()) return { success: false, error: "Manifest generation is only available on dev instances.", message: "Dev-only tool." };

  const { generateManifest } = await import("@/lib/manifest-generator");
  const { getCurrentCommitHash } = await import("@/lib/git-utils");

  const gitRef = await getCurrentCommitHash() ?? "unknown";
  const version = typeof params.version === "string" ? params.version : "dev";

  const manifest = await generateManifest({ version, gitRef, writeFile: true });

  // Store in DB (best-effort) — delete+create to avoid nullable composite key issues
  try {
    await prisma.codebaseManifest.deleteMany({
      where: { version, digitalProductId: null },
    });
    await prisma.codebaseManifest.create({
      data: { version, gitRef, manifest: manifest as unknown as import("@dpf/db").Prisma.InputJsonValue },
    });
  } catch (err) {
    console.warn("[generate_codebase_manifest] DB store failed:", err);
  }

  return {
    success: true,
    message: `Manifest generated for version "${version}" with ${manifest.statistics.totalFiles} files, ${manifest.statistics.dataModelCount} models, ${manifest.statistics.externalDependencyCount} dependencies.`,
    data: { manifest },
  };
}

async function readCodebaseManifestHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const version = typeof params.version === "string" ? params.version : undefined;

  // Try DB first
  const dbManifest = await prisma.codebaseManifest.findFirst({
    where: version ? { version } : {},
    orderBy: { generatedAt: "desc" },
    select: { version: true, gitRef: true, manifest: true, generatedAt: true },
  });

  if (dbManifest) {
    return {
      success: true,
      message: `Manifest for version "${dbManifest.version}" (generated ${dbManifest.generatedAt.toISOString().slice(0, 10)})`,
      data: { manifest: dbManifest.manifest, version: dbManifest.version, gitRef: dbManifest.gitRef },
    };
  }

  // Fall back to reading the file (dev instances only)
  const { isDevInstance, readProjectFile } = await import("@/lib/build/codebase-tools");
  if (isDevInstance()) {
    const result = await readProjectFile("codebase-manifest.json");
    if ("content" in result) {
      try {
        const manifest = JSON.parse(result.content);
        return { success: true, message: "Manifest loaded from file.", data: { manifest } };
      } catch { /* fall through */ }
    }
  }

  return { success: false, error: "No manifest found. Use generate_codebase_manifest to create one.", message: "No manifest available." };
}

const handlers: Record<string, ToolPackHandler> = {
  list_project_directory: (params) => listProjectDirectoryHandler(params),
  read_project_file: (params) => readProjectFileHandler(params),
  search_project_files: (params) => searchProjectFilesHandler(params),
  generate_codebase_manifest: (params) => generateCodebaseManifestHandler(params),
  read_codebase_manifest: (params) => readCodebaseManifestHandler(params),
};

export const projectFilesPack: ToolPack = {
  packId: "project-files",
  definitions,
  handlers,
  grants: {
    list_project_directory: ["file_read"],
    read_project_file: ["file_read"],
    search_project_files: ["file_read"],
    generate_codebase_manifest: ["file_read"],
    read_codebase_manifest: ["file_read"],
  },
};
