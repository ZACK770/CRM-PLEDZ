import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import {
  type App,
  type User,
  type Member,
  fail,
  hash,
  id,
  one,
  write,
} from "./core";
const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
const credentials = z.object({ email, password: z.string().min(12).max(256) });
const equal = (a: string, b: string) => {
  let n = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    n |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return n === 0;
};
export async function passwordHash(
  password: string,
  salt: string = crypto.randomUUID(),
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return `${salt}:${Array.from(new Uint8Array(bits), (x) => x.toString(16).padStart(2, "0")).join("")}`;
}
export const auth = new Hono<App>();
auth.get("/status", async (c) =>
  c.json({
    setup: !(await one(c.env.DB, "SELECT id FROM installation WHERE id=1")),
  }),
);
auth.post("/setup", async (c) => {
  const d = credentials
    .extend({
      name: z.string().trim().min(2).max(100),
      token: z.string().min(20),
    })
    .parse(await c.req.json());
  if (!c.env.BOOTSTRAP_TOKEN || !equal(d.token, c.env.BOOTSTRAP_TOKEN))
    fail("קוד הקמה אינו תקין", 403);
  if (await one(c.env.DB, "SELECT id FROM installation WHERE id=1"))
    fail("המערכת כבר הוקמה", 409);
  const uid = id();
  const password = await passwordHash(d.password);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)",
    ).bind(uid, d.name, d.email, password),
    c.env.DB.prepare("INSERT INTO installation(id,owner_id) VALUES(1,?)").bind(
      uid,
    ),
    c.env.DB.prepare(
      "INSERT INTO workspaces(id,name,color) VALUES('women','מכללת נשים','#7862bb'),('men','מכללת גברים','#24756e')",
    ),
    ...["women", "men"].map((ws) =>
      c.env.DB.prepare(
        "INSERT INTO members(workspace_id,user_id,role) VALUES(?,?,'owner')",
      ).bind(ws, uid),
    ),
    ...["women", "men"].flatMap((ws) =>
      [
        ["direct", "פרסום ישיר", "hot"],
        ["webinar", "הרשמה ליום פתוח", "warm"],
        ["referral", "המלצה", "warm"],
        ["manual", "פנייה ידנית", "cold"],
      ].map((s) =>
        c.env.DB.prepare(
          "INSERT INTO sources(workspace_id,id,name,heat) VALUES(?,?,?,?)",
        ).bind(ws, ...s),
      ),
    ),
  ]);
  return c.json({ ok: true });
});
auth.post("/login", async (c) => {
  const d = credentials.parse(await c.req.json());
  const key = await hash(
    `${c.req.header("CF-Connecting-IP") || "local"}:${d.email}`,
  );
  const current = Math.floor(Date.now() / 1000);
  await write(
    c.env.DB,
    "INSERT INTO login_limits(key,attempts,until_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN until_at<? THEN 1 ELSE attempts+1 END,until_at=CASE WHEN until_at<? THEN excluded.until_at ELSE until_at END",
    key,
    current + 900,
    current,
    current,
  );
  const limit = await one(
    c.env.DB,
    "SELECT attempts FROM login_limits WHERE key=?",
    key,
  );
  if (limit!.attempts > 10) fail("יותר מדי ניסיונות; נסו בעוד רבע שעה", 429);
  const u = await one<User & { password: string }>(
    c.env.DB,
    "SELECT * FROM users WHERE email=? AND active=1",
    d.email,
  );
  const calculated = await passwordHash(
    d.password,
    u?.password.split(":")[0] || "missing-account-salt",
  );
  if (!u || !equal(calculated, u.password))
    fail("פרטי ההתחברות אינם נכונים", 401);
  const token = crypto.randomUUID() + crypto.randomUUID();
  await write(
    c.env.DB,
    "INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)",
    await hash(token),
    u.id,
    current + 43200,
  );
  await write(c.env.DB, "DELETE FROM login_limits WHERE key=?", key);
  setCookie(c, "crm_session", token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    path: "/",
    maxAge: 43200,
  });
  return c.json({ id: u.id, name: u.name, email: u.email });
});
auth.post("/logout", async (c) => {
  const t = getCookie(c, "crm_session");
  if (t)
    await write(c.env.DB, "DELETE FROM sessions WHERE token=?", await hash(t));
  deleteCookie(c, "crm_session", { path: "/" });
  return c.json({ ok: true });
});
export async function authenticate(c: Context<App>, next: () => Promise<void>) {
  const token = getCookie(c, "crm_session");
  if (!token) fail("יש להתחבר", 401);
  const u = await one<User>(
    c.env.DB,
    "SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>? AND u.active=1",
    await hash(token!),
    Math.floor(Date.now() / 1000),
  );
  if (!u) fail("יש להתחבר מחדש", 401);
  c.set("user", u!);
  await next();
}
auth.put("/password", authenticate, async (c) => {
  const d = z
    .object({
      current_password: z.string().min(1).max(256),
      password: z.string().min(12).max(256),
    })
    .parse(await c.req.json());
  const u = await one<{ password: string }>(
    c.env.DB,
    "SELECT password FROM users WHERE id=?",
    c.get("user").id,
  );
  if (
    !u ||
    !equal(
      await passwordHash(d.current_password, u.password.split(":")[0]),
      u.password,
    )
  )
    fail("הסיסמה הנוכחית אינה נכונה", 401);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password=? WHERE id=?").bind(
      await passwordHash(d.password),
      c.get("user").id,
    ),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND token<>?").bind(
      c.get("user").id,
      await hash(getCookie(c, "crm_session")!),
    ),
  ]);
  return c.json({ ok: true });
});
export async function workspace(
  c: Parameters<typeof authenticate>[0],
  next: () => Promise<void>,
) {
  const ws = c.req.param("ws")!;
  const m = await one<Member>(
    c.env.DB,
    "SELECT * FROM members WHERE workspace_id=? AND user_id=? AND active=1",
    ws,
    c.get("user").id,
  );
  if (!m) fail("אין גישה למכללה זו", 403);
  c.set("ws", ws);
  c.set("member", m!);
  await next();
}
