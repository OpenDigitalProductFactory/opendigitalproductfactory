"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { EmailField, TextField, SubmitButton, FormStatus } from "@/components/ui/form";
import { sanitizeStorefrontReturnTo } from "@/lib/storefront/return-to";

export function SignInForm({
  orgSlug,
  returnTo,
}: {
  orgSlug?: string;
  /**
   * Where to send the customer after a successful sign-in — captured from the
   * booking/inquiry/order route they were on (BI-CC4BEB5F). Validated against
   * open-redirect before use; an absent or unsafe value falls back to the
   * storefront home (or `/portal` when this form isn't storefront-scoped).
   */
  returnTo?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const safeReturnTo = sanitizeStorefrontReturnTo(returnTo, orgSlug);
  // A customer who signed in FROM this business's storefront belongs back on
  // that storefront (or the exact page they came from) — never the internal
  // /portal, which is a different, non-customer-safe destination.
  const successDestination = safeReturnTo ?? (orgSlug ? `/s/${orgSlug}` : "/portal");
  const signUpHref = orgSlug
    ? `/s/${orgSlug}/sign-up${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`
    : "/portal/sign-up";

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
    router.push(successDestination);
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
        <a
          href="/forgot-password"
          className="self-end text-xs font-medium text-[var(--dpf-accent)]"
          style={{ marginTop: -8 }}
        >
          Forgot password?
        </a>
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
            onClick={() => signIn("google", { callbackUrl: successDestination })}
            className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-5 py-2.5 text-sm text-[var(--dpf-text)]"
          >
            Continue with Google
          </button>
          <button
            type="button"
            onClick={() => signIn("apple", { callbackUrl: successDestination })}
            className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-5 py-2.5 text-sm text-[var(--dpf-text)]"
          >
            Continue with Apple
          </button>
        </div>
      )}

      <div className="text-center text-xs text-[var(--dpf-muted)]">
        <a href={signUpHref} className="font-medium text-[var(--dpf-accent)]">
          Create an account
        </a>
      </div>

      {/* Staff login is not part of the customer journey — demoted below the
          fold, small, and visually separated so it never reads as a peer
          option to "Create an account" (BI-CC4BEB5F). */}
      <div className="text-center text-[11px] text-[var(--dpf-muted)] opacity-60">
        Staff member?{" "}
        <a href="/login" className="underline">
          Sign in here
        </a>
      </div>
    </div>
  );
}
