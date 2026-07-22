"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adminIssuePasswordReset,
  createUserAccount,
  type PasswordResetIssueResult,
  type UserActionResult,
} from "@/lib/actions/users";
import {
  EmailField,
  TextField,
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

type UserOption = {
  id: string;
  email: string;
};

type Props = {
  roles: RoleOption[];
  users: UserOption[];
};

export function AdminUserAccessPanel({ roles, users }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [createResult, setCreateResult] = useState<UserActionResult | null>(null);
  const [resetResult, setResetResult] = useState<PasswordResetIssueResult | null>(null);

  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRoleId, setCreateRoleId] = useState(roles[0]?.roleId ?? "HR-100");
  const [createSuperuser, setCreateSuperuser] = useState(false);

  const [resetUserId, setResetUserId] = useState(users[0]?.id ?? "");

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
      const result = await adminIssuePasswordReset({ userId: resetUserId });
      setResetResult(result);
      if (result.ok) {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Access setup (Admin)</h3>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          Create user credentials and perform password resets.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Create user */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onCreate();
          }}
          noValidate
          className="space-y-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
        >
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--dpf-text)]">
            Create user
          </h4>

          <ConsequenceNotice
            tone={createSuperuser ? "danger" : "info"}
            summary="This creates a new sign-in and grants portal access."
            what={
              createSuperuser
                ? "Adds an account with the temporary password and role you set. Superuser is ticked — this person will be able to control everything, including other admins."
                : "Adds an account with the temporary password and role you set. They can sign in right away and are prompted to change the password."
            }
            who="The person at the email address you enter. No one else is notified automatically."
            reversibility="Reversible — deactivate the account or change its role anytime from Employee → HR."
            recovery="Wrong details? Deactivate the user under Employee → HR, or issue a password reset on the right."
          />

          <EmailField
            name="new-user-email"
            label="Email"
            value={createEmail}
            onValueChange={setCreateEmail}
            required
            autoComplete="off"
            placeholder="person@company.com"
          />
          <TextField
            name="temporary-password"
            label="Temporary password"
            type="password"
            value={createPassword}
            onValueChange={setCreatePassword}
            required
            autoComplete="new-password"
            hint="Min 12 characters with upper/lower/number/symbol. The user changes it on first sign-in."
          />
          <SelectField
            name="primary-role"
            label="Primary role"
            value={createRoleId}
            onValueChange={setCreateRoleId}
            required
            options={roles.map((role) => ({ value: role.roleId, label: `${role.roleId} - ${role.name}` }))}
          />
          <CheckboxField
            name="superuser"
            label="Superuser"
            checked={createSuperuser}
            onCheckedChange={setCreateSuperuser}
            hint="Full control of the platform, including other admin accounts. Grant only when necessary."
          />
          <SubmitButton pending={isPending} pendingLabel="Creating…">
            Create user
          </SubmitButton>
          <FormStatus
            error={createResult && !createResult.ok ? createResult.message : null}
            success={createResult?.ok ? createResult.message : null}
          />
        </form>

        {/* Password reset */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onReset();
          }}
          noValidate
          className="space-y-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
        >
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--dpf-text)]">
            Password reset
          </h4>

          <ConsequenceNotice
            tone="warning"
            summary="This ends the user's current password and issues a recovery link."
            what="Their existing password stops working immediately. A one-time recovery link (or email, when configured) lets them set a new one."
            who="The user you select below. They'll need the link to get back in."
            reversibility="Partly — the old password can't be restored, but you can re-issue a new recovery link anytime."
            recovery="If the email doesn't arrive, use the manual recovery link shown here after you issue it."
          />

          <SelectField
            name="reset-user"
            label="User"
            value={resetUserId}
            onValueChange={setResetUserId}
            options={users.map((user) => ({ value: user.id, label: user.email }))}
          />
          <SubmitButton pending={isPending} pendingLabel="Issuing…">
            Issue recovery
          </SubmitButton>
          {resetResult?.recoveryLink ? (
            <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2">
              <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
                Manual recovery link
              </span>
              <p className="mt-1 break-all text-xs text-[var(--dpf-text)]">{resetResult.recoveryLink}</p>
            </div>
          ) : null}
          <FormStatus
            error={resetResult && !resetResult.ok ? resetResult.message : null}
            success={resetResult?.ok ? resetResult.message : null}
          />
        </form>
      </div>
    </div>
  );
}
