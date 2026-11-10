import { RescueRoutePage } from "@/components/animal-welfare/RescueRoutePage";

export default function RescueAdoptionsPage({ searchParams }: { searchParams: Promise<{ filter?: string | string[] }> }) {
  return <RescueRoutePage area="adoptions" searchParams={searchParams} />;
}
