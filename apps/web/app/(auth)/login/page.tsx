// apps/web/app/(auth)/login/page.tsx
import { EmailInput } from "@/components/ui/EmailInput";
import { signIn } from "@/lib/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { resolveReturnPath } from "@/lib/auth/safe-return-path";

type Props = {
  searchParams: Promise<{ reset?: string; error?: string; callbackUrl?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const { reset, error, callbackUrl } = await searchParams;
  // Honour where the user was actually headed. Without this, every deep link — an emailed
  // attention link, a shared bill URL, a bookmark — dumps the user on /workspace after
  // sign-in and makes them go looking, which is the cognitive load the attention surface
  // exists to remove (BI-C7D25599). Validated to a same-origin relative path so the
  // parameter cannot become an open redirect.
  const returnPath = resolveReturnPath(callbackUrl);
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--dpf-bg)]">
      <div className="w-full max-w-sm p-8 bg-[var(--dpf-surface-1)] rounded-xl border border-[var(--dpf-border)]">
        <h1 className="text-xl font-bold text-[var(--dpf-text)] mb-6">Digital Product Factory</h1>
        {reset === "success" ? (
          <p className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            Password updated. Sign in with your new password.
          </p>
        ) : null}
        {error === "CredentialsSignin" ? (
          <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            Invalid email or password.
          </p>
        ) : null}
        <form
          action={async (formData: FormData) => {
            "use server";
            try {
              await signIn("workforce", {
                email: formData.get("email"),
                password: formData.get("password"),
                redirectTo: returnPath,
              });
            } catch (err) {
              if (err instanceof AuthError) {
                // Preserve the destination across a failed attempt, or a mistyped password
                // silently discards where the user was going.
                redirect(
                  `/login?error=${err.type}&callbackUrl=${encodeURIComponent(returnPath)}`,
                );
              }
              throw err;
            }
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm text-[var(--dpf-muted)] mb-1" htmlFor="email">
              Email
            </label>
            <EmailInput
              id="email"
              name="email"
              required
              className="w-full px-3 py-2 rounded-lg bg-[var(--dpf-bg)] border border-[var(--dpf-border)] text-[var(--dpf-text)] text-sm focus:outline-none focus:border-[var(--dpf-accent)]"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--dpf-muted)] mb-1" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="w-full px-3 py-2 rounded-lg bg-[var(--dpf-bg)] border border-[var(--dpf-border)] text-[var(--dpf-text)] text-sm focus:outline-none focus:border-[var(--dpf-accent)]"
            />
          </div>
          <button
            type="submit"
            className="w-full py-2 rounded-lg bg-[var(--dpf-accent)] text-white font-semibold text-sm hover:opacity-90 transition-opacity"
          >
            Sign in
          </button>
          <a
            href="/forgot-password"
            className="block text-center text-sm text-[var(--dpf-accent)] hover:opacity-90 transition-opacity"
          >
            Forgot password?
          </a>
        </form>
      </div>
    </div>
  );
}
