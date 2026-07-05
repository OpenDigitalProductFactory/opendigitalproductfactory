import Link from "next/link";

import { engineReadinessBadgeContent, ENGINE_READINESS_TONE_COLOR } from "./engine-readiness-badge";
import { ProvisionEngineButton } from "./ProvisionEngineButton";

export type ProviderOption = {
  providerId: string;
  name: string;
  status: string;
  billingLabel: string | null;
  costNotes: string | null;
};

export type EngineReadinessBadge = {
  present: boolean | null;
  version: string | null;
  lastProbedAt: string | null;
  /** Live-probe failure reason (only when present === false). */
  error?: string | null;
  /** A live probe for this engine is in flight. */
  probing?: boolean;
};

const STATUS_COLORS: Record<string, string> = {
  ok: "var(--dpf-success)",
  configured: "var(--dpf-success)",
  pending: "var(--dpf-warning)",
  unconfigured: "var(--dpf-muted)",
  auth_failed: "var(--dpf-error)",
  expired: "var(--dpf-error)",
};

const STATUS_LABELS: Record<string, string> = {
  ok: "Connected",
  configured: "Configured",
  pending: "Credentials saved, not yet verified",
  unconfigured: "Not configured",
  auth_failed: "Auth failed",
  expired: "Token expired",
};

function isSubscriptionProvider(p: ProviderOption): boolean {
  return p.billingLabel !== null && p.billingLabel.toLowerCase().includes("subscription");
}

export function isConfigured(status: string): boolean {
  return status === "ok" || status === "configured" || status === "pending";
}

function EngineReadinessBadgeView({ readiness }: { readiness: EngineReadinessBadge }) {
  const { icon, text, tone } = engineReadinessBadgeContent(readiness.present, readiness.version, {
    probing: readiness.probing,
  });
  // Show the live-probe failure reason so "not installed" says WHY (missing
  // binary vs docker error) — the operator can act instead of guessing.
  const showReason = !readiness.probing && readiness.present === false && !!readiness.error;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 3 }}>
      <div
        role="status"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 10,
          fontWeight: 600,
          color: ENGINE_READINESS_TONE_COLOR[tone],
        }}
      >
        <span aria-hidden="true">{icon}</span>
        <span>{text}</span>
      </div>
      {showReason && (
        <div style={{ fontSize: 10, color: "var(--dpf-muted)", maxWidth: "22rem", lineHeight: 1.4 }}>
          {readiness.error}
        </div>
      )}
    </div>
  );
}

export function ProviderRadio({ name, value, checked, onChange, disabled, label, desc, unconfiguredMsg, readiness, canProvision }: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
  label: string;
  desc: string;
  unconfiguredMsg?: string;
  readiness?: EngineReadinessBadge;
  canProvision?: boolean;
}) {
  return (
    <label style={{
      display: "flex",
      alignItems: "flex-start",
      gap: 8,
      padding: "8px 10px",
      borderRadius: 6,
      border: checked ? "1px solid var(--dpf-accent)" : "1px solid var(--dpf-border)",
      background: checked ? "color-mix(in srgb, var(--dpf-accent) 5%, transparent)" : "transparent",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
    }}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} disabled={disabled} style={{ marginTop: 2 }} />
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)" }}>{label}</div>
        <div style={{ fontSize: 10, color: "var(--dpf-muted)" }}>{desc}</div>
        {readiness && <EngineReadinessBadgeView readiness={readiness} />}
        {canProvision && !readiness?.probing && readiness?.present === false && (
          <ProvisionEngineButton engineId={value} label={value.charAt(0).toUpperCase() + value.slice(1)} />
        )}
        {unconfiguredMsg && (
          <div style={{ fontSize: 10, color: "var(--dpf-warning)", marginTop: 2 }}>
            {unconfiguredMsg}{" "}
            <Link href="/platform/ai/providers" style={{ color: "var(--dpf-accent)", textDecoration: "underline" }}>
              Set up in External Services
            </Link>
          </div>
        )}
      </div>
    </label>
  );
}

export function CredentialCard({ title, providers, selectedId, onSelect, active, canWrite }: {
  title: string;
  providers: ProviderOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  active: boolean;
  canWrite: boolean;
}) {
  return (
    <div style={{
      flex: "1 1 280px",
      minWidth: 280,
      padding: 12,
      borderRadius: 6,
      border: "1px solid var(--dpf-border)",
      opacity: active ? 1 : 0.5,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 8 }}>{title}</div>

      {providers.length === 0 ? (
        <p style={{ fontSize: 11, color: "var(--dpf-muted)" }}>
          No credentials configured.{" "}
          <Link href="/platform/ai/providers" style={{ color: "var(--dpf-accent)", textDecoration: "underline" }}>
            Set up in External Services
          </Link>
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {providers.map(p => {
            const isSubscription = isSubscriptionProvider(p);
            const credConfigured = isConfigured(p.status);
            return (
              <label
                key={p.providerId}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "6px 8px",
                  borderRadius: 4,
                  border: selectedId === p.providerId ? "1px solid var(--dpf-accent)" : "1px solid transparent",
                  cursor: canWrite && credConfigured ? "pointer" : "not-allowed",
                  opacity: credConfigured ? 1 : 0.5,
                }}
              >
                <input
                  type="radio"
                  name={`${title}-cred`}
                  value={p.providerId}
                  checked={selectedId === p.providerId}
                  onChange={() => onSelect(p.providerId)}
                  disabled={!canWrite || !credConfigured}
                  style={{ marginTop: 2 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color: "var(--dpf-text)" }}>{p.name}</span>
                    {isSubscription && (
                      <span style={{
                        fontSize: 9,
                        fontWeight: 600,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background: "color-mix(in srgb, var(--dpf-success) 15%, transparent)",
                        color: "var(--dpf-success)",
                      }}>
                        Recommended
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                    <span style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: STATUS_COLORS[p.status] ?? "var(--dpf-muted)",
                      flexShrink: 0,
                    }} />
                    <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
                      {p.providerId} · {STATUS_LABELS[p.status] ?? p.status}
                    </span>
                  </div>
                  {p.billingLabel && (
                    <div style={{ fontSize: 10, color: "var(--dpf-muted)", marginTop: 2 }}>{p.billingLabel}</div>
                  )}
                  {isSubscription && p.costNotes && (
                    <div style={{ fontSize: 10, color: "var(--dpf-success)", marginTop: 2 }}>{p.costNotes}</div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <Link href="/platform/ai/providers" style={{ fontSize: 10, color: "var(--dpf-accent)", textDecoration: "underline" }}>
          Manage credentials in External Services
        </Link>
      </div>
    </div>
  );
}
