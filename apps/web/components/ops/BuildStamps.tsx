"use client";

// Technical build stamps for the self-upgrade banner (BI-5B1FDA09).
//
// The banner LEADS with the merged-PR identity an operator can act on
// ("PR #3747"). These hex stamps stay visible but subordinate: an operator
// needs to know which PR they are on; a contributor diagnosing an image/bytes
// mismatch needs the SHAs, and needs them without hunting.
//
// Deliberately NOT a disclosure. Both available constructs are wrong here: a
// native <details> is the construct the kernel's progressive-disclosure
// doctrine ranks lowest, and the canonical ExpandableCard omits its collapsed
// subtree from the DOM entirely (BI-2B196D07) — which would make the deployed
// SHA, target SHA, and platform version unreachable to anything reading the
// rendered page, including this surface's own contract tests. Demotion here
// means smaller and quieter, not hidden.

import { LocalTime } from "@/components/ui/LocalTime";
import type { ImageVersionSource } from "@/lib/platform/image-version";

function shortSha(value: string | null | undefined): string {
  if (!value) return "";
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

function sourceLabel(source: ImageVersionSource | undefined): string {
  switch (source) {
    case "git-sha":
      return "commit";
    case "content-hash":
      return "image hash";
    default:
      return "image";
  }
}

export type BuildStampsProps = {
  enabled: boolean;
  deployedSha: string | null;
  deployedShaSource?: ImageVersionSource;
  targetSha: string | null;
  /** The upstream commit the running build absorbed, when resolved. */
  lineageSha?: string | null;
  platformVersion: {
    version: string;
    gitSha: string | null;
    imageVersion?: { raw: string; source: ImageVersionSource } | null;
    buildDate?: string | null;
  };
};

export function BuildStamps({
  enabled,
  deployedSha,
  deployedShaSource,
  targetSha,
  lineageSha,
  platformVersion,
}: BuildStampsProps) {
  const buildStamp = platformVersion.gitSha ?? platformVersion.imageVersion?.raw ?? null;

  return (
    <div
      className="space-y-0.5 text-dpf-caption text-[var(--dpf-muted)]"
      data-build-details="true"
    >
      <div>
        <span className="font-medium text-[var(--dpf-text)]">Platform version:</span>{" "}
        <span className="font-mono">v{platformVersion.version}</span>
      </div>
      <div>
        build{" "}
        <span className="font-mono">{buildStamp ? shortSha(buildStamp) : "dev (unbuilt)"}</span>
        {platformVersion.imageVersion?.source && (
          <span className="ml-1">({sourceLabel(platformVersion.imageVersion.source)})</span>
        )}
        {platformVersion.buildDate && (
          <span className="ml-1">
            · built <LocalTime value={platformVersion.buildDate} />
          </span>
        )}
      </div>
      {enabled && (
        <>
          <div>
            <span className="font-medium text-[var(--dpf-text)]">Deployed:</span>{" "}
            <span className="font-mono">{deployedSha ?? "unknown"}</span>
            {deployedSha && deployedShaSource && deployedShaSource !== "unknown" && (
              <span className="ml-2">({sourceLabel(deployedShaSource)})</span>
            )}
          </div>
          <div>
            <span className="font-medium text-[var(--dpf-text)]">Target:</span>{" "}
            <span className="font-mono">{targetSha ?? "unknown"}</span>
          </div>
          {lineageSha && (
            <div>
              <span className="font-medium text-[var(--dpf-text)]">Upstream lineage:</span>{" "}
              <span className="font-mono">{lineageSha}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default BuildStamps;
