import { serve } from "inngest/next";
import { inngest } from "@/lib/queue/inngest-client";
import { getInngestFunctionsForRuntime } from "@/lib/queue/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: getInngestFunctionsForRuntime(),
});
