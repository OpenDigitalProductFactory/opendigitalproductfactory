/** Shared read for GitHub repository alert surfaces (BI-C67E5CCB).
 *
 * Same contract as the Dependabot reader: the controller credential, an owned
 * transport, a Link-header pager pinned to the one endpoint, and a refusal for
 * every denied, malformed or truncated read. A surface that cannot be read is
 * incomplete coverage, never zero findings. */
import { createGithubReadTransport, resolveGithubToken, type RepoIdentity } from "@/lib/contributor-change-lanes/github-rest-reader";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export type AlertPageRead<T> = { ok: true; alerts: T[] } | { ok: false; error: string };

export interface AlertPagerInput<T> {
  repo: RepoIdentity;
  /** Path under the repository, e.g. "code-scanning/alerts". */
  path: string;
  /** Query parameters for the first page (per_page is added). */
  query: Record<string, string>;
  /** Operator-facing surface name, e.g. "Code scanning". */
  surface: string;
  /** The GitHub permission a 401/403/404 most likely means is missing. */
  permission: string;
  /** Parse one raw alert; null means malformed and fails the whole read. */
  parse: (raw: unknown, repo: RepoIdentity) => T | null;
  token?: string | null;
  fetchImpl?: typeof fetch;
  maxPages?: number;
}

export async function readGithubAlertPages<T>(input: AlertPagerInput<T>): Promise<AlertPageRead<T>> {
  const maxPages = input.maxPages ?? 20;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) return { ok: false, error: `Invalid ${input.surface} page limit` };
  const token = input.token !== undefined ? input.token
    : await resolveGithubToken((await import("@dpf/db")).prisma, { preferRepositoryController: true });
  if (!token) return { ok: false, error: `${input.surface} coverage unavailable: no controller credential` };
  const transport = input.fetchImpl ? null : createGithubReadTransport();
  const fetchImpl = input.fetchImpl ?? transport!.fetch;
  const endpoint = `https://api.github.com/repos/${input.repo.owner}/${input.repo.name}/${input.path}`;
  const endpointPath = new URL(endpoint).pathname;
  const first = new URL(endpoint);
  for (const [key, value] of Object.entries({ ...input.query, per_page: "100" })) first.searchParams.set(key, value);
  let url: string | null = first.toString();
  const alerts: T[] = [];
  try {
    for (let page = 0; page < maxPages && url; page++) {
      // A Link header must never forward the controller credential elsewhere.
      const target = new URL(url);
      if (target.origin !== "https://api.github.com" || target.pathname !== endpointPath
          || target.username || target.password) return { ok: false, error: `Invalid ${input.surface} pagination target` };
      const response: Response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "dpf-repository-security-intake" },
        signal: AbortSignal.timeout(30_000), redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        const hint = [401, 403, 404].includes(response.status)
          ? `; the controller credential needs "${input.permission}"` : "";
        return { ok: false, error: `${input.surface} coverage unreadable (HTTP ${response.status})${hint}` };
      }
      const batch: unknown = await response.json();
      if (!Array.isArray(batch)) return { ok: false, error: `Malformed ${input.surface} alert response` };
      for (const raw of batch) {
        const alert = input.parse(raw, input.repo);
        if (!alert) return { ok: false, error: `Malformed ${input.surface} alert; security coverage incomplete` };
        alerts.push(alert);
      }
      url = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") ?? "")?.[1] ?? null;
    }
    if (url) return { ok: false, error: `${input.surface} coverage incomplete after ${maxPages} pages` };
    return { ok: true, alerts };
  } catch (error) {
    return { ok: false, error: `${input.surface} coverage failed: ${getErrorMessage(error)}` };
  } finally {
    await transport?.close();
  }
}
