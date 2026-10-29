import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { z, ZodError } from "zod";
import { auth, authenticate, workspace } from "./auth";
import { api, chooseAssignee } from "./api";
import { email, brevoWebhook, receiveEmail, unsubscribePage } from "./email";
import { type App, type Env, hash, one, rows, id } from "./core";
const app = new Hono<App>();
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Frame-Options", "DENY");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  if (c.req.path.startsWith("/api")) c.header("Cache-Control", "no-store");
});
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 100000,
    onError: (c) => c.json({ error: "הבקשה גדולה מדי" }, 413),
  }),
);
app.use("/api/*", async (c, next) => {
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method) &&
    !["/api/webhooks/brevo", "/api/intake"].includes(c.req.path)
  ) {
    const origin = c.req.header("Origin");
    if (!origin || origin !== new URL(c.req.url).origin)
      return c.json({ error: "בקשה ממקור לא מורשה" }, 403);
  }
  const length = Number(c.req.header("Content-Length") || 0);
  if (length > 100000) return c.json({ error: "הבקשה גדולה מדי" }, 413);
  await next();
});
app.route("/api/auth", auth);
app.get("/unsubscribe", (c) => unsubscribePage(c.req.raw, c.env));
app.post("/api/unsubscribe", (c) => unsubscribePage(c.req.raw, c.env));
app.post("/api/webhooks/brevo", (c) => brevoWebhook(c.req.raw, c.env));
app.post("/api/intake", async (c) => {
  const token = (c.req.header("Authorization") || "").replace(/^Bearer /, "");
  const k = await one(
    c.env.DB,
    "SELECT * FROM intake_keys WHERE token_hash=?",
    await hash(token),
  );
  if (!k) return c.json({ error: "מפתח טופס לא תקין" }, 401);
  const d = z
    .object({
      event_id: z.string().min(1).max(200),
      name: z.string().trim().min(1).max(200),
      email: z.union([z.string().email(), z.literal("")]).default(""),
      phone: z.string().max(40).default(""),
      course_id: z.string().optional(),
      consent: z.boolean().default(false),
      consent_text: z.string().max(3000).default(""),
    })
    .parse(await c.req.json());
  if (!d.email && !d.phone) return c.json({ error: "נדרש טלפון או מייל" }, 400);
  if (d.consent && !d.consent_text)
    return c.json({ error: "נדרש נוסח הסכמה" }, 400);
  const old = await one(
    c.env.DB,
    "SELECT lead_id FROM intake_events WHERE workspace_id=? AND event_id=?",
    k.workspace_id,
    d.event_id,
  );
  if (old) return c.json({ id: old.lead_id, duplicate: true });
  if (
    d.course_id &&
    !(await one(
      c.env.DB,
      "SELECT id FROM courses WHERE workspace_id=? AND id=?",
      k.workspace_id,
      d.course_id,
    ))
  )
    return c.json({ error: "קורס לא תקין" }, 400);
  const source = await one(
    c.env.DB,
    "SELECT heat FROM sources WHERE workspace_id=? AND id=?",
    k.workspace_id,
    k.source_id,
  );
  const assignee = await chooseAssignee(
      c.env.DB,
      k.workspace_id,
      k.source_id,
      d.course_id || null,
    ),
    lid = id();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO leads(workspace_id,id,name,email,phone,source_id,campaign_id,course_id,assignee_id,heat,marketing_consent,consent_text,consent_at,consent_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        k.workspace_id,
        lid,
        d.name,
        d.email.toLowerCase(),
        d.phone,
        k.source_id,
        k.campaign_id,
        d.course_id || null,
        assignee,
        source!.heat,
        d.consent ? 1 : 0,
        d.consent_text,
        d.consent ? new Date().toISOString() : null,
        "web-form",
      ),
      c.env.DB.prepare(
        "INSERT INTO intake_events(workspace_id,event_id,lead_id) VALUES(?,?,?)",
      ).bind(k.workspace_id, d.event_id, lid),
    ]);
  } catch (e) {
    const replay = await one(
      c.env.DB,
      "SELECT lead_id FROM intake_events WHERE workspace_id=? AND event_id=?",
      k.workspace_id,
      d.event_id,
    );
    if (replay) return c.json({ id: replay.lead_id, duplicate: true });
    throw e;
  }
  return c.json({ id: lid }, 201);
});
app.use("/api/*", authenticate);
app.get("/api/me", async (c) =>
  c.json({
    user: c.get("user"),
    workspaces: await rows(
      c.env.DB,
      "SELECT w.id,w.name,w.color,m.role FROM workspaces w JOIN members m ON m.workspace_id=w.id WHERE m.user_id=? AND m.active=1",
      c.get("user").id,
    ),
  }),
);
app.use("/api/w/:ws/*", workspace);
app.route("/api/w/:ws", api);
app.route("/api/w/:ws", email);
app.all("/api/*", (c) => c.json({ error: "נתיב לא קיים" }, 404));
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));
app.onError((err, c) => {
  if (err instanceof ZodError)
    return c.json(
      {
        error: err.issues
          .map((x) => x.path.join(".") + ": " + x.message)
          .join(" · "),
      },
      400,
    );
  if (err instanceof HTTPException)
    return c.json({ error: err.message }, err.status);
  if (err.message.includes("CLASS_FULL"))
    return c.json({ error: "הכיתה מלאה" }, 409);
  if (err.message.includes("ASSIGNEE_FULL"))
    return c.json(
      { error: "מכסת הלידים של איש המכירות מלאה; בחרו אחראי אחר" },
      409,
    );
  if (err.message.includes("UNIQUE constraint"))
    return c.json({ error: "הרשומה כבר קיימת" }, 409);
  console.error("request_failed", c.req.path, err.name);
  return c.json({ error: "אירעה תקלה; המידע לא נשמר. נסו שוב." }, 500);
});
export { app };
const BASE_PATH = "/crm";
export default {
  fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === BASE_PATH)
      return Response.redirect(url.origin + BASE_PATH + "/" + url.search, 308);
    const headers = new Headers(req.headers);
    headers.delete("X-Base-Path");
    if (url.pathname.startsWith(BASE_PATH + "/")) {
      url.pathname = url.pathname.slice(BASE_PATH.length);
      headers.set("X-Base-Path", BASE_PATH);
    }
    return app.fetch(
      new Request(url, { method: req.method, headers, body: req.body }),
      env,
      ctx,
    );
  },
  email: receiveEmail,
} satisfies ExportedHandler<Env>;
