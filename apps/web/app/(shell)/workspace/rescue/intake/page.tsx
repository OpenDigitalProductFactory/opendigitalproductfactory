import { RescueRoutePage } from "@/components/animal-welfare/RescueRoutePage";

export default function RescueIntakePage({ searchParams }: { searchParams: Promise<{ filter?: string | string[] }> }) {
  return <RescueRoutePage area="intake" searchParams={searchParams} />;
}
