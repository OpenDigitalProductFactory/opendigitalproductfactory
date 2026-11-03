/** Repository alerts use the controller's existing credential and owned transport.
 * Denied, malformed or truncated reads are incomplete coverage, never all-clear. */
import { createGithubReadTransport, resolveGithubToken, type RepoIdentity } from "@/lib/contributor-change-lanes/github-rest-reader";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { isRecord } from "@/lib/shared/coerce";

export interface RepositoryAlert {
  number: number;
  state: string;
  packageName: string;
  manifest: string;
  severity: string;
  advisory: string;
  summary: string;
  vulnerable: string;
  patched: string | null;
  url: string;
}

export type RepositoryAlertRead = { ok: true; alerts: RepositoryAlert[] } | { ok: false; error: string };

function parseAlert(value: unknown, repo: RepoIdentity): RepositoryAlert | null {
  if (!isRecord(value)) return null;
  const dep = isRecord(value.dependency) ? value.dependency : {};
  const pkg = isRecord(dep.package) ? dep.package : {};
  const advisory = isRecord(value.security_advisory) ? value.security_advisory : {};
  const vulnerability = isRecord(value.security_vulnerability) ? value.security_vulnerability : {};
  const patched = isRecord(vulnerability.first_patched_version) ? vulnerability.first_patched_version : {};
  if (!Number.isSafeInteger(value.number) || Number(value.number) < 1 || typeof value.state !== "string"
      || typeof pkg.name !== "string" || typeof dep.manifest_path !== "string"
      || typeof advisory.ghsa_id !== "string" || typeof advisory.severity !== "string"
      || typeof advisory.summary !== "string" || typeof vulnerability.vulnerable_version_range !== "string") return null;
  return {
    number: Number(value.number), state: value.state, packageName: pkg.name,
    manifest: dep.manifest_path, severity: advisory.severity, advisory: advisory.ghsa_id,
    summary: advisory.summary, vulnerable: vulnerability.vulnerable_version_range,
    patched: typeof patched.identifier === "string" ? patched.identifier : null,
    url: `https://github.com/${repo.owner}/${repo.name}/security/dependabot/${value.number}`,
  };
}

export async function readDependabotAlerts(input: {
  repo: RepoIdentity; token?: string | null; fetchImpl?: typeof fetch; maxPages?: number;
}): Promise<RepositoryAlertRead> {
  const maxPages = input.maxPages ?? 20;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) return { ok: false, error: "Invalid security coverage page limit" };
  const token = input.token !== undefined ? input.token
    : await resolveGithubToken((await import("@dpf/db")).prisma, { preferRepositoryController: true });
  if (!token) return { ok: false, error: "Repository security coverage unavailable: no controller credential" };
  const transport = input.fetchImpl ? null : createGithubReadTransport();
  const fetchImpl = input.fetchImpl ?? transport!.fetch;
  const endpoint = `https://api.github.com/repos/${input.repo.owner}/${input.repo.name}/dependabot/alerts`;
  let url: string | null = `${endpoint}?state=open&per_page=100`;
  const alerts: RepositoryAlert[] = [];
  try {
    for (let page = 0; page < maxPages && url; page++) {
      // A Link header must never forward the controller credential elsewhere.
      const target = new URL(url);
      if (target.origin !== "https://api.github.com" || target.pathname !== new URL(endpoint).pathname
          || target.username || target.password) return { ok: false, error: "Invalid security pagination target" };
      const response: Response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "dpf-repository-security-intake" },
        signal: AbortSignal.timeout(30_000), redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        return { ok: false, error: `Dependabot coverage unreadable (HTTP ${response.status}); verify repository Dependabot read permission` };
      }
      const batch: unknown = await response.json();
      if (!Array.isArray(batch)) return { ok: false, error: "Malformed Dependabot alert response" };
      for (const raw of batch) {
        const alert = parseAlert(raw, input.repo);
        if (!alert) return { ok: false, error: "Malformed Dependabot alert; security coverage incomplete" };
        alerts.push(alert);
      }
      url = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") ?? "")?.[1] ?? null;
    }
    if (url) return { ok: false, error: `Dependabot coverage incomplete after ${maxPages} pages` };
    return { ok: true, alerts };
  } catch (error) {
    return { ok: false, error: `Dependabot coverage failed: ${getErrorMessage(error)}` };
  } finally {
    await transport?.close();
  }
}
