import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import { db, uuid } from "../db/index.js";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = "xscan_session";
const SESSION_DAYS = 30;

export interface User {
  id: string;
  email: string;
  name: string;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 64);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

// Compared against when the email is unknown, so a wrong email and a wrong password take the same time.
const DUMMY_HASH = await hashPassword(randomBytes(12).toString("hex"));

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function cookieAttrs(maxAgeSec: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

export async function startSession(res: Response, userId: string) {
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3::interval)", [tokenHash(token), userId, `${SESSION_DAYS} days`]);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; ${cookieAttrs(SESSION_DAYS * 86400)}`);
}

export async function endSession(req: Request, res: Response) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await db.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; ${cookieAttrs(0)}`);
}

export async function createUser(email: string, name: string, password: string): Promise<User | null> {
  const id = uuid();
  const { rows } = await db.query<User>(
    "INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING RETURNING id, email, name",
    [id, email.toLowerCase(), name, await hashPassword(password)],
  );
  return rows[0] ?? null;
}

export async function checkCredentials(email: string, password: string): Promise<User | null> {
  const row = await db.one<User & { password_hash: string }>("SELECT id, email, name, password_hash FROM users WHERE email = $1", [email.toLowerCase()]);
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  return row && ok ? { id: row.id, email: row.email, name: row.name } : null;
}

/** Puts the signed-in user (or null) on res.locals.user for every request. */
export async function attachUser(req: Request, res: Response, next: NextFunction) {
  res.locals.user = null;
  const token = readCookie(req, SESSION_COOKIE);
  if (token) {
    try {
      res.locals.user = await db.one<User>(
        "SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()",
        [tokenHash(token)],
      );
    } catch (e) {
      return next(e);
    }
  }
  next();
}

export function requireUser(_req: Request, res: Response, next: NextFunction) {
  if (!res.locals.user) return res.status(401).json({ error: { code: "auth_required", message: "Sign in to do this." } });
  next();
}

export const currentUser = (res: Response): User | null => res.locals.user ?? null;
