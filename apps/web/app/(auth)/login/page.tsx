// apps/web/app/(auth)/login/page.tsx
import { signIn } from "@/lib/auth";

type Props = {
  searchParams: Promise<{ reset?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const { reset } = await searchParams;
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--dpf-bg)]">
      <div className="w-full max-w-sm p-8 bg-[var(--dpf-surface-1)] rounded-xl border border-[var(--dpf-border)]">
        <h1 className="text-xl font-bold text-white mb-6">Digital Product Factory</h1>
        {reset === "success" ? (
          <p className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            Password updated. Sign in with your new password.
          </p>
        ) : null}
        <form
          action={async (formData: FormData) => {
            "use server";
            await signIn("workforce", {
              email: formData.get("email"),
              password: formData.get("password"),
              redirectTo: "/workspace",
            });
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm text-[var(--dpf-muted)] mb-1" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="w-full px-3 py-2 rounded-lg bg-[var(--dpf-bg)] border border-[var(--dpf-border)] text-white text-sm focus:outline-none focus:border-[var(--dpf-accent)]"
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
              className="w-full px-3 py-2 rounded-lg bg-[var(--dpf-bg)] border border-[var(--dpf-border)] text-white text-sm focus:outline-none focus:border-[var(--dpf-accent)]"
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
        <div className="mt-4 text-center">
          <a href="/customer-login" className="text-xs text-[var(--dpf-muted)] hover:text-white transition-colors">
            Customer portal login →
          </a>
        </div>
      </div>
    </div>
  );
}
