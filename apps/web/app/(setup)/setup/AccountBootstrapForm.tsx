"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createOrganization, createOwnerAccount } from "@/lib/actions/setup-entities";
import { advanceStep } from "@/lib/actions/setup-progress";

type Props = {
  setupId: string;
};

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

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      try {
        // 1. Create organization
        await createOrganization(setupId, { orgName });

        // 2. Create owner account
        const result = await createOwnerAccount(setupId, {
          name: orgName,
          email,
          password,
        });

        // 3. Advance past bootstrap step
        await advanceStep(setupId, { orgName });

        // 4. Sign in (client-side) and redirect to portal
        // The signIn import depends on the auth setup — using fetch for portability
        const signInRes = await fetch("/api/auth/callback/workforce", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            email,
            password,
            csrfToken: await getCsrfToken(),
          }),
          redirect: "manual",
        });

        // Redirect to the first real portal route (AI providers)
        router.push("/platform/ai/providers");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--dpf-bg)]">
      <div className="w-full max-w-md p-8 rounded-xl bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] shadow-lg">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--dpf-text)]">Welcome to your platform</h1>
          <p className="mt-2 text-sm text-[var(--dpf-muted)]">
            Let&apos;s create your organization and admin account. After this, your AI operations officer will show you around the portal.
          </p>
        </div>

        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-[var(--dpf-text)] mb-1">
              Organization Name
            </label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="e.g., Riverside Medical Group"
              className="w-full rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--dpf-text)] mb-1">
              Your Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--dpf-text)] mb-1">
              Password (8+ characters)
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg"
            />
          </div>

          {error && (
            <p className="text-sm text-[#ef4444]">{error}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={!canSubmit || isPending}
            className="w-full py-3 text-sm font-medium text-white bg-[var(--dpf-accent)] rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? "Setting up..." : "Get Started"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Fetch CSRF token from NextAuth for the sign-in POST. */
async function getCsrfToken(): Promise<string> {
  const res = await fetch("/api/auth/csrf");
  const data = await res.json();
  return data.csrfToken ?? "";
}
