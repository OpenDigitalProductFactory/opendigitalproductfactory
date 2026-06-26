"use client";

import { CreditCard, Layers3, LayoutDashboard, Network, ShieldCheck } from "lucide-react";
import {
  CAPABILITY_REGISTRY,
  readActivationProfile,
  type CapabilityKey,
  type CapabilityApplicability,
} from "@dpf/storefront-templates";
import type { WorkspaceHomeSetupActivationSummary } from "@/lib/workspace-home";

type Props = {
  activationProfile?: unknown;
  workspaceHomeActivation?: WorkspaceHomeSetupActivationSummary | null;
};

function formatToken(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isVisibleCapability(applicability: CapabilityApplicability): boolean {
  return applicability === "required" || applicability === "recommended";
}

const SUMMARY_CAPABILITY_ORDER: CapabilityKey[] = [
  "customer-estate",
  "edge-node-customer-deployment",
  "service-agreements",
  "backup-restore-posture",
  "cybersecurity-posture",
  "billing-readiness",
  "recurring-agreement-billing",
  "appointment-checkout",
  "point-of-sale",
  "customer-sites",
  "network-inventory",
  "lifecycle-review-queues",
  "project-work",
  "customer-accounts",
  "remote-support",
];

function capabilityPriority(capabilityKey: string): number {
  const index = SUMMARY_CAPABILITY_ORDER.indexOf(capabilityKey as CapabilityKey);
  return index === -1 ? SUMMARY_CAPABILITY_ORDER.length : index;
}

export function ArchetypeActivationSummary({
  activationProfile,
  workspaceHomeActivation,
}: Props) {
  const profile = readActivationProfile(activationProfile);
  if (!profile && !workspaceHomeActivation) return null;

  const visibleCapabilities = profile
    ? profile.capabilityActivations
        .filter((capability) => isVisibleCapability(capability.applicability))
        .sort((a, b) => capabilityPriority(a.capabilityKey) - capabilityPriority(b.capabilityKey))
        .slice(0, 8)
    : [];
  const requiredCount = profile
    ? profile.capabilityActivations.filter(
        (capability) => capability.applicability === "required",
      ).length
    : 0;
  const recommendedCount = profile
    ? profile.capabilityActivations.filter(
        (capability) => capability.applicability === "recommended",
      ).length
    : 0;
  const isolation =
    visibleCapabilities.find((capability) => capability.isolation === "strict-customer-scope")
      ?.isolation ?? "organization-scope";

  return (
    <section
      aria-label="Archetype activation"
      className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)]"
      style={{
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
      }}
    >
      {profile && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
              <Layers3 size={16} aria-hidden="true" />
              <div style={{ minWidth: 0 }}>
                <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11 }}>Required</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{requiredCount}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
              <ShieldCheck size={16} aria-hidden="true" />
              <div style={{ minWidth: 0 }}>
                <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11 }}>Recommended</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{recommendedCount}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
              <CreditCard size={16} aria-hidden="true" />
              <div style={{ minWidth: 0 }}>
                <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11 }}>Payment</div>
                <div style={{ fontSize: 13, fontWeight: 700, overflowWrap: "anywhere" }}>
                  {formatToken(profile.billingProfile.primaryPaymentPattern)}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
              <Network size={16} aria-hidden="true" />
              <div style={{ minWidth: 0 }}>
                <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11 }}>Isolation</div>
                <div style={{ fontSize: 13, fontWeight: 700, overflowWrap: "anywhere" }}>
                  {formatToken(isolation)}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {visibleCapabilities.map((capability) => {
              const entry = CAPABILITY_REGISTRY[capability.capabilityKey as keyof typeof CAPABILITY_REGISTRY];
              return (
                <span
                  key={capability.capabilityKey}
                  className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    minHeight: 26,
                    padding: "4px 8px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: capability.applicability === "required" ? 700 : 500,
                  }}
                >
                  {entry?.label ?? formatToken(capability.capabilityKey)}
                </span>
              );
            })}
          </div>
        </>
      )}

      {workspaceHomeActivation && (
        <div
          className={profile ? "border-t border-[var(--dpf-border)]" : undefined}
          style={{
            marginTop: profile ? 12 : 0,
            paddingTop: profile ? 12 : 0,
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
            <LayoutDashboard size={16} aria-hidden="true" />
            <div style={{ minWidth: 0 }}>
              <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11 }}>Worker Home</div>
              <div style={{ fontSize: 14, fontWeight: 700, overflowWrap: "anywhere" }}>
                {workspaceHomeActivation.label}
              </div>
            </div>
            <span
              className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                minHeight: 24,
                padding: "3px 8px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {formatToken(workspaceHomeActivation.status)}
            </span>
          </div>
          {workspaceHomeActivation.primaryOperatingQuestion && (
            <p
              className="text-[var(--dpf-muted)]"
              style={{
                marginTop: 8,
                fontSize: 12,
                fontStyle: "italic",
              }}
            >
              The worker arrives asking: {workspaceHomeActivation.primaryOperatingQuestion}
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {workspaceHomeActivation.primitiveWidgets.length > 0 ? (
              workspaceHomeActivation.primitiveWidgets.map((primitive) => (
                <span
                  key={primitive}
                  className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    minHeight: 26,
                    padding: "4px 8px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  {formatToken(primitive)}
                </span>
              ))
            ) : (
              <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>
                Standard workspace fallback
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
