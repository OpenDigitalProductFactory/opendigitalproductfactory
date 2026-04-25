import { permanentRedirect } from "next/navigation";

export default async function AdminSkillsPage() {
  permanentRedirect("/platform/ai/skills");
}
