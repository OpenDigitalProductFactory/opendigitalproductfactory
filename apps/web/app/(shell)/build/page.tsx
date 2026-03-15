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

  // Negative margin counteracts the shell's p-6 so Build Studio goes full-bleed
  return (
    <div className="-m-6 h-[calc(100vh-48px)]">
      <BuildStudio builds={builds} portfolios={portfolios} />
    </div>
  );
}
