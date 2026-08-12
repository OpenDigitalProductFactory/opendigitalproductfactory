import { listControls } from "@/lib/actions/compliance";
import { CreateControlForm } from "@/components/compliance/CreateControlForm";
import { FilterBar, StatusBadge } from "@/components/ui/report-kit";
import {
  PlatformGridSection,
  parseSurfaceDataScope,
  parseSurfaceView,
} from "@/components/workbooks/PlatformGridSection";
import Link from "next/link";

type Props = { searchParams: Promise<{ controlType?: string; implementationStatus?: string; effectiveness?: string; view?: string; dataScope?: string }> };

export default async function ControlsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const view = parseSurfaceView(sp.view);
  const dataScope = parseSurfaceDataScope(sp.dataScope);
  const filters = {
    ...(sp.controlType && { controlType: sp.controlType }),
    ...(sp.implementationStatus && { implementationStatus: sp.implementationStatus }),
    ...(sp.effectiveness && { effectiveness: sp.effectiveness }),
  };
  const controls = await listControls(filters);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Controls</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{controls.length} active</p>
        </div>
        <CreateControlForm />
      </div>

      {/* Filter bar — report-kit FilterBar in url mode (server-rendered) */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <FilterBar
          mode="url"
          basePath="/compliance/controls"
          value={{
            ...(sp.controlType ? { controlType: sp.controlType } : {}),
            ...(sp.implementationStatus ? { implementationStatus: sp.implementationStatus } : {}),
            ...(sp.effectiveness ? { effectiveness: sp.effectiveness } : {}),
          }}
          facets={[
            {
              kind: "select",
              key: "controlType",
              label: "Type",
              options: [
                { value: "preventive", label: "Preventive" },
                { value: "detective", label: "Detective" },
                { value: "corrective", label: "Corrective" },
              ],
            },
            {
              kind: "select",
              key: "implementationStatus",
              label: "Status",
              options: [
                { value: "planned", label: "Planned" },
                { value: "in-progress", label: "In Progress" },
                { value: "implemented", label: "Implemented" },
                { value: "not-applicable", label: "Not Applicable" },
              ],
            },
            {
              kind: "select",
              key: "effectiveness",
              label: "Effectiveness",
              options: [
                { value: "effective", label: "Effective" },
                { value: "partially-effective", label: "Partially Effective" },
                { value: "ineffective", label: "Ineffective" },
                { value: "not-assessed", label: "Not Assessed" },
              ],
            },
          ]}
          resultCount={controls.length}
        />
        {Object.keys(filters).length > 0 && (
          <Link
            href="/compliance/controls"
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
          >
            Clear
          </Link>
        )}
      </div>

      <PlatformGridSection
        entityType="compliance_control"
        view={view}
        dataScope={dataScope}
      />

      {!view && (controls.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No controls match the current filters.</p>
      ) : (
        <div className="space-y-2">
          {controls.map((c) => (
            <Link key={c.id} href={`/compliance/controls/${c.id}`}
              className="block p-3 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-sm text-[var(--dpf-text)]">{c.title}</span>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    <StatusBadge intent="neutral" label={c.controlType} variant="soft" uppercase={false} />
                    <StatusBadge
                      domain="controlStatus"
                      status={c.implementationStatus}
                      variant="soft"
                      uppercase={false}
                    />
                    {c.effectiveness && (
                      <StatusBadge
                        domain="controlEffectiveness"
                        status={c.effectiveness}
                        variant="soft"
                        uppercase={false}
                      />
                    )}
                  </div>
                </div>
                <div className="text-right text-xs text-[var(--dpf-muted)]">
                  <p>{c._count.obligations} obligation{c._count.obligations !== 1 ? "s" : ""}</p>
                  {c.ownerEmployee && <p>{c.ownerEmployee.displayName}</p>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}
