import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

type Props = {
  searchParams?: Promise<{
    token?: string;
  }>;
};

export default async function ResetPasswordPage({ searchParams }: Props) {
  const params = await searchParams;
  const token = params?.token ?? "";

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--dpf-bg)]">
      <div className="w-full max-w-sm p-8 bg-[var(--dpf-surface-1)] rounded-xl border border-[var(--dpf-border)]">
        <h1 className="text-xl font-bold text-[var(--dpf-text)] mb-3">Reset password</h1>
        <ResetPasswordForm token={token} />
      </div>
    </div>
  );
}
