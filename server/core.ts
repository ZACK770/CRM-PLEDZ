import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  BOOTSTRAP_TOKEN?: string;
  BREVO_WOMEN_API_KEY?: string;
  BREVO_MEN_API_KEY?: string;
  BREVO_WEBHOOK_TOKEN?: string;
  APP_NAME: string;
};
export type User = { id: string; name: string; email: string };
export type Member = {
  workspace_id: string;
  user_id: string;
  role: "owner" | "manager" | "sales" | "class_manager" | "teacher";
  capacity: number;
};
export type App = {
  Bindings: Env;
  Variables: { user: User; member: Member; ws: string };
};
export const id = () => crypto.randomUUID();
export function fail(
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 429 | 503 = 400,
): never {
  throw new HTTPException(status, { message });
}
export const rows = async <T = Record<string, any>>(
  db: D1Database,
  sql: string,
  ...values: unknown[]
): Promise<T[]> =>
  (
    await db
      .prepare(sql)
      .bind(...values)
      .all<T>()
  ).results;
export const one = <T = Record<string, any>>(
  db: D1Database,
  sql: string,
  ...values: unknown[]
) =>
  db
    .prepare(sql)
    .bind(...values)
    .first<T>();
export const write = (db: D1Database, sql: string, ...values: unknown[]) =>
  db
    .prepare(sql)
    .bind(...values)
    .run();
export const elevated = (m: Member) => ["owner", "manager"].includes(m.role);
export const requireManager = (c: Context<App>) => {
  if (!elevated(c.get("member"))) fail("נדרשת הרשאת מנהל", 403);
};
export const now = () => new Date().toISOString();
export const hash = async (s: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
export async function audit(
  c: Context<App>,
  action: string,
  leadId: string | null = null,
) {
  await write(
    c.env.DB,
    "INSERT INTO activity(workspace_id,id,lead_id,user_id,action) VALUES(?,?,?,?,?)",
    c.get("ws"),
    id(),
    leadId,
    c.get("user").id,
    action,
  );
}
export async function leadAccess(c: Context<App>, leadId: string) {
  const lead = await one(
    c.env.DB,
    "SELECT * FROM leads WHERE workspace_id=? AND id=?",
    c.get("ws"),
    leadId,
  );
  if (!lead) fail("הרשומה לא נמצאה", 404);
  const m = c.get("member");
  if (!elevated(m) && !(m.role === "sales" && lead.assignee_id === m.user_id))
    fail("אין הרשאה לליד זה", 403);
  return lead;
}
export async function classAccess(c: Context<App>, classId: string) {
  const record = await one(
    c.env.DB,
    "SELECT * FROM classes WHERE workspace_id=? AND id=?",
    c.get("ws"),
    classId,
  );
  if (!record) fail("הכיתה לא נמצאה", 404);
  const m = c.get("member");
  if (
    !elevated(m) &&
    record.teacher_id !== m.user_id &&
    record.manager_id !== m.user_id
  )
    fail("אין הרשאה לכיתה", 403);
  return record;
}
export async function memberExists(
  c: Context<App>,
  userId: string,
  roles?: string[],
) {
  const m = await one(
    c.env.DB,
    "SELECT * FROM members WHERE workspace_id=? AND user_id=? AND active=1",
    c.get("ws"),
    userId,
  );
  if (!m || (roles && !roles.includes(m.role)))
    fail("איש הצוות אינו בתפקיד המתאים במכללה זו");
}
