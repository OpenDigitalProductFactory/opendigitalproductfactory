import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const exec = promisify(execFile);
const oid = z.string().regex(/^[0-9a-f]{40}$/u);
export const t4SourceTargetSchema = z.strictObject({
  repositoryFullName: z.string().max(256).regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u),
  commitSha: oid,
  path: z.string().min(1).max(1024).refine(path => !/[\\\p{Cc}]/u.test(path)
    && path.split("/").every(segment => segment !== "" && segment !== "." && segment !== "..")),
  expectedBlobId: oid,
});
export const t4SourceWindowSchema = z.strictObject({
  startLine: z.int().positive(), maxLines: z.int().min(1).max(100), maxBytes: z.int().min(1).max(8192),
});

export type T4SourceTarget = z.infer<typeof t4SourceTargetSchema>;
export type T4SourceWindow = z.infer<typeof t4SourceWindowSchema>;
export type T4InstalledStore = Readonly<{ repositoryFullName: string; gitDir: string }>;
export type T4SourceResult =
  | { kind: "page"; startLine: number; endLine: number; content: string; utf8Bytes: number; nextLine: number | null }
  | { kind: "refused"; code: "source-unavailable" | "window-unavailable" };

// Technical limit on a single object allocation, separate from the admitted page and Control budget.
const MAX_OBJECT_BYTES = 8 * 1024 * 1024;
const unavailable = { kind: "refused", code: "source-unavailable" } as const;
const windowUnavailable = { kind: "refused", code: "window-unavailable" } as const;
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

async function localGit(gitDir: string, args: string[]) {
  const { stdout } = await exec("git", [
    "--no-lazy-fetch", "--no-replace-objects", "--git-dir=" + gitDir, ...args,
  ], {
    encoding: "buffer", timeout: 10_000, maxBuffer: MAX_OBJECT_BYTES,
    // Inherit neither repository overrides nor ambient Git configuration.
    env: {
      PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV,
      GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "",
    },
  });
  return stdout;
}

function paginate(source: string, window: T4SourceWindow): T4SourceResult {
  let offset = 0;
  let line = 1;
  let bytes = 0;
  const page: string[] = [];
  while (offset < source.length && page.length < window.maxLines) {
    const newline = source.indexOf("\n", offset);
    const end = newline === -1 ? source.length : newline + 1;
    if (line >= window.startLine) {
      const part = source.slice(offset, end);
      const size = Buffer.byteLength(part, "utf8");
      if (bytes + size > window.maxBytes) break;
      bytes += size;
      page.push(part);
    }
    offset = end;
    line++;
  }
  if (!page.length) return windowUnavailable;
  return { kind: "page", startLine: window.startLine, endLine: line - 1,
    content: page.join(""), utf8Bytes: bytes, nextLine: offset < source.length ? line : null };
}

/** An admission-selected Git directory and full object IDs only. No generic source provider. */
export async function readT4GitPage(
  store: T4InstalledStore, target: T4SourceTarget, window: T4SourceWindow,
): Promise<T4SourceResult> {
  if (!t4SourceTargetSchema.safeParse(target).success || !t4SourceWindowSchema.safeParse(window).success
    || target.repositoryFullName !== store.repositoryFullName || !isAbsolute(store.gitDir)) return unavailable;
  try {
    const verify = async (name: string) =>
      (await localGit(store.gitDir, ["rev-parse", "--verify", "--end-of-options", name])).toString("ascii").trim();
    if (await verify(target.commitSha + "^{commit}") !== target.commitSha) return unavailable;
    if (await verify(target.commitSha + ":" + target.path) !== target.expectedBlobId) return unavailable;
    const bytes = await localGit(store.gitDir, ["cat-file", "blob", target.expectedBlobId]);
    return paginate(strictUtf8.decode(bytes), window);
  } catch {
    return unavailable;
  }
}
