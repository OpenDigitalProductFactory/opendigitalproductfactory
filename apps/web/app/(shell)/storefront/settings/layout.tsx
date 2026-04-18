import { StorefrontSettingsNav } from "@/components/storefront-admin/StorefrontSettingsNav";

export default function StorefrontSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <StorefrontSettingsNav />
      {children}
    </div>
  );
}
