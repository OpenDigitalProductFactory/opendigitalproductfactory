import { RescueRoutePage } from "@/components/animal-welfare/RescueRoutePage";

export default function RescueCarePage({ searchParams }: { searchParams: Promise<{ filter?: string | string[] }> }) {
  return <RescueRoutePage area="care" searchParams={searchParams} />;
}
