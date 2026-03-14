import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

type Props = {
  searchParams?: {
    token?: string;
  };
};

export default function ResetPasswordPage({ searchParams }: Props) {
  const token = searchParams?.token ?? "";

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--dpf-bg)]">
      <div className="w-full max-w-sm p-8 bg-[var(--dpf-surface-1)] rounded-xl border border-[var(--dpf-border)]">
        <h1 className="text-xl font-bold text-white mb-3">Reset password</h1>
        <ResetPasswordForm token={token} />
      </div>
    </div>
  );
}
