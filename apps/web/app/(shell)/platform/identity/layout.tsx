import { PlatformTabNav } from "@/components/platform/PlatformTabNav";

export default function IdentityLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PlatformTabNav />
      {children}
    </div>
  );
}
