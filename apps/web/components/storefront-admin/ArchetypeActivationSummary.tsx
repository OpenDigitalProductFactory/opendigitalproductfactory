"use client";

import { CreditCard, Layers3, Network, ShieldCheck } from "lucide-react";
import {
  CAPABILITY_REGISTRY,
  readActivationProfile,
  type CapabilityKey,
  type CapabilityApplicability,
} from "@dpf/storefront-templates";

type Props = {
  activationProfile?: unknown;
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

export function ArchetypeActivationSummary({ activationProfile }: Props) {
  const profile = readActivationProfile(activationProfile);
  if (!profile) return null;

  const visibleCapabilities = profile.capabilityActivations
    .filter((capability) => isVisibleCapability(capability.applicability))
    .sort((a, b) => capabilityPriority(a.capabilityKey) - capabilityPriority(b.capabilityKey))
    .slice(0, 8);
  const requiredCount = profile.capabilityActivations.filter(
    (capability) => capability.applicability === "required",
  ).length;
  const recommendedCount = profile.capabilityActivations.filter(
    (capability) => capability.applicability === "recommended",
  ).length;
  const isolation =
    visibleCapabilities.find((capability) => capability.isolation === "strict-customer-scope")
      ?.isolation ?? "organization-scope";

  return (
    <section
      aria-label="Archetype activation"
      style={{
        border: "1px solid var(--dpf-border)",
        borderRadius: 8,
        background: "var(--dpf-surface-1)",
        color: "var(--dpf-text)",
        padding: 12,
        marginBottom: 16,
      }}
    >
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
            <div style={{ fontSize: 11, color: "var(--dpf-muted)" }}>Required</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{requiredCount}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
          <ShieldCheck size={16} aria-hidden="true" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: "var(--dpf-muted)" }}>Recommended</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{recommendedCount}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
          <CreditCard size={16} aria-hidden="true" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: "var(--dpf-muted)" }}>Payment</div>
            <div style={{ fontSize: 13, fontWeight: 700, overflowWrap: "anywhere" }}>
              {formatToken(profile.billingProfile.primaryPaymentPattern)}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
          <Network size={16} aria-hidden="true" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: "var(--dpf-muted)" }}>Isolation</div>
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
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: 26,
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid var(--dpf-border)",
                background: "var(--dpf-surface-2)",
                color: "var(--dpf-text)",
                fontSize: 12,
                fontWeight: capability.applicability === "required" ? 700 : 500,
              }}
            >
              {entry?.label ?? formatToken(capability.capabilityKey)}
            </span>
          );
        })}
      </div>
    </section>
  );
}
