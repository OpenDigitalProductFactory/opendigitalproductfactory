import { IdentityPlaceholderPanel } from "@/components/platform/identity/IdentityPlaceholderPanel";

export default function PlatformIdentityFederationPage() {
  return (
    <IdentityPlaceholderPanel
      title="Federation"
      description="Manage upstream authorities such as Microsoft Entra, LDAP, and future workforce identity anchors."
    />
  );
}
