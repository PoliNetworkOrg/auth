import type { z } from "zod";
import { ActionError } from "./action-error";

/**
 * A server function validator from a schema. A malformed request is refused with a plain
 * 400, rather than the schema's issue list, which only a hand-written request could trigger.
 */
export function validate<TSchema extends z.ZodType>(schema: TSchema) {
  return (input: z.input<TSchema>): z.output<TSchema> => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new ActionError(400, "Invalid request.");
    return parsed.data;
  };
}
