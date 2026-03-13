"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminResetUserPassword, createUserAccount, type UserActionResult } from "@/lib/actions/users";

type RoleOption = {
  roleId: string;
  name: string;
};

type UserOption = {
  id: string;
  email: string;
};

type Props = {
  roles: RoleOption[];
  users: UserOption[];
};

function resultClasses(result: UserActionResult | null): string {
  if (!result) return "text-[var(--dpf-muted)]";
  return result.ok ? "text-green-400" : "text-red-400";
}

export function AdminUserAccessPanel({ roles, users }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [createResult, setCreateResult] = useState<UserActionResult | null>(null);
  const [resetResult, setResetResult] = useState<UserActionResult | null>(null);

  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRoleId, setCreateRoleId] = useState(roles[0]?.roleId ?? "HR-100");
  const [createSuperuser, setCreateSuperuser] = useState(false);

  const [resetUserId, setResetUserId] = useState(users[0]?.id ?? "");
  const [resetPassword, setResetPassword] = useState("");

  function onCreate() {
    startTransition(async () => {
      const result = await createUserAccount({
        email: createEmail,
        password: createPassword,
        roleId: createRoleId,
        isSuperuser: createSuperuser,
      });
      setCreateResult(result);
      if (result.ok) {
        setCreateEmail("");
        setCreatePassword("");
        setCreateSuperuser(false);
        router.refresh();
      }
    });
  }

  function onReset() {
    startTransition(async () => {
      if (!resetUserId) {
        setResetResult({ ok: false, message: "Select a user to reset password." });
        return;
      }
      const result = await adminResetUserPassword({
        userId: resetUserId,
        newPassword: resetPassword,
      });
      setResetResult(result);
      if (result.ok) {
        setResetPassword("");
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-4 space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-white">Access setup (Admin)</h3>
        <p className="text-xs text-[var(--dpf-muted)] mt-1">Create user credentials and perform password resets.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
          <h4 className="text-xs font-semibold text-white uppercase tracking-wider">Create user</h4>
          <label className="block">
            <span className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest">Email</span>
            <input
              value={createEmail}
              onChange={(e) => setCreateEmail(e.target.value)}
              type="email"
              className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2.5 py-2 text-sm text-white"
              placeholder="person@company.com"
            />
          </label>
          <label className="block">
            <span className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest">Temporary password</span>
            <input
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              type="password"
              className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2.5 py-2 text-sm text-white"
              placeholder="12+ chars, upper/lower/number/symbol"
            />
          </label>
          <label className="block">
            <span className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest">Primary role</span>
            <select
              value={createRoleId}
              onChange={(e) => setCreateRoleId(e.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2.5 py-2 text-sm text-white"
            >
              {roles.map((role) => (
                <option key={role.roleId} value={role.roleId}>
                  {role.roleId} - {role.name}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-[var(--dpf-muted)]">
            <input
              type="checkbox"
              checked={createSuperuser}
              onChange={(e) => setCreateSuperuser(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
            />
            Superuser
          </label>
          <button
            type="button"
            disabled={isPending}
            onClick={onCreate}
            className="rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {isPending ? "Saving..." : "Create user"}
          </button>
          <p className={`text-xs ${resultClasses(createResult)}`}>
            {createResult?.message ?? "Password policy: min 12 chars with upper/lower/number/symbol."}
          </p>
        </div>

        <div className="space-y-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
          <h4 className="text-xs font-semibold text-white uppercase tracking-wider">Password reset</h4>
          <label className="block">
            <span className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest">User</span>
            <select
              value={resetUserId}
              onChange={(e) => setResetUserId(e.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2.5 py-2 text-sm text-white"
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.email}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest">New password</span>
            <input
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              type="password"
              className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2.5 py-2 text-sm text-white"
              placeholder="Set temporary reset password"
            />
          </label>
          <button
            type="button"
            disabled={isPending}
            onClick={onReset}
            className="rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {isPending ? "Saving..." : "Reset password"}
          </button>
          <p className={`text-xs ${resultClasses(resetResult)}`}>
            {resetResult?.message ?? "Use strong temporary passwords and rotate them after first sign-in."}
          </p>
        </div>
      </div>
    </div>
  );
}
