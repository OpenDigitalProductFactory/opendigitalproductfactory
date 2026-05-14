import { bootstrapFirstRunOwner } from "@/lib/actions/first-run-account-bootstrap";
import { AccountBootstrapSubmitButton } from "./AccountBootstrapSubmitButton";

type Props = {
  setupId: string;
};

/**
 * Minimal account bootstrap - the one custom form in onboarding.
 *
 * The form posts as a native server action so first-run sign-in follows the
 * same Auth.js redirect path as the normal login page.
 */
export function AccountBootstrapForm({ setupId }: Props) {
  async function submitBootstrap(formData: FormData) {
    "use server";

    await bootstrapFirstRunOwner(setupId, {
      orgName: String(formData.get("organizationName") ?? ""),
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    });
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--dpf-bg)]">
      <div className="w-full max-w-md rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-8 shadow-lg">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--dpf-text)]">Welcome to your platform</h1>
          <p className="mt-2 text-sm text-[var(--dpf-muted)]">
            Let&apos;s create your organization and admin account. After this, your AI operations officer will show you around the portal.
          </p>
        </div>

        <form className="space-y-5" action={submitBootstrap}>
          <div>
            <label className="block text-sm font-medium text-[var(--dpf-text)] mb-1" htmlFor="first-run-org-name">
              Organization Name
            </label>
            <input
              id="first-run-org-name"
              name="organizationName"
              type="text"
              placeholder="e.g., Digital Product Factory"
              autoComplete="organization"
              required
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
              autoComplete="email"
              required
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
              autoComplete="new-password"
              minLength={8}
              required
              className="w-full rounded-lg"
            />
          </div>

          <AccountBootstrapSubmitButton />
        </form>
      </div>
    </div>
  );
}
