import { serve } from "inngest/next";
import { inngest } from "@/lib/queue/inngest-client";
import { allFunctions } from "@/lib/queue/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: allFunctions,
});
