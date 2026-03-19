import { z } from "zod";

export const updateCustomerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  industry: z.string().max(100).optional(),
  notes: z.string().max(5000).optional(),
});

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
