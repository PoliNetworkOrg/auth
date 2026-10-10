import { createSerializationAdapter } from "@tanstack/react-router";

/** Per-field messages for a form; list fields carry one entry (or null) per item. */
export type FieldErrors = {
  readonly [field: string]: string | readonly (string | null)[] | undefined;
};

/**
 * A refusal a person can act on, thrown by server functions and route guards.
 *
 * Start sends only the message of an ordinary error across the wire, so this has its own
 * serialization adapter (registered in `src/start.ts`): the page receives the status that
 * decides what to show, and the field errors a form highlights.
 */
export class ActionError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: FieldErrors,
    /** The managed permission that was missing, for a page that explains what to ask for. */
    readonly permission?: string,
  ) {
    super(message);
    this.name = "ActionError";
  }
}

export const actionErrorAdapter = createSerializationAdapter({
  key: "action-error",
  test: (value): value is ActionError => value instanceof ActionError,
  toSerializable: ({ status, message, fields, permission }) => ({
    status,
    message,
    fields: fields ?? null,
    permission: permission ?? null,
  }),
  fromSerializable: ({ status, message, fields, permission }) =>
    new ActionError(status, message, fields ?? undefined, permission ?? undefined),
});

export function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

/** The field errors of a refused form, typed as the form that was submitted expects them. */
export function errorFields<TFields extends FieldErrors>(cause: unknown): TFields | undefined {
  // Safety: the server function that refused this form built `fields` from the same draft
  // validation the form uses, so they have the form's shape.
  return cause instanceof ActionError ? (cause.fields as TFields | undefined) : undefined;
}
