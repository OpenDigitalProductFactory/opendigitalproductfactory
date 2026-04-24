import { PlatformTabNav } from "@/components/platform/PlatformTabNav";
import { IdentityTabNav } from "@/components/platform/identity/IdentityTabNav";

export default function IdentityLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PlatformTabNav />
      <IdentityTabNav />
      {children}
    </div>
  );
}
