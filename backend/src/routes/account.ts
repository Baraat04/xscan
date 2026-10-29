import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { audit, db } from "../db/index.js";
import { checkCredentials, createUser, currentUser, endSession, requireUser, startSession } from "../services/auth.js";

export const account = Router();

const fail = (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false,
  message: { error: { code: "rate_limited", message: "Too many attempts. Wait a few minutes and try again." } } });

const Email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(200);
const SignUp = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(80),
  email: Email,
  password: z.string().min(8, "The password needs at least 8 characters.").max(200),
});
const SignIn = z.object({ email: Email, password: z.string().min(1, "Enter your password.").max(200) });

account.get("/auth/me", (_req, res) => res.json({ user: currentUser(res) }));

account.post("/auth/signup", authLimiter, async (req, res) => {
  const body = SignUp.safeParse(req.body);
  if (!body.success) return fail(res, 400, "invalid_body", body.error.issues[0].message);
  const user = await createUser(body.data.email, body.data.name, body.data.password);
  if (!user) return fail(res, 409, "email_taken", "An account with this email already exists. Sign in instead.");
  await startSession(res, user.id);
  await audit("user.signup", "user", user.id);
  res.status(201).json({ user });
});

account.post("/auth/login", authLimiter, async (req, res) => {
  const body = SignIn.safeParse(req.body);
  if (!body.success) return fail(res, 400, "invalid_body", body.error.issues[0].message);
  const user = await checkCredentials(body.data.email, body.data.password);
  if (!user) return fail(res, 401, "bad_credentials", "Wrong email or password.");
  await startSession(res, user.id);
  res.json({ user });
});

account.post("/auth/logout", async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
});

account.get("/me/saved", requireUser, async (_req, res) => {
  const { rows } = await db.query("SELECT tender_id, created_at FROM saved_tenders WHERE user_id = $1 ORDER BY created_at DESC", [currentUser(res)!.id]);
  res.json({ saved: rows });
});

account.put("/tenders/:id/save", requireUser, async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id) || !(await db.one("SELECT 1 FROM tenders WHERE id = $1", [id]))) return fail(res, 404, "not_found", "Tender not found");
  await db.query("INSERT INTO saved_tenders (user_id, tender_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [currentUser(res)!.id, id]);
  res.json({ saved: true });
});

account.delete("/tenders/:id/save", requireUser, async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return fail(res, 404, "not_found", "Tender not found");
  await db.query("DELETE FROM saved_tenders WHERE user_id = $1 AND tender_id = $2", [currentUser(res)!.id, id]);
  res.json({ saved: false });
});
