/** Secret scanning alerts for the commissioned repository (BI-C67E5CCB).
 *
 * The alert body GitHub returns includes the secret itself. It is dropped at
 * parse time: nothing downstream (backlog item, activity, run summary, log)
 * may ever carry the value. Only the type, first location and alert link are kept. */
import type { RepoIdentity } from "@/lib/contributor-change-lanes/github-rest-reader";
import { isRecord } from "@/lib/shared/coerce";
import { readGithubAlertPages, type AlertPageRead } from "./github-alert-pager";

export interface SecretScanningAlert {
  number: number;
  state: string;
  secretType: string;
  /** "active" | "inactive" | "unknown" as GitHub reports it, when it does. */
  validity: string | null;
  path: string | null;
  startLine: number | null;
  url: string;
}

export function parseSecretScanningAlert(value: unknown, repo: RepoIdentity): SecretScanningAlert | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.number) || Number(value.number) < 1
      || typeof value.state !== "string" || typeof value.secret_type !== "string") return null;
  const display = typeof value.secret_type_display_name === "string" && value.secret_type_display_name.trim()
    ? value.secret_type_display_name : value.secret_type;
  const first = isRecord(value.first_location_detected) ? value.first_location_detected : {};
  return {
    number: Number(value.number), state: value.state, secretType: display,
    validity: typeof value.validity === "string" ? value.validity : null,
    path: typeof first.path === "string" ? first.path : null,
    startLine: Number.isSafeInteger(first.start_line) ? Number(first.start_line) : null,
    url: `https://github.com/${repo.owner}/${repo.name}/security/secret-scanning/${value.number}`,
  };
}

export function readSecretScanningAlerts(input: {
  repo: RepoIdentity; token?: string | null; fetchImpl?: typeof fetch; maxPages?: number;
}): Promise<AlertPageRead<SecretScanningAlert>> {
  return readGithubAlertPages({
    ...input, path: "secret-scanning/alerts", query: { state: "open" },
    surface: "Secret scanning", permission: "Secret scanning alerts: read", parse: parseSecretScanningAlert,
  });
}
