import { z } from "zod";

export const createCommentSchema = z.object({
  body: z.string().trim().min(1, "comment is required").max(5000),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
