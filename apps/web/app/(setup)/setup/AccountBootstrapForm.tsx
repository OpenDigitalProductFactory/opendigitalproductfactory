"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { createOrganization, createOwnerAccount } from "@/lib/actions/setup-entities";
import { advanceStep } from "@/lib/actions/setup-progress";

type Props = {
  setupId: string;
};

const NEXT_SETUP_ROUTE = "/platform/ai/providers";

/**
 * Minimal account bootstrap — the ONE custom form in onboarding.
 *
 * Collects org name + owner credentials, creates both records,
 * then redirects into the real portal where the setup overlay
 * and COO coworker panel take over.
 */
export function AccountBootstrapForm({ setupId }: Props) {
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const canSubmit =
    orgName.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 8;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        // 1. Create organization
        await createOrganization(setupId, { orgName });

        // 2. Create owner account
        await createOwnerAccount(setupId, {
          name: orgName,
          email,
          password,
        });

        // 3. Advance past bootstrap step
        await advanceStep(setupId, { orgName });

        // 4. Sign in client-side and redirect to the first real portal route.
        const signInResult = await signIn("workforce", {
          email,
          password,
          redirect: false,
          redirectTo: NEXT_SETUP_ROUTE,
        });
        if (signInResult?.error) {
          throw new Error("Account created, but sign-in failed. Try signing in from the login page.");
        }

        router.replace(NEXT_SETUP_ROUTE);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--dpf-bg)]">
      <div className="w-full max-w-md rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-8 shadow-lg">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--dpf-text)]">Welcome to your platform</h1>
          <p className="mt-2 text-sm text-[var(--dpf-muted)]">
            Let&apos;s create your organization and admin account. After this, your AI operations officer will show you around the portal.
          </p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium text-[var(--dpf-text)] mb-1" htmlFor="first-run-org-name">
              Organization Name
            </label>
            <input
              id="first-run-org-name"
              name="organizationName"
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="e.g., Digital Product Factory"
              autoComplete="organization"
              className="w-full rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--dpf-text)] mb-1" htmlFor="first-run-owner-email">
              Your Email
            </label>
            <input
              id="first-run-owner-email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--dpf-text)] mb-1" htmlFor="first-run-owner-password">
              Password (8+ characters)
            </label>
            <input
              id="first-run-owner-password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-lg"
            />
          </div>

          {error && (
            <p className="text-sm text-[var(--dpf-error)]">{error}</p>
          )}

          <button
            type="submit"
            disabled={!canSubmit || isPending}
            className="w-full py-3 text-sm font-medium text-white bg-[var(--dpf-accent)] rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? "Setting up..." : "Get Started"}
          </button>
        </form>
      </div>
    </div>
  );
}
