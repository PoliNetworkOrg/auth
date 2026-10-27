import { z } from "zod";
import { peopleCommandSchema } from "./people-role-command";

const contact = (max: number) => z.string().trim().max(max).default("");
export const createPeoplePersonSchema = z
  .object({
    operation: z.literal("create-person"),
    id: z.uuid(),
    actor: z.string().min(1).max(200),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.union([z.literal(""), z.email().max(254)]).default(""),
    phone: contact(40),
    telegramId: z.union([z.literal(""), z.string().regex(/^[1-9]\d{0,19}$/)]).default(""),
    telegramUsername: contact(32).refine((value) => !value || /^[A-Za-z0-9_]{5,32}$/.test(value)),
    changes: z.array(peopleCommandSchema.shape.changes.element).max(64),
  })
  .superRefine((input, ctx) => {
    const keys = input.changes.map((change) =>
      change.kind === "admin" ? "admin" : `team:${change.team}`,
    );
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: "custom", message: "Each role concept may appear only once" });
  });
export const linkPeoplePersonSchema = z.object({
  operation: z.literal("link-person"),
  id: z.uuid(),
  actor: z.string().min(1).max(200),
  personId: z.string().min(1).max(200),
  userId: z.string().min(1).max(200),
  reason: z.string().trim().min(1).max(500),
});
export type CreatePeoplePerson = z.infer<typeof createPeoplePersonSchema>;
export type LinkPeoplePerson = z.infer<typeof linkPeoplePersonSchema>;

export const updatePeoplePersonSchema = z.object({
  operation: z.literal("update-person"),
  id: z.uuid(),
  actor: createPeoplePersonSchema.shape.actor,
  personId: z.string().min(1).max(200),
  firstName: createPeoplePersonSchema.shape.firstName,
  lastName: createPeoplePersonSchema.shape.lastName,
  email: createPeoplePersonSchema.shape.email,
  phone: createPeoplePersonSchema.shape.phone,
  telegramId: createPeoplePersonSchema.shape.telegramId,
  telegramUsername: createPeoplePersonSchema.shape.telegramUsername,
});
export type UpdatePeoplePerson = z.infer<typeof updatePeoplePersonSchema>;
