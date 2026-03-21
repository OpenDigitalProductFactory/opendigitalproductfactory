import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--dpf-bg)]">
      <div className="w-full max-w-sm p-8 bg-[var(--dpf-surface-1)] rounded-xl border border-[var(--dpf-border)]">
        <h1 className="text-xl font-bold text-[var(--dpf-text)] mb-3">Forgot password</h1>
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
