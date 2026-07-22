"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { EmailField, TextField, SubmitButton, FormStatus } from "@/components/ui/form";

export function SignInForm({ orgSlug }: { orgSlug?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await signIn("customer", { email, password, redirect: false });
    if (result?.error) {
      setError("Email or password not recognised. If you don't have an account, sign up below.");
      setLoading(false);
      return;
    }
    router.push("/portal");
  }

  return (
    <div className="flex max-w-[360px] flex-col gap-5">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <FormStatus error={error} />
        <EmailField
          name="email"
          label="Email address"
          value={email}
          onValueChange={setEmail}
          required
          autoComplete="username"
        />
        <TextField
          name="password"
          label="Password"
          type="password"
          value={password}
          onValueChange={setPassword}
          required
          autoComplete="current-password"
        />
        <SubmitButton pending={loading} pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>

      {/* Social auth — shown only when configured */}
      {process.env.NEXT_PUBLIC_ENABLE_SOCIAL_AUTH === "true" && (
        <div className="flex flex-col gap-2">
          <div className="text-center text-xs text-[var(--dpf-muted)]">or continue with</div>
          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl: "/portal" })}
            className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-5 py-2.5 text-sm text-[var(--dpf-text)]"
          >
            Continue with Google
          </button>
          <button
            type="button"
            onClick={() => signIn("apple", { callbackUrl: "/portal" })}
            className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-5 py-2.5 text-sm text-[var(--dpf-text)]"
          >
            Continue with Apple
          </button>
        </div>
      )}

      <div className="text-center text-xs text-[var(--dpf-muted)]">
        <a
          href={orgSlug ? `/s/${orgSlug}/sign-up` : "/portal/sign-up"}
          className="font-medium text-[var(--dpf-accent)]"
        >
          Create an account
        </a>
        {" · "}
        <a href="/login" className="text-[var(--dpf-muted)]">
          Staff login
        </a>
      </div>
    </div>
  );
}
