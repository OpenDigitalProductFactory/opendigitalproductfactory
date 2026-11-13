// apps/web/app/(shell)/platform/ai/layout.tsx
import { PlatformTabNav } from "@/components/platform/PlatformTabNav";
import { Suspense } from "react";
import { RoutingManagementNav } from "@/components/platform/RoutingManagementNav";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { namespaceMessages } from "@dpf/i18n";
import { getLocaleContext } from "@/lib/i18n/locale-context.server";

export default async function AiLayout({ children }: { children: React.ReactNode }) {
  const { language } = await getLocaleContext();
  return (
    <div>
      <MessagesProvider locale={language} messages={{ routingManagement: namespaceMessages(language, "routingManagement"), shell: namespaceMessages(language, "shell"), setup: namespaceMessages(language, "setup"), errors: namespaceMessages(language, "errors") }}>
      <Suspense fallback={<PlatformTabNav />}><RoutingManagementNav /></Suspense>
      {children}
      </MessagesProvider>
    </div>
  );
}
