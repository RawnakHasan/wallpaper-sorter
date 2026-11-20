import { z } from 'zod';

const idSchema = z.number().int().nonnegative();

export const activityEventSchema = z.object({
  id: idSchema,
  batch: idSchema.nullable(),
  time: z.number().nonnegative(),
  kind: z.string(),
  from: z.string(),
  to: z.string(),
  note: z.string(),
  undone: z.boolean(),
  undoable: z.boolean(),
}).passthrough();

export const activitySchema = z.array(activityEventSchema);

export const undoRequestSchema = z.union([
  z.object({ id: idSchema }).strict(),
  z.object({ batch: idSchema }).strict(),
]);

export const undoResponseSchema = z.object({
  undone: z.array(z.object({
    id: idSchema,
    from: z.string(),
    to: z.string(),
  }).passthrough()),
}).passthrough();

export type ActivityEvent = z.infer<typeof activityEventSchema>;
export type UndoRequest = z.infer<typeof undoRequestSchema>;
