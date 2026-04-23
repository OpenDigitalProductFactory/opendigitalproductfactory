"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCustomerSite } from "@/lib/actions/crm";

const inputClasses =
  "w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "mb-1 block text-xs text-[var(--dpf-muted)]";

export function NewCustomerSiteButton({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [siteType, setSiteType] = useState("office");
  const [status, setStatus] = useState("active");
  const [timezone, setTimezone] = useState("");
  const [accessInstructions, setAccessInstructions] = useState("");
  const [hoursNotes, setHoursNotes] = useState("");
  const [serviceNotes, setServiceNotes] = useState("");
  const router = useRouter();

  function resetForm() {
    setName("");
    setSiteType("office");
    setStatus("active");
    setTimezone("");
    setAccessInstructions("");
    setHoursNotes("");
    setServiceNotes("");
    setError(null);
  }

  function closeModal() {
    setOpen(false);
    resetForm();
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Site name is required.");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        await createCustomerSite({
          accountId,
          name,
          siteType,
          status,
          timezone,
          accessInstructions,
          hoursNotes,
          serviceNotes,
        });
        closeModal();
        router.refresh();
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Failed to create customer site.",
        );
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
      >
        + New Site
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={closeModal} />
      <div className="fixed right-8 top-20 z-50 w-[460px] rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--dpf-border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">New Customer Site</h2>
          <button
            type="button"
            onClick={closeModal}
            className="text-lg text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          >
            x
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <div>
            <label className={labelClasses}>Site Name *</label>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Dallas HQ"
              className={inputClasses}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Site Type</label>
              <select
                value={siteType}
                onChange={(event) => setSiteType(event.target.value)}
                className={inputClasses}
              >
                <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="office">Office</option>
                <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="branch">Branch</option>
                <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="campus">Campus</option>
                <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="datacenter">Datacenter</option>
                <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="warehouse">Warehouse</option>
              </select>
            </div>

            <div>
              <label className={labelClasses}>Status</label>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className={inputClasses}
              >
                <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="active">Active</option>
                <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="planned">Planned</option>
                <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelClasses}>Timezone</label>
            <input
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              placeholder="e.g. America/Chicago"
              className={inputClasses}
            />
          </div>

          <div>
            <label className={labelClasses}>Access Instructions</label>
            <textarea
              rows={2}
              value={accessInstructions}
              onChange={(event) => setAccessInstructions(event.target.value)}
              placeholder="Badge desk, suite access, entry notes..."
              className={inputClasses}
            />
          </div>

          <div>
            <label className={labelClasses}>Hours Notes</label>
            <textarea
              rows={2}
              value={hoursNotes}
              onChange={(event) => setHoursNotes(event.target.value)}
              placeholder="Support window, after-hours notes..."
              className={inputClasses}
            />
          </div>

          <div>
            <label className={labelClasses}>Service Notes</label>
            <textarea
              rows={2}
              value={serviceNotes}
              onChange={(event) => setServiceNotes(event.target.value)}
              placeholder="Operational notes for the site..."
              className={inputClasses}
            />
          </div>

          {error ? <p className="text-xs text-red-500">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeModal}
              className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? "Creating..." : "Create Site"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
