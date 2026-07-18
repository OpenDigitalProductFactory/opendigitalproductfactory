import {
  AlertTriangle,
  CheckCircle2,
  CircleOff,
  CloudCog,
} from "lucide-react";

import type {
  CapabilityHealthState,
  CapabilityServiceHealthProjection,
} from "@/lib/platform-runtime/service-health";

type CapabilityServiceHealthProps = {
  projection: CapabilityServiceHealthProjection;
};

const STATE_PRESENTATION: Record<
  CapabilityHealthState,
  { Icon: typeof CheckCircle2; iconClass: string }
> = {
  required: { Icon: CheckCircle2, iconClass: "text-[var(--dpf-success)]" },
  optional_inactive: { Icon: CircleOff, iconClass: "text-[var(--dpf-muted)]" },
  optional_degraded: { Icon: AlertTriangle, iconClass: "text-[var(--dpf-warning)]" },
  external: { Icon: CloudCog, iconClass: "text-[var(--dpf-accent)]" },
};

export function CapabilityServiceHealth({ projection }: CapabilityServiceHealthProps) {
  return (
    <section
      aria-labelledby="capability-service-health-title"
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 sm:p-5"
    >
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h2
            id="capability-service-health-title"
            className="text-sm font-semibold text-[var(--dpf-text)]"
          >
            Capability service requirements
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--dpf-muted)]">
            Current service expectations come from the enabled runtime capabilities. Inactive
            optional services do not reduce platform health.
          </p>
        </div>
        <div className="shrink-0 sm:max-w-xs sm:text-right">
          <p
            className="text-xs font-semibold text-[var(--dpf-text)]"
            aria-label={`Platform capability health: ${projection.aggregate.value}`}
          >
            {projection.aggregate.value}
          </p>
          <p className="mt-1 text-[11px] leading-4 text-[var(--dpf-muted)]">
            {projection.aggregate.detail}
          </p>
        </div>
      </div>

      {projection.items.length === 0 ? (
        <p className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-xs text-[var(--dpf-muted)]">
          No capability-owned service requirements are configured.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projection.items.map((item) => {
            const presentation = item.state === "required" && item.availability === "unavailable"
              ? { Icon: AlertTriangle, iconClass: "text-[var(--dpf-warning)]" }
              : STATE_PRESENTATION[item.state];
            const { Icon, iconClass } = presentation;
            return (
              <li
                key={`${item.kind}:${item.key}`}
                className="min-w-0 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
              >
                <div className="flex items-start gap-3">
                  <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} />
                  <div className="min-w-0">
                    <h3 className="break-words text-xs font-semibold text-[var(--dpf-text)]">
                      {item.key}
                    </h3>
                    <p className="mt-1 text-xs font-medium text-[var(--dpf-text)]">
                      {item.label}
                    </p>
                    {item.detail && (
                      <p className="mt-1 text-[11px] leading-4 text-[var(--dpf-muted)]">
                        {item.detail}
                      </p>
                    )}
                    {item.actionHref ? (
                      <a
                        href={item.actionHref}
                        className="mt-2 inline-flex rounded-sm text-[11px] font-medium text-[var(--dpf-accent)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dpf-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--dpf-surface-2)]"
                      >
                        {item.action}
                      </a>
                    ) : (
                      <p className="mt-1 text-[11px] leading-4 text-[var(--dpf-muted)]">
                        {item.action}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
