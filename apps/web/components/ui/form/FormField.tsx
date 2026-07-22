"use client";

// FormField — the accessible labeled-control wrapper for the portal form
// contract (BI-8E74C749). It owns the four things every user-facing field must
// get right and which hand-rolled forms kept dropping:
//   1. a real <label htmlFor> bound to the control's id (click-to-focus + AT),
//   2. a visible + screen-reader required/optional state,
//   3. a hint region wired via aria-describedby,
//   4. inline validation: aria-invalid + an error region wired via
//      aria-describedby and announced with role="alert".
//
// The control itself is supplied through a render prop so any input — a plain
// <input>, a themed <select>, EmailInput, PhoneInput — receives the exact same
// id/name/aria wiring. Ids are derived from React's useId(), so two forms with a
// "email" field on one page never collide.

import { useId, type ReactNode } from "react";
import { cx, fieldErrorClass, fieldHintClass, fieldLabelClass } from "./styles";

/** The wiring a control must spread onto itself to satisfy the contract. */
export type FieldControlProps = {
  id: string;
  name: string;
  required: boolean;
  "aria-required": true | undefined;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
};

export type FormFieldProps = {
  /** Form field name — becomes the control's `name` and seeds its id. */
  name: string;
  /** Visible label text. */
  label: ReactNode;
  required?: boolean;
  /** Show an "(optional)" marker. Ignored when `required`. */
  optional?: boolean;
  /** Persistent helper text beneath the control. */
  hint?: ReactNode;
  /** Inline validation message. Presence flips the control to the invalid state. */
  error?: ReactNode;
  /** Renders the control with the required id/name/aria props spread in. */
  children: (control: FieldControlProps) => ReactNode;
  className?: string;
};

export function FormField({
  name,
  label,
  required = false,
  optional = false,
  hint,
  error,
  children,
  className,
}: FormFieldProps) {
  const uid = useId();
  const id = `${uid}-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={id} className={fieldLabelClass}>
        <span>{label}</span>
        {required ? (
          <>
            <span aria-hidden="true" className="ml-0.5 text-[var(--dpf-error)]">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        ) : optional ? (
          <span className="ml-1 font-normal text-[var(--dpf-muted)]">(optional)</span>
        ) : null}
      </label>

      {children({
        id,
        name,
        required,
        "aria-required": required || undefined,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}

      {hint ? (
        <p id={hintId} className={fieldHintClass}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className={fieldErrorClass}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
