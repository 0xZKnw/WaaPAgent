import { randomUUID } from "node:crypto";

import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { verifyMessage } from "viem";
import { getAddress } from "viem";

import { APP_NAME } from "@/lib/constants";
import { getDb } from "@/server/db/client";
import { ensureDatabase } from "@/server/db/init";
import { authChallenges, sessions } from "@/server/db/schema";

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AppSession {
  id: string;
  sessionToken: string;
  address: string;
  expiresAt: number;
}

export class SessionService {
  createChallenge(rawAddress: string) {
    ensureDatabase();

    const address = getAddress(rawAddress);
    const nonce = randomUUID();
    const now = Date.now();
    const message = [
      `${APP_NAME} authentication`,
      "",
      `Address: ${address}`,
      `Nonce: ${nonce}`,
      `Issued At: ${new Date(now).toISOString()}`,
      "",
      "Sign this challenge to bind your WaaP wallet to the app session.",
    ].join("\n");

    getDb()
      .insert(authChallenges)
      .values({
        id: randomUUID(),
        address,
        nonce,
        message,
        createdAt: now,
        expiresAt: now + CHALLENGE_TTL_MS,
        consumedAt: null,
      })
      .run();

    return { address, nonce, message, expiresAt: now + CHALLENGE_TTL_MS };
  }

  async verifyChallenge(rawAddress: string, signature: string) {
    ensureDatabase();

    const address = getAddress(rawAddress);
    const db = getDb();
    const now = Date.now();
    const challenge = db
      .select()
      .from(authChallenges)
      .where(
        and(
          eq(authChallenges.address, address),
          gt(authChallenges.expiresAt, now),
          isNull(authChallenges.consumedAt),
        ),
      )
      .orderBy(desc(authChallenges.createdAt))
      .get();

    if (!challenge) {
      throw new Error("No valid challenge found for this address.");
    }

    const isValid = await verifyMessage({
      address,
      message: challenge.message,
      signature: signature as `0x${string}`,
    });

    if (!isValid) {
      throw new Error("Signature verification failed.");
    }

    db.update(authChallenges)
      .set({ consumedAt: now })
      .where(eq(authChallenges.id, challenge.id))
      .run();

    const session = this.createSession(address);
    return { session, challengeMessage: challenge.message };
  }

  createSession(address: string): AppSession {
    ensureDatabase();

    const now = Date.now();
    const session: AppSession = {
      id: randomUUID(),
      sessionToken: randomUUID(),
      address: getAddress(address),
      expiresAt: now + SESSION_TTL_MS,
    };

    getDb()
      .insert(sessions)
      .values({
        id: session.id,
        sessionToken: session.sessionToken,
        address: session.address,
        createdAt: now,
        expiresAt: session.expiresAt,
        lastSeenAt: now,
      })
      .run();

    return session;
  }

  getSession(sessionToken: string) {
    ensureDatabase();

    const now = Date.now();
    const session = getDb()
      .select()
      .from(sessions)
      .where(and(eq(sessions.sessionToken, sessionToken), gt(sessions.expiresAt, now)))
      .get();

    if (!session) {
      return null;
    }

    getDb()
      .update(sessions)
      .set({ lastSeenAt: now })
      .where(eq(sessions.id, session.id))
      .run();

    return {
      id: session.id,
      sessionToken: session.sessionToken,
      address: getAddress(session.address),
      expiresAt: session.expiresAt,
    } satisfies AppSession;
  }
}
