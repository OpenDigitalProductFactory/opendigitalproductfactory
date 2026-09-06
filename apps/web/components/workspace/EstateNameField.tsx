"use client";

// BI-7626A660 — where an operator names the estate that runs this installation.
//
// Deliberately separate from the identity change form below it. That form moves
// what AI coworkers may do here and so it makes you preview the impact first;
// this one sets a label and does not. Keeping the ceremony where the
// consequences are is what stops the ceremony becoming noise.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { TextField } from "@/components/ui/form/TextField";
import { declareEstateName } from "@/lib/actions/installation-estate-name";

export function EstateNameField({
  estateName,
  badgePreview,
  organizationFallback = null,
}: {
  estateName: string | null;
  /** The role word the badge will pair the name with, e.g. `DEV`. Null on production. */
  badgePreview: string | null;
  /**
   * The setup-time organization name in force because nobody named the
   * operator here (BI-CA54ACC8). The field stays empty so what the operator
   * types is a real declaration, and the hint says what applies meanwhile.
   */
  organizationFallback?: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(estateName ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmed = value.trim();
  const preview =
    badgePreview === null
      ? null
      : trimmed.length > 0
        ? `${trimmed.toUpperCase()} ${badgePreview}`
        : badgePreview;

  function save() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await declareEstateName(value);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(
        result.data.estateName
          ? `Saved. Your coworkers now see this installation as ${result.data.estateName}.`
          : "Saved. This installation no longer carries a name.",
      );
      router.refresh();
    });
  }

  return (
    <Surface level={2} padding="sm" rounded="md" className="mt-4">
      <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Who runs this installation</h3>
      <p className="mt-1 text-xs text-[var(--dpf-muted)]">
        Name the company or team that operates it, not the business it runs for. Two installations
        that belong together share this name, and it is how you tell them apart everywhere else.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <TextField
          name="estate-name"
          label="Operator name"
          value={value}
          onValueChange={(next: string) => {
            setValue(next);
            setMessage(null);
            setError(null);
          }}
          optional
          autoComplete="off"
          hint={
            organizationFallback
              ? `Until you name it, the organization from setup applies: ${organizationFallback}.`
              : "Leave it empty if you would rather not name it yet."
          }
          disabled={isPending}
        />
        <div className="text-xs text-[var(--dpf-muted)]">
          <span className="font-semibold text-[var(--dpf-text)]">In the header</span>
          <p className="mt-1">
            {preview === null ? (
              <>A production installation shows no badge at all.</>
            ) : (
              <>
                <span className="rounded-full border border-[var(--dpf-warning)] px-2 py-0.5 font-bold uppercase tracking-[0.14em] text-[var(--dpf-warning)]">
                  {preview}
                </span>{" "}
                appears beside your logo.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <Button onClick={save} disabled={isPending} data-owner-first-next-action="save-estate-name">
          {isPending ? "Saving" : "Save the name"}
        </Button>
      </div>

      {message ? (
        <p className="mt-2 text-xs text-[var(--dpf-muted)]" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs text-[var(--dpf-error)]" role="alert">
          {error}
        </p>
      ) : null}
    </Surface>
  );
}
