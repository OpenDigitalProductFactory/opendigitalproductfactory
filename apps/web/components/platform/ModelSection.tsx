"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { profileModels } from "@/lib/actions/ai-providers";
import { ModelCard } from "@/components/platform/ModelCard";
import type { DiscoveredModelRow, ModelProfileRow } from "@/lib/ai-provider-types";

const PAGE_SIZE = 20;
const BULK_CONFIRM_THRESHOLD = 50;

type Props = {
  providerId: string;
  models: DiscoveredModelRow[];
  profiles: ModelProfileRow[];
  canWrite: boolean;
  hasActiveProvider: boolean;
  latestDiscovery: Date | null;
};

export function ModelSection({
  providerId,
  models,
  profiles,
  canWrite,
  hasActiveProvider,
  latestDiscovery,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [profilingResult, setProfilingResult] = useState<{
    profiled: number;
    failed: number;
    error?: string;
  } | null>(null);
  const [profilingStatus, setProfilingStatus] = useState<string | null>(null);
  // Track modelIds that were discovered but not profiled after a profiling run
  const [failedModelIds, setFailedModelIds] = useState<Set<string>>(new Set());

  // Build a lookup map from modelId to profile
  const profileMap = new Map<string, ModelProfileRow>(
    profiles.map((p) => [p.modelId, p])
  );

  // Stale detection: models not seen in the most recent discovery run.
  // Use a 5-minute tolerance so models upserted sequentially in the same
  // run aren't falsely marked stale due to slight timestamp differences.
  const STALE_TOLERANCE_MS = 5 * 60 * 1000;
  function isModelStale(model: DiscoveredModelRow): boolean {
    if (!latestDiscovery) return false;
    return latestDiscovery.getTime() - model.lastSeenAt.getTime() > STALE_TOLERANCE_MS;
  }

  // Filtered models based on search query
  const searchLower = search.toLowerCase().trim();
  const filtered = searchLower
    ? models.filter((m) => {
        if (m.modelId.toLowerCase().includes(searchLower)) return true;
        const profile = profileMap.get(m.modelId);
        if (profile && profile.friendlyName.toLowerCase().includes(searchLower)) return true;
        return false;
      })
    : models;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageModels = filtered.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);

  const unprofiledCount = models.filter((m) => !profileMap.has(m.modelId)).length;
  const showProfileAllButton =
    canWrite && hasActiveProvider && unprofiledCount > 0;

  function handleProfileSingle(modelId: string) {
    startTransition(async () => {
      setProfilingResult(null);
      const result = await profileModels(providerId, [modelId]);
      setProfilingResult(result);
      // If the single model failed, record it
      if (result.failed > 0) {
        setFailedModelIds((prev) => new Set([...prev, modelId]));
      } else {
        // Remove from failed set on success
        setFailedModelIds((prev) => {
          const next = new Set(prev);
          next.delete(modelId);
          return next;
        });
      }
      router.refresh();
    });
  }

  function handleProfileAll() {
    const unprofiledIds = models
      .filter((m) => !profileMap.has(m.modelId))
      .map((m) => m.modelId);

    if (unprofiledIds.length === 0) return;

    if (
      unprofiledIds.length > BULK_CONFIRM_THRESHOLD &&
      !window.confirm(
        `You are about to profile ${unprofiledIds.length} models. This may incur significant API costs. Continue?`
      )
    ) {
      return;
    }

    startTransition(async () => {
      setProfilingResult(null);
      setProfilingStatus(`Profiling ${unprofiledIds.length} model${unprofiledIds.length !== 1 ? "s" : ""}... This may take a minute.`);
      const result = await profileModels(providerId, unprofiledIds);
      setProfilingResult(result);
      setProfilingStatus(null);

      if (result.failed > 0) {
        setFailedModelIds(new Set(unprofiledIds));
      }

      router.refresh();
    });
  }

  function handlePageChange(newPage: number) {
    setPage(newPage);
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setPage(0); // Reset to first page on search
  }

  if (models.length === 0) {
    return (
      <div style={{ color: "#8888a0", fontSize: 12, padding: "16px 0" }}>
        No models discovered yet. Use the provider configuration above to run discovery.
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        {/* Search box */}
        <input
          type="search"
          value={search}
          onChange={handleSearchChange}
          placeholder="Search models…"
          style={{
            background: "#1a1a2e",
            border: "1px solid #2a2a40",
            color: "#e0e0ff",
            fontSize: 11,
            padding: "5px 10px",
            borderRadius: 4,
            width: 200,
            outline: "none",
          }}
        />

        {/* Count label */}
        <span style={{ color: "#8888a0", fontSize: 10, flexGrow: 1 }}>
          {filtered.length} model{filtered.length !== 1 ? "s" : ""}
          {searchLower ? " matching" : ""}
          {" — "}
          {unprofiledCount} unprofiled
        </span>

        {/* Profile All Unprofiled button */}
        {showProfileAllButton && (
          <button
            onClick={handleProfileAll}
            disabled={isPending}
            style={{
              padding: "5px 12px",
              background: "#2a2a50",
              border: "1px solid #7c8cf8",
              color: "#7c8cf8",
              borderRadius: 4,
              fontSize: 11,
              cursor: isPending ? "not-allowed" : "pointer",
              opacity: isPending ? 0.55 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {isPending ? "Profiling…" : `Profile All Unprofiled (${unprofiledCount})`}
          </button>
        )}
      </div>

      {/* Profiling progress */}
      {profilingStatus && (
        <div style={{ marginBottom: 10, fontSize: 11, color: "#7c8cf8" }} className="animate-pulse">
          {profilingStatus}
        </div>
      )}

      {/* Profiling result message */}
      {profilingResult && (
        <div
          style={{
            marginBottom: 10,
            fontSize: 11,
            color: profilingResult.error
              ? "#f87171"
              : profilingResult.failed > 0
              ? "#fbbf24"
              : "#4ade80",
          }}
        >
          {profilingResult.error
            ? `Profiling error: ${profilingResult.error}`
            : `Profiling complete — ${profilingResult.profiled} profiled, ${profilingResult.failed} failed`}
        </div>
      )}

      {/* Model grid */}
      {pageModels.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 10,
            marginBottom: 14,
          }}
        >
          {pageModels.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              profile={profileMap.get(model.modelId) ?? null}
              isStale={isModelStale(model)}
              profilingFailed={failedModelIds.has(model.modelId)}
              canWrite={canWrite}
              hasActiveProvider={hasActiveProvider}
              onProfile={handleProfileSingle}
            />
          ))}
        </div>
      ) : (
        <div style={{ color: "#8888a0", fontSize: 12, padding: "12px 0" }}>
          No models match your search.
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <button
            onClick={() => handlePageChange(clampedPage - 1)}
            disabled={clampedPage === 0 || isPending}
            style={{
              padding: "4px 10px",
              background: "transparent",
              border: "1px solid #2a2a40",
              color: clampedPage === 0 ? "#8888a0" : "#e0e0ff",
              borderRadius: 4,
              fontSize: 11,
              cursor: clampedPage === 0 ? "not-allowed" : "pointer",
            }}
          >
            Prev
          </button>

          <span style={{ color: "#8888a0", fontSize: 10 }}>
            Page {clampedPage + 1} of {totalPages}
          </span>

          <button
            onClick={() => handlePageChange(clampedPage + 1)}
            disabled={clampedPage >= totalPages - 1 || isPending}
            style={{
              padding: "4px 10px",
              background: "transparent",
              border: "1px solid #2a2a40",
              color: clampedPage >= totalPages - 1 ? "#8888a0" : "#e0e0ff",
              borderRadius: 4,
              fontSize: 11,
              cursor: clampedPage >= totalPages - 1 ? "not-allowed" : "pointer",
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
