import Link from "next/link";
import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";

import { StatCard } from "@/components/ui/report-kit";
import { intentStyle } from "@/components/ui/report-kit/statusColors";
import { TablesNowView } from "@/components/storefront-admin/TablesNowView";
import {
  HospitalityResourceManager,
  type HospitalityResourceManagerRow,
} from "@/components/storefront-admin/HospitalityResourceManager";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import { resolveResourceVocabulary } from "@/lib/storefront/resource-vocabulary";
import { loadRestaurantCapacitySnapshot } from "@/lib/storefront/restaurant-capacity-loader";
import {
  capacityStateIntent,
  capacityStateLabel,
  readinessHeadline,
  readinessIntent,
  TABLE_CAPACITY_STATES,
} from "@/lib/storefront/restaurant-capacity";

export default async function TablesCapacityPage() {
  const config = await prisma.storefrontConfig.findFirst({
    select: {
      id: true,
      archetype: { select: { archetypeId: true, category: true, customVocabulary: true } },
      hospitalityResources: {
        where: { kind: "table" },
        orderBy: [{ serviceArea: "asc" }, { label: "asc" }],
        select: {
          id: true,
          resourceId: true,
          label: true,
          kind: true,
          status: true,
          capacity: true,
          capacityUnit: true,
          serviceArea: true,
          blockedReason: true,
          version: true,
          availability: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              days: true,
              startTime: true,
              endTime: true,
              date: true,
              kind: true,
              reason: true,
            },
          },
        },
      },
    },
  });

  if (!config) redirect("/storefront/setup");

  const vocabulary = getVocabulary(
    config.archetype?.category,
    config.archetype?.customVocabulary as Record<string, string> | null,
  );
  const resourceVocab = resolveResourceVocabulary({
    archetypeId: config.archetype?.archetypeId,
    teamLabel: vocabulary.teamLabel,
  });

  // Not a capacity archetype — this surface only exists for FLOOR (Restaurant).
  if (!resourceVocab.hasCapacityResources) redirect("/storefront/team");

  const loaded = await loadRestaurantCapacitySnapshot();
  const snapshot = loaded?.snapshot ?? null;

  const tableResources: HospitalityResourceManagerRow[] =
    config.hospitalityResources.map((resource) => ({
      ...resource,
      kind: "table",
      capacityUnit: "seats",
      status: resource.status as HospitalityResourceManagerRow["status"],
      availability: resource.availability.map((row) => ({
        id: row.id,
        days: row.days,
        startTime: row.startTime ?? "00:00",
        endTime: row.endTime ?? "23:59",
        date: row.date?.toISOString() ?? null,
        isBlocked: row.kind === "blocked",
        reason: row.reason,
      })),
    }));

  const readiness = snapshot?.readiness ?? "closed";
  const banner = intentStyle(readinessIntent(readiness));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Service-period readiness — the one-line answer + one next action. */}
      <div
        className="border"
        style={{
          borderColor: banner.border,
          background: banner.softBg,
          borderRadius: 10,
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em" }}>
            Service readiness
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>
            {snapshot ? readinessHeadline(snapshot) : "No storefront configured"}
          </div>
        </div>
        {snapshot?.nextAction && (
          <Link
            href={snapshot.nextAction.href}
            className="bg-[var(--dpf-accent)] text-white"
            style={{ padding: "8px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}
          >
            {snapshot.nextAction.label}
          </Link>
        )}
      </div>

      {/* Capacity state — the owner-readable counts. */}
      {snapshot && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
          <StatCard label="Tables" value={snapshot.totalTables} hint={snapshot.seatsTotal != null ? `${snapshot.seatsTotal} seats` : undefined} intent="info" />
          {TABLE_CAPACITY_STATES.map((state) => (
            <StatCard
              key={state}
              label={capacityStateLabel(state)}
              value={snapshot.counts[state]}
              intent={capacityStateIntent(state)}
            />
          ))}
          <StatCard label="Parties waiting" value={snapshot.waitlistParties} intent={snapshot.waitlistParties > 0 ? "warning" : "success"} />
        </div>
      )}

      {/* Live table state — graphical floor plan or list, one shared projection
          so both reconcile with Workspace and public booking. */}
      {snapshot && snapshot.tables.length > 0 && <TablesNowView tables={snapshot.tables} />}

      {/* Manage the physical tables (add / edit / block). */}
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Manage {resourceVocab.resourcePlural}</div>
        <HospitalityResourceManager
          resources={tableResources}
          storefrontId={config.id}
        />
      </div>
    </div>
  );
}
