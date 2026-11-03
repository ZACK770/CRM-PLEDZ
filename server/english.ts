import { Hono } from "hono";
import { z } from "zod";
import { type App, type Env, fail, one, rows } from "./core";

export const ENGLISH_WS = "english";
export const USD_ILS = 3.7;
export const STATUS_LABELS: Record<string, string> = {
  free: "משתמש חינם",
  capped: "נתקע בתקרה",
  paying: "משלם פעיל",
  low_balance: "יתרה נמוכה",
  ended: "החבילה הסתיימה",
  churned: "נטש",
};
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const REMAINING =
  "(p.minutes*60-coalesce((SELECT sum(k.seconds) FROM en_calls k WHERE k.purchase_id=p.id),0))";
const ACTIVE = `p.lead_id=s.lead_id AND p.expires_at>${NOW}`;
const STATUS_SQL = `CASE
  WHEN EXISTS(SELECT 1 FROM en_purchases p WHERE ${ACTIVE} AND ${REMAINING}>max(600,p.minutes*12)) THEN 'paying'
  WHEN EXISTS(SELECT 1 FROM en_purchases p WHERE ${ACTIVE} AND ${REMAINING}>=60) THEN 'low_balance'
  WHEN EXISTS(SELECT 1 FROM en_purchases p WHERE p.lead_id=s.lead_id AND p.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')) THEN 'ended'
  WHEN EXISTS(SELECT 1 FROM en_purchases p WHERE p.lead_id=s.lead_id) THEN 'churned'
  WHEN EXISTS(SELECT 1 FROM en_calls k WHERE k.lead_id=s.lead_id AND k.mode IN ('basic','blocked')) THEN 'capped'
  ELSE 'free' END`;

export async function refreshStatuses(db: D1Database) {
  await db
    .prepare(
      `UPDATE en_subscribers SET status=n.st,status_at=${NOW}
       FROM (SELECT s.lead_id id,${STATUS_SQL} st FROM en_subscribers s) n
       WHERE n.id=en_subscribers.lead_id AND n.st!=en_subscribers.status`,
    )
    .run();
}

const iso = z
  .string()
  .min(10)
  .max(40)
  .transform((v, ctx) => {
    const t = Date.parse(v);
    if (Number.isNaN(t)) {
      ctx.addIssue({ code: "custom", message: "תאריך לא תקין" });
      return z.NEVER;
    }
    return new Date(t).toISOString();
  });
const key = z.string().trim().min(1).max(120);
const event = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("customer"),
    customer_id: key,
    phone: z.string().max(40).default(""),
    name: z.string().trim().max(200).default(""),
    email: z.union([z.string().email(), z.literal("")]).default(""),
    product: z.enum(["school", "translator", ""]).default(""),
    created_at: iso.optional(),
  }),
  z.object({
    type: z.literal("call"),
    call_id: key,
    customer_id: key,
    bot_id: z.string().max(80).default(""),
    product: z.string().max(40).default(""),
    mode: z.enum(["free", "basic", "paid", "blocked", "unrestricted", ""]).default(""),
    purchase_id: z.string().max(200).nullish(),
    seconds: z.coerce.number().min(0).max(86400).default(0),
    cost_usd: z.coerce.number().min(0).max(10000).default(0),
    started_at: iso,
  }),
  z.object({
    type: z.literal("purchase"),
    purchase_id: z.string().trim().min(1).max(200),
    customer_id: key,
    package_id: z.string().max(120).default(""),
    package_name: z.string().max(200).default(""),
    product: z.enum(["school", "translator"]),
    amount: z.coerce.number().min(0).max(100000),
    vat_rate: z.coerce.number().min(0).max(0.5).default(0.18),
    minutes: z.coerce.number().int().min(0).max(100000),
    expires_at: iso,
    created_at: iso,
  }),
  z.object({
    type: z.literal("package"),
    package_id: key,
    name: z.string().trim().min(1).max(200),
    product: z.enum(["school", "translator"]),
    minutes: z.coerce.number().int().min(0).max(100000),
    price: z.coerce.number().min(0).max(100000),
    validity_days: z.coerce.number().int().min(1).max(3650).default(30),
    active: z.boolean().default(false),
  }),
]);
type Event = z.infer<typeof event>;

const equal = (a: string, b: string) => {
  const x = new TextEncoder().encode(a),
    y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
};

function ensureCustomer(db: D1Database, customerId: string, phone = "", name = "", email = "", product = "", at?: string) {
  const source = product === "school" ? "school" : "translator";
  return [
    db
      .prepare(
        `INSERT INTO leads(workspace_id,id,name,email,phone,source_id,heat,stage,created_at) VALUES('${ENGLISH_WS}',?,?,?,?,?,?,'new',coalesce(?,${NOW}))
         ON CONFLICT(workspace_id,id) DO UPDATE SET
           phone=CASE WHEN excluded.phone!='' THEN excluded.phone ELSE leads.phone END,
           email=CASE WHEN leads.email='' THEN excluded.email ELSE leads.email END,
           name=CASE WHEN excluded.name!='' AND leads.name IN ('לקוח טלפוני',leads.phone) THEN excluded.name ELSE leads.name END`,
      )
      .bind(customerId, name || phone || "לקוח טלפוני", email.toLowerCase(), phone, source, source === "school" ? "hot" : "warm", at || null),
    db
      .prepare(
        `INSERT INTO en_subscribers(lead_id,phone,first_product,created_at) VALUES(?,?,?,coalesce(?,${NOW}))
         ON CONFLICT(lead_id) DO UPDATE SET phone=CASE WHEN excluded.phone!='' THEN excluded.phone ELSE en_subscribers.phone END,
           first_product=CASE WHEN en_subscribers.first_product='' THEN excluded.first_product ELSE en_subscribers.first_product END`,
      )
      .bind(customerId, phone, product, at || null),
  ];
}

function statements(db: D1Database, e: Event) {
  switch (e.type) {
    case "customer":
      return ensureCustomer(db, e.customer_id, e.phone, e.name, e.email, e.product, e.created_at);
    case "call":
      return [
        ...ensureCustomer(db, e.customer_id, "", "", "", e.product.startsWith("school") ? "school" : "translator", e.started_at),
        db
          .prepare(
            `INSERT INTO en_calls(call_id,lead_id,bot_id,product,mode,purchase_id,seconds,cost_usd,started_at) VALUES(?,?,?,?,?,?,?,?,?)
             ON CONFLICT(call_id) DO UPDATE SET bot_id=excluded.bot_id,product=excluded.product,mode=excluded.mode,
               purchase_id=excluded.purchase_id,seconds=excluded.seconds,cost_usd=excluded.cost_usd`,
          )
          .bind(e.call_id, e.customer_id, e.bot_id, e.product, e.mode, e.purchase_id || null, e.seconds, e.cost_usd, e.started_at),
        db
          .prepare(
            "UPDATE en_subscribers SET first_call_at=CASE WHEN first_call_at IS NULL OR first_call_at>? THEN ? ELSE first_call_at END,last_call_at=CASE WHEN last_call_at IS NULL OR last_call_at<? THEN ? ELSE last_call_at END WHERE lead_id=?",
          )
          .bind(e.started_at, e.started_at, e.started_at, e.started_at, e.customer_id),
      ];
    case "purchase":
      return [
        ...ensureCustomer(db, e.customer_id, "", "", "", e.product, e.created_at),
        db
          .prepare(
            `INSERT INTO en_purchases(id,lead_id,package_id,package_name,product,amount,vat_rate,minutes,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at,minutes=excluded.minutes,package_name=excluded.package_name`,
          )
          .bind(e.purchase_id, e.customer_id, e.package_id, e.package_name, e.product, e.amount, e.vat_rate, e.minutes, e.expires_at, e.created_at),
        db.prepare(`UPDATE leads SET stage='won' WHERE workspace_id='${ENGLISH_WS}' AND id=?`).bind(e.customer_id),
      ];
    case "package":
      return [
        db
          .prepare(
            `INSERT INTO en_packages(id,name,product,minutes,price,validity_days,active,updated_at) VALUES(?,?,?,?,?,?,?,${NOW})
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,product=excluded.product,minutes=excluded.minutes,price=excluded.price,
               validity_days=excluded.validity_days,active=excluded.active,updated_at=excluded.updated_at`,
          )
          .bind(e.package_id, e.name, e.product, e.minutes, e.price, e.validity_days, e.active ? 1 : 0),
      ];
  }
}

export async function ingestEnglish(req: Request, env: Env) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
  if (!env.ENGLISH_INGEST_SECRET || env.ENGLISH_INGEST_SECRET.length < 32 || !equal(token, env.ENGLISH_INGEST_SECRET))
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = z
    .object({ events: z.array(event).min(1).max(200) })
    .parse(await req.json());
  const stmts = body.events.flatMap((e) => statements(env.DB, e));
  for (let i = 0; i < stmts.length; i += 400) await env.DB.batch(stmts.slice(i, i + 400));
  await refreshStatuses(env.DB);
  return Response.json({ ok: true, events: body.events.length });
}

export const english = new Hono<App>();
english.use("/en/*", async (c, next) => {
  if (c.get("ws") !== ENGLISH_WS) fail("המסך זמין רק במרחב בית הספר לאנגלית", 404);
  if (!["owner", "manager"].includes(c.get("member").role)) fail("נדרשת הרשאת מנהל", 403);
  await next();
});
english.get("/en/overview", async (c) => {
  const db = c.env.DB;
  const [statuses, sales, usage, joined, funnel, subscribers, packages] = await Promise.all([
    rows(db, "SELECT status,count(*) n FROM en_subscribers GROUP BY status"),
    rows(
      db,
      "SELECT substr(created_at,1,7) month,count(*) purchases,count(DISTINCT lead_id) payers,sum(amount) gross,sum(amount/(1+vat_rate)) net,sum(CASE WHEN product='school' THEN amount/(1+vat_rate) ELSE 0 END) school_net,sum(CASE WHEN product='translator' THEN amount/(1+vat_rate) ELSE 0 END) translator_net,sum(CASE WHEN EXISTS(SELECT 1 FROM en_purchases o WHERE o.lead_id=en_purchases.lead_id AND o.created_at<en_purchases.created_at) THEN 1 ELSE 0 END) repeat_purchases FROM en_purchases GROUP BY month ORDER BY month DESC LIMIT 12",
    ),
    rows(
      db,
      "SELECT substr(started_at,1,7) month,count(*) calls,count(DISTINCT lead_id) callers,sum(seconds)/60.0 minutes,sum(cost_usd) cost_usd,sum(CASE WHEN mode IN ('free','basic') OR purchase_id IS NULL THEN cost_usd ELSE 0 END) free_cost_usd,sum(CASE WHEN mode IN ('free','basic') OR purchase_id IS NULL THEN seconds ELSE 0 END)/60.0 free_minutes FROM en_calls GROUP BY month ORDER BY month DESC LIMIT 12",
    ),
    rows(db, "SELECT substr(created_at,1,7) month,count(*) n FROM en_subscribers GROUP BY month ORDER BY month DESC LIMIT 12"),
    one(
      db,
      "SELECT count(*) total,sum(CASE WHEN EXISTS(SELECT 1 FROM en_calls k WHERE k.lead_id=s.lead_id AND k.mode IN ('basic','blocked')) OR EXISTS(SELECT 1 FROM en_purchases p WHERE p.lead_id=s.lead_id) THEN 1 ELSE 0 END) reached_cap,sum(CASE WHEN EXISTS(SELECT 1 FROM en_purchases p WHERE p.lead_id=s.lead_id) THEN 1 ELSE 0 END) paid,sum(CASE WHEN (SELECT count(*) FROM en_purchases p WHERE p.lead_id=s.lead_id)>1 THEN 1 ELSE 0 END) repeat FROM en_subscribers s",
    ),
    rows(
      db,
      `SELECT s.*,l.name,l.email,
        (SELECT coalesce(sum(max(0,${REMAINING})),0)/60.0 FROM en_purchases p WHERE ${ACTIVE}) balance_minutes,
        (SELECT min(p.expires_at) FROM en_purchases p WHERE ${ACTIVE}) expires_at,
        (SELECT p.package_name FROM en_purchases p WHERE p.lead_id=s.lead_id ORDER BY p.created_at DESC LIMIT 1) last_package,
        (SELECT coalesce(sum(p.amount),0) FROM en_purchases p WHERE p.lead_id=s.lead_id) total_paid,
        (SELECT count(*) FROM en_calls k WHERE k.lead_id=s.lead_id) calls,
        (SELECT coalesce(sum(k.seconds),0)/60.0 FROM en_calls k WHERE k.lead_id=s.lead_id AND k.started_at>=strftime('%Y-%m-01T00:00:00Z','now')) minutes_month
       FROM en_subscribers s JOIN leads l ON l.workspace_id='${ENGLISH_WS}' AND l.id=s.lead_id
       ORDER BY coalesce(s.last_call_at,s.created_at) DESC LIMIT 1000`,
    ),
    rows(db, "SELECT * FROM en_packages ORDER BY active DESC,product,price"),
  ]);
  return c.json({ usd_ils: USD_ILS, labels: STATUS_LABELS, statuses, sales, usage, joined, funnel, subscribers, packages });
});
english.get("/en/subscribers/:id", async (c) => {
  const db = c.env.DB,
    lid = c.req.param("id");
  const subscriber = await one(
    db,
    `SELECT s.*,l.name,l.email,l.notes FROM en_subscribers s JOIN leads l ON l.workspace_id='${ENGLISH_WS}' AND l.id=s.lead_id WHERE s.lead_id=?`,
    lid,
  );
  if (!subscriber) fail("המנוי לא נמצא", 404);
  const [purchases, calls] = await Promise.all([
    rows(db, `SELECT p.*,${REMAINING}/60.0 remaining_minutes FROM en_purchases p WHERE p.lead_id=? ORDER BY p.created_at DESC`, lid),
    rows(db, "SELECT * FROM en_calls WHERE lead_id=? ORDER BY started_at DESC LIMIT 200", lid),
  ]);
  return c.json({ subscriber, purchases, calls, labels: STATUS_LABELS });
});
