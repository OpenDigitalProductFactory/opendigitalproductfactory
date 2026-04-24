import { IdentityPlaceholderPanel } from "@/components/platform/identity/IdentityPlaceholderPanel";

export default function PlatformIdentityDirectoryPage() {
  return (
    <IdentityPlaceholderPanel
      title="Directory"
      description="Define how DPF publishes OUs, branches, and coarse directory authority for downstream consumers."
    />
  );
}
