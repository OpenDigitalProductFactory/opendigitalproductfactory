"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateUserLifecycle, type UserActionResult } from "@/lib/actions/users";
import {
  SelectField,
  CheckboxField,
  SubmitButton,
  FormStatus,
  ConsequenceNotice,
} from "@/components/ui/form";

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

  // A deactivation (was active, now unticked) is the offboarding path — surface
  // it as a danger-toned consequence so it is never a silent side effect.
  const deactivating = (selectedUser?.isActive ?? true) && !isActive;

  function syncFromSelected(nextUserId: string) {
    setSelectedUserId(nextUserId);
    const next = sortedUsers.find((user) => user.id === nextUserId);
    setRoleId(next?.roleId ?? roles[0]?.roleId ?? "HR-100");
    setIsActive(next?.isActive ?? true);
    setResult(null);
  }

  function save() {
    startTransition(async () => {
      if (!selectedUserId) {
        setResult({ ok: false, message: "Select a user first." });
        return;
      }
      const response = await updateUserLifecycle({ userId: selectedUserId, roleId, isActive });
      setResult(response);
      if (response.ok) router.refresh();
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      noValidate
      className="space-y-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
    >
      <div>
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">HR user lifecycle</h2>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          Manage role assignment and active/inactive state. Password setup/reset stays in Admin.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SelectField
          name="lifecycle-user"
          label="User"
          value={selectedUserId}
          onValueChange={syncFromSelected}
          options={sortedUsers.map((user) => ({ value: user.id, label: user.email }))}
        />
        <SelectField
          name="lifecycle-role"
          label="Role"
          value={roleId}
          onValueChange={setRoleId}
          options={roles.map((role) => ({ value: role.roleId, label: `${role.roleId} - ${role.name}` }))}
        />
        <div className="self-end md:pb-1">
          <CheckboxField
            name="lifecycle-active"
            label="Active user"
            checked={isActive}
            onCheckedChange={setIsActive}
          />
        </div>
      </div>

      {selectedUser?.isSuperuser && (
        <p className="text-xs text-[var(--dpf-warning)]">
          Selected user is a superuser. Only superusers can change superuser accounts.
        </p>
      )}

      <ConsequenceNotice
        tone={deactivating ? "danger" : "info"}
        defaultOpen={deactivating}
        summary={
          deactivating
            ? "Deactivating this user removes their access."
            : "This updates the user's role and active state."
        }
        what={
          deactivating
            ? "The account is marked inactive — they can no longer sign in — and their role is set to the value above."
            : "Sets the selected role and keeps the account active. No password or email changes happen here."
        }
        who={selectedUser ? selectedUser.email : "The selected user."}
        reversibility="Reversible — re-tick Active user (and reselect a role) and save again to restore access."
        recovery="Locked someone out by mistake? Reactivate them here; password issues are handled under Admin → Access setup."
      />

      <div className="flex items-center gap-3">
        <SubmitButton pending={isPending} pendingLabel="Saving…">
          Save HR changes
        </SubmitButton>
        <FormStatus
          error={result && !result.ok ? result.message : null}
          success={result?.ok ? result.message : null}
        />
      </div>
    </form>
  );
}
