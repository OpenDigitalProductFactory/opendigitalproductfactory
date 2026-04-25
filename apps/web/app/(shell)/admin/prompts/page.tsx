import { permanentRedirect } from "next/navigation";

export default async function AdminPromptsPage() {
  permanentRedirect("/platform/ai/prompts");
}
