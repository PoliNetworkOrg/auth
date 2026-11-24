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

    async function sendsToday(id) {
      const { rows } = await pool.query(
        "SELECT count(*)::int AS total FROM student_verification_send WHERE user_id = $1 AND sent_at > now() - interval '24 hours'",
        [id],
      );
      return rows[0].total;
    }

    // Gives every code this person asks for a send time already past the resend cooldown, so
    // that concurrent requests are refused only if the daily limit refuses them.
    async function withoutCooldown(id, run) {
      const name = `skip_cooldown_${id.replaceAll("-", "_")}`;
      await pool.query(
        `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN NEW.last_sent_at := NEW.last_sent_at - interval '61 seconds'; RETURN NEW; END $$`,
      );
      await pool.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON student_verification_challenge FOR EACH ROW
          WHEN (NEW.user_id = '${id}') EXECUTE FUNCTION ${name}()`,
      );
      try {
        await run();
      } finally {
        await pool.query(`DROP TRIGGER ${name} ON student_verification_challenge`);
        await pool.query(`DROP FUNCTION ${name}()`);
      }
    }

    async function passDay(id) {
      await pool.query(
        "UPDATE student_verification_send SET sent_at = sent_at - interval '24 hours 1 second' WHERE user_id = $1",
        [id],
      );
      await allowResend(id);
    }

    it("refuses a sixth code within 24 hours and allows codes again a day later", async () => {
      const actor = await subject();
      for (let sent = 0; sent < 5; sent++) {
        await requestStudentVerification(actor.id, actor.email);
        await allowResend(actor.id);
      }
      await expect(requestStudentVerification(actor.id, actor.email)).rejects.toMatchObject({
        status: 429,
        message: "You asked for too many codes. Try again in 24 hours.",
      });
      // The window is a rolling 24 hours: the wait ends when the oldest code leaves it.
      await pool.query(
        "UPDATE student_verification_send SET sent_at = sent_at - interval '23 hours 30 minutes' WHERE user_id = $1",
        [actor.id],
      );
      const other = await subject();
      await expect(requestStudentVerification(actor.id, other.email)).rejects.toMatchObject({
        status: 429,
        message: "You asked for too many codes. Try again in 30 minutes.",
      });
      expect(mocks.sendEmail).toHaveBeenCalledTimes(5);

      await passDay(actor.id);
      await requestStudentVerification(actor.id, actor.email);
      expect(mocks.sendEmail).toHaveBeenCalledTimes(6);
      await expect(
        confirmStudentVerification(actor.id, {
          email: actor.email,
          code: mocks.sendEmail.mock.lastCall[1],
        }),
      ).resolves.toMatchObject({ email: actor.email });
      // Older sends are pruned, so only the new one is left.
      const { rows } = await pool.query(
        "SELECT count(*)::int AS total FROM student_verification_send WHERE user_id = $1",
        [actor.id],
      );
      expect(rows[0].total).toBe(1);
    });

    it("keeps counting codes after successful confirmations", async () => {
      const actor = await subject();
      for (let sent = 0; sent < 5; sent++) {
        await requestStudentVerification(actor.id, actor.email);
        await expect(
          confirmStudentVerification(actor.id, {
            email: actor.email,
            code: mocks.sendEmail.mock.lastCall[1],
          }),
        ).resolves.toMatchObject({ email: actor.email });
        await allowResend(actor.id);
      }
      await expect(requestStudentVerification(actor.id, actor.email)).rejects.toMatchObject({
        status: 429,
      });
      expect(mocks.sendEmail).toHaveBeenCalledTimes(5);
    });

    it("counts codes whose delivery failed", async () => {
      const actor = await subject();
      for (let sent = 0; sent < 5; sent++) {
        mocks.sendEmail.mockRejectedValueOnce(new Error("mail unavailable"));
        await expect(requestStudentVerification(actor.id, actor.email)).rejects.toMatchObject({
          status: 502,
        });
        await allowResend(actor.id);
      }
      await expect(requestStudentVerification(actor.id, actor.email)).rejects.toMatchObject({
        status: 429,
      });
      expect(mocks.sendEmail).toHaveBeenCalledTimes(5);
    });

    it("keeps counting when another person asks for a code for the same address", async () => {
      const actor = await subject();
      const other = await subject();
      for (let sent = 0; sent < 5; sent++) {
        await requestStudentVerification(actor.id, actor.email);
        await allowResend(actor.id);
        // This replaces the first person's challenge row for the address.
        await requestStudentVerification(other.id, actor.email);
        await allowResend(other.id);
      }
      await expect(requestStudentVerification(actor.id, actor.email)).rejects.toMatchObject({
        status: 429,
      });
      await expect(requestStudentVerification(other.id, other.email)).rejects.toMatchObject({
        status: 429,
      });
      expect(mocks.sendEmail).toHaveBeenCalledTimes(10);
    });

    it("does not exceed the daily limit with concurrent requests", async () => {
      const actor = await subject();
      for (let sent = 0; sent < 4; sent++) {
        await requestStudentVerification(actor.id, actor.email);
        await allowResend(actor.id);
      }
      const dailyLimit = { status: 429, message: expect.stringMatching(/too many codes/) };
      await withoutCooldown(actor.id, async () => {
        const targets = await Promise.all(Array.from({ length: 6 }, () => subject()));
        const results = await Promise.allSettled(
          targets.map((target) => requestStudentVerification(actor.id, target.email)),
        );
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        for (const result of results.filter((entry) => entry.status === "rejected"))
          expect(result.reason).toMatchObject(dailyLimit);
        expect(mocks.sendEmail).toHaveBeenCalledTimes(5);
        expect(await sendsToday(actor.id)).toBe(5);

        const again = await Promise.allSettled(
          targets.map((target) => requestStudentVerification(actor.id, target.email)),
        );
        for (const result of again) expect(result).toMatchObject({ reason: dailyLimit });
        expect(mocks.sendEmail).toHaveBeenCalledTimes(5);
        expect(await sendsToday(actor.id)).toBe(5);
      });
    });

    it("removes the sent-code count when the person is deleted", async () => {
      const actor = await subject();
      await requestStudentVerification(actor.id, actor.email);
      expect(await sendsToday(actor.id)).toBe(1);
      await pool.query('DELETE FROM "user" WHERE id = $1', [actor.id]);
      expect(await sendsToday(actor.id)).toBe(0);
    });

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
