import Link from "next/link";
import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";

import { StatCard } from "@/components/ui/report-kit";
import { intentStyle } from "@/components/ui/report-kit/statusColors";
import { TablesNowView } from "@/components/storefront-admin/TablesNowView";
import { TeamManager } from "@/components/storefront-admin/TeamManager";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import { resolveResourceVocabulary } from "@/lib/storefront/resource-vocabulary";
import { loadRestaurantCapacitySnapshot } from "@/lib/storefront/restaurant-capacity-loader";
import {
  capacityStateIntent,
  capacityStateLabel,
  classifyStorefrontResource,
  readinessHeadline,
  readinessIntent,
  TABLE_CAPACITY_STATES,
} from "@/lib/storefront/restaurant-capacity";

export default async function TablesCapacityPage() {
  const config = await prisma.storefrontConfig.findFirst({
    select: {
      id: true,
      archetype: { select: { archetypeId: true, category: true, customVocabulary: true } },
      providers: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          services: { include: { item: { select: { id: true, name: true, ctaType: true } } } },
          availability: { orderBy: { createdAt: "asc" } },
        },
      },
      items: {
        where: { isActive: true },
        select: { id: true, name: true, ctaType: true },
        orderBy: { sortOrder: "asc" },
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

  // Table-classified providers become the managed inventory below.
  const tableProviders = config.providers
    .filter((p) => classifyStorefrontResource(p) === "table")
    .map((provider) => ({
      ...provider,
      createdAt: undefined,
      updatedAt: undefined,
      availability: provider.availability.map((a) => ({
        id: a.id,
        days: a.days,
        startTime: a.startTime,
        endTime: a.endTime,
        date: a.date ? a.date.toISOString() : null,
        isBlocked: a.isBlocked,
        reason: a.reason,
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
        <TeamManager
          providers={tableProviders}
          storefrontId={config.id}
          items={config.items}
          teamLabel={resourceVocab.resourceLabel}
          singularNoun={resourceVocab.resourceSingular}
          mode="table"
        />
      </div>
    </div>
  );
}
