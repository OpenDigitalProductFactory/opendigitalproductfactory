"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCustomerSiteNode } from "@/lib/actions/crm";

const inputClasses =
  "w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "mb-1 block text-xs text-[var(--dpf-muted)]";

export function NewCustomerSiteNodeButton({
  accountId,
  siteId,
  parentNodeId,
  label = "+ Add Sublocation",
}: {
  accountId: string;
  siteId: string;
  parentNodeId?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [nodeType, setNodeType] = useState("area");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function resetForm() {
    setName("");
    setNodeType("area");
    setNotes("");
    setError(null);
  }

  function closeModal() {
    setOpen(false);
    resetForm();
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Sublocation name is required.");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        await createCustomerSiteNode({
          accountId,
          siteId,
          parentNodeId,
          name,
          nodeType,
          notes,
        });
        closeModal();
        router.refresh();
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Failed to create sublocation.",
        );
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-[var(--dpf-border)] px-2 py-1 text-[10px] font-medium text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
      >
        {label}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={closeModal} />
          <div className="fixed right-8 top-24 z-50 w-[420px] rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--dpf-border)] px-4 py-3">
              <h2 className="text-sm font-semibold text-[var(--dpf-text)]">New Sublocation</h2>
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
                <label className={labelClasses}>Name *</label>
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Server Room"
                  className={inputClasses}
                />
              </div>

              <div>
                <label className={labelClasses}>Type</label>
                <select
                  value={nodeType}
                  onChange={(event) => setNodeType(event.target.value)}
                  className={inputClasses}
                >
                  <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="area">Area</option>
                  <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="building">Building</option>
                  <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="floor">Floor</option>
                  <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="suite">Suite</option>
                  <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="room">Room</option>
                  <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="closet">Closet</option>
                </select>
              </div>

              <div>
                <label className={labelClasses}>Notes</label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Operational notes for this sublocation..."
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
                  {isPending ? "Creating..." : "Create Sublocation"}
                </button>
              </div>
            </form>
          </div>
        </>
      ) : null}
    </>
  );
}
