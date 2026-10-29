import { Hono } from "hono";
import { z } from "zod";
import { passwordHash } from "./auth";
import {
  type App,
  type Member,
  id,
  fail,
  one,
  rows,
  write,
  elevated,
  requireManager,
  leadAccess,
  classAccess,
  memberExists,
  audit,
  now,
} from "./core";
export const api = new Hono<App>();
const text = z.string().trim().min(1).max(200);
const opt = z.string().max(100).nullable().optional();
const data = z
  .record(
    z.string(),
    z.union([z.string().max(5000), z.number(), z.boolean(), z.null()]),
  )
  .default({});
const leadSchema = z.object({
  name: text,
  email: z.union([z.string().email().max(254), z.literal("")]).default(""),
  phone: z.string().max(40).default(""),
  source_id: opt,
  campaign_id: opt,
  course_id: opt,
  class_id: opt,
  assignee_id: opt,
  stage: z
    .enum(["new", "first_call", "in_progress", "won", "irrelevant"])
    .default("new"),
  heat: z.enum(["hot", "warm", "cold"]).default("warm"),
  notes: z.string().max(20000).default(""),
  data,
});
const resourceSchemas = {
  sources: z.object({ name: text, heat: z.enum(["hot", "warm", "cold"]) }),
  campaigns: z.object({
    name: text,
    budget: z.number().min(0).max(1e9).default(0),
    data,
  }),
  courses: z.object({
    name: text,
    price: z.number().min(0).max(1e8).default(0),
    description: z.string().max(10000).default(""),
    data,
  }),
  classes: z.object({
    name: text,
    course_id: text,
    teacher_id: opt,
    manager_id: opt,
    capacity: z.number().int().min(1).max(10000).default(30),
    starts_at: z.string().max(40).default(""),
    data,
  }),
  assignment_rules: z.object({
    source_id: opt,
    course_id: opt,
    assignee_id: text,
    priority: z.number().int().min(0).max(9999).default(10),
    active: z.number().int().min(0).max(1).default(1),
  }),
  finance: z.object({
    title: text,
    kind: z.enum(["forecast", "booked", "receipt", "expense_plan", "expense"]),
    amount: z.number().min(0).max(1e10),
    course_id: opt,
    campaign_id: opt,
    date: z.string().date(),
  }),
  entity_types: z.object({ name: text }),
  fields: z.object({
    entity_type: text,
    label: text,
    type: z.enum(["text", "number", "date", "select"]),
    options: z.array(z.string().max(100)).max(100).default([]),
    required: z.number().int().min(0).max(1).default(0),
  }),
  records: z.object({ type_id: text, title: text, data }),
};
async function refs(c: any, d: Record<string, any>) {
  const mapping: Record<string, string> = {
    source_id: "sources",
    campaign_id: "campaigns",
    course_id: "courses",
    class_id: "classes",
    type_id: "entity_types",
  };
  for (const [key, table] of Object.entries(mapping))
    if (
      d[key] &&
      !(await one(
        c.env.DB,
        `SELECT id FROM ${table} WHERE workspace_id=? AND id=?`,
        c.get("ws"),
        d[key],
      ))
    )
      fail("קישור שאינו שייך למכללה");
  if (d.assignee_id)
    await memberExists(c, d.assignee_id, ["owner", "manager", "sales"]);
  if (d.teacher_id)
    await memberExists(c, d.teacher_id, ["owner", "manager", "teacher"]);
  if (d.manager_id)
    await memberExists(c, d.manager_id, ["owner", "manager", "class_manager"]);
  if (d.class_id) {
    const cl = await one(
      c.env.DB,
      "SELECT course_id FROM classes WHERE workspace_id=? AND id=?",
      c.get("ws"),
      d.class_id,
    );
    if (cl && cl.course_id !== d.course_id)
      fail("הכיתה אינה שייכת לקורס שנבחר");
  }
}
async function validateFields(
  c: any,
  type: string,
  values: Record<string, any>,
) {
  const fields = await rows(
    c.env.DB,
    "SELECT * FROM fields WHERE workspace_id=? AND entity_type=?",
    c.get("ws"),
    type,
  );
  for (const f of fields) {
    const v = values[f.id];
    if (f.required && (v === undefined || v === null || v === ""))
      fail(`חסר שדה חובה: ${f.label}`);
    if (v === undefined || v === null || v === "") continue;
    if (f.type === "number" && typeof v !== "number")
      fail(`נדרש מספר: ${f.label}`);
    if (f.type === "select" && !JSON.parse(f.options).includes(v))
      fail(`בחירה לא תקינה: ${f.label}`);
    if (f.type === "date" && !z.string().date().safeParse(v).success)
      fail(`תאריך לא תקין: ${f.label}`);
  }
}
export async function chooseAssignee(
  db: D1Database,
  ws: string,
  sourceId: string | null,
  courseId: string | null,
) {
  const options = await rows(
    db,
    `SELECT m.user_id,m.capacity,r.priority,COUNT(l.id) load FROM assignment_rules r JOIN members m ON m.workspace_id=r.workspace_id AND m.user_id=r.assignee_id AND m.active=1 AND m.role IN ('sales','manager','owner') LEFT JOIN leads l ON l.workspace_id=m.workspace_id AND l.assignee_id=m.user_id AND l.stage NOT IN ('won','irrelevant') WHERE r.workspace_id=? AND r.active=1 AND (r.source_id IS NULL OR r.source_id=?) AND (r.course_id IS NULL OR r.course_id=?) GROUP BY r.id HAVING load<m.capacity ORDER BY r.priority ASC,load ASC,m.user_id ASC`,
    ws,
    sourceId,
    courseId,
  );
  return options[0]?.user_id || null;
}
api.get("/state", async (c) => {
  const db = c.env.DB,
    ws = c.get("ws"),
    m = c.get("member"),
    manager = elevated(m),
    sales = m.role === "sales";
  const leads = manager
    ? await rows(
        db,
        "SELECT * FROM leads WHERE workspace_id=? ORDER BY created_at DESC",
        ws,
      )
    : sales
      ? await rows(
          db,
          "SELECT * FROM leads WHERE workspace_id=? AND assignee_id=? ORDER BY created_at DESC",
          ws,
          m.user_id,
        )
      : [];
  const allowedClasses =
    manager || sales
      ? await rows(db, "SELECT * FROM classes WHERE workspace_id=?", ws)
      : await rows(
          db,
          "SELECT * FROM classes WHERE workspace_id=? AND (teacher_id=? OR manager_id=?)",
          ws,
          m.user_id,
          m.user_id,
        );
  const classIds = new Set(allowedClasses.map((x) => x.id));
  const leadIds = new Set(leads.map((x) => x.id));
  const enrollments = (
    await rows(
      db,
      `SELECT e.*,l.name,l.email,l.phone,c.teacher_id,c.manager_id FROM enrollments e JOIN leads l ON l.workspace_id=e.workspace_id AND l.id=e.lead_id JOIN classes c ON c.workspace_id=e.workspace_id AND c.id=e.class_id WHERE e.workspace_id=? AND e.active=1`,
      ws,
    )
  ).filter(
    (e) =>
      manager || (sales ? leadIds.has(e.lead_id) : classIds.has(e.class_id)),
  );
  const enrollmentIds = new Set(enrollments.map((e) => e.id));
  const lessons = (
    await rows(
      db,
      "SELECT * FROM lessons WHERE workspace_id=? ORDER BY held_at DESC",
      ws,
    )
  ).filter((l) => classIds.has(l.class_id));
  const lessonIds = new Set(lessons.map((l) => l.id));
  const tasks = manager
    ? await rows(
        db,
        "SELECT * FROM tasks WHERE workspace_id=? ORDER BY due_at",
        ws,
      )
    : await rows(
        db,
        "SELECT * FROM tasks WHERE workspace_id=? AND assignee_id=? ORDER BY due_at",
        ws,
        m.user_id,
      );
  const messages =
    manager || sales
      ? (
          await rows(
            db,
            "SELECT * FROM messages WHERE workspace_id=? ORDER BY created_at DESC",
            ws,
          )
        ).filter((x) => manager || leadIds.has(x.lead_id))
      : [];
  const messageIds = new Set(messages.map((x) => x.id));
  return c.json({
    member: m,
    workspace: await one(db, "SELECT * FROM workspaces WHERE id=?", ws),
    members: await rows(
      db,
      "SELECT m.user_id,m.role,m.capacity,m.active,u.name FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=?",
      ws,
    ),
    leads,
    tasks,
    courses: await rows(db, "SELECT * FROM courses WHERE workspace_id=?", ws),
    classes: allowedClasses,
    enrollments,
    lessons,
    attendance: (
      await rows(db, "SELECT * FROM attendance WHERE workspace_id=?", ws)
    ).filter(
      (x) => enrollmentIds.has(x.enrollment_id) && lessonIds.has(x.lesson_id),
    ),
    grades: (
      await rows(db, "SELECT * FROM grades WHERE workspace_id=?", ws)
    ).filter((x) => enrollmentIds.has(x.enrollment_id)),
    campaigns:
      manager || sales
        ? await rows(db, "SELECT * FROM campaigns WHERE workspace_id=?", ws)
        : [],
    sources:
      manager || sales
        ? await rows(db, "SELECT * FROM sources WHERE workspace_id=?", ws)
        : [],
    finance: manager
      ? await rows(
          db,
          "SELECT * FROM finance WHERE workspace_id=? ORDER BY date DESC",
          ws,
        )
      : [],
    assignment_rules: manager
      ? await rows(
          db,
          "SELECT * FROM assignment_rules WHERE workspace_id=? ORDER BY priority",
          ws,
        )
      : [],
    fields: await rows(db, "SELECT * FROM fields WHERE workspace_id=?", ws),
    entity_types: manager
      ? await rows(db, "SELECT * FROM entity_types WHERE workspace_id=?", ws)
      : [],
    records: manager
      ? await rows(db, "SELECT * FROM records WHERE workspace_id=?", ws)
      : [],
    relations: manager
      ? await rows(db, "SELECT * FROM relations WHERE workspace_id=?", ws)
      : [],
    messages,
    message_events:
      manager || sales
        ? (
            await rows(
              db,
              "SELECT * FROM message_events WHERE workspace_id=?",
              ws,
            )
          ).filter((x) => messageIds.has(x.message_id))
        : [],
    activity: manager
      ? await rows(
          db,
          "SELECT a.*,u.name user_name FROM activity a LEFT JOIN users u ON u.id=a.user_id WHERE a.workspace_id=? ORDER BY a.created_at DESC LIMIT 100",
          ws,
        )
      : [],
    emailConnected: !!(ws === "women"
      ? c.env.BREVO_WOMEN_API_KEY
      : c.env.BREVO_MEN_API_KEY),
    intake_keys: manager
      ? await rows(
          db,
          "SELECT id,source_id,campaign_id FROM intake_keys WHERE workspace_id=?",
          ws,
        )
      : [],
  });
});
api.post("/leads", async (c) => {
  const m = c.get("member");
  if (!elevated(m) && m.role !== "sales") fail("אין הרשאת מכירות", 403);
  const d = leadSchema.parse(await c.req.json());
  await refs(c, d);
  await validateFields(c, "lead", d.data);
  if (d.stage === "won") fail("יש לסגור מכירה מתוך כרטיס ליד שמור");
  if (m.role === "sales") d.assignee_id = m.user_id;
  if (!d.assignee_id)
    d.assignee_id = await chooseAssignee(
      c.env.DB,
      c.get("ws"),
      d.source_id || null,
      d.course_id || null,
    );
  if (d.source_id) {
    const s = await one(
      c.env.DB,
      "SELECT heat FROM sources WHERE workspace_id=? AND id=?",
      c.get("ws"),
      d.source_id,
    );
    d.heat = s!.heat;
  }
  const lid = id();
  await write(
    c.env.DB,
    `INSERT INTO leads(workspace_id,id,name,email,phone,source_id,campaign_id,course_id,class_id,assignee_id,stage,heat,notes,data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    c.get("ws"),
    lid,
    d.name,
    d.email.toLowerCase(),
    d.phone,
    d.source_id || null,
    d.campaign_id || null,
    d.course_id || null,
    d.class_id || null,
    d.assignee_id || null,
    d.stage,
    d.heat,
    d.notes,
    JSON.stringify(d.data),
  );
  await audit(c, "נוצר ליד", lid);
  return c.json({ id: lid }, 201);
});
api.put("/leads/:id", async (c) => {
  const old = await leadAccess(c, c.req.param("id"));
  const d = leadSchema.parse(await c.req.json());
  await refs(c, d);
  await validateFields(c, "lead", d.data);
  if (d.source_id)
    d.heat = (await one(
      c.env.DB,
      "SELECT heat FROM sources WHERE workspace_id=? AND id=?",
      c.get("ws"),
      d.source_id,
    ))!.heat;
  const m = c.get("member");
  if (m.role === "sales" && d.assignee_id !== m.user_id)
    fail("רק מנהל משנה הקצאה", 403);
  if (old.stage === "won" && (d.stage !== "won" || d.class_id !== old.class_id))
    fail("שינוי הרשמה קיימת דורש תהליך העברה נפרד");
  const statements: D1PreparedStatement[] = [];
  if (d.stage === "won" && old.stage !== "won") {
    if (!d.course_id || !d.class_id) fail("לפני סגירה יש לבחור קורס וכיתה");
    const cl = await one(
      c.env.DB,
      "SELECT * FROM classes WHERE workspace_id=? AND id=?",
      c.get("ws"),
      d.class_id,
    );
    const count = await one(
      c.env.DB,
      "SELECT COUNT(*) n FROM enrollments WHERE workspace_id=? AND class_id=? AND active=1",
      c.get("ws"),
      d.class_id,
    );
    if (count!.n >= cl!.capacity) fail("הכיתה מלאה", 409);
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO enrollments(workspace_id,id,lead_id,class_id) VALUES(?,?,?,?)",
      ).bind(c.get("ws"), id(), old.id, d.class_id),
    );
  }
  statements.push(
    c.env.DB.prepare(
      "UPDATE leads SET name=?,email=?,phone=?,source_id=?,campaign_id=?,course_id=?,class_id=?,assignee_id=?,stage=?,heat=?,notes=?,data=?,updated_at=? WHERE workspace_id=? AND id=?",
    ).bind(
      d.name,
      d.email.toLowerCase(),
      d.phone,
      d.source_id || null,
      d.campaign_id || null,
      d.course_id || null,
      d.class_id || null,
      d.assignee_id || null,
      d.stage,
      d.heat,
      d.notes,
      JSON.stringify(d.data),
      now(),
      c.get("ws"),
      old.id,
    ),
  );
  await c.env.DB.batch(statements);
  await audit(
    c,
    old.stage !== d.stage
      ? `שינוי שלב: ${old.stage} ← ${d.stage}`
      : "עודכנו פרטי ליד",
    old.id,
  );
  return c.json({ ok: true });
});
api.post("/tasks", async (c) => {
  const d = z
    .object({
      title: text,
      assignee_id: text,
      lead_id: opt,
      class_id: opt,
      due_at: z.string().datetime(),
    })
    .parse(await c.req.json());
  const m = c.get("member");
  await memberExists(c, d.assignee_id);
  if (!elevated(m) && d.assignee_id !== m.user_id)
    fail("אפשר ליצור משימה לעצמך בלבד", 403);
  if (d.lead_id) await leadAccess(c, d.lead_id);
  if (d.class_id) await classAccess(c, d.class_id);
  await write(
    c.env.DB,
    "INSERT INTO tasks(workspace_id,id,title,assignee_id,lead_id,class_id,due_at) VALUES(?,?,?,?,?,?,?)",
    c.get("ws"),
    id(),
    d.title,
    d.assignee_id,
    d.lead_id || null,
    d.class_id || null,
    d.due_at,
  );
  return c.json({ ok: true }, 201);
});
api.put("/tasks/:id", async (c) => {
  const d = z.object({ done: z.boolean() }).parse(await c.req.json());
  const t = await one(
    c.env.DB,
    "SELECT * FROM tasks WHERE workspace_id=? AND id=?",
    c.get("ws"),
    c.req.param("id"),
  );
  if (!t) fail("משימה לא נמצאה", 404);
  if (!elevated(c.get("member")) && t.assignee_id !== c.get("user").id)
    fail("אין הרשאה", 403);
  await write(
    c.env.DB,
    "UPDATE tasks SET done=? WHERE workspace_id=? AND id=?",
    d.done ? 1 : 0,
    c.get("ws"),
    t.id,
  );
  return c.json({ ok: true });
});
api.post("/members", async (c) => {
  requireManager(c);
  const d = z
    .object({
      name: text,
      email: z
        .string()
        .email()
        .transform((s) => s.toLowerCase()),
      password: z
        .union([z.string().min(12).max(256), z.literal("")])
        .optional(),
      role: z.enum(["manager", "sales", "class_manager", "teacher"]),
      capacity: z.number().int().min(0).max(10000).default(100),
    })
    .parse(await c.req.json());
  if (c.get("member").role !== "owner" && d.role === "manager")
    fail("רק בעלים מוסיף מנהל", 403);
  let u = await one(c.env.DB, "SELECT id FROM users WHERE email=?", d.email);
  if (u) {
    if (c.get("member").role !== "owner")
      fail("רק בעלים יכול לצרף משתמש קיים למכללה נוספת", 403);
    await write(
      c.env.DB,
      "INSERT INTO members(workspace_id,user_id,role,capacity) VALUES(?,?,?,?)",
      c.get("ws"),
      u.id,
      d.role,
      d.capacity,
    );
    await audit(c, "צורף איש צוות קיים");
    return c.json({ ok: true }, 201);
  }
  if (!d.password) fail("נדרשת סיסמה למשתמש חדש");
  u = { id: id() };
  const p = await passwordHash(d.password);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)",
    ).bind(u.id, d.name, d.email, p),
    c.env.DB.prepare(
      "INSERT INTO members(workspace_id,user_id,role,capacity) VALUES(?,?,?,?)",
    ).bind(c.get("ws"), u.id, d.role, d.capacity),
  ]);
  await audit(c, "נוסף איש צוות");
  return c.json({ ok: true }, 201);
});
api.put("/members/:id", async (c) => {
  requireManager(c);
  const d = z
    .object({
      active: z.number().int().min(0).max(1),
      capacity: z.number().int().min(0).max(10000),
    })
    .parse(await c.req.json());
  const target = await one<Member>(
    c.env.DB,
    "SELECT * FROM members WHERE workspace_id=? AND user_id=?",
    c.get("ws"),
    c.req.param("id"),
  );
  if (!target) fail("לא נמצא", 404);
  if (
    target!.role === "owner" ||
    (target!.role === "manager" && c.get("member").role !== "owner")
  )
    fail("אין הרשאה לשינוי משתמש זה", 403);
  await write(
    c.env.DB,
    "UPDATE members SET active=?,capacity=? WHERE workspace_id=? AND user_id=?",
    d.active,
    d.capacity,
    c.get("ws"),
    target!.user_id,
  );
  return c.json({ ok: true });
});
api.post("/lessons", async (c) => {
  const d = z
    .object({ class_id: text, title: text, held_at: z.string().datetime() })
    .parse(await c.req.json());
  await classAccess(c, d.class_id);
  await write(
    c.env.DB,
    "INSERT INTO lessons(workspace_id,id,class_id,title,held_at) VALUES(?,?,?,?,?)",
    c.get("ws"),
    id(),
    d.class_id,
    d.title,
    d.held_at,
  );
  return c.json({ ok: true }, 201);
});
api.post("/attendance", async (c) => {
  const d = z
    .object({
      lesson_id: text,
      enrollment_id: text,
      status: z.enum(["present", "absent", "late", "excused"]),
    })
    .parse(await c.req.json());
  const l = await one(
      c.env.DB,
      "SELECT * FROM lessons WHERE workspace_id=? AND id=?",
      c.get("ws"),
      d.lesson_id,
    ),
    e = await one(
      c.env.DB,
      "SELECT * FROM enrollments WHERE workspace_id=? AND id=? AND active=1",
      c.get("ws"),
      d.enrollment_id,
    );
  if (!l || !e || l.class_id !== e.class_id)
    fail("המפגש וההרשמה אינם באותה כיתה");
  await classAccess(c, l.class_id);
  await write(
    c.env.DB,
    "INSERT INTO attendance(workspace_id,lesson_id,enrollment_id,status) VALUES(?,?,?,?) ON CONFLICT(workspace_id,lesson_id,enrollment_id) DO UPDATE SET status=excluded.status",
    c.get("ws"),
    d.lesson_id,
    d.enrollment_id,
    d.status,
  );
  return c.json({ ok: true });
});
api.post("/grades", async (c) => {
  const d = z
    .object({
      enrollment_id: text,
      title: text,
      score: z.number().min(0).max(100),
    })
    .parse(await c.req.json());
  const e = await one(
    c.env.DB,
    "SELECT * FROM enrollments WHERE workspace_id=? AND id=? AND active=1",
    c.get("ws"),
    d.enrollment_id,
  );
  if (!e) fail("הרשמה לא נמצאה", 404);
  await classAccess(c, e.class_id);
  await write(
    c.env.DB,
    "INSERT INTO grades(workspace_id,id,enrollment_id,title,score) VALUES(?,?,?,?,?)",
    c.get("ws"),
    id(),
    d.enrollment_id,
    d.title,
    d.score,
  );
  return c.json({ ok: true }, 201);
});
api.post("/resources/:type", async (c) => {
  requireManager(c);
  const type = c.req.param("type") as keyof typeof resourceSchemas;
  const schema = resourceSchemas[type];
  if (!schema) fail("סוג לא קיים", 404);
  const d = schema.parse(await c.req.json()) as Record<string, any>;
  await refs(c, d);
  const entityType =
    type === "records"
      ? d.type_id
      : (
          {
            courses: "course",
            classes: "class",
            campaigns: "campaign",
          } as Record<string, string>
        )[type];
  if (entityType) await validateFields(c, entityType, d.data || {});
  const keys = Object.keys(d),
    vals = keys.map((k) =>
      typeof d[k] === "object" && d[k] !== null
        ? JSON.stringify(d[k])
        : (d[k] ?? null),
    );
  const rid = id();
  await write(
    c.env.DB,
    `INSERT INTO ${type}(workspace_id,id,${keys.join(",")}) VALUES(?,?,${keys.map(() => "?").join(",")})`,
    c.get("ws"),
    rid,
    ...vals,
  );
  await audit(c, "נוספה רשומה: " + type);
  return c.json({ id: rid }, 201);
});
api.put("/resources/:type/:id", async (c) => {
  requireManager(c);
  const type = c.req.param("type") as keyof typeof resourceSchemas;
  if (
    ![
      "courses",
      "classes",
      "campaigns",
      "sources",
      "assignment_rules",
      "records",
      "finance",
    ].includes(type)
  )
    fail("סוג לא ניתן לעריכה", 400);
  const old = await one(
    c.env.DB,
    `SELECT * FROM ${type} WHERE workspace_id=? AND id=?`,
    c.get("ws"),
    c.req.param("id"),
  );
  if (!old) fail("הרשומה לא נמצאה", 404);
  const d = resourceSchemas[type].parse(await c.req.json()) as Record<
    string,
    any
  >;
  await refs(c, d);
  const entityType =
    type === "records"
      ? d.type_id
      : (
          {
            courses: "course",
            classes: "class",
            campaigns: "campaign",
          } as Record<string, string>
        )[type];
  if (entityType) await validateFields(c, entityType, d.data || {});
  if (type === "classes") {
    const count = await one(
      c.env.DB,
      "SELECT COUNT(*) n FROM enrollments WHERE workspace_id=? AND class_id=? AND active=1",
      c.get("ws"),
      old.id,
    );
    if (count!.n > d.capacity) fail("הקיבולת קטנה ממספר התלמידים הקיימים");
    if (
      old.course_id !== d.course_id &&
      (await one(
        c.env.DB,
        "SELECT id FROM leads WHERE workspace_id=? AND class_id=? LIMIT 1",
        c.get("ws"),
        old.id,
      ))
    )
      fail("כיתה עם לידים מקושרים אינה ניתנת להעברה לקורס אחר");
  }
  const keys = Object.keys(d),
    values = keys.map((k) =>
      typeof d[k] === "object" && d[k] !== null
        ? JSON.stringify(d[k])
        : (d[k] ?? null),
    );
  await write(
    c.env.DB,
    `UPDATE ${type} SET ${keys.map((k) => k + "=?").join(",")} WHERE workspace_id=? AND id=?`,
    ...values,
    c.get("ws"),
    old.id,
  );
  await audit(c, "עודכנה רשומה: " + type);
  return c.json({ ok: true });
});
api.post("/relations", async (c) => {
  requireManager(c);
  const d = z
    .object({
      from_type: text,
      from_id: text,
      to_type: text,
      to_id: text,
      label: z.string().max(100).default(""),
    })
    .parse(await c.req.json());
  const tables: Record<string, string> = {
    lead: "leads",
    course: "courses",
    class: "classes",
    campaign: "campaigns",
  };
  for (const [type, rid] of [
    [d.from_type, d.from_id],
    [d.to_type, d.to_id],
  ]) {
    const table = tables[type] || "records";
    const r = await one(
      c.env.DB,
      `SELECT * FROM ${table} WHERE workspace_id=? AND id=?`,
      c.get("ws"),
      rid,
    );
    if (!r || (!tables[type] && r.type_id !== type)) fail("קישור לא תקין");
  }
  await write(
    c.env.DB,
    "INSERT INTO relations(workspace_id,id,from_type,from_id,to_type,to_id,label) VALUES(?,?,?,?,?,?,?)",
    c.get("ws"),
    id(),
    d.from_type,
    d.from_id,
    d.to_type,
    d.to_id,
    d.label,
  );
  return c.json({ ok: true }, 201);
});
api.post("/intake-keys", async (c) => {
  requireManager(c);
  const d = z
    .object({ source_id: text, campaign_id: opt })
    .parse(await c.req.json());
  await refs(c, d);
  const token = id() + id();
  const { hash } = await import("./core");
  await write(
    c.env.DB,
    "INSERT INTO intake_keys(workspace_id,id,token_hash,source_id,campaign_id) VALUES(?,?,?,?,?)",
    c.get("ws"),
    id(),
    await hash(token),
    d.source_id,
    d.campaign_id || null,
  );
  return c.json({ token }, 201);
});
api.put("/email-settings", async (c) => {
  requireManager(c);
  const d = z
    .object({
      sender_email: z.union([z.string().email(), z.literal("")]),
      inbox_email: z.union([z.string().email(), z.literal("")]),
      sender_address: z.string().trim().max(500).default(""),
    })
    .parse(await c.req.json());
  await write(
    c.env.DB,
    "UPDATE workspaces SET sender_email=?,inbox_email=?,sender_address=? WHERE id=?",
    d.sender_email.toLowerCase(),
    d.inbox_email.toLowerCase(),
    d.sender_address,
    c.get("ws"),
  );
  await audit(c, "עודכנו הגדרות דואר");
  return c.json({ ok: true });
});
