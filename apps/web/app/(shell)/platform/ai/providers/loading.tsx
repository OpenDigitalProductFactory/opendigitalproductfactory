"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { Notice, Skeleton } from "@/components/ui/report-kit";
import { useT } from "@/lib/i18n/use-t";

const PROVIDER_LOAD_DELAY_MS = 15_000;

export default function ProvidersLoading() {
  const t = useT("errors");
  const router = useRouter();
  const [delayed, setDelayed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDelayed(true), PROVIDER_LOAD_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [attempt]);

  function refreshProviderLoad() {
    setDelayed(false);
    setAttempt((current) => current + 1);
    router.refresh();
  }

  if (delayed) {
    return (
      <main
        role="status"
        aria-live="polite"
        aria-label={t("providerLoading.status")}
        className="mx-auto max-w-5xl p-4 sm:p-6"
      >
        <section aria-labelledby="provider-load-pending-heading">
          <Notice variant="info" className="p-5 shadow-sm">
            <h1 id="provider-load-pending-heading" className="text-lg font-semibold">
              {t("providerLoading.heading")}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--dpf-muted)]">
              {t("providerLoading.body")}
            </p>
            <Button
              className="mt-4 min-h-11"
              data-dpf-primary-action
              onClick={refreshProviderLoad}
            >
              {t("providerLoading.refresh")}
            </Button>
          </Notice>
        </section>
      </main>
    );
  }

  return (
    <main
      role="status"
      aria-live="polite"
      aria-label={t("providerLoading.status")}
      className="mx-auto max-w-5xl space-y-6 p-4 text-[var(--dpf-text)] sm:p-6"
    >
      <span className="sr-only">{t("providerLoading.status")}</span>
      <header className="space-y-3">
        <Skeleton width={240} height={28} />
        <Skeleton width="min(38rem, 100%)" lines={2} />
      </header>
      <section className="grid gap-4 md:grid-cols-2" aria-label={t("providerLoading.providers")}>
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} height={132} rounded="lg" />
        ))}
      </section>
    </main>
  );
}
