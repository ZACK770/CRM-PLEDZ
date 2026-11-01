import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../server/index";
import { brevoWebhook } from "../server/email";

const origin = "https://crm.test";
const password = "Test-only-password-123!";
type Row = Record<string, any>;
let owner = "";
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
async function req(path: string, body?: unknown, cookie = owner, method = body ? "POST" : "GET") {
  const response = await app.request(
    origin + path,
    { method, headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
    ctx,
  );
  const text = await response.text();
  let data: Row = {};
  try { data = JSON.parse(text); } catch { data = { text }; }
  return { response, data };
}
beforeEach(async () => {
  await req("/api/auth/setup", { email: "owner@example.test", password, name: "מנהל בדיקה", token: env.BOOTSTRAP_TOKEN });
  const login = await req("/api/auth/login", { email: "owner@example.test", password });
  owner = login.response.headers.get("Set-Cookie")!.split(";")[0];
});
describe("marketing platform", () => {
  it("is owner-only", async () => {
    await req("/api/w/women/members", { name: "s", email: "sales@example.test", password, role: "sales", capacity: 1 });
    const login = await req("/api/auth/login", { email: "sales@example.test", password });
    const cookie = login.response.headers.get("Set-Cookie")!.split(";")[0];
    expect((await req("/api/mk/contacts", undefined, cookie)).response.status).toBe(403);
    expect((await req("/api/mk/contacts")).response.status).toBe(200);
  });
  it("syncs leads, imports, segments, launches and tracks events", async () => {
    const l = await req("/api/w/women/leads", { name: "שרה כהן", email: "Sara@Example.test", source_id: "direct" });
    expect(l.response.status, JSON.stringify(l.data)).toBe(201);
    expect((await req("/api/mk/sync-leads", {})).response.status).toBe(200);
    await req("/api/mk/sync-leads", {});
    const list = await req("/api/mk/lists", { name: "רשימה" });
    const imp = await req("/api/mk/contacts/import", {
      rows: [
        { email: "a@example.test", name: "א", fields: { עיר: "בני ברק" } },
        { email: "sara@example.test", name: "", tags: "vip" },
        { email: "bad", name: "x" },
      ],
      list_id: list.data.id,
      tags: "ייבוא1",
    });
    expect(imp.data, JSON.stringify(imp.data)).toEqual({ imported: 2, skipped: 1 });
    const all = await req("/api/mk/contacts");
    expect(all.data.total).toBe(2);
    const sara = all.data.contacts.find((c: Row) => c.email === "sara@example.test");
    expect(sara.name).toBe("שרה כהן");
    expect(sara.tags).toContain(",vip,");
    expect(sara.workspace_id).toBe("women");
    const prev = await req("/api/mk/segments/preview", { match: "all", conditions: [{ field: "field:עיר", op: "eq", value: "בני ברק" }, { field: "tag", op: "has", value: "ייבוא1" }] });
    expect(prev.data.total).toBe(1);
    const seg = await req("/api/mk/segments", { name: "חמים", rules: { match: "any", conditions: [{ field: "source", op: "not_empty" }, { field: "last_open", op: "not_within", value: "30" }] } });
    expect(seg.response.status).toBe(201);
    const count = await req("/api/mk/audience/count", { lists: [list.data.id], segments: [seg.data.id] });
    expect(count.data.sendable).toBe(2);
    await req("/api/mk/contacts/bulk", { ids: [sara.id], action: "unsubscribe" });
    const c2 = await req("/api/mk/audience/count", { all: true });
    expect(c2.data.excluded.unsubscribed).toBe(1);
    await req("/api/mk/contacts/bulk", { ids: [sara.id], action: "resubscribe" });
    const camp = await req("/api/mk/campaigns", { name: "בדיקה", subject: "שלום", html: "<p>שלום {{first_name}}</p>", audience: { all: true } });
    const put = await req(`/api/mk/campaigns/${camp.data.id}`, { name: "בדיקה", subject: "שלום", html: "<p>שלום {{first_name}}</p>", audience: { all: true, lists: [], segments: [], exclude_lists: [], exclude_segments: [] } }, owner, "PUT");
    expect(put.response.status, JSON.stringify(put.data)).toBe(200);
    const launch = await req(`/api/mk/campaigns/${camp.data.id}/launch`, {});
    expect(launch.data, JSON.stringify(launch.data)).toMatchObject({ ok: true, total: 2 });
    await env.DB.prepare("UPDATE mk_sends SET status='sent'").run();
    const ev = (event: string, extra: Row = {}) =>
      brevoWebhook(
        new Request("https://crm.test/api/webhooks/brevo", {
          method: "POST",
          headers: { Authorization: "Bearer test-only-webhook-token", "Content-Type": "application/json" },
          body: JSON.stringify({ event, email: "sara@example.test", "message-id": "<x@y>", ts_event: 1790000000, tags: ["mk", `mk-${camp.data.id}`], ...extra }),
        }),
        env,
      );
    await ev("opened");
    await ev("opened");
    await ev("click", { link: "https://x.test/a", ts_event: 1790000100 });
    await ev("unsubscribed", { ts_event: 1790000200 });
    const rep = await req(`/api/mk/campaigns/${camp.data.id}/report`);
    expect(rep.data.stats).toMatchObject({ total: 2, sent: 2, opened: 1, clicked: 1, opens: 1, unsubscribed: 1 });
    expect(rep.data.links[0]).toMatchObject({ link: "https://x.test/a", clicks: 1 });
    const contacts = await req("/api/mk/contacts?status=unsubscribed");
    expect(contacts.data.total).toBe(1);
    const lead = await env.DB.prepare("SELECT marketing_consent FROM leads").first<Row>();
    expect(lead!.marketing_consent).toBe(0);
    const an = await req("/api/mk/analytics");
    expect(an.response.status).toBe(200);
    const page = await req(`/u?t=${(await env.DB.prepare("SELECT token FROM mk_contacts WHERE email='a@example.test'").first<Row>())!.token}&c=${camp.data.id}`);
    expect(page.data.text).toContain("אישור הסרה");
    const csv = await app.request(origin + "/api/mk/contacts/export", { headers: { Cookie: owner } }, env, ctx);
    expect(await csv.text()).toContain("a@example.test");
    await req("/api/mk/contacts/bulk", { filter: { q: "א" }, action: "delete" });
    expect((await req("/api/mk/contacts")).data.total).toBe(1);
  });
});
