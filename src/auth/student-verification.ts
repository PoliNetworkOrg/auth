import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { account } from "../db/auth-schema";
import { identityEvidence, studentVerificationChallenge } from "../db/evidence";
import { db } from "../db/index";
import { authorizationMutationLock } from "../db/security-lock";
import { env } from "../env";
import { sendStudentVerificationEmail, studentVerificationEmailConfigured } from "./email";
import { hasPolimiStudentDomain } from "./policy";

const POLIMI_EMAIL_ISSUER = "https://mail.polimi.it";
const CODE_LIFETIME_MS = 10 * 60 * 1_000;
const RESEND_DELAY_MS = 60 * 1_000;
const MAX_ATTEMPTS = 5;

export class StudentVerificationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function parsePolimiStudentEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!z.email().safeParse(email).success || !hasPolimiStudentDomain(email)) {
    throw new StudentVerificationError(400, "Use your @mail.polimi.it email address.");
  }
  return email;
}

function hashCode(userId: string, email: string, code: string) {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(`${userId}:${email}:${code}`)
    .digest("hex");
}

function codeMatches(storedHash: string, candidateHash: string) {
  const stored = Buffer.from(storedHash, "hex");
  const candidate = Buffer.from(candidateHash, "hex");
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

export async function requestStudentVerification(userId: string, input: unknown) {
  if (!studentVerificationEmailConfigured) {
    throw new StudentVerificationError(503, "Student email verification is not configured.");
  }
  const email = parsePolimiStudentEmail(input);
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const codeHash = hashCode(userId, email, code);
  await db.transaction(
    async (transaction) => {
      await transaction.execute(authorizationMutationLock);
      const now = new Date();
      const [recent] = await transaction
        .select({ lastSentAt: studentVerificationChallenge.lastSentAt })
        .from(studentVerificationChallenge)
        .where(
          or(
            eq(studentVerificationChallenge.userId, userId),
            eq(studentVerificationChallenge.email, email),
          ),
        )
        .orderBy(desc(studentVerificationChallenge.lastSentAt))
        .limit(1);
      if (recent && now.getTime() - recent.lastSentAt.getTime() < RESEND_DELAY_MS)
        throw new StudentVerificationError(429, "Wait one minute before requesting another code.");
      await transaction
        .delete(studentVerificationChallenge)
        .where(
          or(
            eq(studentVerificationChallenge.userId, userId),
            eq(studentVerificationChallenge.email, email),
          ),
        );
      await transaction.insert(studentVerificationChallenge).values({
        userId,
        email,
        codeHash,
        expiresAt: new Date(now.getTime() + CODE_LIFETIME_MS),
        lastSentAt: now,
      });
    },
    { isolationLevel: "read committed" },
  );

  try {
    await sendStudentVerificationEmail(email, code);
  } catch {
    await db
      .delete(studentVerificationChallenge)
      .where(
        and(
          eq(studentVerificationChallenge.userId, userId),
          eq(studentVerificationChallenge.codeHash, codeHash),
        ),
      );
    throw new StudentVerificationError(502, "The verification email could not be sent.");
  }
  return { email };
}

export async function confirmStudentVerification(
  userId: string,
  input: { email?: unknown; code?: unknown },
) {
  const email = parsePolimiStudentEmail(input.email);
  const code = z
    .string()
    .regex(/^\d{6}$/)
    .safeParse(input.code);
  if (!code.success) throw new StudentVerificationError(400, "Enter the six-digit code.");

  const result = await db.transaction(
    async (transaction) => {
      await transaction.execute(authorizationMutationLock);
      const [challenge] = await transaction
        .select()
        .from(studentVerificationChallenge)
        .where(eq(studentVerificationChallenge.userId, userId))
        .limit(1);
      if (!challenge || challenge.email !== email || challenge.expiresAt <= new Date()) {
        if (challenge) {
          await transaction
            .delete(studentVerificationChallenge)
            .where(eq(studentVerificationChallenge.userId, userId));
        }
        return new StudentVerificationError(400, "The code is invalid or expired.");
      }

      if (!codeMatches(challenge.codeHash, hashCode(userId, email, code.data))) {
        if (challenge.attempts + 1 >= MAX_ATTEMPTS) {
          await transaction
            .delete(studentVerificationChallenge)
            .where(eq(studentVerificationChallenge.userId, userId));
        } else {
          await transaction
            .update(studentVerificationChallenge)
            .set({ attempts: challenge.attempts + 1 })
            .where(eq(studentVerificationChallenge.userId, userId));
        }
        return new StudentVerificationError(400, "The code is invalid or expired.");
      }

      const now = new Date();
      const validUntil = new Date(
        now.getTime() + env.STUDENT_VERIFICATION_TTL_DAYS * 24 * 60 * 60 * 1_000,
      );
      const [currentStudentAccount] = await transaction
        .select({ accountId: account.accountId })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, "polimi-email")))
        .limit(1);
      if (currentStudentAccount && currentStudentAccount.accountId !== email) {
        throw new StudentVerificationError(
          409,
          "Unlink your current Polimi email before linking another one.",
        );
      }
      const [existingAccount] = await transaction
        .select({ id: account.id, userId: account.userId })
        .from(account)
        .where(and(eq(account.issuer, POLIMI_EMAIL_ISSUER), eq(account.accountId, email)))
        .limit(1);
      if (existingAccount && existingAccount.userId !== userId) {
        throw new StudentVerificationError(
          409,
          "This Polimi email is already connected to another account.",
        );
      }
      if (!existingAccount) {
        await transaction.insert(account).values({
          id: randomUUID(),
          accountId: email,
          providerId: "polimi-email",
          issuer: POLIMI_EMAIL_ISSUER,
          userId,
          createdAt: now,
          updatedAt: now,
        });
      }
      const proof = {
        issuer: POLIMI_EMAIL_ISSUER,
        subject: email,
        providerId: "polimi-email",
        states: ["student"],
        validUntil,
        telegramId: null,
      };
      await transaction
        .insert(identityEvidence)
        .values(proof)
        .onConflictDoUpdate({
          target: [identityEvidence.issuer, identityEvidence.subject],
          set: proof,
        });
      await transaction
        .delete(studentVerificationChallenge)
        .where(eq(studentVerificationChallenge.userId, userId));
      return { email, validUntil };
    },
    { isolationLevel: "read committed" },
  );
  // Failed attempts must commit their counter/removal before returning a denial.
  if (result instanceof StudentVerificationError) throw result;
  return result;
}
