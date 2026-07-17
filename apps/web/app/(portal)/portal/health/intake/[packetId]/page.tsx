import { redirect } from "next/navigation";

import { PatientIntakeRunner } from "@/components/healthcare/PatientIntakeRunner";
import { auth } from "@/lib/auth";

export default async function PatientIntakePage({
  params,
}: {
  params: Promise<{ packetId: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.type !== "customer") redirect("/portal/sign-in");
  const { packetId } = await params;
  return <PatientIntakeRunner packetId={packetId} />;
}
