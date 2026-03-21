"use client";

import { useState, useTransition } from "react";

import { completePasswordReset } from "@/lib/actions/users";

type Props = {
  token: string;
};

export function ResetPasswordForm({ token }: Props) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await completePasswordReset({
        token,
        newPassword,
        confirmPassword,
      });
      setMessage(result.message);
      if (result.ok && typeof window !== "undefined") {
        window.location.assign("/login?reset=success");
      }
    });
  }

  return (
    <div className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <label className="block">
        <span className="block text-sm text-[var(--dpf-muted)] mb-1">New password</span>
        <input
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          name="newPassword"
          type="password"
          required
          className="w-full px-3 py-2 rounded-lg bg-[var(--dpf-bg)] border border-[var(--dpf-border)] text-[var(--dpf-text)] text-sm focus:outline-none focus:border-[var(--dpf-accent)]"
        />
      </label>
      <label className="block">
        <span className="block text-sm text-[var(--dpf-muted)] mb-1">Confirm password</span>
        <input
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          name="confirmPassword"
          type="password"
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
        {isPending ? "Resetting..." : "Reset password"}
      </button>
      <p className="text-sm text-[var(--dpf-muted)]">
        {message ?? "Use a strong password with upper, lower, number, and symbol characters."}
      </p>
    </div>
  );
}
