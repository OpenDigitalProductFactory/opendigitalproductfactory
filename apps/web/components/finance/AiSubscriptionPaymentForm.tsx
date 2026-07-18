"use client";

import type { FormEvent } from "react";
import { useMemo, useState, useTransition } from "react";
import { CreditCard } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { useRouter } from "next/navigation";

import { recordAiProviderSubscriptionPaymentAction } from "@/lib/actions/ai-provider-finance";

export type AiSubscriptionPaymentProviderOption = {
  providerId: string;
  providerName: string;
  supplierName: string | null;
};

const inputClassName =
  "w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)] outline-none transition-colors focus:border-[var(--dpf-accent)]";

const labelClassName = "text-xs font-medium uppercase tracking-[0.12em] text-[var(--dpf-muted)]";

const paymentMethods = [
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "direct_debit", label: "Direct debit" },
  { value: "stripe", label: "Stripe" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
] as const;

type SubscriptionPaymentMethod = (typeof paymentMethods)[number]["value"];

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayFromIsoDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return "1";
  return String(parsed.getUTCDate());
}

export function AiSubscriptionPaymentForm({
  providerOptions,
}: {
  providerOptions: AiSubscriptionPaymentProviderOption[];
}) {
  const router = useRouter();
  const defaultProvider = providerOptions[0] ?? null;
  const defaultPaidAt = todayIsoDate();
  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>(
    defaultProvider ? [defaultProvider.providerId] : [],
  );
  const [supplierName, setSupplierName] = useState(defaultProvider?.supplierName ?? "");
  const [planName, setPlanName] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [billingCadence, setBillingCadence] = useState<"monthly" | "quarterly" | "annual">("monthly");
  const [billingDayOfMonth, setBillingDayOfMonth] = useState(dayFromIsoDate(defaultPaidAt));
  const [billingDayEdited, setBillingDayEdited] = useState(false);
  const [paidAt, setPaidAt] = useState(defaultPaidAt);
  const [paymentMethod, setPaymentMethod] = useState<SubscriptionPaymentMethod>("card");
  const [paymentReference, setPaymentReference] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedCountLabel = useMemo(() => {
    const count = selectedProviderIds.length;
    return `${count} provider${count === 1 ? "" : "s"} covered`;
  }, [selectedProviderIds.length]);

  function toggleProvider(providerId: string) {
    const option = providerOptions.find((provider) => provider.providerId === providerId);
    setSelectedProviderIds((current) => {
      const next = current.includes(providerId)
        ? current.filter((id) => id !== providerId)
        : [...current, providerId];
      if (next.length > 0 && !supplierName.trim() && option?.supplierName) {
        setSupplierName(option.supplierName);
      }
      return next;
    });
  }

  function updatePaidAt(value: string) {
    setPaidAt(value);
    if (!billingDayEdited) {
      setBillingDayOfMonth(dayFromIsoDate(value));
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const amountNumber = Number(amount);
    const billingDayNumber = Number(billingDayOfMonth);

    if (selectedProviderIds.length === 0) {
      setError("Select at least one covered provider.");
      return;
    }
    if (!supplierName.trim()) {
      setError("Enter the billing supplier.");
      return;
    }
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setError("Enter a positive subscription amount.");
      return;
    }
    if (!Number.isInteger(billingDayNumber) || billingDayNumber < 1 || billingDayNumber > 31) {
      setError("Billing day must be between 1 and 31.");
      return;
    }

    startTransition(async () => {
      try {
        await recordAiProviderSubscriptionPaymentAction({
          providerIds: selectedProviderIds,
          supplierName: supplierName.trim(),
          planName: planName.trim() || undefined,
          amount: amountNumber,
          currency: currency.trim().toUpperCase(),
          billingCadence,
          billingDayOfMonth: billingDayNumber,
          paidAt,
          paymentMethod,
          paymentReference: paymentReference.trim() || undefined,
          evidenceUrl: evidenceUrl.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        setMessage("Subscription payment recorded.");
        setAmount("");
        setPaymentReference("");
        setEvidenceUrl("");
        setNotes("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to record subscription payment.");
      }
    });
  }

  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Record subscription payment</h2>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            Capture provider coverage, card timing, and bill evidence in one finance record.
          </p>
        </div>
        <span className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-2 py-1 text-xs text-[var(--dpf-muted)]">
          {selectedCountLabel}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <fieldset className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-3">
          <legend className="px-1 text-xs font-medium uppercase tracking-[0.12em] text-[var(--dpf-muted)]">
            Covered providers
          </legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {providerOptions.map((provider) => (
              <label
                key={provider.providerId}
                className="flex min-h-12 items-start gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 text-sm text-[var(--dpf-text)]"
              >
                <input
                  type="checkbox"
                  checked={selectedProviderIds.includes(provider.providerId)}
                  onChange={() => toggleProvider(provider.providerId)}
                  className="mt-1 h-4 w-4 accent-[var(--dpf-accent)]"
                />
                <span>
                  <span className="block font-medium">{provider.providerName}</span>
                  {provider.supplierName ? (
                    <span className="block text-xs text-[var(--dpf-muted)]">{provider.supplierName}</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 lg:grid-cols-4">
          <label className="space-y-1 lg:col-span-2">
            <span className={labelClassName}>Supplier</span>
            <input
              value={supplierName}
              onChange={(event) => setSupplierName(event.target.value)}
              className={inputClassName}
              placeholder="Anthropic"
            />
          </label>
          <label className="space-y-1 lg:col-span-2">
            <span className={labelClassName}>Plan</span>
            <input
              value={planName}
              onChange={(event) => setPlanName(event.target.value)}
              className={inputClassName}
              placeholder="Claude Pro"
            />
          </label>
          <label className="space-y-1">
            <span className={labelClassName}>Amount</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className={inputClassName}
              placeholder="20.00"
            />
          </label>
          <label className="space-y-1">
            <span className={labelClassName}>Currency</span>
            <input
              value={currency}
              maxLength={3}
              onChange={(event) => setCurrency(event.target.value)}
              className={inputClassName}
            />
          </label>
          <label className="space-y-1">
            <span className={labelClassName}>Cadence</span>
            <select
              value={billingCadence}
              onChange={(event) => setBillingCadence(event.target.value as "monthly" | "quarterly" | "annual")}
              className={inputClassName}
            >
              <option value="monthly" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Monthly</option>
              <option value="quarterly" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Quarterly</option>
              <option value="annual" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Annual</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelClassName}>Billing day</span>
            <input
              type="number"
              min="1"
              max="31"
              value={billingDayOfMonth}
              onChange={(event) => {
                setBillingDayEdited(true);
                setBillingDayOfMonth(event.target.value);
              }}
              className={inputClassName}
            />
          </label>
          <label className="space-y-1">
            <span className={labelClassName}>Paid date</span>
            <input
              type="date"
              value={paidAt}
              onChange={(event) => updatePaidAt(event.target.value)}
              className={inputClassName}
            />
          </label>
          <label className="space-y-1">
            <span className={labelClassName}>Payment method</span>
            <select
              value={paymentMethod}
              onChange={(event) => setPaymentMethod(event.target.value as SubscriptionPaymentMethod)}
              className={inputClassName}
            >
              {paymentMethods.map((method) => (
                <option
                  key={method.value}
                  value={method.value}
                  className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                >
                  {method.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 lg:col-span-2">
            <span className={labelClassName}>Payment reference</span>
            <input
              value={paymentReference}
              onChange={(event) => setPaymentReference(event.target.value)}
              className={inputClassName}
              placeholder="Card ending 4242"
            />
          </label>
          <label className="space-y-1 lg:col-span-2">
            <span className={labelClassName}>Evidence URL</span>
            <input
              type="url"
              value={evidenceUrl}
              onChange={(event) => setEvidenceUrl(event.target.value)}
              className={inputClassName}
              placeholder="https://..."
            />
          </label>
          <label className="space-y-1 lg:col-span-4">
            <span className={labelClassName}>Notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className={`${inputClassName} min-h-20 resize-y`}
            />
          </label>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-h-5 text-sm">
            {error ? <span className="text-[var(--dpf-error)]">{error}</span> : null}
            {message ? <span className="text-[var(--dpf-success)]">{message}</span> : null}
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--dpf-accent)] px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? (
              <Spinner size="sm" tone="current" presentational />
            ) : (
              <CreditCard className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{isPending ? "Recording..." : "Record payment"}</span>
          </button>
        </div>
      </form>
    </section>
  );
}
