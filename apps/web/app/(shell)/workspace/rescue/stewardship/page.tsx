import { RescueRoutePage } from "@/components/animal-welfare/RescueRoutePage";

export default function RescueStewardshipPage({ searchParams }: { searchParams: Promise<{ filter?: string | string[] }> }) {
  return <RescueRoutePage area="stewardship" searchParams={searchParams} />;
}
