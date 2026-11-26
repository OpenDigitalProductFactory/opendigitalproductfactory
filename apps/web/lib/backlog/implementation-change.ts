import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { trustedGitArgs } from "@/lib/work-capsules/git-scanner";

const exec = promisify(execFile);
const SHA = /^[0-9a-f]{40}$/i;
const DOCS_ROOT = /^(?:docs?|documentation)\//i;
const PROSE_EXTENSION = /\.(?:md|mdx|rst|adoc|txt)$/i;
// A nested docs directory can be application source. Its generated docs
// inventory and diagram manifests still do not prove implementation.
const GENERATED_DOC_ARTIFACTS = new Set([
  "apps/web/lib/docs/doc-index.generated.json",
  "apps/web/lib/docs/doc-impact.generated.json",
  "apps/web/lib/docs/diagram-versions.generated.mjs",
  "apps/web/lib/docs/diagram-versions.generated.d.mts",
]);
// These directories also house executable publication tools. Do not mistake
// changes to those programs for changes to their documents or generated output.
const PUBLICATION_SOURCE = /^(?:docs\/architecture\/(?:generate-[^/]+\.mjs|agent-standard-publications\.mjs|fit-white-paper-docx-images\.py)|docs\/business-types\/_[^/]+\.mjs|apps\/web\/lib\/docs\/(?:diagram-assets|doc-link-resolver)\.mjs)$/;
const IMPLEMENTATION = /\.(?:[cm]?[jt]sx?|vue|svelte|css|scss|sass|less|py|go|rs|java|kt|sql|prisma|sh|ps1|json|ya?ml|toml|graphql|proto|html)$|(?:^|\/)(?:Dockerfile(?:\.[\w-]+)?|Makefile)$/i;

export function requiresImplementationChange(workType: string | null | undefined): boolean {
  return workType === "feature" || workType === "bug" || workType === "refactor";
}

/** A title, design receipt, empty diff, or unrecognized path is not delivery. */
export function hasImplementationChange(paths: readonly string[]): boolean {
  if (paths.some(path => !path || path.startsWith("/") || path.includes("\\")
    || path.split("/").some(part => !part || part === "." || part === ".."))) return false;
  return paths.some(path => PUBLICATION_SOURCE.test(path) || (
    !DOCS_ROOT.test(path)
    && !PROSE_EXTENSION.test(path)
    && !GENERATED_DOC_ARTIFACTS.has(path)
    && IMPLEMENTATION.test(path)
  ));
}

/** Only immutable tree objects are compared. Never run a worktree diff. */
export async function readImplementationChange(root: string, head: string, base?: string): Promise<boolean | null> {
  if (!SHA.test(head) || (base !== undefined && !SHA.test(base))) return null;
  const git = (args: string[]) => exec("git", trustedGitArgs(root, args), {
    timeout: 5000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
  try {
    if (!base) {
      const { stdout } = await git(["show", "-s", "--format=%P", head]);
      base = stdout.trim();
      // Multiple parents have no unique delivery range. A shallow/root commit
      // has no readable parent and cannot prove a change against a baseline.
      if (!SHA.test(base)) return null;
    } else {
      await git(["merge-base", "--is-ancestor", base, head]);
    }
    const { stdout } = await git(["diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", base, head, "--"]);
    if (stdout && !stdout.endsWith("\0")) return null;
    return hasImplementationChange(stdout ? stdout.slice(0, -1).split("\0") : []);
  } catch {
    return null;
  }
}
