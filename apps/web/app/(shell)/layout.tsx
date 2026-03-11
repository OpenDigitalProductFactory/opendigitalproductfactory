// apps/web/app/(shell)/layout.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Header } from "@/components/shell/Header";
import { headers } from "next/headers";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const headersList = await headers();
  const pathname = headersList.get("x-pathname") ?? "/workspace";

  return (
    <div className="min-h-screen flex flex-col bg-[var(--dpf-bg)]">
      <Header activePath={pathname} platformRole={session.user.platformRole} isSuperuser={session.user.isSuperuser} />
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">{children}</main>
    </div>
  );
}
