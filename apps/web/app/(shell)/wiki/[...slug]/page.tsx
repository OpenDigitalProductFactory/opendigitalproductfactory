import { redirect } from "next/navigation";

type Params = Promise<{ slug: string[] }>;

export default async function WikiAliasSlugRedirect({ params }: { params: Params }) {
  const { slug } = await params;
  redirect(`/coworker-decisions/${slug.map(encodeURIComponent).join("/")}`);
}
