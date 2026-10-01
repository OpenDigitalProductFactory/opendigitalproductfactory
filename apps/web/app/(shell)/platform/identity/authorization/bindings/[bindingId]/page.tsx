import { permanentRedirect } from "next/navigation";

type Props = {
  params: Promise<{ bindingId: string }>;
};

// EP-2FB6C0CC (BI-DD763B93): superseded by the in-page binding drawer, which is
// what every binding link opens. Saved links keep the binding id.
export default async function IdentityAuthorizationBindingRedirect({ params }: Props) {
  const { bindingId } = await params;
  permanentRedirect(`/platform/identity/authorization?binding=${bindingId}`);
}
