import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { type App, type Env, fail, hash, id, now, one, rows, write } from "./core";
const b64 = (buf: ArrayBuffer) => { let out = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) out += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(out); };

export const mk = new Hono<App>();
type R = Record<string, any>;
const esc = (v: string) =>
  String(v).replace(
    /[&<>"']/g,
    (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[x]!,
  );
const brevoKey = (env: Env, ws: string) =>
  ws === "women" ? env.BREVO_WOMEN_API_KEY : env.BREVO_MEN_API_KEY;
const SITE = "https://the-impact.net/crm";
const BATCH = 300;

async function ownerOnly(c: Context<App>, next: () => Promise<void>) {
  const inst = await one(c.env.DB, "SELECT owner_id FROM installation WHERE id=1");
  if (!inst || inst.owner_id !== c.get("user").id)
    fail("פלטפורמת הדיוור זמינה לבעלים בלבד", 403);
  await next();
}
mk.use("*", ownerOnly);

// ---------- audience rules ----------
const cond = z.object({
  field: z.string().max(60),
  op: z.string().max(20),
  value: z.string().max(300).optional().default(""),
});
const rulesSchema = z.object({
  match: z.enum(["all", "any"]).default("all"),
  conditions: z.array(cond).max(20).default([]),
});
type Rules = z.infer<typeof rulesSchema>;
const audienceSchema = z.object({
  all: z.boolean().default(false),
  lists: z.array(z.string()).max(20).default([]),
  segments: z.array(z.string()).max(10).default([]),
  exclude_lists: z.array(z.string()).max(20).default([]),
  exclude_segments: z.array(z.string()).max(10).default([]),
});
type Audience = z.infer<typeof audienceSchema>;
const TEXT_FIELDS = ["email", "name", "phone", "source", "campaign", "stage", "course", "workspace_id", "status"];

function condSql(c: z.infer<typeof cond>, p: unknown[]): string {
  const v = c.value ?? "";
  const text = (col: string) => {
    switch (c.op) {
      case "eq": p.push(v); return `${col}=?`;
      case "neq": p.push(v); return `${col}!=?`;
      case "contains": p.push(`%${v}%`); return `${col} LIKE ?`;
      case "not_contains": p.push(`%${v}%`); return `${col} NOT LIKE ?`;
      case "empty": return `${col}=''`;
      case "not_empty": return `${col}!=''`;
      default: return fail("תנאי לא תקין");
    }
  };
  if (TEXT_FIELDS.includes(c.field)) return text(`c.${c.field}`);
  switch (c.field) {
    case "tag":
      p.push(`%,${v.trim()},%`);
      return c.op === "not_has" ? "c.tags NOT LIKE ?" : "c.tags LIKE ?";
    case "consent":
      return c.op === "no" ? "c.consent=0" : "c.consent=1";
    case "list":
      p.push(v);
      return `${c.op === "not_in" ? "NOT " : ""}EXISTS(SELECT 1 FROM mk_list_members lm WHERE lm.contact_id=c.id AND lm.list_id=?)`;
    case "created_at":
      p.push(v);
      return c.op === "before" ? "c.created_at<?" : "c.created_at>=?";
    case "opens":
    case "clicks":
      p.push(Number(v) || 0);
      return c.op === "lte" ? `c.${c.field}<=?` : `c.${c.field}>=?`;
    case "last_open":
    case "last_click": {
      const col = c.field === "last_open" ? "c.last_open_at" : "c.last_click_at";
      p.push(`-${Math.max(1, Number(v) || 30)} days`);
      const since = "strftime('%Y-%m-%dT%H:%M:%fZ','now',?)";
      return c.op === "not_within" ? `(${col} IS NULL OR ${col}<${since})` : `${col}>=${since}`;
    }
    case "opened_campaign":
    case "clicked_campaign":
    case "received_campaign": {
      p.push(v);
      const where =
        c.field === "opened_campaign" ? "s.opened_at IS NOT NULL" : c.field === "clicked_campaign" ? "s.clicked_at IS NOT NULL" : "s.status='sent'";
      return `${c.op === "no" ? "NOT " : ""}EXISTS(SELECT 1 FROM mk_sends s WHERE s.contact_id=c.id AND s.campaign_id=? AND ${where})`;
    }
  }
  if (c.field.startsWith("field:")) {
    const k = c.field.slice(6);
    if (!/^[\w\u0590-\u05FF -]{1,40}$/.test(k)) fail("שם שדה לא תקין");
    p.push(`$."${k}"`);
    return text("coalesce(json_extract(c.fields,?),'')");
  }
  return fail("שדה לא מוכר בתנאי");
}
function rulesSql(r: Rules, p: unknown[]) {
  if (!r.conditions.length) return "1=1";
  return "(" + r.conditions.map((c) => condSql(c, p)).join(r.match === "any" ? " OR " : " AND ") + ")";
}
async function audienceSql(db: D1Database, a: Audience, p: unknown[]) {
  const ids = [...a.segments, ...a.exclude_segments];
  const segs = ids.length
    ? await rows(db, `SELECT id,rules FROM mk_segments WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids)
    : [];
  const segRule = (sid: string) => {
    const s = segs.find((x) => x.id === sid);
    return s ? rulesSql(rulesSchema.parse(JSON.parse(s.rules || "{}")), p) : "0";
  };
  const inc: string[] = [];
  if (a.all) inc.push("1=1");
  if (a.lists.length) {
    p.push(...a.lists);
    inc.push(`EXISTS(SELECT 1 FROM mk_list_members lm WHERE lm.contact_id=c.id AND lm.list_id IN (${a.lists.map(() => "?").join(",")}))`);
  }
  for (const sid of a.segments) inc.push(segRule(sid));
  let sql = inc.length ? `(${inc.join(" OR ")})` : "0";
  if (a.exclude_lists.length) {
    p.push(...a.exclude_lists);
    sql += ` AND NOT EXISTS(SELECT 1 FROM mk_list_members lx WHERE lx.contact_id=c.id AND lx.list_id IN (${a.exclude_lists.map(() => "?").join(",")}))`;
  }
  for (const sid of a.exclude_segments) sql += ` AND NOT ${segRule(sid)}`;
  return sql;
}
const SENDABLE = "c.email!='' AND c.status='active'";

// ---------- contacts ----------
export async function syncLeads(db: D1Database) {
  await write(
    db,
    `INSERT INTO mk_contacts(id,email,phone,name,workspace_id,lead_id,source,campaign,stage,course,consent,created_at)
     SELECT lower(hex(randomblob(16))),lower(l.email),l.phone,l.name,l.workspace_id,l.id,coalesce(s.name,''),coalesce(cp.name,''),l.stage,coalesce(co.name,''),l.marketing_consent,l.created_at
     FROM leads l
     LEFT JOIN sources s ON s.workspace_id=l.workspace_id AND s.id=l.source_id
     LEFT JOIN campaigns cp ON cp.workspace_id=l.workspace_id AND cp.id=l.campaign_id
     LEFT JOIN courses co ON co.workspace_id=l.workspace_id AND co.id=l.course_id
     WHERE l.email!='' AND l.email LIKE '%@%'
     ORDER BY l.created_at
     ON CONFLICT(email) WHERE email!='' DO UPDATE SET
       phone=CASE WHEN excluded.phone!='' THEN excluded.phone ELSE mk_contacts.phone END,
       name=CASE WHEN mk_contacts.name='' THEN excluded.name ELSE mk_contacts.name END,
       workspace_id=excluded.workspace_id,lead_id=excluded.lead_id,source=excluded.source,campaign=excluded.campaign,
       stage=excluded.stage,course=excluded.course,consent=excluded.consent,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  );
}
mk.get("/me", (c) => c.json({ ok: true }));
mk.post("/sync-leads", async (c) => {
  await syncLeads(c.env.DB);
  return c.json({ ok: true });
});
const contactQuery = z.object({
  q: z.string().max(100).default(""),
  list: z.string().max(60).default(""),
  segment: z.string().max(60).default(""),
  status: z.string().max(20).default(""),
  page: z.coerce.number().int().min(0).max(10000).default(0),
});
async function contactFilter(db: D1Database, q: z.infer<typeof contactQuery>, p: unknown[]) {
  let where = "1=1";
  if (q.q) {
    p.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`);
    where += " AND (c.email LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)";
  }
  if (q.list) {
    p.push(q.list);
    where += " AND EXISTS(SELECT 1 FROM mk_list_members lm WHERE lm.contact_id=c.id AND lm.list_id=?)";
  }
  if (q.status) {
    p.push(q.status);
    where += " AND c.status=?";
  }
  if (q.segment) {
    const s = await one(db, "SELECT rules FROM mk_segments WHERE id=?", q.segment);
    if (s) where += " AND " + rulesSql(rulesSchema.parse(JSON.parse(s.rules || "{}")), p);
  }
  return where;
}
mk.get("/contacts", async (c) => {
  const q = contactQuery.parse(c.req.query());
  const p: unknown[] = [];
  const where = await contactFilter(c.env.DB, q, p);
  const total = await one(c.env.DB, `SELECT count(*) n FROM mk_contacts c WHERE ${where}`, ...p);
  const list = await rows(
    c.env.DB,
    `SELECT c.*,(SELECT group_concat(list_id) FROM mk_list_members lm WHERE lm.contact_id=c.id) lists FROM mk_contacts c WHERE ${where} ORDER BY c.created_at DESC LIMIT 100 OFFSET ?`,
    ...p,
    q.page * 100,
  );
  return c.json({ total: total?.n || 0, contacts: list });
});
mk.get("/contacts/export", async (c) => {
  const q = contactQuery.parse(c.req.query());
  const p: unknown[] = [];
  const where = await contactFilter(c.env.DB, q, p);
  const list = await rows(c.env.DB, `SELECT c.* FROM mk_contacts c WHERE ${where} ORDER BY c.created_at DESC LIMIT 50000`, ...p);
  const cols = ["email", "name", "phone", "workspace_id", "source", "campaign", "stage", "course", "tags", "consent", "status", "opens", "clicks", "last_open_at", "created_at"];
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "\ufeff" + [cols.join(","), ...list.map((r) => cols.map((k) => cell(k === "tags" ? String(r.tags).replace(/^,|,$/g, "") : r[k])).join(","))].join("\n");
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="contacts.csv"' },
  });
});
mk.get("/contacts/:id", async (c) => {
  const contact = await one(c.env.DB, "SELECT * FROM mk_contacts WHERE id=?", c.req.param("id"));
  if (!contact) fail("איש קשר לא נמצא", 404);
  const history = await rows(
    c.env.DB,
    "SELECT s.*,m.name campaign_name,m.subject FROM mk_sends s JOIN mk_campaigns m ON m.id=s.campaign_id WHERE s.contact_id=? ORDER BY s.sent_at DESC LIMIT 100",
    contact.id,
  );
  const lists = await rows(c.env.DB, "SELECT list_id FROM mk_list_members WHERE contact_id=?", contact.id);
  return c.json({ contact, history, lists: lists.map((l) => l.list_id) });
});
const tagsText = (t: string[] | string) => {
  const arr = (Array.isArray(t) ? t : String(t).split(/[,;|]/)).map((x) => x.trim()).filter(Boolean);
  return "," + [...new Set(arr)].join(",") + (arr.length ? "," : "");
};
const contactInput = z.object({
  email: z.union([z.string().trim().toLowerCase().email(), z.literal("")]).default(""),
  name: z.string().trim().max(200).default(""),
  phone: z.string().trim().max(40).default(""),
  tags: z.union([z.string(), z.array(z.string())]).default(""),
  fields: z.record(z.string(), z.string().max(500)).default({}),
  consent: z.boolean().default(false),
  status: z.enum(["active", "unsubscribed", "bounced", "complained"]).default("active"),
});
mk.post("/contacts", async (c) => {
  const d = contactInput.parse(await c.req.json());
  if (!d.email && !d.phone) fail("נדרש מייל או טלפון");
  const cid = id();
  await write(
    c.env.DB,
    "INSERT INTO mk_contacts(id,email,phone,name,tags,fields,consent,status,source) VALUES(?,?,?,?,?,?,?,?,'ידני')",
    cid, d.email, d.phone, d.name, tagsText(d.tags), JSON.stringify(d.fields), d.consent ? 1 : 0, d.status,
  );
  return c.json({ id: cid }, 201);
});
mk.put("/contacts/:id", async (c) => {
  const d = contactInput.parse(await c.req.json());
  await write(
    c.env.DB,
    "UPDATE mk_contacts SET email=?,phone=?,name=?,tags=?,fields=?,consent=?,status=?,updated_at=? WHERE id=?",
    d.email, d.phone, d.name, tagsText(d.tags), JSON.stringify(d.fields), d.consent ? 1 : 0, d.status, now(), c.req.param("id"),
  );
  return c.json({ ok: true });
});
const bulkInput = z.object({
  ids: z.array(z.string()).max(90).default([]),
  filter: contactQuery.partial().optional(),
  action: z.enum(["add_list", "remove_list", "tag", "untag", "delete", "unsubscribe", "resubscribe", "consent", "no_consent"]),
  value: z.string().max(100).default(""),
});
mk.post("/contacts/bulk", async (c) => {
  const d = bulkInput.parse(await c.req.json());
  const p: unknown[] = [];
  let where: string;
  if (d.filter) where = await contactFilter(c.env.DB, contactQuery.parse(d.filter), p);
  else {
    if (!d.ids.length) fail("לא נבחרו אנשי קשר");
    where = `c.id IN (${d.ids.map(() => "?").join(",")})`;
    p.push(...d.ids);
  }
  const sel = `SELECT c.id FROM mk_contacts c WHERE ${where}`;
  const db = c.env.DB;
  switch (d.action) {
    case "add_list":
      await write(db, `INSERT OR IGNORE INTO mk_list_members(list_id,contact_id) SELECT ?,c.id FROM mk_contacts c WHERE ${where}`, d.value, ...p);
      break;
    case "remove_list":
      await write(db, `DELETE FROM mk_list_members WHERE list_id=? AND contact_id IN (${sel})`, d.value, ...p);
      break;
    case "tag":
      await write(db, `UPDATE mk_contacts SET tags=tags||?||',' WHERE id IN (${sel}) AND tags NOT LIKE ?`, d.value.trim(), ...p, `%,${d.value.trim()},%`);
      break;
    case "untag":
      await write(db, `UPDATE mk_contacts SET tags=replace(tags,?,',') WHERE id IN (${sel})`, `,${d.value.trim()},`, ...p);
      break;
    case "delete": {
      const ids = (await rows(db, sel, ...p)).map((r) => r.id as string);
      for (let i = 0; i < ids.length; i += 90) {
        const chunk = ids.slice(i, i + 90), q = chunk.map(() => "?").join(",");
        await db.batch([
          db.prepare(`DELETE FROM mk_list_members WHERE contact_id IN (${q})`).bind(...chunk),
          db.prepare(`DELETE FROM mk_contacts WHERE id IN (${q})`).bind(...chunk),
        ]);
      }
      break;
    }
    case "unsubscribe":
      await write(db, `UPDATE mk_contacts SET status='unsubscribed' WHERE id IN (${sel})`, ...p);
      break;
    case "resubscribe":
      await write(db, `UPDATE mk_contacts SET status='active' WHERE id IN (${sel})`, ...p);
      break;
    case "consent":
    case "no_consent":
      await write(db, `UPDATE mk_contacts SET consent=? WHERE id IN (${sel})`, d.action === "consent" ? 1 : 0, ...p);
      break;
  }
  return c.json({ ok: true });
});
const importInput = z.object({
  rows: z
    .array(
      z.object({
        email: z.string().trim().toLowerCase().max(254).default(""),
        name: z.string().trim().max(200).default(""),
        phone: z.string().trim().max(40).default(""),
        tags: z.string().max(300).default(""),
        fields: z.record(z.string(), z.string().max(500)).default({}),
      }),
    )
    .max(300),
  list_id: z.string().max(60).default(""),
  tags: z.string().max(200).default(""),
  consent: z.boolean().default(false),
});
mk.post("/contacts/import", async (c) => {
  const d = importInput.parse(await c.req.json());
  const valid = d.rows.filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email));
  const db = c.env.DB;
  const stmts: D1PreparedStatement[] = [];
  const per = 12;
  for (let i = 0; i < valid.length; i += per) {
    const chunk = valid.slice(i, i + per);
    const p: unknown[] = [];
    for (const r of chunk)
      p.push(id(), r.email, r.phone, r.name, tagsText(`${r.tags},${d.tags}`), JSON.stringify(r.fields), d.consent ? 1 : 0);
    stmts.push(
      db
        .prepare(
          `INSERT INTO mk_contacts(id,email,phone,name,tags,fields,consent,source) VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,'ייבוא')").join(",")}
           ON CONFLICT(email) WHERE email!='' DO UPDATE SET
             name=CASE WHEN excluded.name!='' THEN excluded.name ELSE mk_contacts.name END,
             phone=CASE WHEN excluded.phone!='' THEN excluded.phone ELSE mk_contacts.phone END,
             tags=CASE WHEN excluded.tags=',' THEN mk_contacts.tags ELSE mk_contacts.tags||substr(excluded.tags,2) END,
             fields=json_patch(mk_contacts.fields,excluded.fields),
             consent=max(mk_contacts.consent,excluded.consent),
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
        )
        .bind(...p),
    );
  }
  if (d.list_id)
    for (let i = 0; i < valid.length; i += 90) {
      const chunk = valid.slice(i, i + 90).map((r) => r.email);
      stmts.push(
        db
          .prepare(`INSERT OR IGNORE INTO mk_list_members(list_id,contact_id) SELECT ?,id FROM mk_contacts WHERE email IN (${chunk.map(() => "?").join(",")})`)
          .bind(d.list_id, ...chunk),
      );
    }
  if (stmts.length) await db.batch(stmts);
  return c.json({ imported: valid.length, skipped: d.rows.length - valid.length });
});

// ---------- lists & segments ----------
mk.get("/lists", async (c) =>
  c.json(
    await rows(
      c.env.DB,
      "SELECT l.*,(SELECT count(*) FROM mk_list_members m WHERE m.list_id=l.id) members,(SELECT count(*) FROM mk_list_members m JOIN mk_contacts c ON c.id=m.contact_id WHERE m.list_id=l.id AND c.status='active' AND c.email!='') active FROM mk_lists l ORDER BY l.created_at DESC",
    ),
  ),
);
const listInput = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(500).default("") });
mk.post("/lists", async (c) => {
  const d = listInput.parse(await c.req.json());
  const lid = id();
  await write(c.env.DB, "INSERT INTO mk_lists(id,name,description) VALUES(?,?,?)", lid, d.name, d.description);
  return c.json({ id: lid }, 201);
});
mk.put("/lists/:id", async (c) => {
  const d = listInput.parse(await c.req.json());
  await write(c.env.DB, "UPDATE mk_lists SET name=?,description=? WHERE id=?", d.name, d.description, c.req.param("id"));
  return c.json({ ok: true });
});
mk.delete("/lists/:id", async (c) => {
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM mk_list_members WHERE list_id=?").bind(c.req.param("id")),
    c.env.DB.prepare("DELETE FROM mk_lists WHERE id=?").bind(c.req.param("id")),
  ]);
  return c.json({ ok: true });
});
mk.get("/segments", async (c) => c.json(await rows(c.env.DB, "SELECT * FROM mk_segments ORDER BY created_at DESC")));
const segInput = z.object({ name: z.string().trim().min(1).max(120), rules: rulesSchema });
mk.post("/segments", async (c) => {
  const d = segInput.parse(await c.req.json());
  rulesSql(d.rules, []);
  const sid = id();
  await write(c.env.DB, "INSERT INTO mk_segments(id,name,rules) VALUES(?,?,?)", sid, d.name, JSON.stringify(d.rules));
  return c.json({ id: sid }, 201);
});
mk.put("/segments/:id", async (c) => {
  const d = segInput.parse(await c.req.json());
  rulesSql(d.rules, []);
  await write(c.env.DB, "UPDATE mk_segments SET name=?,rules=? WHERE id=?", d.name, JSON.stringify(d.rules), c.req.param("id"));
  return c.json({ ok: true });
});
mk.delete("/segments/:id", async (c) => {
  await write(c.env.DB, "DELETE FROM mk_segments WHERE id=?", c.req.param("id"));
  return c.json({ ok: true });
});
mk.post("/segments/preview", async (c) => {
  const r = rulesSchema.parse(await c.req.json());
  const p: unknown[] = [];
  const where = rulesSql(r, p);
  const n = await one(c.env.DB, `SELECT count(*) n,sum(CASE WHEN ${SENDABLE} THEN 1 ELSE 0 END) sendable FROM mk_contacts c WHERE ${where}`, ...p);
  return c.json({ total: n?.n || 0, sendable: n?.sendable || 0 });
});
const EXCLUDED = `sum(CASE WHEN c.email='' THEN 1 ELSE 0 END) no_email,
  sum(CASE WHEN c.email!='' AND c.status='unsubscribed' THEN 1 ELSE 0 END) unsubscribed,
  sum(CASE WHEN c.email!='' AND c.status='bounced' THEN 1 ELSE 0 END) bounced,
  sum(CASE WHEN c.email!='' AND c.status='complained' THEN 1 ELSE 0 END) complained`;
mk.post("/audience/count", async (c) => {
  const a = audienceSchema.parse(await c.req.json());
  const p: unknown[] = [];
  const where = await audienceSql(c.env.DB, a, p);
  const n = await one(
    c.env.DB,
    `SELECT count(*) n,sum(CASE WHEN ${SENDABLE} THEN 1 ELSE 0 END) sendable,sum(CASE WHEN c.consent=1 AND ${SENDABLE} THEN 1 ELSE 0 END) consented,${EXCLUDED} FROM mk_contacts c WHERE ${where}`,
    ...p,
  );
  return c.json({
    total: n?.n || 0, sendable: n?.sendable || 0, consented: n?.consented || 0,
    excluded: { no_email: n?.no_email || 0, unsubscribed: n?.unsubscribed || 0, bounced: n?.bounced || 0, complained: n?.complained || 0 },
  });
});

// ---------- campaigns ----------
const campaignInput = z.object({
  name: z.string().trim().min(1).max(200),
  channel: z.enum(["email", "sms", "voice"]).default("email"),
  workspace_id: z.enum(["women", "men"]).default("women"),
  from_name: z.string().trim().max(120).default(""),
  subject: z.string().trim().max(300).default(""),
  subject_b: z.string().trim().max(300).default(""),
  ab_percent: z.coerce.number().int().min(0).max(50).default(0),
  ab_hours: z.coerce.number().int().min(1).max(72).default(4),
  preheader: z.string().max(300).default(""),
  html: z.string().max(900_000).default(""),
  ad_prefix: z.boolean().default(true),
  audience: audienceSchema.default({ all: false, lists: [], segments: [], exclude_lists: [], exclude_segments: [] }),
});
const STATS = `count(*) total,
  sum(CASE WHEN s.status='sent' THEN 1 ELSE 0 END) sent,
  sum(CASE WHEN s.delivered_at IS NOT NULL THEN 1 ELSE 0 END) delivered,
  sum(CASE WHEN s.opened_at IS NOT NULL THEN 1 ELSE 0 END) opened,
  sum(CASE WHEN s.clicked_at IS NOT NULL THEN 1 ELSE 0 END) clicked,
  sum(s.opens) opens,sum(s.clicks) clicks,
  sum(CASE WHEN s.unsubscribed_at IS NOT NULL THEN 1 ELSE 0 END) unsubscribed,
  sum(CASE WHEN s.bounced!='' THEN 1 ELSE 0 END) bounced,
  sum(CASE WHEN s.status='failed' THEN 1 ELSE 0 END) failed`;
mk.get("/campaigns", async (c) => {
  const list = await rows(
    c.env.DB,
    "SELECT id,name,channel,status,workspace_id,subject,subject_b,ab_percent,ab_winner,scheduled_at,started_at,finished_at,last_error,resume_at,excluded,total,sent,created_at,updated_at FROM mk_campaigns ORDER BY created_at DESC",
  );
  const stats = await rows(c.env.DB, `SELECT s.campaign_id,${STATS} FROM mk_sends s GROUP BY s.campaign_id`);
  return c.json(list.map((m) => ({ ...m, stats: stats.find((x) => x.campaign_id === m.id) || null })));
});
mk.get("/campaigns/:id", async (c) => {
  const m = await one(c.env.DB, "SELECT * FROM mk_campaigns WHERE id=?", c.req.param("id"));
  if (!m) fail("קמפיין לא נמצא", 404);
  return c.json(m);
});
mk.post("/campaigns", async (c) => {
  const d = campaignInput.parse(await c.req.json());
  const cid = id();
  await write(
    c.env.DB,
    "INSERT INTO mk_campaigns(id,name,channel,workspace_id,from_name,subject,subject_b,ab_percent,ab_hours,preheader,html,ad_prefix,audience) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    cid, d.name, d.channel, d.workspace_id, d.from_name, d.subject, d.subject_b, d.ab_percent, d.ab_hours, d.preheader, d.html, d.ad_prefix ? 1 : 0, JSON.stringify(d.audience),
  );
  return c.json({ id: cid }, 201);
});
mk.put("/campaigns/:id", async (c) => {
  const d = campaignInput.parse(await c.req.json());
  const r = await write(
    c.env.DB,
    "UPDATE mk_campaigns SET name=?,channel=?,workspace_id=?,from_name=?,subject=?,subject_b=?,ab_percent=?,ab_hours=?,preheader=?,html=?,ad_prefix=?,audience=?,updated_at=? WHERE id=? AND status IN ('draft','scheduled')",
    d.name, d.channel, d.workspace_id, d.from_name, d.subject, d.subject_b, d.ab_percent, d.ab_hours, d.preheader, d.html, d.ad_prefix ? 1 : 0, JSON.stringify(d.audience), now(), c.req.param("id"),
  );
  if (!r.meta.changes) fail("אפשר לערוך רק קמפיין שטרם נשלח", 409);
  return c.json({ ok: true });
});
mk.post("/campaigns/:id/duplicate", async (c) => {
  const cid = id();
  await write(
    c.env.DB,
    "INSERT INTO mk_campaigns(id,name,channel,workspace_id,from_name,subject,subject_b,ab_percent,ab_hours,preheader,html,ad_prefix,audience) SELECT ?,name||' (עותק)',channel,workspace_id,from_name,subject,subject_b,ab_percent,ab_hours,preheader,html,ad_prefix,audience FROM mk_campaigns WHERE id=?",
    cid, c.req.param("id"),
  );
  await write(c.env.DB, "INSERT INTO mk_attachments(id,campaign_id,name,mime,size,data) SELECT lower(hex(randomblob(16))),?,name,mime,size,data FROM mk_attachments WHERE campaign_id=?", cid, c.req.param("id"));
  return c.json({ id: cid }, 201);
});
mk.get("/campaigns/:id/attachments", async (c) =>
  c.json(await rows(c.env.DB, "SELECT id,name,mime,size FROM mk_attachments WHERE campaign_id=? ORDER BY created_at", c.req.param("id"))),
);
mk.post("/campaigns/:id/attachments", async (c) => {
  const d = z.object({ name: z.string().trim().min(1).max(200), mime: z.string().max(120).default("application/octet-stream"), data: z.string().max(2_700_000) }).parse(await c.req.json());
  const bytes = Uint8Array.from(atob(d.data), (ch) => ch.charCodeAt(0));
  if (bytes.length > 1_900_000) fail("קובץ גדול מ־1.9MB");
  const used = await one(c.env.DB, "SELECT coalesce(sum(size),0) n FROM mk_attachments WHERE campaign_id=?", c.req.param("id"));
  if ((used?.n || 0) + bytes.length > 4_000_000) fail("סך הקבצים בדיוור מוגבל ל־4MB");
  const aid = id();
  await write(c.env.DB, "INSERT INTO mk_attachments(id,campaign_id,name,mime,size,data) VALUES(?,?,?,?,?,?)", aid, c.req.param("id"), d.name, d.mime || "application/octet-stream", bytes.length, bytes);
  return c.json({ id: aid }, 201);
});
mk.delete("/campaigns/:id/attachments/:aid", async (c) => {
  await write(c.env.DB, "DELETE FROM mk_attachments WHERE id=? AND campaign_id=?", c.req.param("aid"), c.req.param("id"));
  return c.json({ ok: true });
});
mk.delete("/campaigns/:id", async (c) => {
  const r = await write(c.env.DB, "DELETE FROM mk_campaigns WHERE id=? AND status='draft'", c.req.param("id"));
  if (!r.meta.changes) fail("אפשר למחוק רק טיוטה", 409);
  return c.json({ ok: true });
});

const decodeAttr = (v: string) => v.replace(/&amp;/g, "&");
// Repairs a full <a> tag pasted inside another link's href.
const repairNested = (html: string) =>
  html.replace(/href\s*=\s*"\s*<a\s[^>]*?href\s*=\s*"([^"]*)"[^>]*>[\s\S]*?<\/a>\s*"/gi, 'href="$1"');
export function extractLinks(raw: string) {
  const html = repairNested(raw);
  const out: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
    const u = decodeAttr(m[1]);
    if (!out.includes(u)) out.push(u);
  }
  return out;
}
function renderHtml(m: R, w: R) {
  let html: string = repairNested(m.html || "");
  if (!/<[a-z][\s\S]*>/i.test(html))
    html = `<div dir="rtl" style="direction:rtl;text-align:right;font-family:Arial,sans-serif;font-size:15px;line-height:1.6">${esc(html).replace(/\n/g, "<br>")}</div>`;
  const links = extractLinks(html);
  html = html.replace(/href\s*=\s*["'](https?:\/\/[^"']+)["']/gi, (_all: string, u: string) => {
    const i = links.indexOf(decodeAttr(u));
    return `href="${SITE}/t/c?c=${m.id}&amp;t={{ params.token }}&amp;l=${i}"`;
  });
  html = html.replace(/href\s*=\s*["']\{\{\s*unsubscribe\s*\}\}["']/gi, 'href="{{ params.unsubscribe }}"');
  html = html.replace(/\{\{\s*unsubscribe\s*\}\}/g, '<a href="{{ params.unsubscribe }}">להסרה מרשימת התפוצה</a>');
  html = html.replace(/\{\{\s*(name|first_name|email|phone)\s*\}\}/g, "{{ params.$1 }}");
  if (!/\{\{\s*params\.unsubscribe\s*\}\}/.test(html)) {
    const footer = `<div dir="rtl" style="direction:rtl;text-align:center;font-family:Arial,sans-serif;font-size:12px;color:#8a8a8a;padding:18px 10px">${esc(w.name || "")}${w.sender_address ? " · " + esc(w.sender_address) : ""}<br><a href="{{ params.unsubscribe }}" style="color:#8a8a8a">להסרה מרשימת התפוצה</a></div>`;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, footer + "</body>") : html + footer;
  }
  const pixel = `<img src="${SITE}/t/o?c=${m.id}&amp;t={{ params.token }}" width="1" height="1" alt="" style="border:0;width:1px;height:1px">`;
  html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, pixel + "</body>") : html + pixel;
  if (m.preheader) {
    const pre = `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(m.preheader)}</div>`;
    html = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (b: string) => b + pre) : pre + html;
  }
  if (!/<html/i.test(html))
    html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body dir="rtl" style="direction:rtl;text-align:right;margin:0">${html}</body></html>`;
  return html;
}
const subjectOf = (m: R, variant: string) => {
  const s = variant === "B" && m.subject_b ? m.subject_b : m.subject;
  return m.ad_prefix ? `פרסומת | ${s}` : s;
};
const params = (r: R, campaignId: string) => ({
  name: r.name || "",
  first_name: String(r.name || "").split(" ")[0] || "",
  email: r.email,
  phone: r.phone || "",
  token: r.token,
  unsubscribe: `${SITE}/u?t=${r.token}&c=${campaignId}`,
});
async function brevoSend(env: Env, m: R, body: R) {
  const w = await one(env.DB, "SELECT * FROM workspaces WHERE id=?", m.workspace_id);
  const k = brevoKey(env, m.workspace_id);
  if (!k || !w?.sender_email) fail("חסרה הגדרת שולח Brevo למכללה", 503);
  const files = await rows(env.DB, "SELECT name,data FROM mk_attachments WHERE campaign_id=?", m.id);
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": k, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: m.from_name || w.name, email: w.sender_email },
      replyTo: { email: w.inbox_email || w.sender_email },
      htmlContent: renderHtml(m, w),
      attachment: files.length ? files.map((f) => ({ name: f.name, content: b64(f.data as ArrayBuffer) })) : undefined,
      tags: ["mk", `mk-${m.id}`],
      headers: { "List-Unsubscribe": `<mailto:${w.inbox_email || w.sender_email}?subject=unsubscribe>` },
      ...body,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    const quota = res.status === 402 || /credit|limit|quota/i.test(t);
    const reason =
      res.status === 401
        ? "מפתח Brevo לא תקין או בוטל"
        : quota
          ? "המכסה ב־Brevo נגמרה (מגבלה יומית/חודשית). השליחה תתחדש אוטומטית כל שעה עד שתתפנה מכסה, או לאחר שדרוג החבילה."
          : `Brevo דחה את השליחה (${res.status}): ${t.slice(0, 200)}`;
    throw Object.assign(new Error(reason), { quota });
  }
}
mk.post("/campaigns/:id/test", async (c) => {
  const d = z.object({ emails: z.array(z.string().trim().toLowerCase().email()).min(1).max(5) }).parse(await c.req.json());
  const m = await one(c.env.DB, "SELECT * FROM mk_campaigns WHERE id=?", c.req.param("id"));
  if (!m) fail("קמפיין לא נמצא", 404);
  if (!m.subject || !m.html) fail("נדרשים נושא ו־HTML");
  const user = c.get("user");
  try {
    await brevoSend(c.env, m, {
      subject: "[בדיקה] " + subjectOf(m, "A"),
      to: d.emails.map((email) => ({ email })),
      params: { name: user.name, first_name: user.name.split(" ")[0], email: d.emails[0], phone: "", token: "test", unsubscribe: `${SITE}/u?t=test` },
    });
  } catch (e) {
    fail((e as Error).message, 503);
  }
  return c.json({ ok: true });
});
mk.post("/campaigns/:id/launch", async (c) => {
  const d = z.object({ scheduled_at: z.string().max(40).default("") }).parse(await c.req.json());
  const db = c.env.DB;
  const m = await one(db, "SELECT * FROM mk_campaigns WHERE id=?", c.req.param("id"));
  if (!m) fail("קמפיין לא נמצא", 404);
  if (m.status !== "draft") fail("הקמפיין כבר שוגר", 409);
  if (m.channel !== "email") fail("ערוץ SMS/קולי ייפתח בשלב הבא", 400);
  if (!m.subject || !m.html) fail("נדרשים נושא ו־HTML");
  if (m.ab_percent > 0 && !m.subject_b) fail("לבדיקת A/B נדרש נושא חלופי");
  const when = d.scheduled_at ? new Date(d.scheduled_at) : new Date();
  if (Number.isNaN(when.getTime())) fail("מועד שליחה לא תקין");
  const a = audienceSchema.parse(JSON.parse(m.audience || "{}"));
  const p: unknown[] = [];
  const where = await audienceSql(db, a, p);
  const ab = Number(m.ab_percent) || 0;
  const variant = ab
    ? `CASE WHEN abs(random())%100<${ab} THEN 'A' WHEN abs(random())%100<${ab * 2} THEN 'B' ELSE 'W' END`
    : "'A'";
  await write(
    db,
    `INSERT OR IGNORE INTO mk_sends(campaign_id,contact_id,email,variant,status) SELECT ?,c.id,c.email,${variant},'pending' FROM mk_contacts c WHERE ${SENDABLE} AND ${where}`,
    m.id,
    ...p,
  );
  if (ab) await write(db, "UPDATE mk_sends SET status='held' WHERE campaign_id=? AND variant='W'", m.id);
  const total = await one(db, "SELECT count(*) n FROM mk_sends WHERE campaign_id=?", m.id);
  const ex = await one(db, `SELECT ${EXCLUDED} FROM mk_contacts c WHERE ${where}`, ...p);
  if (!total?.n) fail("אין נמענים פעילים בקהל שנבחר");
  await write(
    db,
    "UPDATE mk_campaigns SET status='scheduled',scheduled_at=?,total=?,last_error='',excluded=?,updated_at=? WHERE id=?",
    when.toISOString(), total.n, JSON.stringify(ex || {}), now(), m.id,
  );
  if (when.getTime() <= Date.now()) c.executionCtx.waitUntil(processMarketing(c.env).catch(() => undefined));
  return c.json({ ok: true, total: total.n });
});
mk.post("/campaigns/:id/cancel", async (c) => {
  const db = c.env.DB;
  await write(db, "UPDATE mk_campaigns SET status='cancelled',updated_at=? WHERE id=? AND status IN ('scheduled','sending','testing','paused')", now(), c.req.param("id"));
  await write(db, "UPDATE mk_sends SET status='cancelled' WHERE campaign_id=? AND status IN ('pending','held')", c.req.param("id"));
  return c.json({ ok: true });
});
mk.post("/campaigns/:id/resume", async (c) => {
  await write(c.env.DB, "UPDATE mk_campaigns SET status='sending',last_error='',resume_at='',updated_at=? WHERE id=? AND status='paused'", now(), c.req.param("id"));
  await write(c.env.DB, "UPDATE mk_sends SET status='pending',error='' WHERE campaign_id=? AND status='failed'", c.req.param("id"));
  c.executionCtx.waitUntil(processMarketing(c.env).catch(() => undefined));
  return c.json({ ok: true });
});
mk.get("/campaigns/:id/report", async (c) => {
  const db = c.env.DB, cid = c.req.param("id");
  const [stats, variants, links, timeline, errors] = await Promise.all([
    one(db, `SELECT ${STATS} FROM mk_sends s WHERE s.campaign_id=?`, cid),
    rows(db, `SELECT s.variant,${STATS} FROM mk_sends s WHERE s.campaign_id=? GROUP BY s.variant`, cid),
    rows(db, "SELECT link,count(*) clicks,count(DISTINCT contact_id) people FROM mk_events WHERE campaign_id=? AND event='click' GROUP BY link ORDER BY clicks DESC LIMIT 50", cid),
    rows(db, "SELECT substr(at,1,13) h,event,count(*) n FROM mk_events WHERE campaign_id=? AND event IN ('opened','click') GROUP BY h,event ORDER BY h LIMIT 2000", cid),
    rows(db, "SELECT CASE WHEN bounced!='' THEN bounced WHEN status='failed' THEN 'failed' WHEN status='pending' AND error!='' THEN 'waiting_quota' ELSE status END reason,count(*) n,max(error) error FROM mk_sends WHERE campaign_id=? AND (status!='sent' OR bounced!='') GROUP BY reason", cid),
  ]);
  return c.json({ stats, variants, links, timeline, errors });
});
const RECIPIENT_FILTERS: Record<string, string> = {
  all: "1=1",
  opened: "s.opened_at IS NOT NULL",
  not_opened: "s.opened_at IS NULL AND s.status='sent'",
  clicked: "s.clicked_at IS NOT NULL",
  not_clicked: "s.clicked_at IS NULL AND s.status='sent'",
  bounced: "s.bounced!=''",
  unsubscribed: "s.unsubscribed_at IS NOT NULL",
  failed: "s.status='failed'",
};
mk.get("/campaigns/:id/recipients", async (c) => {
  const f = RECIPIENT_FILTERS[c.req.query("filter") || "all"] || "1=1";
  const page = Math.max(0, Number(c.req.query("page")) || 0);
  const list = await rows(
    c.env.DB,
    `SELECT s.*,c.name,c.phone FROM mk_sends s LEFT JOIN mk_contacts c ON c.id=s.contact_id WHERE s.campaign_id=? AND ${f} ORDER BY coalesce(s.opened_at,s.sent_at,'') DESC LIMIT 100 OFFSET ?`,
    c.req.param("id"),
    page * 100,
  );
  const total = await one(c.env.DB, `SELECT count(*) n FROM mk_sends s WHERE s.campaign_id=? AND ${f}`, c.req.param("id"));
  return c.json({ total: total?.n || 0, recipients: list });
});
mk.post("/campaigns/:id/to-list", async (c) => {
  const d = z.object({ filter: z.string(), name: z.string().trim().min(1).max(120) }).parse(await c.req.json());
  const f = RECIPIENT_FILTERS[d.filter];
  if (!f) fail("מסנן לא תקין");
  const lid = id();
  await write(c.env.DB, "INSERT INTO mk_lists(id,name) VALUES(?,?)", lid, d.name);
  await write(c.env.DB, `INSERT OR IGNORE INTO mk_list_members(list_id,contact_id) SELECT ?,s.contact_id FROM mk_sends s WHERE s.campaign_id=? AND ${f}`, lid, c.req.param("id"));
  return c.json({ id: lid }, 201);
});
mk.get("/analytics", async (c) => {
  const db = c.env.DB;
  const days = Math.min(730, Math.max(7, Number(c.req.query("days")) || 180));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const [hours, contacts, growth] = await Promise.all([
    rows(db, "SELECT substr(at,1,13) h,event,count(*) n FROM mk_events WHERE event IN ('opened','click') AND at>=? GROUP BY h,event LIMIT 20000", since),
    one(db, "SELECT count(*) total,sum(CASE WHEN status='active' AND email!='' THEN 1 ELSE 0 END) active,sum(CASE WHEN status='unsubscribed' THEN 1 ELSE 0 END) unsubscribed,sum(CASE WHEN status='bounced' THEN 1 ELSE 0 END) bounced,sum(consent) consented,sum(CASE WHEN last_open_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days') THEN 1 ELSE 0 END) engaged FROM mk_contacts"),
    rows(db, "SELECT substr(created_at,1,7) month,count(*) n FROM mk_contacts GROUP BY month ORDER BY month DESC LIMIT 24"),
  ]);
  return c.json({ hours, contacts, growth });
});

// ---------- sending engine ----------
export async function processMarketing(env: Env) {
  const db = env.DB;
  const t = now();
  await write(db, "UPDATE mk_campaigns SET status='sending',started_at=? WHERE status='scheduled' AND scheduled_at<=?", t, t);
  await write(db, "UPDATE mk_campaigns SET status='sending',resume_at='' WHERE status='paused' AND resume_at!='' AND resume_at<=?", t);
  const testing = await rows(db, "SELECT * FROM mk_campaigns WHERE status='testing' AND test_done_at!='' LIMIT 3");
  for (const m of testing) {
    if (Date.now() - new Date(m.test_done_at).getTime() < m.ab_hours * 3600000) continue;
    const v = await rows(db, "SELECT variant,count(*) n,sum(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) o,sum(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) k FROM mk_sends WHERE campaign_id=? AND variant IN ('A','B') GROUP BY variant", m.id);
    const score = (x?: R) => (x && x.n ? (x.o + x.k * 2) / x.n : 0);
    const winner = score(v.find((x) => x.variant === "B")) > score(v.find((x) => x.variant === "A")) ? "B" : "A";
    await write(db, "UPDATE mk_sends SET variant=?,status='pending' WHERE campaign_id=? AND status='held'", winner, m.id);
    await write(db, "UPDATE mk_campaigns SET status='sending',ab_winner=? WHERE id=?", winner, m.id);
  }
  const active = await rows(db, "SELECT * FROM mk_campaigns WHERE status='sending' ORDER BY started_at LIMIT 2");
  let budget = 3;
  for (const m of active) {
    while (budget-- > 0) {
      const batch = await rows(
        db,
        "SELECT s.rowid rid,s.email,s.variant,c.name,c.phone,c.token FROM mk_sends s JOIN mk_contacts c ON c.id=s.contact_id WHERE s.campaign_id=? AND s.status='pending' ORDER BY s.rowid LIMIT ?",
        m.id,
        BATCH,
      );
      if (!batch.length) {
        const left = await one(db, "SELECT sum(CASE WHEN status='held' THEN 1 ELSE 0 END) held,sum(CASE WHEN status='sending' THEN 1 ELSE 0 END) sending FROM mk_sends WHERE campaign_id=?", m.id);
        if (left?.held) await write(db, "UPDATE mk_campaigns SET status='testing',test_done_at=? WHERE id=?", now(), m.id);
        else if (!left?.sending) await write(db, "UPDATE mk_campaigns SET status='sent',finished_at=? WHERE id=?", now(), m.id);
        break;
      }
      const maxRid = batch[batch.length - 1].rid;
      await write(db, "UPDATE mk_sends SET status='sending' WHERE campaign_id=? AND status='pending' AND rowid<=?", m.id, maxRid);
      try {
        await brevoSend(env, m, {
          subject: subjectOf(m, "A"),
          messageVersions: batch.map((r) => ({
            to: [{ email: r.email, name: r.name || r.email }],
            params: params(r, m.id),
            subject: subjectOf(m, r.variant),
          })),
        });
        await write(db, "UPDATE mk_sends SET status='sent',sent_at=? WHERE campaign_id=? AND status='sending' AND rowid<=?", now(), m.id, maxRid);
        await write(db, "UPDATE mk_campaigns SET sent=(SELECT count(*) FROM mk_sends WHERE campaign_id=? AND status='sent') WHERE id=?", m.id, m.id);
      } catch (e) {
        const err = e as Error & { quota?: boolean };
        const msg = String(err.message).slice(0, 500);
        await write(db, "UPDATE mk_sends SET status=?,error=? WHERE campaign_id=? AND status='sending' AND rowid<=?", err.quota ? "pending" : "failed", msg, m.id, maxRid);
        await write(
          db,
          "UPDATE mk_campaigns SET status='paused',last_error=?,resume_at=? WHERE id=?",
          msg, err.quota ? new Date(Date.now() + 3600000).toISOString() : "", m.id,
        );
        break;
      }
    }
  }
}

// ---------- tracking ----------
const EVENT_NAMES: Record<string, string> = {
  opened: "opened", unique_opened: "opened", uniqueOpened: "opened", proxy_open: "opened", loadedByProxy: "opened",
  click: "click", clicks: "click",
  delivered: "delivered",
  hard_bounce: "hard_bounce", hardBounce: "hard_bounce", hardBounces: "hard_bounce", invalid_email: "hard_bounce", invalid: "hard_bounce", blocked: "blocked",
  soft_bounce: "soft_bounce", softBounce: "soft_bounce", softBounces: "soft_bounce", deferred: "soft_bounce",
  spam: "spam", complaint: "spam", unsubscribed: "unsubscribed", unsubscribe: "unsubscribed",
};
export function marketingCampaignOf(ev: R) {
  const m = JSON.stringify([ev.tags, ev.tag, ev["X-Mailin-Tag"]]).match(/mk-([0-9a-f-]{36})/);
  return m ? m[1] : "";
}
export async function recordMarketingEvent(env: Env, campaignId: string, ev: R) {
  const name = EVENT_NAMES[ev.event];
  const email = String(ev.email || "").toLowerCase();
  // Opens and clicks come from our own pixel/redirect; Brevo's copies would double-count.
  if (!name || !email || name === "opened" || name === "click") return;
  const s = await one(env.DB, "SELECT contact_id FROM mk_sends WHERE campaign_id=? AND email=?", campaignId, email);
  if (!s) return;
  const ts = Number(ev.ts_event || ev.ts) || (ev.date ? Date.parse(ev.date) / 1000 : Date.now() / 1000);
  await applyEvent(env, campaignId, s.contact_id, email, name, ts, String(ev.link || ""));
}
async function applyEvent(env: Env, campaignId: string, contactId: string, email: string, name: string, ts: number, rawLink: string) {
  const db = env.DB;
  const s = { contact_id: contactId };
  const at = new Date(Math.floor(ts) * 1000).toISOString();
  const link = rawLink.slice(0, 1000);
  const eid = await hash(JSON.stringify([campaignId, s.contact_id, name, Math.floor(ts), link]));
  const r = await write(db, "INSERT OR IGNORE INTO mk_events(id,campaign_id,contact_id,event,link,at) VALUES(?,?,?,?,?,?)", eid, campaignId, s.contact_id, name, link, at);
  if (!r.meta.changes) return;
  const cid = s.contact_id;
  const upd = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v);
  const st: D1PreparedStatement[] = [];
  if (name === "delivered") st.push(upd("UPDATE mk_sends SET delivered_at=coalesce(delivered_at,?) WHERE campaign_id=? AND contact_id=?", at, campaignId, cid));
  if (name === "opened") {
    st.push(upd("UPDATE mk_sends SET opens=opens+1,opened_at=coalesce(opened_at,?) WHERE campaign_id=? AND contact_id=?", at, campaignId, cid));
    st.push(upd("UPDATE mk_contacts SET opens=opens+1,last_open_at=max(coalesce(last_open_at,''),?) WHERE id=?", at, cid));
  }
  if (name === "click") {
    st.push(upd("UPDATE mk_sends SET clicks=clicks+1,clicked_at=coalesce(clicked_at,?),opened_at=coalesce(opened_at,?) WHERE campaign_id=? AND contact_id=?", at, at, campaignId, cid));
    st.push(upd("UPDATE mk_contacts SET clicks=clicks+1,last_click_at=max(coalesce(last_click_at,''),?),last_open_at=max(coalesce(last_open_at,''),?) WHERE id=?", at, at, cid));
  }
  if (["hard_bounce", "soft_bounce", "blocked"].includes(name))
    st.push(upd("UPDATE mk_sends SET bounced=? WHERE campaign_id=? AND contact_id=?", name, campaignId, cid));
  if (name === "hard_bounce") st.push(upd("UPDATE mk_contacts SET status='bounced' WHERE id=?", cid));
  if (name === "unsubscribed" || name === "spam") {
    st.push(upd("UPDATE mk_sends SET unsubscribed_at=coalesce(unsubscribed_at,?) WHERE campaign_id=? AND contact_id=?", at, campaignId, cid));
    st.push(upd("UPDATE mk_contacts SET status=? WHERE id=?", name === "spam" ? "complained" : "unsubscribed", cid));
    st.push(upd("UPDATE leads SET marketing_consent=0 WHERE lower(email)=?", email));
  }
  if (st.length) await db.batch(st);
}

// ---------- public unsubscribe ----------
export async function marketingUnsubscribe(req: Request, env: Env) {
  const url = new URL(req.url);
  const v = req.method === "POST" ? new URLSearchParams(await req.text()) : url.searchParams;
  const token = v.get("t") || "", campaign = v.get("c") || "";
  const contact = token && token !== "test" ? await one(env.DB, "SELECT id,email FROM mk_contacts WHERE token=?", token) : null;
  let done = false;
  if (req.method === "POST" && contact) {
    const at = now();
    await env.DB.batch([
      env.DB.prepare("UPDATE mk_contacts SET status='unsubscribed',updated_at=? WHERE id=?").bind(at, contact.id),
      env.DB.prepare("UPDATE leads SET marketing_consent=0,consent_source='unsubscribe-link',consent_at=? WHERE lower(email)=?").bind(at, contact.email),
      env.DB.prepare("UPDATE mk_sends SET unsubscribed_at=coalesce(unsubscribed_at,?) WHERE campaign_id=? AND contact_id=?").bind(at, campaign, contact.id),
      env.DB.prepare("INSERT OR IGNORE INTO mk_events(id,campaign_id,contact_id,event,at) VALUES(?,?,?,'unsubscribed',?)").bind(id(), campaign, contact.id, at),
    ]);
    done = true;
  }
  const body = !contact
    ? "<h1>קישור ההסרה אינו תקף</h1><p>ניתן להשיב למייל עם המילה 'הסרה'.</p>"
    : done
      ? "<h1>הוסרת מרשימת התפוצה</h1><p>לא יישלחו אליך עוד דיוורים.</p>"
      : `<h1>הסרה מרשימת התפוצה</h1><p>${esc(contact.email)}</p><form method="post"><input type="hidden" name="t" value="${esc(token)}"><input type="hidden" name="c" value="${esc(campaign)}"><button style="padding:14px 26px;border:0;background:#246c61;color:#fff;border-radius:8px;font-size:16px">אישור הסרה</button></form>`;
  return new Response(
    `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>הסרה מדיוור</title><body style="font-family:Arial;padding:60px 20px;text-align:center;background:#f5f8f5;color:#234a40">${body}</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
  );
}
export async function unsubscribeByReply(env: Env, from: string, subject: string) {
  if (!/unsubscribe|הסר/i.test(subject)) return;
  await write(env.DB, "UPDATE mk_contacts SET status='unsubscribed',updated_at=? WHERE email=?", now(), from.toLowerCase());
}

// ---------- own open/click tracking ----------
const PREFETCH_MS = 120_000;
const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (ch) => ch.charCodeAt(0));
async function trackedSend(env: Env, campaignId: string, token: string) {
  if (!campaignId || !token || token === "test") return null;
  return one(env.DB, "SELECT s.contact_id,s.email,s.sent_at FROM mk_sends s JOIN mk_contacts c ON c.id=s.contact_id WHERE s.campaign_id=? AND c.token=?", campaignId, token);
}
export async function trackOpen(req: Request, env: Env, ctx: ExecutionContext) {
  const u = new URL(req.url);
  ctx.waitUntil(
    (async () => {
      const s = await trackedSend(env, u.searchParams.get("c") || "", u.searchParams.get("t") || "");
      if (!s) return;
      // Mail servers and security scanners fetch images right on arrival; that is not a human open.
      const machine = s.sent_at && Date.now() - new Date(s.sent_at).getTime() < PREFETCH_MS;
      await applyEvent(env, u.searchParams.get("c")!, s.contact_id, s.email, machine ? "prefetch" : "opened", Date.now() / 1000, machine ? (req.headers.get("User-Agent") || "").slice(0, 200) : "");
    })().catch(() => undefined),
  );
  return new Response(GIF, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
}
export async function trackClick(req: Request, env: Env) {
  const u = new URL(req.url);
  const cid = u.searchParams.get("c") || "", l = Number(u.searchParams.get("l"));
  const m = cid ? await one(env.DB, "SELECT html FROM mk_campaigns WHERE id=?", cid) : null;
  const target = m ? extractLinks(m.html || "")[l] : undefined;
  const s = await trackedSend(env, cid, u.searchParams.get("t") || "");
  if (s && target) await applyEvent(env, cid, s.contact_id, s.email, "click", Date.now() / 1000, target);
  return Response.redirect(target || SITE.replace(/\/crm$/, ""), 302);
}
