/** Declared contacts produce review proposals; they never prove identity or grant roles. */
export function peopleRegistrationProposals(
  registrations: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    telegramId: string | null;
    linkedUserId: string | null;
  }[],
  accounts: {
    sub: string;
    name: string;
    email: string | null;
    emailVerified: boolean;
    telegramId: string | null;
  }[],
) {
  const lower = (value: string | null) => value?.trim().toLowerCase() || null;
  const pending = registrations.filter((person) => !person.linkedUserId);
  return accounts.flatMap((account) => {
    if (
      registrations.some(
        (person) => person.id === account.sub || person.linkedUserId === account.sub,
      )
    )
      return [];
    const strong = pending.filter(
      (person) =>
        (account.emailVerified &&
          lower(account.email) &&
          lower(account.email) === lower(person.email)) ||
        (account.telegramId && account.telegramId === person.telegramId),
    );
    const candidates = strong.length
      ? strong
      : pending.filter(
          (person) => lower(`${person.firstName} ${person.lastName}`) === lower(account.name),
        );
    return candidates.map((person) => ({
      personId: person.id,
      sub: account.sub,
      name: account.name,
      email: account.email,
      telegramId: account.telegramId,
      reason:
        strong.length > 1 ||
        (strong.length &&
          account.telegramId &&
          person.telegramId &&
          account.telegramId !== person.telegramId)
          ? ("conflicting-identities" as const)
          : account.telegramId && account.telegramId === person.telegramId
            ? ("verified-telegram" as const)
            : account.emailVerified &&
                lower(account.email) &&
                lower(account.email) === lower(person.email)
              ? ("verified-email" as const)
              : ("name-only" as const),
    }));
  });
}
