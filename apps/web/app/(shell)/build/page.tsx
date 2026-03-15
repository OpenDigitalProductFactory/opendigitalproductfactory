// apps/web/app/(shell)/build/page.tsx
import { auth } from "@/lib/auth";
import { getFeatureBuilds } from "@/lib/feature-build-data";
import { getPortfoliosForSelect } from "@/lib/backlog-data";
import { BuildStudio } from "@/components/build/BuildStudio";

export default async function BuildPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const [builds, portfolios] = await Promise.all([
    getFeatureBuilds(session.user.id),
    getPortfoliosForSelect(),
  ]);

  return <BuildStudio builds={builds} portfolios={portfolios} />;
}
