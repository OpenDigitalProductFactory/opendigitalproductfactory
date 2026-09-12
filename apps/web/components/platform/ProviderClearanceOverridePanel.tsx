"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Surface } from "@/components/ui/Surface";
import { Button } from "@/components/ui/Button";
import {
  grantProviderClearanceOverride,
  revokeProviderClearanceOverride,
  type ClearanceOverrideView,
} from "@/lib/actions/provider-clearance-override";

// Break-glass panel (BI-FA412D44). Distinct from the attestation form on purpose:
// attestation asserts the account IS safe; an override records that it is NOT and
// that we accept the exposure. Defaults off; the education lives on the ack step.

const OVERRIDABLE = ["internal", "confidential", "restricted"] as const;
type Overridable = (typeof OVERRIDABLE)[number];

function defaultExpiryValue(): string {
  const d = new Date(Date.now() + 30 * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function riskStatement(providerId: string, levels: string[]): string {
  const list = levels.length ? levels.join(", ") : "the selected";
  return (
    `I understand this lets "${providerId}" — not verified safe for ${list} data ` +
    `(no confirmed no-training agreement) — receive ${list} work, and I accept the exposure.`
  );
}

export function ProviderClearanceOverridePanel({
  providerId,
  canWrite,
  genuinelyCleared,
  overrides,
}: {
  providerId: string;
  canWrite: boolean;
  genuinelyCleared: string[];
  overrides: ClearanceOverrideView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<Overridable>>(new Set());
  const [rationale, setRationale] = useState("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const cleared = useMemo(() => new Set(genuinelyCleared), [genuinelyCleared]);
  const offerable = OVERRIDABLE.filter((level) => !cleared.has(level));
  const selectedLevels = [...selected];

  function toggle(level: Overridable) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  function submit() {
    setMessage(null);
    const expiryIso = expiresAt ? new Date(expiresAt).toISOString() : "";
    startTransition(async () => {
      const res = await grantProviderClearanceOverride({
        providerId,
        acceptedSensitivities: selectedLevels,
        rationale,
        acknowledgedRisk: riskStatement(providerId, selectedLevels),
        acknowledged,
        expiresAt: expiryIso,
      });
      if (res.error) {
        setMessage(res.error);
        return;
      }
      setSelected(new Set());
      setRationale("");
      setExpiresAt("");
      setAcknowledged(false);
      setShowForm(false);
      router.refresh();
    });
  }

  function revoke(overrideId: string) {
    setMessage(null);
    startTransition(async () => {
      const res = await revokeProviderClearanceOverride({ overrideId });
      if (res.error) setMessage(res.error);
      else router.refresh();
    });
  }

  const canSubmit =
    canWrite && !pending && selectedLevels.length > 0 && rationale.trim().length >= 10 && !!expiresAt && acknowledged;

  return (
    <Surface
      as="section"
      level={1}
      padding="md"
      rounded="lg"
      aria-labelledby="clearance-override-heading"
      className="mb-4 border border-[var(--dpf-warning)] bg-[var(--dpf-warning-surface)]"
    >
      <h3 id="clearance-override-heading" className="text-dpf-heading text-[var(--dpf-warning-text)]">
        Break-glass: accept the risk of using this provider for sensitive work
      </h3>
      <p className="mt-1 text-dpf-caption text-[var(--dpf-warning-text)]">
        This is <strong>not</strong> an attestation. Use the account-posture form above if the account genuinely has a
        no-training agreement, or run a capable local model. An override records that this provider is <strong>not</strong>{" "}
        verified safe and that you accept the exposure. Overrides default off, are audited, expire, and can be revoked.
      </p>

      {overrides.length > 0 && (
        <div className="mt-3">
          <div className="text-dpf-caption text-[var(--dpf-muted)] uppercase tracking-wide">Active overrides</div>
          <ul className="mt-1 space-y-2">
            {overrides.map((o) => (
              <li key={o.overrideId}>
                <Surface
                  level={1}
                  padding="sm"
                  rounded="md"
                  className="flex items-start justify-between gap-3 border border-[var(--dpf-border)]"
                >
                  <div className="text-dpf-caption text-[var(--dpf-text)]">
                    <div>
                      <strong>{o.acceptedSensitivities.join(", ")}</strong> — expires {new Date(o.expiresAt).toLocaleString()}
                    </div>
                    <div className="text-[var(--dpf-muted)]">
                      {o.rationale} · accepted by {o.approverRef ?? "unknown"}
                    </div>
                  </div>
                  {canWrite && (
                    <Button variant="danger" size="sm" onClick={() => revoke(o.overrideId)} disabled={pending}>
                      Revoke
                    </Button>
                  )}
                </Surface>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canWrite && offerable.length > 0 && (
        <div className="mt-3">
          {!showForm ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowForm(true);
                setExpiresAt(defaultExpiryValue());
              }}
            >
              Accept risk / add an override…
            </Button>
          ) : (
            <Surface level={1} padding="sm" rounded="md" className="border border-[var(--dpf-warning)]">
              <fieldset>
                <legend className="text-dpf-caption text-[var(--dpf-muted)] uppercase tracking-wide">
                  Sensitivities to risk-accept
                </legend>
                <div className="mt-1 flex flex-wrap gap-3">
                  {offerable.map((level) => (
                    <label key={level} className="flex items-center gap-1.5 text-dpf-caption text-[var(--dpf-text)]">
                      <input type="checkbox" checked={selected.has(level)} onChange={() => toggle(level)} />
                      {level}
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="mt-3 block text-dpf-caption text-[var(--dpf-text)]">
                Justification (why accept this risk?)
                <textarea
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-dpf-caption text-[var(--dpf-text)]"
                  placeholder="At least 10 characters — recorded in the audit trail."
                />
              </label>

              <label className="mt-3 block text-dpf-caption text-[var(--dpf-text)]">
                Expires
                <input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="mt-1 block rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-1.5 text-dpf-caption text-[var(--dpf-text)]"
                />
              </label>

              {selectedLevels.length > 0 && (
                <label className="mt-3 flex items-start gap-2 text-dpf-caption text-[var(--dpf-warning-text)]">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>{riskStatement(providerId, selectedLevels)}</span>
                </label>
              )}

              <div className="mt-3 flex items-center gap-2">
                <Button variant="danger" size="sm" onClick={submit} disabled={!canSubmit}>
                  {pending ? "Saving…" : "Accept risk & save override"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowForm(false);
                    setMessage(null);
                  }}
                  disabled={pending}
                >
                  Cancel
                </Button>
              </div>
            </Surface>
          )}
        </div>
      )}

      {canWrite && offerable.length === 0 && overrides.length === 0 && (
        <p className="mt-3 text-dpf-caption text-[var(--dpf-muted)]">
          This provider is already cleared for internal, confidential, and restricted work — no override is needed.
        </p>
      )}

      {message && <p className="mt-2 text-dpf-caption text-[var(--dpf-error-text)]">{message}</p>}
    </Surface>
  );
}
