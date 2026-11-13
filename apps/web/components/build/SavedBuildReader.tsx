"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/report-kit";
import { DetailsDrawer } from "./DetailsDrawer";
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
  const sections = useMemo(() => selected ? [{
    id: "review", title: "Review proof", defaultOpen: true,
    content: <ReviewPanel build={selected} executionAvailable={false} />,
  }] : [], [selected]);
  return <section className="relative p-4 space-y-4">
    <h2 className="text-dpf-h2">Saved builds</h2>
    {loadFailed ? <div role="alert"><p>Saved builds could not be loaded.</p><Link href="/build">Try again</Link></div> : <>
    <p role="status">{availabilityUnknown ? "Runner availability could not be checked. Saved results remain available." : "Saved results are available. Building is unavailable."}</p>
    {builds.length > 0 ? <DataTable ariaLabel="Saved builds" columns={columns} rows={builds} getRowKey={build => build.buildId} /> : null}
    {builds.length === 0 && !selected ? <p>No saved builds yet.</p> : null}
    {initialBuildId && !selected ? <p role="status">The requested saved build is unavailable.</p> : null}
    {selected ? <div>
      <p>{selected.title}</p>
      <Button onClick={() => setOpen(true)}>Review proof</Button>
      <DetailsDrawer isOpen={open} onClose={() => setOpen(false)} sections={sections} />
    </div> : null}
    </>}
    {runnerSetup ? <details><summary>Runner setup</summary>{runnerSetup}</details> : null}
  </section>;
}
