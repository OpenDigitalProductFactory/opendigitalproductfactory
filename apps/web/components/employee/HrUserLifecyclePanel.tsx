"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addUserPlatformRole, updateUserLifecycle, type UserActionResult } from "@/lib/actions/users";
import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n/use-t";
import { InlineBusy } from "@/components/ui/InlineBusy";
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
  roleIds: string[];
};

type Props = {
  users: UserRow[];
  roles: RoleOption[];
  canAddRole: boolean;
};

export function HrUserLifecyclePanel({ users, roles, canAddRole }: Props) {
  const router = useRouter();
  const t = useT("admin");
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<UserActionResult | null>(null);
  const [pendingAction, setPendingAction] = useState<"add" | "replace">("replace");

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.email.localeCompare(b.email)),
    [users],
  );

  const [selectedUserId, setSelectedUserId] = useState(sortedUsers[0]?.id ?? "");
  const selectedUser = sortedUsers.find((user) => user.id === selectedUserId) ?? null;
  const [roleId, setRoleId] = useState(selectedUser?.roleIds[0] ?? roles[0]?.roleId ?? "");
  const [isActive, setIsActive] = useState(selectedUser?.isActive ?? true);
  const alreadyHeld = selectedUser?.roleIds.includes(roleId);

  // A deactivation (was active, now unticked) is the offboarding path — surface
  // it as a danger-toned consequence so it is never a silent side effect.
  const deactivating = (selectedUser?.isActive ?? true) && !isActive;

  function syncFromSelected(nextUserId: string) {
    setSelectedUserId(nextUserId);
    const next = sortedUsers.find((user) => user.id === nextUserId);
    setRoleId(next?.roleIds[0] ?? roles[0]?.roleId ?? "");
    setIsActive(next?.isActive ?? true);
    setResult(null);
  }

  function save() {
    if (isPending) return;
    setPendingAction("replace");
    startTransition(async () => {
      if (!selectedUserId) {
        setResult({ ok: false, message: t("userLifecycle.selectUser") });
        return;
      }
      const response = await updateUserLifecycle({ userId: selectedUserId, roleId, isActive });
      setResult(response);
      if (response.ok) router.refresh();
    });
  }

  function addRole() {
    if (isPending || !canAddRole || !selectedUserId || !roleId || alreadyHeld) return;
    setPendingAction("add");
    setResult(null);
    startTransition(async () => {
      const response = await addUserPlatformRole({ userId: selectedUserId, roleId });
      setResult({ ok: response.ok, message: response.ok ? response.data.message : response.error });
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
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">{t("userLifecycle.heading")}</h2>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          {t("userLifecycle.description")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SelectField
          name="lifecycle-user"
          label={t("userLifecycle.userLabel")}
          value={selectedUserId}
          onValueChange={syncFromSelected}
          options={sortedUsers.map((user) => ({ value: user.id, label: user.email }))}
        />
        <SelectField
          name="lifecycle-role"
          label={t("userLifecycle.roleLabel")}
          value={roleId}
          onValueChange={setRoleId}
          options={roles.map((role) => ({ value: role.roleId, label: `${role.roleId} - ${role.name}` }))}
        />
        <div className="self-end md:pb-1">
          <CheckboxField
            name="lifecycle-active"
            label={t("userLifecycle.activeLabel")}
            checked={isActive}
            onCheckedChange={setIsActive}
          />
        </div>
      </div>

      {selectedUser?.isSuperuser && (
        <p className="text-xs text-[var(--dpf-warning)]">
          {t("userLifecycle.superuserNotice")}
        </p>
      )}

      {selectedUser && (
        <p className="text-xs text-[var(--dpf-muted)]">
          {t("userLifecycle.currentRoles", { roles: selectedUser.roleIds.join(", ") || t("userLifecycle.noRoles") })}
        </p>
      )}
      {canAddRole && (
        <p className="text-xs text-[var(--dpf-muted)]">
          {t("userLifecycle.addNotice")}
        </p>
      )}

      <ConsequenceNotice
        tone={deactivating ? "danger" : "info"}
        defaultOpen={deactivating}
        summary={
          deactivating
            ? t("userLifecycle.deactivateSummary")
            : t("userLifecycle.replaceSummary")
        }
        what={
          deactivating
            ? t("userLifecycle.deactivateEffect")
            : t("userLifecycle.replaceEffect")
        }
        who={selectedUser ? selectedUser.email : t("userLifecycle.selectedUser")}
        reversibility={t("userLifecycle.reversibility")}
        recovery={t("userLifecycle.recovery")}
      />

      <div className="flex flex-wrap items-center gap-3">
        {canAddRole && (
          <Button variant="secondary" onClick={addRole} disabled={isPending || !selectedUser || !roleId || alreadyHeld}>
            {isPending && pendingAction === "add" ? <InlineBusy label={t("userLifecycle.addPending")} /> : t("userLifecycle.addLabel")}
          </Button>
        )}
        <SubmitButton pending={isPending && pendingAction === "replace"} disabled={isPending} pendingLabel={t("userLifecycle.savePending")}>
          {t("userLifecycle.saveLabel")}
        </SubmitButton>
        <FormStatus
          error={result && !result.ok ? result.message : null}
          success={result?.ok ? result.message : null}
        />
      </div>
    </form>
  );
}
