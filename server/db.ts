import { and, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

/**
 * Upsert user with email-based merging.
 *
 * When a user logs in via OAuth, we first check whether a pre-created
 * (manual) user record with the same email already exists.  If so we
 * **merge** into that record (update its openId to the real OAuth one)
 * instead of inserting a duplicate row.  This prevents the "two records
 * for the same person" problem that happens when admin pre-creates a
 * user with a made-up name and the real user later logs in with a
 * different openId from the OAuth provider.
 */
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    // ----- Build field maps -----
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    // ----- Email-based merge for pre-created (manual) users -----
    // Only attempt merge when:
    //   1. The incoming openId is NOT a manual_ placeholder (i.e. a real OAuth login)
    //   2. An email is provided
    const isRealOAuth = !user.openId.startsWith("manual_");
    const email = user.email ?? values.email;

    if (isRealOAuth && email) {
      // Check if a pre-created user with matching email exists
      const existing = await db.select()
        .from(users)
        .where(
          and(
            eq(users.email, email as string),
            like(users.openId, "manual_%"),
          )
        )
        .limit(1);

      if (existing.length > 0) {
        const manualUser = existing[0];
        console.log(
          `[Database] Merging pre-created user id=${manualUser.id} (openId=${manualUser.openId}) ` +
          `into OAuth user (openId=${user.openId}, email=${email})`
        );

        // Update the pre-created record: replace placeholder openId with the
        // real one, and refresh name / loginMethod from OAuth.
        const mergeSet: Record<string, unknown> = {
          openId: user.openId,
          ...updateSet,
        };
        // Preserve the admin role if the pre-created user was an admin
        if (manualUser.role === 'admin' && !updateSet.role) {
          mergeSet.role = 'admin';
        }

        await db.update(users)
          .set(mergeSet)
          .where(eq(users.id, manualUser.id));

        return; // done – merged into existing row
      }
    }

    // ----- Standard upsert (by openId unique key) -----
    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// TODO: add feature queries here as your schema grows.
