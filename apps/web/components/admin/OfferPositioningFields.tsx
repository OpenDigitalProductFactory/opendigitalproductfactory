"use client";
// What the business offers and who it is for (BI-C1E83871): the value
// proposition and customer segments marketing plans from. Self-contained like
// MarketContextFields — collapsed by default, loads the current answers when
// opened, and saves through the business-context route.
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n/use-t";
import { CUSTOMER_SEGMENT_MAX, VALUE_PROPOSITION_MAX } from "@/lib/onboarding/offer-positioning";

const inputClass =
  "w-full px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]";

export function OfferPositioningFields() {
  const t = useT("setup");
  const [open, setOpen] = useState(false);
  const [valueProposition, setValueProposition] = useState("");
  const [segments, setSegments] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setOpen(true);
    try {
      const res = await fetch("/api/business-context/setup");
      const body = (await res.json()) as {
        businessContext?: { valueProposition?: string | null; customerSegments?: string[] } | null;
      };
      setValueProposition(body.businessContext?.valueProposition ?? "");
      setSegments((body.businessContext?.customerSegments ?? []).join("\n"));
    } catch {
      setError(t("offerPositioning.loadFailed"));
    }
  }

  async function save() {
    setStatus("saving");
    setError(null);
    const res = await fetch("/api/business-context/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ valueProposition, customerSegments: segments.split("\n") }),
    });
    if (res.ok) {
      setStatus("saved");
      return;
    }
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    setError(body?.message ?? t("offerPositioning.saveFailed"));
    setStatus("error");
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => void reveal()}>
        {t("offerPositioning.open")}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="font-semibold text-[var(--dpf-text)]">{t("offerPositioning.heading")}</div>
      <label className="block">
        <span className="mb-1 block font-semibold">{t("offerPositioning.valueProposition")}</span>
        <textarea
          value={valueProposition}
          onChange={(e) => {
            setValueProposition(e.target.value);
            setStatus("idle");
          }}
          placeholder={t("offerPositioning.valuePropositionHint")}
          maxLength={VALUE_PROPOSITION_MAX}
          rows={3}
          className={`${inputClass} resize-y`}
        />
      </label>
      <label className="block">
        <span className="mb-1 block font-semibold">{t("offerPositioning.segments")}</span>
        <textarea
          value={segments}
          onChange={(e) => {
            setSegments(e.target.value);
            setStatus("idle");
          }}
          placeholder={t("offerPositioning.segmentsHint")}
          maxLength={CUSTOMER_SEGMENT_MAX * 8}
          rows={3}
          className={`${inputClass} resize-y`}
        />
      </label>
      <p className="m-0 text-xs text-[var(--dpf-muted)]">{t("offerPositioning.note")}</p>
      {error && (
        <p role="alert" className="m-0 text-xs text-[var(--dpf-error)]">
          {error}
        </p>
      )}
      {status === "saved" && <p className="m-0 text-xs text-[var(--dpf-success)]">{t("offerPositioning.saved")}</p>}
      <div>
        <Button type="button" size="sm" disabled={status === "saving"} onClick={() => void save()}>
          {status === "saving" ? t("offerPositioning.saving") : t("offerPositioning.save")}
        </Button>
      </div>
    </div>
  );
}
