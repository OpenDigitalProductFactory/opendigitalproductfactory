// apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getProviderById, getProviders, getDiscoveredModels, getModelProfiles } from "@/lib/ai-provider-data";
import { ProviderDetailForm } from "@/components/platform/ProviderDetailForm";

type Props = { params: Promise<{ providerId: string }> };

export default async function ProviderDetailPage({ params }: Props) {
  const { providerId } = await params;
  const [pw, models, profiles, allProviders] = await Promise.all([
    getProviderById(providerId),
    getDiscoveredModels(providerId),
    getModelProfiles(providerId),
    getProviders(),
  ]);
  if (!pw) notFound();

  const hasActiveProvider = allProviders.some((p) => p.provider.status === "active");

  const session = await auth();
  const user = session?.user;
  const canWrite = !!user && can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections");

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Link href="/platform/ai" style={{ color: "#555566", fontSize: 10 }}>← AI Providers</Link>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: "6px 0 2px" }}>{pw.provider.name}</h1>
        <p style={{ fontSize: 10, color: "#555566", margin: 0, fontFamily: "monospace" }}>{pw.provider.providerId}</p>
      </div>

      <div style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: 8, padding: 20 }}>
        <ProviderDetailForm pw={pw} canWrite={canWrite} models={models} profiles={profiles} hasActiveProvider={hasActiveProvider} />
      </div>
    </div>
  );
}
