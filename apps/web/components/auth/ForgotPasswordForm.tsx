"use client";

import { useState, useTransition } from "react";

import { requestPasswordReset } from "@/lib/actions/users";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await requestPasswordReset({ email });
      setMessage(result.message);
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--dpf-muted)]">
        If an account exists for that email, recovery instructions will be sent or issued locally.
      </p>
      <label className="block">
        <span className="block text-sm text-[var(--dpf-muted)] mb-1">Email</span>
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          name="email"
          type="email"
          required
          className="w-full px-3 py-2 rounded-lg bg-[var(--dpf-bg)] border border-[var(--dpf-border)] text-[var(--dpf-text)] text-sm focus:outline-none focus:border-[var(--dpf-accent)]"
        />
      </label>
      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        className="w-full py-2 rounded-lg bg-[var(--dpf-accent)] text-white font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-70"
      >
        {isPending ? "Submitting..." : "Send recovery instructions"}
      </button>
      <p className="text-sm text-[var(--dpf-muted)]">
        {message ?? "If an account exists, check your email or contact an administrator for recovery assistance."}
      </p>
    </div>
  );
}
