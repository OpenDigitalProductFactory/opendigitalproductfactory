"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCustomerContact } from "@/lib/actions/customer-contacts";

const selectClasses =
  "w-full rounded-dpf-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-dpf-caption text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "mb-1 block text-dpf-caption text-[var(--dpf-muted)]";

const CHANNEL_OPTIONS = [
  { value: "", label: "—" },
  { value: "sms", label: "SMS" },
  { value: "voice", label: "Voice" },
  { value: "email", label: "Email" },
  { value: "none", label: "None" },
] as const;

const PHONE_TYPE_OPTIONS = [
  { value: "", label: "—" },
  { value: "mobile", label: "Mobile" },
  { value: "landline", label: "Landline" },
  { value: "unknown", label: "Unknown" },
] as const;

type Props = {
  contactId: string;
  preferredNotificationChannel: string | null;
  phoneType: string | null;
};

/**
 * Compact edit surface for BI-FS-003 notification preference fields on a
 * contact card. Dropdowns only — progressive disclosure without a wizard.
 */
export function ContactNotificationPrefs({
  contactId,
  preferredNotificationChannel,
  phoneType,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [channel, setChannel] = useState(preferredNotificationChannel ?? "");
  const [type, setType] = useState(phoneType ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    (channel || null) !== (preferredNotificationChannel ?? null) ||
    (type || null) !== (phoneType ?? null);

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const result = await updateCustomerContact({
          contactId,
          preferredNotificationChannel: (channel || null) as
            | "sms"
            | "voice"
            | "email"
            | "none"
            | null,
          phoneType: (type || null) as "mobile" | "landline" | "unknown" | null,
        });
        if (result.outcome === "not-found") {
          setError("Not found.");
          return;
        }
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed.");
      }
    });
  }

  return (
    <div className="mt-2 space-y-2 border-t border-[var(--dpf-border)] pt-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClasses} htmlFor={`channel-${contactId}`}>
            Notify via
          </label>
          <select
            id={`channel-${contactId}`}
            className={selectClasses}
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value);
              setSaved(false);
            }}
            disabled={isPending}
            aria-label="Preferred notification channel"
          >
            {CHANNEL_OPTIONS.map((opt) => (
              <option
                key={opt.value || "unset"}
                value={opt.value}
                className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
              >
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClasses} htmlFor={`phoneType-${contactId}`}>
            Phone
          </label>
          <select
            id={`phoneType-${contactId}`}
            className={selectClasses}
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setSaved(false);
            }}
            disabled={isPending}
            aria-label="Phone type"
          >
            {PHONE_TYPE_OPTIONS.map((opt) => (
              <option
                key={opt.value || "unset"}
                value={opt.value}
                className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
              >
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error ? (
        <p className="text-dpf-caption text-[var(--dpf-accent)]" role="alert">
          {error}
        </p>
      ) : null}
      {saved && !dirty ? (
        <p className="text-dpf-caption text-[var(--dpf-muted)]">Saved</p>
      ) : null}
      {dirty ? (
        <button
          type="button"
          className="rounded-dpf-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-dpf-caption font-dpf-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
          disabled={isPending}
          onClick={save}
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      ) : null}
    </div>
  );
}
