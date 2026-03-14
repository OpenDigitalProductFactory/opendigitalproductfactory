"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateUserLifecycle, type UserActionResult } from "@/lib/actions/users";

type RoleOption = {
  roleId: string;
  name: string;
};

type UserRow = {
  id: string;
  email: string;
  isActive: boolean;
  isSuperuser: boolean;
  roleId: string | null;
};

type Props = {
  users: UserRow[];
  roles: RoleOption[];
};

export function HrUserLifecyclePanel({ users, roles }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<UserActionResult | null>(null);

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.email.localeCompare(b.email)),
    [users],
  );

  const [selectedUserId, setSelectedUserId] = useState(sortedUsers[0]?.id ?? "");
  const selectedUser = sortedUsers.find((user) => user.id === selectedUserId) ?? null;
  const [roleId, setRoleId] = useState(selectedUser?.roleId ?? roles[0]?.roleId ?? "HR-100");
  const [isActive, setIsActive] = useState(selectedUser?.isActive ?? true);

  function syncFromSelected(nextUserId: string) {
    setSelectedUserId(nextUserId);
    const next = sortedUsers.find((user) => user.id === nextUserId);
    setRoleId(next?.roleId ?? roles[0]?.roleId ?? "HR-100");
    setIsActive(next?.isActive ?? true);
  }

  function save() {
    startTransition(async () => {
      if (!selectedUserId) {
        setResult({ ok: false, message: "Select a user first." });
        return;
      }
      const response = await updateUserLifecycle({
        userId: selectedUserId,
        roleId,
        isActive,
      });
      setResult(response);
      if (response.ok) router.refresh();
    });
  }

  return (
    <div className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">HR user lifecycle</h2>
        <p className="text-xs text-[var(--dpf-muted)] mt-1">Manage role assignment and active/inactive state. Password setup/reset stays in Admin.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest">User</span>
          <select
            value={selectedUserId}
            onChange={(e) => syncFromSelected(e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-2 text-sm text-white"
          >
            {sortedUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.email}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest">Role</span>
          <select
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-2 text-sm text-white"
          >
            {roles.map((role) => (
              <option key={role.roleId} value={role.roleId}>
                {role.roleId} - {role.name}
              </option>
            ))}
          </select>
        </label>

        <label className="inline-flex items-center gap-2 text-xs text-[var(--dpf-muted)] self-end md:pb-2">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]"
          />
          Active user
        </label>
      </div>

      {selectedUser?.isSuperuser && (
        <p className="text-xs text-amber-400">Selected user is a superuser. Only superusers can change superuser accounts.</p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
        >
          {isPending ? "Saving..." : "Save HR changes"}
        </button>
        <p className={`text-xs ${result ? (result.ok ? "text-green-400" : "text-red-400") : "text-[var(--dpf-muted)]"}`}>
          {result?.message ?? "Typical HR functions: role movement, onboarding activation, offboarding deactivation."}
        </p>
      </div>
    </div>
  );
}
