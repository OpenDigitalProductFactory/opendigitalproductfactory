"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

export const FIRST_RUN_PENDING_RECOVERY_DELAY_MS = 10_000;

export function AccountBootstrapSubmitButton() {
  const { pending } = useFormStatus();
  const [showRecovery, setShowRecovery] = useState(false);

  useEffect(() => {
    if (!pending) {
      setShowRecovery(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      setShowRecovery(true);
    }, FIRST_RUN_PENDING_RECOVERY_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [pending]);

  return (
    <div className="space-y-3">
      <button
        type="submit"
        disabled={pending}
        className="w-full py-3 text-sm font-medium text-white bg-[var(--dpf-accent)] rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? "Setting up..." : "Get Started"}
      </button>
      {showRecovery ? (
        <a
          href="/setup"
          className="block text-center text-sm font-medium text-[var(--dpf-accent)] hover:opacity-90"
        >
          Continue
        </a>
      ) : null}
    </div>
  );
}
