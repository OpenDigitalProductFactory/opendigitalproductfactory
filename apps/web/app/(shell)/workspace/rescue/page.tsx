import { RescueRoutePage } from "@/components/animal-welfare/RescueRoutePage";

export default function RescueOverviewPage({ searchParams }: { searchParams: Promise<{ filter?: string | string[] }> }) {
  return <RescueRoutePage area="overview" searchParams={searchParams} />;
}
