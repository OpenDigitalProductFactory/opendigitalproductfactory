import { z } from "zod";

export const formSubmissionSchema = z.object({
  formId: z.string(),
  values: z.record(z.string(), z.unknown()),
  fileIds: z.array(z.string()).optional(),
});

export type FormSubmissionInput = z.infer<typeof formSubmissionSchema>;
