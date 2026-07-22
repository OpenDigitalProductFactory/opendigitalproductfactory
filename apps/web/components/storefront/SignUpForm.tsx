"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import {
  TextField,
  EmailField,
  SubmitButton,
  FormStatus,
} from "@/components/ui/form";

export function SignUpForm({
  orgSlug,
  prefillEmail,
}: {
  orgSlug: string;
  prefillEmail?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(prefillEmail ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Inline field-level validation: surface the mismatch on the confirm field
  // itself (aria-invalid + described error) rather than only a form-level banner.
  const mismatch =
    confirmPassword.length > 0 && password !== confirmPassword
      ? "Passwords do not match."
      : undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/storefront/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, orgSlug }),
    });

    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "Sign-up failed. Please try again.");
      setLoading(false);
      return;
    }

    // Sign in immediately after successful registration
    const result = await signIn("customer", { email, password, redirect: false });
    if (result?.error) {
      setError("Account created but sign-in failed. Please sign in manually.");
      setLoading(false);
      return;
    }

    router.push("/portal");
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-[360px] flex-col gap-4" noValidate>
      <FormStatus error={error} />
      <TextField
        name="name"
        label="Full name"
        value={name}
        onValueChange={setName}
        required
        autoComplete="name"
        placeholder="Your name"
      />
      <EmailField
        name="email"
        label="Email address"
        value={email}
        onValueChange={setEmail}
        required
        autoComplete="email"
      />
      <TextField
        name="password"
        label="Password"
        type="password"
        value={password}
        onValueChange={setPassword}
        required
        autoComplete="new-password"
        hint="At least 12 characters."
      />
      <TextField
        name="confirm-password"
        label="Confirm password"
        type="password"
        value={confirmPassword}
        onValueChange={setConfirmPassword}
        required
        autoComplete="new-password"
        error={mismatch}
      />
      <SubmitButton pending={loading} pendingLabel="Creating account…" disabled={!!mismatch}>
        Create account
      </SubmitButton>
      <p className="text-center text-sm text-[var(--dpf-muted)]">
        Already have an account?{" "}
        <a href={`/s/${orgSlug}/sign-in`} className="font-medium text-[var(--dpf-accent)]">
          Sign in
        </a>
      </p>
    </form>
  );
}
