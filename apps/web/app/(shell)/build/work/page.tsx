import { WorkControlPanel } from "@/components/build/work-control/WorkControlPanel";
import { getWorkControlData } from "@/lib/actions/work-capsules";

export default async function WorkControlPage() {
  const data = await getWorkControlData();

  return <WorkControlPanel capsules={data.capsules} adoptable={data.adoptable} />;
}
