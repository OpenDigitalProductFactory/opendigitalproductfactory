"use client";

import { useFormStatus } from "react-dom";

export function AccountBootstrapSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full py-3 text-sm font-medium text-white bg-[var(--dpf-accent)] rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {pending ? "Setting up..." : "Get Started"}
    </button>
  );
}
