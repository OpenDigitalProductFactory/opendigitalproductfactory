import type { ReactNode } from "react";

import { OwnerFirstDisclosure } from "@/components/owner-first/OwnerFirstDisclosure";
import { StatusBadge } from "@/components/ui/report-kit";
import type { CoworkerAuthorityProjection } from "@/lib/coworker-service-catalog/authority-projection";
import type { CoworkerAvailabilityProjection } from "@/lib/coworker-service-catalog/availability-projection";
import type { CoworkerRecord } from "@/lib/coworker-record/load-record";
import {
  activeRosterServices,
  projectCoworkerInteraction,
  projectCoworkerOwnerAreas,
  type CoworkerServiceAvailability,
} from "@/lib/coworker-record/roster-presentation";

export function HeaderChip({
  children,
  tone,
}: {
  children: string;
  tone: "accent" | "success" | "muted";
}) {
  const intent = tone === "accent" ? "accent" : tone === "success" ? "success" : "neutral";
  return (
    <StatusBadge
      intent={intent}
      label={children}
      uppercase={false}
      size="md"
    />
  );
}

export function OwnerStatus({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 px-0 py-4 sm:px-4 sm:first:pl-0">
      <dt className="text-xs font-medium text-[var(--dpf-muted)]">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
        {value}
      </dd>
      <dd className="mt-1 text-xs leading-5 text-[var(--dpf-text-secondary)]">
        {detail}
      </dd>
    </div>
  );
}

export function WorkOfferedPanel({
  services,
  serviceAvailability,
}: {
  services: CoworkerRecord["services"];
  serviceAvailability: CoworkerServiceAvailability[];
}) {
  const activeServices = activeRosterServices(services);
  const availabilityByService = new Map(
    serviceAvailability.map((service) => [
      service.serviceId,
      service.availability,
    ]),
  );
  if (activeServices.length === 0) {
    return (
      <p className="border-y border-[var(--dpf-border)] py-6 text-sm text-[var(--dpf-muted)]">
        No active work has been declared for this coworker yet.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {activeServices.map((service) => {
        const serviceInteraction = projectCoworkerInteraction([service]);
        const area = projectCoworkerOwnerAreas([service]).primary;
        const availability = availabilityByService.get(service.serviceId);
        return (
          <article
            key={service.serviceId}
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--dpf-text)]">
                {service.name}
              </h2>
              <div className="flex flex-wrap gap-2">
                <StatusBadge
                  intent="neutral"
                  label={area.label}
                  uppercase={false}
                />
                {availability && (
                  <StatusBadge
                    intent={availabilityIntent(availability.state)}
                    label={availability.label}
                    uppercase={false}
                  />
                )}
                {serviceInteraction.labels.map((label, index) => (
                  <StatusBadge
                    key={serviceInteraction.scopes[index]}
                    intent={
                      serviceInteraction.scopes[index] === "internal-only" ||
                      serviceInteraction.scopes[index] === "not-defined"
                        ? "neutral"
                        : "success"
                    }
                    label={label}
                    uppercase={false}
                  />
                ))}
              </div>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--dpf-text-secondary)]">
              {service.summary ||
                "A plain-language work summary is not defined."}
            </p>
            {availability && availability.state !== "available" && (
              <p className="mt-2 text-xs leading-5 text-[var(--dpf-muted)]">
                {availability.reason}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}

export function WorkHighlights({
  services,
  serviceAvailability,
}: {
  services: CoworkerRecord["services"];
  serviceAvailability: CoworkerServiceAvailability[];
}) {
  const readyIds = new Set(
    serviceAvailability
      .filter((service) => service.availability.state === "available")
      .map((service) => service.serviceId),
  );
  const highlighted = activeRosterServices(services)
    .filter((service) => readyIds.has(service.serviceId))
    .slice(0, 3);
  if (highlighted.length === 0) {
    return (
      <p className="text-sm text-[var(--dpf-muted)]">
        No advertised service is ready for this business type yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[var(--dpf-border)] border-y border-[var(--dpf-border)]">
      {highlighted.map((service) => (
        <li key={service.serviceId} className="py-3">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
            {service.name}
          </h3>
          {service.summary && (
            <p className="mt-1 text-sm leading-5 text-[var(--dpf-text-secondary)]">
              {service.summary}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AvailabilityPanel({
  availability,
  serviceAvailability,
  authority,
  interactionLabel,
  installArchetypeId,
}: {
  availability: CoworkerAvailabilityProjection;
  serviceAvailability: CoworkerServiceAvailability[];
  authority: CoworkerAuthorityProjection;
  interactionLabel: string;
  installArchetypeId: string | null;
}) {
  return (
    <div className="space-y-5">
      <dl className="grid border-y border-[var(--dpf-border)] sm:grid-cols-3 sm:divide-x sm:divide-[var(--dpf-border)]">
        <OwnerStatus
          label="Your business type"
          value={
            installArchetypeId ? titleCase(installArchetypeId) : "Not resolved"
          }
          detail={availability.reason}
        />
        <OwnerStatus
          label="Current status"
          value={availability.label}
          detail={
            availability.state === "available"
              ? "This coworker's declared work can be used for this business type."
              : "Conversation and service entry remain unavailable until this status changes."
          }
        />
        <OwnerStatus
          label="Interaction and approval"
          value={interactionLabel}
          detail={`${authority.label}. ${authority.summary}`}
        />
      </dl>

      <OwnerFirstDisclosure summary="Availability evidence">
        <div className="space-y-4 text-xs text-[var(--dpf-text-secondary)]">
          <ul className="space-y-2">
            {serviceAvailability.map((service) => (
              <li key={service.serviceId}>
                <span className="font-medium text-[var(--dpf-text)]">
                  {service.serviceName}
                </span>
                {": "}
                {service.availability.label}
                {". "}
                {service.availability.reason}
              </li>
            ))}
          </ul>
          <ul className="space-y-2 border-t border-[var(--dpf-border)] pt-3">
            {availability.evidence.map((evidence, index) => (
              <li key={`${evidence.source}-${index}`}>
                <span className="font-medium text-[var(--dpf-text)]">
                  {titleCase(evidence.source)}
                </span>
                {": "}
                {evidence.values.join(", ") || "No values declared"}
              </li>
            ))}
          </ul>
        </div>
      </OwnerFirstDisclosure>
    </div>
  );
}

export function AdvancedDetail({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  return (
    <OwnerFirstDisclosure summary={summary}>
      {children}
    </OwnerFirstDisclosure>
  );
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function availabilityIntent(
  state: CoworkerAvailabilityProjection["state"],
): "success" | "warning" | "danger" | "neutral" {
  if (state === "available") return "success";
  if (state === "needs-attention") return "danger";
  if (state === "setup-needed") return "warning";
  return "neutral";
}
