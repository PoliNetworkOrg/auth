import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("../env", () => {
  const url = new URL(
    process.env.RBAC_TEST_DATABASE_URL ??
      "postgresql://postgres:test@localhost:55439/auth_security",
  );
  return {
    env: {
      DB_HOST: url.hostname,
      DB_PORT: Number(url.port),
      DB_USER: url.username,
      DB_PASS: url.password,
      DB_NAME: url.pathname.slice(1),
      BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
      STUDENT_VERIFICATION_TTL_DAYS: 365,
    },
  };
});
vi.mock("./email", () => ({
  studentVerificationEmailConfigured: true,
  sendStudentVerificationEmail: mocks.sendEmail,
}));

import { db } from "../db/index";
import { confirmStudentVerification, requestStudentVerification } from "./student-verification";

describe.skipIf(!process.env.RBAC_TEST_DATABASE_URL)(
  "Student verification resend limits with PostgreSQL",
  () => {
    const pool = new Pool({ connectionString: process.env.RBAC_TEST_DATABASE_URL });
    const users = [];
    const emails = [];

    beforeEach(() => mocks.sendEmail.mockReset().mockResolvedValue(undefined));
    afterAll(async () => {
      await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [users]);
      await pool.query(
        "DELETE FROM identity_evidence WHERE issuer = 'https://mail.polimi.it' AND subject = ANY($1::text[])",
        [emails],
      );
      await pool.end();
      await db.$client.end();
    });

    async function subject() {
      const id = `student-cooldown-${randomUUID()}`;
      await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1, $1, $2)', [
        id,
        `${id}@identity.invalid`,
      ]);
      users.push(id);
      const email = `${id}@mail.polimi.it`;
      emails.push(email);
      return { id, email };
    }

    async function requested() {
      const actor = await subject();
      await requestStudentVerification(actor.id, actor.email);
      return { ...actor, code: mocks.sendEmail.mock.lastCall[1] };
    }

    async function allowResend(id) {
      await pool.query(
        "UPDATE student_verification_challenge SET last_sent_at = now() - interval '61 seconds' WHERE user_id = $1",
        [id],
      );
    }

    it("keeps the cooldown and original code after an email mismatch", async () => {
      const actor = await requested();
      const other = await subject();
      await expect(
        confirmStudentVerification(actor.id, { email: other.email, code: actor.code }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(requestStudentVerification(actor.id, actor.email)).rejects.toMatchObject({
        status: 429,
      });
      await expect(requestStudentVerification(other.id, actor.email)).rejects.toMatchObject({
        status: 429,
      });
      expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
      await expect(confirmStudentVerification(actor.id, actor)).resolves.toMatchObject({
        email: actor.email,
      });
    });

    it("exhausts five guesses without permitting immediate resend, then accepts a fresh code", async () => {
      const actor = await requested();
      const wrong = actor.code === "000000" ? "000001" : "000000";
      for (let attempt = 0; attempt < 5; attempt++)
        await expect(
          confirmStudentVerification(actor.id, { email: actor.email, code: wrong }),
        ).rejects.toMatchObject({ status: 400 });
      await expect(confirmStudentVerification(actor.id, actor)).rejects.toMatchObject({
        status: 400,
      });
      await expect(requestStudentVerification(actor.id, actor.email)).rejects.toMatchObject({
        status: 429,
      });
      await allowResend(actor.id);
      await requestStudentVerification(actor.id, actor.email);
      await expect(
        confirmStudentVerification(actor.id, {
          email: actor.email,
          code: mocks.sendEmail.mock.lastCall[1],
        }),
      ).resolves.toMatchObject({ email: actor.email });
    });

    it("consumes a valid code once without clearing user or recipient cooldowns", async () => {
      const actor = await requested();
      const other = await subject();
      const results = await Promise.allSettled([
        confirmStudentVerification(actor.id, actor),
        confirmStudentVerification(actor.id, actor),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      await expect(requestStudentVerification(actor.id, other.email)).rejects.toMatchObject({
        status: 429,
      });
      await expect(requestStudentVerification(other.id, actor.email)).rejects.toMatchObject({
        status: 429,
      });
    });

    it("invalidates a failed delivery while preserving its resend cooldown", async () => {
      const actor = await subject();
      mocks.sendEmail.mockRejectedValueOnce(new Error("mail unavailable"));
      await expect(requestStudentVerification(actor.id, actor.email)).rejects.toMatchObject({
        status: 502,
      });
      await expect(
        confirmStudentVerification(actor.id, {
          email: actor.email,
          code: mocks.sendEmail.mock.lastCall[1],
        }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(requestStudentVerification(actor.id, actor.email)).rejects.toMatchObject({
        status: 429,
      });
      expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    });

    it("does not invalidate a replacement code when an earlier delivery fails late", async () => {
      const actor = await subject();
      const delivery = Promise.withResolvers();
      const started = Promise.withResolvers();
      mocks.sendEmail.mockImplementationOnce(() => {
        started.resolve();
        return delivery.promise;
      });
      const first = requestStudentVerification(actor.id, actor.email).catch((error) => error);
      await started.promise;
      await allowResend(actor.id);
      await requestStudentVerification(actor.id, actor.email);
      const code = mocks.sendEmail.mock.lastCall[1];
      delivery.reject(new Error("late delivery failure"));
      expect(await first).toMatchObject({ status: 502 });
      await expect(
        confirmStudentVerification(actor.id, { email: actor.email, code }),
      ).resolves.toMatchObject({ email: actor.email });
    });
  },
);
