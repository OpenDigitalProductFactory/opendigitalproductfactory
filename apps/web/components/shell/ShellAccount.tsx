"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ShellSignOut } from "./ShellSignOut";
import { SHELL_TAP_TARGET_CLASS } from "@/lib/shell/shell-action-contract";
import { useT } from "@/lib/i18n/use-t";
import { Surface } from "@/components/ui/Surface";

type Props = {
  displayName: string;
  email: string;
  roleName: string | null;
  organizationName: string | null;
  isSuperuser?: boolean;
  children?: ReactNode;
};

export function ShellAccount({ displayName, email, roleName, organizationName, isSuperuser = false, children }: Props) {
  const t = useT("shell");
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const name = displayName.trim() || email;
  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      const details = detailsRef.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false;
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  return (
    <details ref={detailsRef} className="relative min-w-0" onKeyDown={(event) => {
      if (event.key === "Escape" && detailsRef.current?.open) {
        detailsRef.current.open = false;
        detailsRef.current.querySelector("summary")?.focus();
      }
    }}>
      <summary aria-label={t("account.trigger", { name })} title={name}
        className={`${SHELL_TAP_TARGET_CLASS} flex max-w-[120px] cursor-pointer items-center gap-1 rounded-full border border-[var(--dpf-border)] px-3 text-xs text-[var(--dpf-text)] sm:max-w-[200px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)]`}>
        <span className="truncate">{name}</span>
        <span aria-hidden="true" className="shrink-0 text-[var(--dpf-muted)]">⌄</span>
      </summary>
      <Surface as="section" rounded="xl" aria-label={t("account.heading")} className="absolute end-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] text-sm text-[var(--dpf-text)] shadow-lg">
        <p className="text-xs text-[var(--dpf-muted)]">{t("account.signedInAs")}</p>
        <p className="mt-1 break-words font-semibold">{name}</p>
        <p className="break-all text-xs text-[var(--dpf-muted)]">{email}</p>
        <dl className="my-3 space-y-2">
          <div><dt className="text-xs text-[var(--dpf-muted)]">{t("account.role")}</dt><dd className="break-words">{isSuperuser ? t("account.superuser") : roleName ?? t("account.noRole")}</dd></div>
          <div><dt className="text-xs text-[var(--dpf-muted)]">{t("account.organization")}</dt><dd className="break-words">{organizationName ?? t("account.organizationUnavailable")}</dd></div>
        </dl>
        <div className="flex flex-col gap-2">
          {children}
          <ShellSignOut />
        </div>
      </Surface>
    </details>
  );
}
