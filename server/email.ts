import { marketingCampaignOf, recordMarketingEvent, unsubscribeByReply } from "./marketing";
import { Hono } from "hono";
import { z } from "zod";
import PostalMime from "postal-mime";
import {
  type App,
  type Env,
  fail,
  rows,
  one,
  write,
  id,
  hash,
  leadAccess,
  requireManager,
  audit,
  now,
} from "./core";
export const email = new Hono<App>();
const providerId = (value: string) => value.trim().replace(/^<|>$/g, "");
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (x) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        x
      ]!,
  );
async function unsubscribeSignature(env: Env, ws: string, lid: string) {
  if (!env.BREVO_WEBHOOK_TOKEN) fail("יש להגדיר מפתח מעקב והסרה", 503);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.BREVO_WEBHOOK_TOKEN),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(JSON.stringify([ws, lid])),
      ),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export async function unsubscribePage(req: Request, env: Env) {
  const url = new URL(req.url);
  const values =
    req.method === "POST"
      ? new URLSearchParams(await req.text())
      : url.searchParams;
  const ws = values.get("workspace") || "",
    lid = values.get("lead") || "",
    token = values.get("token") || "";
  if (
    !["women", "men"].includes(ws) ||
    !lid ||
    !env.BREVO_WEBHOOK_TOKEN ||
    (await hash(token)) !==
      (await hash(await unsubscribeSignature(env, ws, lid)))
  )
    return new Response("Invalid unsubscribe link", { status: 400 });
  const w = await one(env.DB, "SELECT name FROM workspaces WHERE id=?", ws);
  if (!w) return new Response("Not found", { status: 404 });
  if (req.method === "POST")
    await write(
      env.DB,
      "UPDATE leads SET marketing_consent=0,consent_at=?,consent_source=? WHERE workspace_id=? AND id=?",
      now(),
      "unsubscribe-link",
      ws,
      lid,
    );
  return new Response(
    `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>הסרה מדיוור</title><body style="font-family:Arial;padding:60px 20px;text-align:center;background:#f5f8f5;color:#234a40"><h1>${req.method === "POST" ? "הוסרת מרשימת הדיוור" : "הסרה מדיוור שיווקי"}</h1><p>${escapeHtml(w.name)}</p>${req.method === "POST" ? "<p>לא יישלחו אליך הודעות שיווקיות נוספות מהמכללה הזו.</p>" : `<form method="post" action="${req.headers.get("X-Base-Path") || ""}/api/unsubscribe"><input type="hidden" name="workspace" value="${ws}"><input type="hidden" name="lead" value="${escapeHtml(lid)}"><input type="hidden" name="token" value="${escapeHtml(token)}"><button style="padding:14px 24px;border:0;background:#246c61;color:white;border-radius:8px">אישור הסרה</button></form>`}</body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
const key = (env: Env, ws: string) =>
  ws === "women" ? env.BREVO_WOMEN_API_KEY : env.BREVO_MEN_API_KEY;
const attachmentInput = z.object({
  name: z.string().trim().min(1).max(200),
  mime: z.string().max(120).default("application/octet-stream"),
  data: z.string().max(2_800_000),
});
const b64 = (bytes: ArrayBuffer | Uint8Array) => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (s: string) => {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
};
async function storeAttachments(
  db: D1Database,
  ws: string,
  link: { message_id?: string; template_id?: string },
  items: { name: string; mime: string; data: string }[],
) {
  let total = 0;
  for (const a of items) {
    const bytes = fromB64(a.data);
    total += bytes.length;
    if (bytes.length > 1_500_000 || total > 1_500_000)
      fail("הקבצים המצורפים גדולים מדי (עד 1.5MB בסך הכול)");
    await write(
      db,
      "INSERT INTO message_attachments(workspace_id,id,message_id,template_id,name,mime,size,data) VALUES(?,?,?,?,?,?,?,?)",
      ws,
      id(),
      link.message_id || null,
      link.template_id || null,
      a.name,
      a.mime || "application/octet-stream",
      bytes.length,
      bytes,
    );
  }
}
export async function deliver(env: Env, ws: string, m: Record<string, any>) {
  const db = env.DB;
  const lead = m.lead_id
    ? await one(
        db,
        "SELECT * FROM leads WHERE workspace_id=? AND id=?",
        ws,
        m.lead_id,
      )
    : null;
  const w = await one(db, "SELECT * FROM workspaces WHERE id=?", ws);
  const apiKey = key(env, ws);
  if (!apiKey || !w?.sender_email)
    fail("יש להגדיר כתובת שולח מאומתת ב־Brevo", 503);
  const unsubscribe =
    m.kind === "marketing" && lead
      ? `${m.origin || ""}${m.base_path || ""}/unsubscribe?${new URLSearchParams({ workspace: ws, lead: lead.id, token: await unsubscribeSignature(env, ws, lead.id) })}`
      : "";
  const files = await rows(
    db,
    "SELECT name,mime,data FROM message_attachments WHERE workspace_id=? AND message_id=?",
    ws,
    m.id,
  );
  const claimed = await write(
    db,
    "UPDATE messages SET status='sending' WHERE workspace_id=? AND id=? AND status IN ('draft','scheduled')",
    ws,
    m.id,
  );
  if (!claimed.meta.changes) return false;
  const footer = unsubscribe
    ? `\n\n${w.name} · ${w.sender_address}\nליצירת קשר: ${w.sender_email}\nלהסרה מדיוור שיווקי: ${unsubscribe}`
    : "";
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: w.name, email: w.sender_email },
        to: [{ email: m.recipient, name: lead?.name || m.recipient }],
        replyTo: { email: w.inbox_email || w.sender_email },
        subject: m.kind === "marketing" ? "פרסומת | " + m.subject : m.subject,
        textContent: m.body + footer,
        htmlContent: `<html lang="he" dir="rtl"><body dir="rtl" style="direction:rtl;text-align:right"><div dir="rtl" style="direction:rtl;text-align:right;unicode-bidi:embed;white-space:pre-wrap;font-family:Arial,sans-serif;font-size:15px;line-height:1.6">${escapeHtml(m.body)}</div>${unsubscribe ? `<hr><p dir="rtl" style="direction:rtl;text-align:right">${escapeHtml(w.name)} · ${escapeHtml(w.sender_address)}</p><p>${escapeHtml(w.sender_email)}</p><a href="${escapeHtml(unsubscribe)}">הסרה מדיוור שיווקי</a>` : ""}</body></html>`,
        attachment: files.length
          ? files.map((f: Record<string, any>) => ({
              name: f.name,
              content: b64(f.data as ArrayBuffer),
            }))
          : undefined,
        tags: [`college-${ws}`, `message-${m.id}`],
        headers: { idempotencyKey: m.id },
      }),
    });
    if (!response.ok) {
      await write(
        db,
        "UPDATE messages SET status='rejected' WHERE workspace_id=? AND id=?",
        ws,
        m.id,
      );
      fail("Brevo דחה את השליחה; בדקו אימות שולח ומכסה", 503);
    }
    const result = (await response.json()) as { messageId: string };
    await write(
      db,
      "UPDATE messages SET status='sent',provider_id=? WHERE workspace_id=? AND id=?",
      providerId(result.messageId),
      ws,
      m.id,
    );
    return true;
  } catch (e) {
    await write(
      db,
      "UPDATE messages SET status='uncertain' WHERE workspace_id=? AND id=? AND status='sending'",
      ws,
      m.id,
    );
    throw e;
  }
}
export async function deliverDue(env: Env) {
  const due = await rows(
    env.DB,
    "SELECT * FROM messages WHERE direction='out' AND status='scheduled' AND scheduled_at!='' AND scheduled_at<=? LIMIT 10",
    now(),
  );
  let sent = 0;
  for (const m of due) {
    try {
      if (await deliver(env, m.workspace_id, m)) sent++;
    } catch {
      /* status already recorded */
    }
  }
  return sent;
}
email.get("/templates", async (c) =>
  c.json({
    templates: await rows(
      c.env.DB,
      "SELECT t.*,(SELECT json_group_array(json_object('id',a.id,'name',a.name,'mime',a.mime,'size',a.size)) FROM message_attachments a WHERE a.workspace_id=t.workspace_id AND a.template_id=t.id) attachments FROM message_templates t WHERE t.workspace_id=? ORDER BY t.created_at DESC",
      c.get("ws"),
    ),
  }),
);
email.post("/templates", async (c) => {
  requireManager(c);
  const d = z
    .object({
      name: z.string().trim().min(1).max(100),
      subject: z.string().trim().min(1).max(200),
      body: z.string().trim().min(1).max(30000),
      kind: z.enum(["service", "marketing"]).default("service"),
      attachments: z.array(attachmentInput).max(5).default([]),
    })
    .parse(await c.req.json());
  const tid = id();
  await write(
    c.env.DB,
    "INSERT INTO message_templates(workspace_id,id,name,subject,body,kind) VALUES(?,?,?,?,?,?)",
    c.get("ws"),
    tid,
    d.name,
    d.subject,
    d.body,
    d.kind,
  );
  await storeAttachments(c.env.DB, c.get("ws"), { template_id: tid }, d.attachments);
  return c.json({ ok: true, id: tid }, 201);
});
email.delete("/templates/:id", async (c) => {
  requireManager(c);
  await write(
    c.env.DB,
    "DELETE FROM message_attachments WHERE workspace_id=? AND template_id=?",
    c.get("ws"),
    c.req.param("id"),
  );
  await write(
    c.env.DB,
    "DELETE FROM message_templates WHERE workspace_id=? AND id=?",
    c.get("ws"),
    c.req.param("id"),
  );
  return c.json({ ok: true });
});
email.get("/attachments/:id", async (c) => {
  const a = await one(
    c.env.DB,
    "SELECT name,mime,data FROM message_attachments WHERE workspace_id=? AND id=?",
    c.get("ws"),
    c.req.param("id"),
  );
  if (!a) fail("קובץ לא נמצא", 404);
  return new Response(a.data as ArrayBuffer, {
    headers: {
      "Content-Type": a.mime,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,
    },
  });
});
email.post("/drafts", async (c) => {
  const d = z
    .object({
      lead_id: z.string(),
      subject: z.string().trim().max(200).default(""),
      body: z.string().trim().max(30000).default(""),
      kind: z.enum(["service", "marketing"]).default("service"),
      template_id: z.string().max(100).optional(),
      scheduled_at: z.union([z.string().datetime(), z.literal("")]).default(""),
      attachments: z.array(attachmentInput).max(5).default([]),
    })
    .parse(await c.req.json());
  const l = await leadAccess(c, d.lead_id);
  if (!l.email) fail("לליד אין כתובת מייל");
  let subject = d.subject,
    body = d.body;
  const kind = d.kind;
  let templateFiles: Record<string, any>[] = [];
  if (d.template_id) {
    const t = await one(
      c.env.DB,
      "SELECT * FROM message_templates WHERE workspace_id=? AND id=?",
      c.get("ws"),
      d.template_id,
    );
    if (!t) fail("תבנית לא נמצאה");
    subject = subject || t.subject;
    body = body || t.body;
    templateFiles = await rows(
      c.env.DB,
      "SELECT name,mime,data FROM message_attachments WHERE workspace_id=? AND template_id=?",
      c.get("ws"),
      d.template_id,
    );
  }
  if (!subject || !body) fail("חסרים נושא או תוכן");
  const scheduled = d.scheduled_at && d.scheduled_at > now();
  const messageId = id();
  await write(
    c.env.DB,
    "INSERT INTO messages(workspace_id,id,lead_id,direction,recipient,subject,body,kind,status,scheduled_at) VALUES(?,?,?,'out',?,?,?,?,?,?)",
    c.get("ws"),
    messageId,
    l.id,
    l.email,
    subject,
    body,
    kind,
    scheduled ? "scheduled" : "draft",
    scheduled ? d.scheduled_at : "",
  );
  for (const f of templateFiles)
    await write(
      c.env.DB,
      "INSERT INTO message_attachments(workspace_id,id,message_id,name,mime,size,data) VALUES(?,?,?,?,?,?,?)",
      c.get("ws"),
      id(),
      messageId,
      f.name,
      f.mime,
      f.size || 0,
      f.data,
    );
  await storeAttachments(c.env.DB, c.get("ws"), { message_id: messageId }, d.attachments);
  return c.json({ ok: true, id: messageId }, 201);
});
email.post("/messages/sync", async (c) => {
  await syncBrevoEvents(c.env);
  return c.json({ ok: true });
});
email.post("/messages/:id/send", async (c) => {
  const ws = c.get("ws"),
    db = c.env.DB;
  const m = await one(
    db,
    "SELECT * FROM messages WHERE workspace_id=? AND id=?",
    ws,
    c.req.param("id"),
  );
  if (!m || m.direction !== "out") fail("הודעה לא נמצאה", 404);
  const w = await one(db, "SELECT * FROM workspaces WHERE id=?", ws);
  const lead = await leadAccess(c, m.lead_id);
  if (!key(c.env, ws) || !w!.sender_email)
    fail("יש להגדיר כתובת שולח מאומתת ב־Brevo", 503);
  if (m.kind === "marketing" && !w!.sender_address)
    fail("לדיוור שיווקי נדרשת כתובת עסק מלאה בהגדרות", 400);
  const sent = await deliver(c.env, ws, {
    ...m,
    origin: new URL(c.req.url).origin,
    base_path: c.req.header("X-Base-Path") || "",
  });
  if (!sent) fail("ההודעה כבר נשלחה או מטופלת", 409);
  await audit(c, "נשלח מייל", lead.id);
  return c.json({ ok: true });
});
email.put("/leads/:id/consent", async (c) => {
  requireManager(c);
  const l = await leadAccess(c, c.req.param("id"));
  const d = z
    .object({
      consent: z.boolean(),
      text: z.string().min(5).max(3000),
      source: z.string().min(2).max(200),
    })
    .parse(await c.req.json());
  await write(
    c.env.DB,
    "UPDATE leads SET marketing_consent=?,consent_text=?,consent_at=?,consent_source=? WHERE workspace_id=? AND id=?",
    d.consent ? 1 : 0,
    d.text,
    now(),
    d.source,
    c.get("ws"),
    l.id,
  );
  await audit(c, d.consent ? "תועדה הסכמה לדיוור" : "בוטלה הסכמה לדיוור", l.id);
  return c.json({ ok: true });
});
export async function brevoWebhook(req: Request, env: Env) {
  const incoming = req.headers.get("Authorization");
  if (
    !env.BREVO_WEBHOOK_TOKEN ||
    (await hash(incoming || "")) !==
      (await hash(`Bearer ${env.BREVO_WEBHOOK_TOKEN}`))
  )
    return new Response("Unauthorized", { status: 401 });
  const raw = await req.json();
  const events = Array.isArray(raw) ? raw : [raw];
  if (events.length > 1000)
    return new Response("Too many events", { status: 413 });
  for (const event of events) {
    const mkCampaign = marketingCampaignOf(event);
    if (mkCampaign) {
      await recordMarketingEvent(env, mkCampaign, event);
      continue;
    }
    if (
      typeof event["message-id"] !== "string" ||
      typeof event.event !== "string"
    )
      continue;
    const matches = await rows(
      env.DB,
      "SELECT workspace_id,id,lead_id FROM messages WHERE provider_id=? AND direction='out'",
      providerId(event["message-id"]),
    );
    // Never match solely by email: the same address may belong to both colleges.
    if (matches.length !== 1) continue;
    const m = matches[0];
    const eid = await hash(
      JSON.stringify([
        event["message-id"],
        event.event,
        event.ts_event || event.ts,
        event.link || "",
        event.id || "",
      ]),
    );
    const ts = Number(event.ts_event || event.ts);
    const at = Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : now();
    await write(
      env.DB,
      "INSERT OR IGNORE INTO message_events(workspace_id,message_id,event_id,event,at) VALUES(?,?,?,?,?)",
      m.workspace_id,
      m.id,
      eid,
      event.event,
      at,
    );
    if (["unsubscribed", "spam"].includes(event.event) && m.lead_id)
      await write(
        env.DB,
        "UPDATE leads SET marketing_consent=0 WHERE workspace_id=? AND id=?",
        m.workspace_id,
        m.lead_id,
      );
  }
  return Response.json({ ok: true });
}
const SYNC_EVENTS: Record<string, string> = {
  requests: "request", delivered: "delivered", opened: "opened", loadedByProxy: "opened", clicks: "click",
  hardBounces: "hard_bounce", softBounces: "soft_bounce", spam: "spam", unsubscribed: "unsubscribed", blocked: "blocked", invalid: "hard_bounce",
};
export async function syncBrevoEvents(env: Env) {
  for (const ws of ["women", "men"]) {
    const apiKey = key(env, ws);
    if (!apiKey) continue;
    const sent = await rows(
      env.DB,
      "SELECT m.id,m.provider_id,(SELECT group_concat(e.event||'@'||substr(e.at,1,19)) FROM message_events e WHERE e.workspace_id=m.workspace_id AND e.message_id=m.id) seen FROM messages m WHERE m.workspace_id=? AND m.direction='out' AND m.provider_id IS NOT NULL AND m.created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days')",
      ws,
    );
    if (!sent.length) continue;
    const res = await fetch(`https://api.brevo.com/v3/smtp/statistics/events?days=5&limit=1000&sort=desc&tags=college-${ws}`, {
      headers: { "api-key": apiKey },
    });
    if (!res.ok) continue;
    const data = (await res.json()) as { events?: Record<string, any>[] };
    const values: unknown[][] = [];
    for (const e of data.events || []) {
      const name = SYNC_EVENTS[e.event];
      const m = sent.find((x) => x.provider_id === providerId(String(e.messageId || "")));
      if (!name || !m) continue;
      const at = new Date(Math.floor(Date.parse(e.date) / 1000) * 1000).toISOString();
      const k = `${name}@${at.slice(0, 19)}`;
      if (String(m.seen || "").split(",").includes(k)) continue;
      m.seen = `${m.seen || ""},${k}`;
      values.push([ws, m.id, await hash(JSON.stringify([m.provider_id, name, at, e.link || ""])), name, at]);
    }
    for (let i = 0; i < values.length && i < 400; i += 18) {
      const chunk = values.slice(i, i + 18);
      await write(
        env.DB,
        `INSERT OR IGNORE INTO message_events(workspace_id,message_id,event_id,event,at) VALUES ${chunk.map(() => "(?,?,?,?,?)").join(",")}`,
        ...chunk.flat(),
      );
    }
  }
}
export async function receiveEmail(message: ForwardableEmailMessage, env: Env) {
  const w = await one(
    env.DB,
    "SELECT id FROM workspaces WHERE inbox_email=?",
    message.to.toLowerCase(),
  );
  if (!w) {
    message.setReject("Unknown college mailbox");
    return;
  }
  if (message.rawSize > 2_000_000) {
    message.setReject("Message exceeds 2 MB; attachments are not supported");
    return;
  }
  const parsed = await PostalMime.parse(message.raw);
  const sender =
    parsed.from?.address?.toLowerCase() || message.from.toLowerCase();
  const matches = await rows(
    env.DB,
    "SELECT id FROM leads WHERE workspace_id=? AND lower(email)=?",
    w.id,
    sender,
  );
  const providerId =
    parsed.messageId ||
    (await hash(`${sender}:${message.to}:${parsed.subject}:${parsed.text}`));
  const leadId = matches.length === 1 ? matches[0].id : null;
  const messageId = id();
  const inserted = await write(
    env.DB,
    "INSERT OR IGNORE INTO messages(workspace_id,id,lead_id,direction,recipient,subject,body,status,provider_id,in_reply_to) VALUES(?,?,?,'in',?,?,?,'received',?,?)",
    w.id,
    messageId,
    leadId,
    sender,
    parsed.subject || "(ללא נושא)",
    (
      parsed.text || "הודעה ללא תוכן טקסט; קבצים מצורפים אינם נתמכים בגרסה זו"
    ).slice(0, 30000),
    providerId,
    parsed.inReplyTo || "",
  );
  if (!inserted.meta.changes) return;
  await unsubscribeByReply(env, sender, parsed.subject || "");
  for (const a of parsed.attachments || []) {
    const content =
      typeof a.content === "string"
        ? new TextEncoder().encode(a.content)
        : a.content;
    if (!content || content.byteLength > 1_500_000) continue;
    await write(
      env.DB,
      "INSERT INTO message_attachments(workspace_id,id,message_id,name,mime,size,data) VALUES(?,?,?,?,?,?,?)",
      w.id,
      id(),
      messageId,
      a.filename || "קובץ מצורף",
      a.mimeType || "application/octet-stream",
      content.byteLength,
      content,
    );
  }
  const ws = await one(
    env.DB,
    "SELECT auto_reply,auto_reply_text,sender_email FROM workspaces WHERE id=?",
    w.id,
  );
  if (
    ws?.auto_reply &&
    ws.auto_reply_text &&
    !/mailer-daemon|no-?reply|postmaster/i.test(sender) &&
    leadId
  ) {
    const recent = await one(
      env.DB,
      "SELECT id FROM messages WHERE workspace_id=? AND direction='out' AND kind='auto' AND recipient=? AND created_at>=datetime('now','-1 day')",
      w.id,
      sender,
    );
    if (!recent) {
      const autoId = id();
      await write(
        env.DB,
        "INSERT INTO messages(workspace_id,id,lead_id,direction,recipient,subject,body,kind,status,in_reply_to) VALUES(?,?,?,'out',?,?,?,'auto','draft',?)",
        w.id,
        autoId,
        leadId,
        sender,
        `Re: ${parsed.subject || "(ללא נושא)"}`,
        ws.auto_reply_text,
        parsed.messageId || "",
      );
      await deliver(env, w.id, {
        id: autoId,
        lead_id: leadId,
        recipient: sender,
        subject: `Re: ${parsed.subject || "(ללא נושא)"}`,
        body: ws.auto_reply_text,
        kind: "auto",
        origin: "https://the-impact.net",
        base_path: "/crm",
      });
    }
  }
}
