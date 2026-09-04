import { RescueRoutePage } from "@/components/animal-welfare/RescueRoutePage";

export default function RescueAnimalsPage({ searchParams }: { searchParams: Promise<{ filter?: string | string[] }> }) {
  return <RescueRoutePage area="animals" searchParams={searchParams} />;
}
