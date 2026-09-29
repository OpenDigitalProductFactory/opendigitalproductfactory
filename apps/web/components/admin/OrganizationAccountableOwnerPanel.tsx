"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { setOrganizationAccountableOwner } from "@/lib/actions/organization-accountable-owner";
import type { ActiveHumanPrincipalOption } from "@/lib/identity/principal-linking";

// The organization's accountable owner (Organization.topAccountablePrincipalId):
// the person every Workroom without its own owner answers to. One line by
// default; the picker and its consequence appear only when the operator asks
// to change it, because this is set once at setup and rarely revisited.

const SELECT_CLASS =
  "max-w-full px-3 py-2 text-xs bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]";

type Owner = { id: string; displayName: string } | null;

export function OrganizationAccountableOwnerPanel({
  owner,
  candidates,
}: {
  owner: Owner;
  candidates: ActiveHumanPrincipalOption[];
}) {
  const [current, setCurrent] = useState<Owner>(owner);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(owner?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    setError(null);
    setChoice(current?.id ?? "");
    setOpen((value) => !value);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await setOrganizationAccountableOwner(choice);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCurrent({ id: result.data.principalId, displayName: result.data.displayName });
      setOpen(false);
    });
  }

  return (
    <Surface as="section" padding="sm" className="mt-8" aria-label="Organization accountable owner">
      <p className="text-sm text-[var(--dpf-text)]">
        {current ? (
          <>
            <span className="text-[var(--dpf-muted)]">Accountable owner:</span>{" "}
            <span className="font-semibold">{current.displayName}</span>
          </>
        ) : (
          <span className="text-[var(--dpf-muted)]">No accountable owner recorded</span>
        )}
        {" · "}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="accountable-owner-editor"
          className="text-[var(--dpf-accent)] hover:underline"
        >
          {current ? "Change" : "Set"}
        </button>
      </p>

      {open && (
        <div id="accountable-owner-editor" className="mt-3 space-y-3">
          <p className="text-xs text-[var(--dpf-muted)]">
            Every workroom without its own owner answers to this person.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="accountable-owner-picker" className="sr-only">
              Accountable owner
            </label>
            <select
              id="accountable-owner-picker"
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              disabled={isPending}
              className={SELECT_CLASS}
            >
              <option value="">Choose a person</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.displayName} ({candidate.email})
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              onClick={save}
              disabled={isPending || !choice || choice === current?.id}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={toggle} disabled={isPending}>
              Cancel
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-[var(--dpf-error)]">
              {error}
            </p>
          )}
        </div>
      )}
    </Surface>
  );
}
