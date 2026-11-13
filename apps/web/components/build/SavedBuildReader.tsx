"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/report-kit";
import { ReviewPanel } from "./ReviewPanel";

type Props = {
  builds: FeatureBuildRow[];
  initialBuildId?: string | null;
  initialActiveBuild?: FeatureBuildRow | null;
  runnerSetup?: ReactNode;
  availabilityUnknown?: boolean;
  loadFailed?: boolean;
};
const columns: Column<FeatureBuildRow>[] = [{
  key: "title", header: "Saved build", cell: build => <Link href={`/build?buildId=${encodeURIComponent(build.buildId)}`}>{build.title}</Link>,
}];

/** No execution shell or mutation effects mount on this unavailable-runner path. */
export function SavedBuildReader({ builds, initialBuildId, initialActiveBuild, runnerSetup, availabilityUnknown = false, loadFailed = false }: Props) {
  const [open, setOpen] = useState(false);
  const selected = initialActiveBuild ?? (initialBuildId
    ? builds.find(build => build.buildId === initialBuildId) ?? null
    : builds[0] ?? null);
  return <section className="relative p-4 space-y-4">
    <h2 className="text-dpf-h2">Saved builds</h2>
    {loadFailed ? <div role="alert"><p>Saved builds could not be loaded.</p><Link href="/build">Try again</Link></div> : <>
    <p role="status">{availabilityUnknown ? "Runner availability could not be checked. Saved results remain available." : "Saved results are available. Building is unavailable."}</p>
    {initialBuildId && !selected ? <p role="status">The requested saved build is unavailable.</p> : null}
    {selected ? <div>
      <p>{selected.title}</p>
      <Button aria-expanded={open} aria-controls="saved-build-proof" onClick={() => setOpen(value => !value)}>Review proof</Button>
      {open ? <section id="saved-build-proof" aria-label={selected.title}>
        <ReviewPanel build={selected} executionAvailable={false} />
      </section> : null}
    </div> : null}
    {builds.length > 0 ? <DataTable ariaLabel="Saved builds" columns={columns} rows={builds} getRowKey={build => build.buildId} /> : null}
    {builds.length === 0 && !selected ? <p>No saved builds yet.</p> : null}
    </>}
    {runnerSetup ? <details><summary>Runner setup</summary>{runnerSetup}</details> : null}
  </section>;
}
