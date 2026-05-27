import type { ContributorChangeLane } from "@/lib/contributor-change-lanes/types";

import { ChangeLaneBlockers } from "./ChangeLaneBlockers";
import { ChangeLaneStatusBadge } from "./ChangeLaneStatusBadge";

export function ChangeLaneTable({
  lanes,
  anySourceWarmingUp = false,
}: {
  lanes: ContributorChangeLane[];
  anySourceWarmingUp?: boolean;
}) {
  if (lanes.length === 0) {
    return (
      <div
        className="rounded border p-6 text-center text-sm text-[var(--dpf-muted)]"
        style={{ borderColor: "var(--dpf-border)" }}
      >
        {anySourceWarmingUp
          ? "Inventory is still syncing — first results will appear within ~10 minutes. Refresh the page once the freshness dots turn green."
          : "No lanes in this view."}
      </div>
    );
  }

  return (
    <div
      className="overflow-x-auto rounded border"
      style={{ borderColor: "var(--dpf-border)" }}
    >
      <table className="w-full min-w-[1200px] text-xs">
        <thead
          className="text-left text-[10px] uppercase tracking-wide text-[var(--dpf-muted)]"
          style={{ backgroundColor: "var(--dpf-surface-2)" }}
        >
          <tr>
            <Th>Lane</Th>
            <Th>Status</Th>
            <Th>Owner</Th>
            <Th>Branch</Th>
            <Th>Commit</Th>
            <Th>Served</Th>
            <Th>PR</Th>
            <Th>Runtime</Th>
            <Th>Verification</Th>
            <Th>TTL</Th>
            <Th className="w-[20%]">Blockers</Th>
            <Th className="w-[18%]">Next action</Th>
          </tr>
        </thead>
        <tbody>
          {lanes.map((lane) => (
            <tr
              key={lane.id}
              className="align-top border-t text-[var(--dpf-text)]"
              style={{ borderColor: "var(--dpf-border)" }}
            >
              <Td>
                <div className="font-medium">{lane.laneKind}</div>
                <div className="text-[var(--dpf-muted)] text-[10px]">{lane.id}</div>
                <div className="text-[var(--dpf-muted)] text-[10px]">{lane.source}</div>
              </Td>
              <Td>
                <ChangeLaneStatusBadge status={lane.status} />
              </Td>
              <Td>{lane.owner ?? <Em>—</Em>}</Td>
              <Td>
                {lane.branch ? (
                  <span className="font-mono text-[11px]">{lane.branch}</span>
                ) : (
                  <Em>—</Em>
                )}
              </Td>
              <Td>{shortenSha(lane.commitSha)}</Td>
              <Td>{shortenSha(lane.servedCommitSha)}</Td>
              <Td>
                {lane.pullRequestUrl ? (
                  <a
                    href={lane.pullRequestUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--dpf-accent)] underline decoration-dotted"
                  >
                    {prNumberFromUrl(lane.pullRequestUrl)}
                  </a>
                ) : (
                  <Em>—</Em>
                )}
              </Td>
              <Td>
                {lane.runtimeUrl ? (
                  <a
                    href={lane.runtimeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--dpf-accent)] underline decoration-dotted"
                  >
                    {hostnameFromUrl(lane.runtimeUrl)}
                  </a>
                ) : (
                  <Em>—</Em>
                )}
              </Td>
              <Td>
                <div>{lane.latestVerification.status}</div>
                {lane.latestVerification.checkedAt && (
                  <div className="text-[var(--dpf-muted)] text-[10px]">
                    {formatRelative(lane.latestVerification.checkedAt)}
                  </div>
                )}
              </Td>
              <Td>{lane.expiresAt ? formatRelative(lane.expiresAt) : <Em>—</Em>}</Td>
              <Td>
                <ChangeLaneBlockers blockers={lane.blockers} />
              </Td>
              <Td>
                <span className="text-[var(--dpf-text)]">{lane.nextAction}</span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-2 py-1.5 ${className ?? ""}`}>{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 ${className ?? ""}`}>{children}</td>;
}

function Em({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--dpf-muted)]">{children}</span>;
}

function shortenSha(sha: string | null): React.ReactNode {
  if (!sha) return <Em>—</Em>;
  return <span className="font-mono text-[11px]">{sha.slice(0, 7)}</span>;
}

function prNumberFromUrl(url: string): string {
  const m = url.match(/\/pull\/(\d+)/);
  return m ? `#${m[1]}` : url;
}

function hostnameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
}

function formatRelative(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${diff < 0 ? "in " : ""}${mins}m${diff < 0 ? "" : " ago"}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${diff < 0 ? "in " : ""}${hours}h${diff < 0 ? "" : " ago"}`;
  const days = Math.round(hours / 24);
  return `${diff < 0 ? "in " : ""}${days}d${diff < 0 ? "" : " ago"}`;
}
