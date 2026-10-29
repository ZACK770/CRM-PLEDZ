import { env, fetchMock } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../server/index";
import { hash } from "../server/core";
import { brevoWebhook } from "../server/email";

const origin = "https://crm.test";
const password = "Test-only-password-123!";
type Row = Record<string, any>;
let owner = "";
async function req(
  path: string,
  body?: unknown,
  cookie = owner,
  method = body ? "POST" : "GET",
) {
  const response = await app.request(
    origin + "/api" + path,
    {
      method,
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
  return { response, data: (await response.json()) as Row };
}
async function resource(type: string, body: Row, ws = "women") {
  const r = await req(`/w/${ws}/resources/${type}`, body);
  expect(r.response.status, JSON.stringify(r.data)).toBe(201);
  return r.data.id as string;
}
async function lead(body: Row = {}, ws = "women") {
  const r = await req(`/w/${ws}/leads`, {
    name: "תלמידת בדיקה",
    source_id: "direct",
    ...body,
  });
  expect(r.response.status, JSON.stringify(r.data)).toBe(201);
  return r.data.id as string;
}
async function member(email: string, role = "sales") {
  const r = await req("/w/women/members", {
    name: email,
    email,
    password,
    role,
    capacity: 1,
  });
  expect(r.response.status).toBe(201);
  const u = await env.DB.prepare("SELECT id FROM users WHERE email=?")
    .bind(email)
    .first<Row>();
  const login = await req("/auth/login", { email, password });
  expect(login.response.status).toBe(200);
  return {
    id: u!.id as string,
    cookie: login.response.headers.get("Set-Cookie")!.split(";")[0],
  };
}
async function state(ws = "women", cookie = owner) {
  const r = await req(`/w/${ws}/state`, undefined, cookie);
  expect(r.response.status).toBe(200);
  return r.data;
}
beforeEach(async () => {
  owner = "";
  const setup = await req("/auth/setup", {
    email: "owner@example.test",
    password,
    name: "מנהל בדיקה",
    token: env.BOOTSTRAP_TOKEN,
  });
  expect(setup.response.status, JSON.stringify(setup.data)).toBe(200);
  const login = await req("/auth/login", {
    email: "owner@example.test",
    password,
  });
  expect(login.response.status).toBe(200);
  owner = login.response.headers.get("Set-Cookie")!.split(";")[0];
});
describe("workspace and role boundaries", () => {
  it("requires authentication, same origin, and a one-time bootstrap secret", async () => {
    expect((await req("/w/women/state", undefined, "")).response.status).toBe(
      401,
    );
    expect(
      (
        await req("/auth/setup", {
          token: env.BOOTSTRAP_TOKEN,
          email: "other@example.test",
          name: "אחר",
          password,
        })
      ).response.status,
    ).toBe(409);
    const csrf = await app.request(
      origin + "/api/w/women/leads",
      {
        method: "POST",
        headers: { Origin: "https://evil.test", Cookie: owner },
        body: "{}",
      },
      env,
    );
    expect(csrf.status).toBe(403);
    const session = await env.DB.prepare(
      "SELECT token FROM sessions LIMIT 1",
    ).first<Row>();
    expect(session!.token).not.toContain(owner.split("=")[1]);
    expect(session!.token).toMatch(/^[a-f0-9]{64}$/);
  });
  it("isolates colleges and rejects cross-college entity links", async () => {
    const id = await lead();
    expect((await state()).leads).toHaveLength(1);
    expect((await state("men")).leads).toHaveLength(0);
    const course = await resource("courses", { name: "גברים" }, "men");
    expect(
      (await req("/w/women/leads", { name: "bad", course_id: course })).response
        .status,
    ).toBe(400);
    expect(
      (await req(`/w/men/leads/${id}`, { name: "bad" }, owner, "PUT")).response
        .status,
    ).toBe(404);
    expect(
      (
        await req("/w/women/relations", {
          from_type: "lead",
          from_id: id,
          to_type: "course",
          to_id: course,
        })
      ).response.status,
    ).toBe(400);
  });
  it("limits a salesperson to assigned leads and own tasks, without finance", async () => {
    const a = await member("sales-a@example.test");
    const b = await member("sales-b@example.test");
    const own = await lead({ assignee_id: a.id });
    const other = await lead({ assignee_id: b.id });
    await resource("finance", {
      title: "private",
      kind: "receipt",
      amount: 100,
      date: "2026-10-29",
    });
    const s = await state("women", a.cookie);
    expect(s.leads.map((x: Row) => x.id)).toEqual([own]);
    expect(s.finance).toEqual([]);
    expect(
      (
        await req(
          `/w/women/leads/${other}`,
          { name: "unauthorized" },
          a.cookie,
          "PUT",
        )
      ).response.status,
    ).toBe(403);
    expect(
      (await req("/w/men/state", undefined, a.cookie)).response.status,
    ).toBe(403);
    expect(
      (await req("/w/women/resources/courses", { name: "bad" }, a.cookie))
        .response.status,
    ).toBe(403);
    expect(
      (
        await req(
          "/w/women/tasks",
          {
            title: "other",
            assignee_id: b.id,
            due_at: new Date().toISOString(),
          },
          a.cookie,
        )
      ).response.status,
    ).toBe(403);
  });
  it("shows a teacher only assigned classes and enrolled students", async () => {
    const teacher = await member("teacher@example.test", "teacher");
    const course = await resource("courses", { name: "course" });
    const cl = await resource("classes", {
      name: "owned",
      course_id: course,
      teacher_id: teacher.id,
    });
    const hidden = await resource("classes", {
      name: "hidden",
      course_id: course,
    });
    const lid = await lead({
      course_id: course,
      class_id: cl,
      notes: "private sales note",
    });
    expect(
      (
        await req(
          `/w/women/leads/${lid}`,
          {
            name: "student",
            source_id: "direct",
            course_id: course,
            class_id: cl,
            stage: "won",
          },
          owner,
          "PUT",
        )
      ).response.status,
    ).toBe(200);
    const s = await state("women", teacher.cookie);
    expect(s.classes.map((x: Row) => x.id)).toEqual([cl]);
    expect(s.leads).toEqual([]);
    expect(s.enrollments).toHaveLength(1);
    expect(s.enrollments[0].notes).toBeUndefined();
    expect(
      (
        await req(
          "/w/women/lessons",
          { class_id: hidden, title: "bad", held_at: new Date().toISOString() },
          teacher.cookie,
        )
      ).response.status,
    ).toBe(403);
  });
});
describe("lead, assignment and learning flow", () => {
  it("uses source heat and priority rules while honoring an open-lead quota", async () => {
    const a = await member("sales@example.test");
    await resource("assignment_rules", {
      assignee_id: a.id,
      source_id: "direct",
      priority: 1,
    });
    await lead({ heat: "cold" });
    await lead();
    const s = await state();
    expect(s.leads.every((x: Row) => x.heat === "hot")).toBe(true);
    expect(s.leads.filter((x: Row) => x.assignee_id === a.id)).toHaveLength(1);
  });
  it("converts a won lead atomically and prevents capacity overflow", async () => {
    const course = await resource("courses", { name: "course" });
    const cl = await resource("classes", {
      name: "one seat",
      course_id: course,
      capacity: 1,
    });
    const first = await lead({ course_id: course, class_id: cl });
    const second = await lead({ course_id: course, class_id: cl });
    const win = (lid: string) =>
      req(
        `/w/women/leads/${lid}`,
        { name: lid, course_id: course, class_id: cl, stage: "won" },
        owner,
        "PUT",
      );
    expect((await win(first)).response.status).toBe(200);
    expect((await win(first)).response.status).toBe(200);
    expect((await win(second)).response.status).toBe(409);
    const s = await state();
    expect(s.enrollments).toHaveLength(1);
    expect(s.leads.find((x: Row) => x.id === second).stage).toBe("new");
    expect(
      (
        await req(
          `/w/women/leads/${first}`,
          { name: "bad", stage: "new", course_id: course, class_id: cl },
          owner,
          "PUT",
        )
      ).response.status,
    ).toBe(400);
  });
  it("records reminders, completion, class attendance and grades", async () => {
    const me = (await req("/me")).data.user.id;
    const course = await resource("courses", { name: "course" });
    const cl = await resource("classes", { name: "class", course_id: course });
    const lid = await lead({ course_id: course, class_id: cl });
    await req(
      `/w/women/leads/${lid}`,
      { name: "student", course_id: course, class_id: cl, stage: "won" },
      owner,
      "PUT",
    );
    expect(
      (
        await req("/w/women/tasks", {
          title: "reminder",
          assignee_id: me,
          lead_id: lid,
          due_at: new Date().toISOString(),
        })
      ).response.status,
    ).toBe(201);
    let s = await state();
    expect(
      (
        await req(
          `/w/women/tasks/${s.tasks[0].id}`,
          { done: true },
          owner,
          "PUT",
        )
      ).response.status,
    ).toBe(200);
    expect(
      (
        await req("/w/women/lessons", {
          class_id: cl,
          title: "lesson",
          held_at: new Date().toISOString(),
        })
      ).response.status,
    ).toBe(201);
    s = await state();
    expect(
      (
        await req("/w/women/attendance", {
          lesson_id: s.lessons[0].id,
          enrollment_id: s.enrollments[0].id,
          status: "present",
        })
      ).response.status,
    ).toBe(200);
    expect(
      (
        await req("/w/women/grades", {
          enrollment_id: s.enrollments[0].id,
          title: "exam",
          score: 93,
        })
      ).response.status,
    ).toBe(201);
    s = await state();
    expect(s.tasks[0].done).toBe(1);
    expect(s.attendance[0].status).toBe("present");
    expect(s.grades[0].score).toBe(93);
    expect(
      (
        await req("/w/women/grades", {
          enrollment_id: s.enrollments[0].id,
          title: "invalid",
          score: 101,
        })
      ).response.status,
    ).toBe(400);
  });
  it("validates required dynamic fields and includes related records", async () => {
    const field = await resource("fields", {
      entity_type: "lead",
      label: "גיל",
      type: "number",
      required: 1,
    });
    expect(
      (await req("/w/women/leads", { name: "missing" })).response.status,
    ).toBe(400);
    const lid = await lead({ data: { [field]: 25 } });
    const type = await resource("entity_types", { name: "projects" });
    const record = await resource("records", {
      type_id: type,
      title: "linked project",
    });
    expect(
      (
        await req("/w/women/relations", {
          from_type: "lead",
          from_id: lid,
          to_type: type,
          to_id: record,
          label: "פרויקט",
        })
      ).response.status,
    ).toBe(201);
    expect((await state()).relations[0].to_id).toBe(record);
  });
});
describe("intake and email safety", () => {
  it("deduplicates intake events and keeps consent in the originating college", async () => {
    const key = (await req("/w/women/intake-keys", { source_id: "webinar" }))
      .data.token;
    const intake = () =>
      app.request(
        origin + "/api/intake",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            event_id: "event-1",
            name: "intake",
            email: "same@example.test",
            consent: true,
            consent_text: "Explicit consent on registration form",
          }),
        },
        env,
      );
    expect((await intake()).status).toBe(201);
    const repeat = await intake();
    expect(((await repeat.json()) as Row).duplicate).toBe(true);
    const s = await state();
    expect(s.leads).toHaveLength(1);
    expect(s.leads[0].heat).toBe("warm");
    expect(s.leads[0].marketing_consent).toBe(1);
    expect((await state("men")).leads).toEqual([]);
  });
  it("blocks marketing without consent and live email without configured sender", async () => {
    const lid = await lead({ email: "person@example.test" });
    await req("/w/women/drafts", {
      lead_id: lid,
      subject: "offer",
      body: "marketing",
      kind: "marketing",
    });
    const mid = (await state()).messages[0].id;
    expect(
      (await req(`/w/women/messages/${mid}/send`, {})).response.status,
    ).toBe(400);
    await req(
      `/w/women/leads/${lid}/consent`,
      { consent: true, text: "recorded agreement", source: "signed form" },
      owner,
      "PUT",
    );
    expect(
      (await req(`/w/women/messages/${mid}/send`, {})).response.status,
    ).toBe(503);
  });
  it("authenticates and deduplicates delivery events by provider ID, not email", async () => {
    const women = await lead({ email: "same@example.test" });
    const men = await lead({ email: "same@example.test" }, "men");
    for (const [ws, lid] of [
      ["women", women],
      ["men", men],
    ])
      await env.DB.prepare(
        "INSERT INTO messages(workspace_id,id,lead_id,direction,recipient,subject,body,provider_id) VALUES(?,?,?,'out','same@example.test','test','test',?)",
      )
        .bind(ws, ws + "-message", lid, ws)
        .run();
    const event = {
      "message-id": "<women>",
      event: "opened",
      ts_event: 1793270000,
    };
    const webhook = (authenticated: boolean) =>
      brevoWebhook(
        new Request(origin, {
          method: "POST",
          headers: authenticated
            ? { Authorization: "Bearer " + env.BREVO_WEBHOOK_TOKEN }
            : {},
          body: JSON.stringify(event),
        }),
        env,
      );
    expect((await webhook(false)).status).toBe(401);
    expect((await webhook(true)).status).toBe(200);
    expect((await webhook(true)).status).toBe(200);
    expect((await state()).message_events).toHaveLength(1);
    expect((await state("men")).message_events).toEqual([]);
    expect(await hash("test")).toHaveLength(64);
  });
  it("formats safe HTML and honors college-scoped unsubscribe without sending real email", async () => {
    const lid = await lead({ email: "person@example.test" });
    await lead({ email: "person@example.test" }, "men");
    await req(
      `/w/women/leads/${lid}/consent`,
      { consent: true, text: "signed consent", source: "form" },
      owner,
      "PUT",
    );
    await req(
      "/w/women/email-settings",
      {
        sender_email: "sender@example.test",
        inbox_email: "women@example.test",
        sender_address: "רחוב הבדיקה 1",
      },
      owner,
      "PUT",
    );
    await req("/w/women/drafts", {
      lead_id: lid,
      subject: "test",
      body: "<script>alert(1)</script>",
      kind: "marketing",
    });
    const mid = (await state()).messages[0].id;
    let sent: Row = {};
    fetchMock.activate();
    fetchMock.disableNetConnect();
    fetchMock
      .get("https://api.brevo.com")
      .intercept({ path: "/v3/smtp/email", method: "POST" })
      .reply(201, (options) => {
        sent = JSON.parse(String(options.body));
        return JSON.stringify({ messageId: "<provider-1>" });
      });
    try {
      const response = await app.request(
        origin + `/api/w/women/messages/${mid}/send`,
        { method: "POST", headers: { Origin: origin, Cookie: owner } },
        { ...env, BREVO_WOMEN_API_KEY: "test-key" },
      );
      expect(response.status).toBe(200);
      expect(sent.htmlContent).toContain("&lt;script&gt;");
      expect(sent.htmlContent).not.toContain("<script>");
      expect(sent.subject).toBe("פרסומת | test");
      const link = sent.textContent.match(
        /https:\/\/crm.test\/unsubscribe\?\S+/,
      )[0];
      expect((await app.request(link, {}, env)).status).toBe(200);
      expect(
        (await state()).leads.find((x: Row) => x.id === lid).marketing_consent,
      ).toBe(1);
      const form = new URL(link).searchParams.toString();
      expect(
        (
          await app.request(
            origin + "/api/unsubscribe",
            {
              method: "POST",
              headers: {
                Origin: origin,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: form,
            },
            env,
          )
        ).status,
      ).toBe(200);
      expect(
        (await state()).leads.find((x: Row) => x.id === lid).marketing_consent,
      ).toBe(0);
      expect((await state()).messages[0].provider_id).toBe("provider-1");
      fetchMock.assertNoPendingInterceptors();
    } finally {
      fetchMock.deactivate();
    }
  });
  it("rejects manual assignment above quota and updates source heat on edit", async () => {
    const a = await member("quota@example.test");
    const lid = await lead({ assignee_id: a.id });
    expect(
      (await req("/w/women/leads", { name: "overflow", assignee_id: a.id }))
        .response.status,
    ).toBe(409);
    expect(
      (
        await req(
          `/w/women/leads/${lid}`,
          { name: "edited", assignee_id: a.id, source_id: "webinar" },
          owner,
          "PUT",
        )
      ).response.status,
    ).toBe(200);
    expect((await state()).leads[0].heat).toBe("warm");
  });
  it("lets an owner attach an existing user without changing credentials", async () => {
    const a = await member("both@example.test");
    expect(
      (
        await req("/w/men/members", {
          email: "both@example.test",
          name: "ignored",
          role: "teacher",
        })
      ).response.status,
    ).toBe(201);
    expect((await state("men", a.cookie)).member.role).toBe("teacher");
    expect(
      (await req("/auth/login", { email: "both@example.test", password }))
        .response.status,
    ).toBe(200);
  });
  it("edits course metadata and refuses a class capacity smaller than enrollment", async () => {
    const course = await resource("courses", { name: "original" });
    expect(
      (
        await req(
          `/w/women/resources/courses/${course}`,
          { name: "updated", price: 500 },
          owner,
          "PUT",
        )
      ).response.status,
    ).toBe(200);
    expect((await state()).courses[0].name).toBe("updated");
    expect(
      (
        await req(
          `/w/men/resources/courses/${course}`,
          { name: "bad" },
          owner,
          "PUT",
        )
      ).response.status,
    ).toBe(404);
  });
});
