import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import {
  LayoutDashboard, Users, ListChecks, Filter, Send, BarChart3, ArrowRight, Plus, X, Upload, Download,
  RefreshCw, Monitor, Smartphone, Copy, Trash2, Mail, MousePointerClick, Eye, AlertTriangle, Search,
} from "lucide-react";
type Row = Record<string, any>;
const BASE = import.meta.env.BASE_URL;
async function api(path: string, method = "GET", body?: unknown): Promise<any> {
  const res = await fetch(BASE + "api/mk" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "הפעולה לא הושלמה");
  return d;
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const fmt = (v?: string) => (v ? new Date(v).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "—");
const num = (n: any) => Number(n || 0).toLocaleString("he-IL");
const DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const STATUS: Row = {
  draft: ["טיוטה", "gray"], scheduled: ["מתוזמן", "blue"], sending: ["בשליחה", "orange"], testing: ["בדיקת A/B", "purple"],
  paused: ["מושהה", "orange"], sent: ["נשלח", "green"], cancelled: ["בוטל", "gray"],
};
const CONTACT_STATUS: Row = { active: "פעיל", unsubscribed: "הוסר", bounced: "כתובת שגויה", complained: "סימן ספאם" };
const REASONS: Row = {
  pending: "ממתין בתור", held: "ממתין לתוצאת A/B", sending: "בשליחה כרגע", failed: "נכשל — Brevo דחה",
  waiting_quota: "ממתין למכסה פנויה ב־Brevo", hard_bounce: "כתובת שגויה/לא קיימת", soft_bounce: "דחייה זמנית (תיבה מלאה/שרת)",
  blocked: "נחסם ע״י Brevo (הוסר/ספאם בעבר)", cancelled: "בוטל",
};
const Badge = ({ children, color = "gray" }: { children: ReactNode; color?: string }) => <span className={"badge " + color}>{children}</span>;
function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={"modal" + (wide ? " mk-wide" : "")} role="dialog" aria-label={title}>
        <header><div><h2>{title}</h2></div><button className="icon" onClick={onClose} aria-label="סגירה"><X /></button></header>
        <div className="pad">{children}</div>
      </section>
    </div>
  );
}
function Kpi({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <section className="stat">
      <div><span>{label}</span>{icon && <i className="green">{icon}</i>}</div>
      <strong>{value}</strong>
      <small>{sub}</small>
    </section>
  );
}
function Bars({ data, unit = "", max }: { data: { label: string; value: number; sub?: string; best?: boolean }[]; unit?: string; max?: number }) {
  const m = max || Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="muted pad">אין עדיין נתונים</p>;
  return (
    <div className="mk-bars">
      {data.map((d, i) => (
        <div key={i} className="mk-bar-row">
          <span title={d.label}>{d.label}</span>
          <div className="mk-bar"><i className={d.best ? "best" : ""} style={{ width: `${(d.value / m) * 100}%` }} /></div>
          <b>{d.value}{unit}</b>
          {d.sub && <small className="muted">{d.sub}</small>}
        </div>
      ))}
    </div>
  );
}
const statsOf = (s: Row | null) => {
  const x = s || {};
  const sent = Number(x.sent || 0), delivered = Number(x.delivered || 0) || sent;
  return {
    total: Number(x.total || 0), sent, delivered, opened: Number(x.opened || 0), clicked: Number(x.clicked || 0),
    opens: Number(x.opens || 0), clicks: Number(x.clicks || 0), unsubscribed: Number(x.unsubscribed || 0),
    bounced: Number(x.bounced || 0), failed: Number(x.failed || 0),
    openRate: pct(Number(x.opened || 0), delivered), ctr: pct(Number(x.clicked || 0), delivered), ctor: pct(Number(x.clicked || 0), Number(x.opened || 0)),
  };
};

export function MarketingApp() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [view, setView] = useState("dashboard");
  const [campaignId, setCampaignId] = useState("");
  const [campaignMode, setCampaignMode] = useState<"edit" | "report">("edit");
  const [toast, setToast] = useState(""), [error, setError] = useState("");
  const [lists, setLists] = useState<Row[]>([]), [segments, setSegments] = useState<Row[]>([]), [campaigns, setCampaigns] = useState<Row[]>([]);
  const reload = useCallback(async () => {
    const [l, s, c] = await Promise.all([api("/lists"), api("/segments"), api("/campaigns")]);
    setLists(l); setSegments(s); setCampaigns(c);
  }, []);
  useEffect(() => {
    api("/me").then(() => { setAllowed(true); void reload(); }).catch(() => setAllowed(false));
  }, [reload]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(""), 4000); return () => clearTimeout(t); } }, [toast]);
  const run = async (fn: () => Promise<unknown>, ok = "בוצע") => {
    try { setError(""); await fn(); setToast(ok); await reload(); } catch (e) { setError((e as Error).message); }
  };
  if (allowed === null) return <div className="loading">טוען…</div>;
  if (!allowed)
    return (
      <div className="loading">
        <p>פלטפורמת הדיוור זמינה לבעלים בלבד. <a href={BASE}>חזרה ל־CRM</a></p>
      </div>
    );
  const openCampaign = (id: string, mode: "edit" | "report") => { setCampaignId(id); setCampaignMode(mode); setView("campaign"); };
  const nav = [
    { id: "dashboard", label: "לוח בקרה", icon: LayoutDashboard },
    { id: "campaigns", label: "דיוורים", icon: Send },
    { id: "contacts", label: "אנשי קשר", icon: Users },
    { id: "lists", label: "רשימות תפוצה", icon: ListChecks },
    { id: "segments", label: "סגמנטים דינמיים", icon: Filter },
    { id: "analytics", label: "אנליטיקס והשוואות", icon: BarChart3 },
  ];
  const ctx = { lists, segments, campaigns, reload, run, setToast, setError, openCampaign };
  return (
    <div className="app-shell mk">
      <aside className="sidebar">
        <a className="brand" onClick={() => setView("dashboard")}>
          <span className="brandmark"><Mail size={22} /></span>
          <span>דיוור<small>פלטפורמת שיווק · מנהל בלבד</small></span>
        </a>
        <span className="nav-label">שיווק דיגיטלי</span>
        <nav>
          {nav.map((n) => (
            <button key={n.id} className={view === n.id || (view === "campaign" && n.id === "campaigns") ? "active" : ""} onClick={() => setView(n.id)}>
              <n.icon size={18} /><span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="live-dot" /> ערוצים: מייל
          <small>SMS והודעות קוליות — בשלב הבא, על אותם אנשי קשר.</small>
        </div>
        <a className="secondary mk-back" href={BASE}><ArrowRight size={16} /> חזרה ל־CRM</a>
      </aside>
      <main>
        <div className="page">
          {error && <div className="error-banner" role="alert">{error} <button className="icon" onClick={() => setError("")}><X size={14} /></button></div>}
          {view === "dashboard" && <Dashboard {...ctx} go={setView} />}
          {view === "campaigns" && <Campaigns {...ctx} />}
          {view === "campaign" && (campaignMode === "edit"
            ? <CampaignEditor key={campaignId} id={campaignId} {...ctx} back={() => setView("campaigns")} />
            : <CampaignReport key={campaignId} id={campaignId} {...ctx} back={() => setView("campaigns")} />)}
          {view === "contacts" && <Contacts {...ctx} />}
          {view === "lists" && <Lists {...ctx} go={setView} />}
          {view === "segments" && <Segments {...ctx} />}
          {view === "analytics" && <Analytics {...ctx} />}
        </div>
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
type Ctx = {
  lists: Row[]; segments: Row[]; campaigns: Row[]; reload: () => Promise<void>;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  setToast: (s: string) => void; setError: (s: string) => void; openCampaign: (id: string, mode: "edit" | "report") => void;
};
function Heading({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="page-heading">
      <div><span className="eyebrow">פלטפורמת דיוור</span><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      <div className="button-group">{action}</div>
    </div>
  );
}

// ---------- dashboard ----------
function Dashboard({ campaigns, openCampaign, go }: Ctx & { go: (v: string) => void }) {
  const [a, setA] = useState<Row | null>(null);
  useEffect(() => { api("/analytics?days=90").then(setA).catch(() => undefined); }, []);
  const sent = campaigns.filter((c) => c.stats?.sent);
  const tot = sent.reduce((t, c) => { const s = statsOf(c.stats); t.d += s.delivered; t.o += s.opened; t.k += s.clicked; t.u += s.unsubscribed; return t; }, { d: 0, o: 0, k: 0, u: 0 });
  const peak = useMemo(() => peakHours(a?.hours || []), [a]);
  return (
    <>
      <Heading title="לוח בקרה" sub="תמונת מצב של כל הדיוורים, הקהלים והביצועים" action={<button className="primary" onClick={() => go("campaigns")}><Plus size={16} /> דיוור חדש</button>} />
      <div className="stats-grid">
        <Kpi label="אנשי קשר פעילים" value={num(a?.contacts?.active)} sub={`${num(a?.contacts?.total)} סה״כ · ${num(a?.contacts?.engaged)} פתחו ב־90 יום`} icon={<Users />} />
        <Kpi label="אחוז פתיחה ממוצע" value={`${pct(tot.o, tot.d)}%`} sub={`${num(tot.o)} פתחו מתוך ${num(tot.d)} שנמסרו`} icon={<Eye />} />
        <Kpi label="אחוז הקלקה ממוצע" value={`${pct(tot.k, tot.d)}%`} sub={`${pct(tot.k, tot.o)}% מהפותחים הקליקו`} icon={<MousePointerClick />} />
        <Kpi label="שעת שיא לפתיחה" value={peak.hour >= 0 ? `${peak.hour}:00` : "—"} sub={peak.day >= 0 ? `יום שיא: ${DAYS[peak.day]}` : "יתעדכן אחרי דיוורים"} icon={<BarChart3 />} />
      </div>
      <section className="panel">
        <header className="panel-header"><div><h2>דיוורים אחרונים</h2></div></header>
        <CampaignTable campaigns={campaigns.slice(0, 8)} openCampaign={openCampaign} />
      </section>
    </>
  );
}
function peakHours(hours: Row[]) {
  const byHour = Array(24).fill(0), byDay = Array(7).fill(0);
  for (const h of hours) if (h.event === "opened") { const d = new Date(h.h + ":00:00Z"); byHour[d.getHours()] += h.n; byDay[d.getDay()] += h.n; }
  const max = (a: number[]) => (Math.max(...a) > 0 ? a.indexOf(Math.max(...a)) : -1);
  return { hour: max(byHour), day: max(byDay), byHour, byDay };
}
function CampaignTable({ campaigns, openCampaign, select }: { campaigns: Row[]; openCampaign: Ctx["openCampaign"]; select?: { ids: string[]; set: (ids: string[]) => void } }) {
  if (!campaigns.length) return <p className="muted pad">עדיין אין דיוורים</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{select && <th />}<th>שם</th><th>סטטוס</th><th>נושא</th><th>נשלחו</th><th>פתיחה</th><th>הקלקה</th><th>הסרות</th><th>חזרות</th><th>מועד</th></tr></thead>
        <tbody>
          {campaigns.map((c) => {
            const s = statsOf(c.stats), st = STATUS[c.status] || [c.status, "gray"];
            return (
              <tr key={c.id} className="clickable" onClick={() => openCampaign(c.id, c.status === "draft" ? "edit" : "report")}>
                {select && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={select.ids.includes(c.id)} onChange={(e) => select.set(e.target.checked ? [...select.ids, c.id] : select.ids.filter((x) => x !== c.id))} /></td>}
                <td><b>{c.name}</b></td>
                <td><Badge color={st[1]}>{st[0]}</Badge>{c.last_error && <AlertTriangle size={14} className="mk-warn" />}</td>
                <td className="mk-ellipsis">{c.subject}{c.subject_b ? " / " + c.subject_b : ""}</td>
                <td>{num(s.sent)} / {num(c.total || s.total)}</td>
                <td>{s.sent ? `${s.openRate}%` : "—"}</td>
                <td>{s.sent ? `${s.ctr}%` : "—"}</td>
                <td>{num(s.unsubscribed)}</td>
                <td>{num(s.bounced)}</td>
                <td>{fmt(c.started_at || c.scheduled_at || c.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- campaigns ----------
function Campaigns({ campaigns, run, openCampaign }: Ctx) {
  const [filter, setFilter] = useState("all");
  const shown = campaigns.filter((c) => filter === "all" || (filter === "active" ? ["scheduled", "sending", "testing", "paused"].includes(c.status) : c.status === filter));
  return (
    <>
      <Heading title="דיוורים" sub="יצירה, תזמון, בדיקות A/B ודוחות"
        action={<button className="primary" onClick={() => void run(async () => { const r = await api("/campaigns", "POST", { name: "דיוור חדש " + new Date().toLocaleDateString("he-IL") }); openCampaign(r.id, "edit"); }, "נוצרה טיוטה")}><Plus size={16} /> דיוור חדש</button>} />
      <div className="filter-row mk-gap">
        {[["all", "הכול"], ["draft", "טיוטות"], ["active", "פעילים/מתוזמנים"], ["sent", "נשלחו"]].map(([k, l]) => (
          <button key={k} className={"chip" + (filter === k ? " active" : "")} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      <section className="panel"><CampaignTable campaigns={shown} openCampaign={openCampaign} /></section>
    </>
  );
}
const PLACEHOLDERS = [["{{first_name}}", "שם פרטי"], ["{{name}}", "שם מלא"], ["{{email}}", "מייל"], ['<a href="{{unsubscribe}}">להסרה מרשימת התפוצה</a>', "קישור הסרה"], ['<a href="https://">טקסט הקישור</a>', "קישור"]];
function preview(html: string) {
  const h = html
    .replace(/\{\{\s*first_name\s*\}\}/g, "שרה").replace(/\{\{\s*name\s*\}\}/g, "שרה כהן")
    .replace(/\{\{\s*email\s*\}\}/g, "sara@example.com").replace(/\{\{\s*phone\s*\}\}/g, "050-0000000").replace(/\{\{\s*unsubscribe\s*\}\}/g, "#");
  return /<html/i.test(h) ? h : `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"></head><body dir="rtl" style="direction:rtl;text-align:right;font-family:Arial">${h}</body></html>`;
}
function MultiPick({ label, items, value, onChange }: { label: string; items: Row[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="mk-pick">
      <span>{label}</span>
      <div className="filter-row">
        {items.length === 0 && <small className="muted">אין</small>}
        {items.map((i) => (
          <button type="button" key={i.id} className={"chip" + (value.includes(i.id) ? " active" : "")} onClick={() => onChange(value.includes(i.id) ? value.filter((x) => x !== i.id) : [...value, i.id])}>
            {i.name}{i.active !== undefined ? ` (${i.active})` : ""}
          </button>
        ))}
      </div>
    </div>
  );
}
function CampaignEditor({ id, lists, segments, run, setToast, setError, openCampaign, back }: Ctx & { id: string; back: () => void }) {
  const [m, setM] = useState<Row | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [count, setCount] = useState<Row | null>(null);
  const [testTo, setTestTo] = useState("");
  const [confirm, setConfirm] = useState<null | "now" | "schedule">(null);
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<Row[]>([]);
  const code = useRef<HTMLTextAreaElement>(null);
  const loadFiles = useCallback(() => api(`/campaigns/${id}/attachments`).then(setFiles).catch(() => undefined), [id]);
  useEffect(() => { void loadFiles(); }, [loadFiles]);
  useEffect(() => {
    api(`/campaigns/${id}`).then((c) => setM({ ...c, audience: JSON.parse(c.audience || "{}"), ad_prefix: !!c.ad_prefix })).catch((e) => setError(e.message));
  }, [id, setError]);
  const audienceKey = JSON.stringify(m?.audience || {});
  useEffect(() => {
    if (!m) return;
    const t = setTimeout(() => api("/audience/count", "POST", JSON.parse(audienceKey)).then(setCount).catch(() => setCount(null)), 300);
    return () => clearTimeout(t);
  }, [audienceKey, m]);
  if (!m) return <div className="loading">טוען…</div>;
  const set = (k: string, v: unknown) => setM({ ...m, [k]: v });
  const aud = { all: false, lists: [], segments: [], exclude_lists: [], exclude_segments: [], ...m.audience };
  const setAud = (k: string, v: unknown) => set("audience", { ...aud, [k]: v });
  const payload = () => ({
    name: m.name, channel: m.channel, workspace_id: m.workspace_id, from_name: m.from_name, subject: m.subject, subject_b: m.subject_b,
    ab_percent: Number(m.ab_percent) || 0, ab_hours: Number(m.ab_hours) || 4, preheader: m.preheader, html: m.html, ad_prefix: !!m.ad_prefix, audience: aud,
  });
  const save = async (quiet = false) => { await api(`/campaigns/${id}`, "PUT", payload()); if (!quiet) setToast("נשמר"); };
  const wrap = async (fn: () => Promise<void>) => { setBusy(true); try { setError(""); await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const insert = (text: string) => {
    const el = code.current, html = m.html || "";
    const at = el ? el.selectionStart : html.length, to = el ? el.selectionEnd : html.length;
    set("html", html.slice(0, at) + text + html.slice(to));
    setTimeout(() => { if (el) { el.focus(); el.selectionStart = el.selectionEnd = at + text.length; } }, 0);
  };
  const addFiles = (list: FileList | null) => void wrap(async () => {
    for (const f of Array.from(list || [])) {
      if (f.size > 1_900_000) throw new Error(`${f.name} גדול מ־1.9MB`);
      const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = () => rej(new Error("קריאת קובץ נכשלה")); r.readAsDataURL(f); });
      await api(`/campaigns/${id}/attachments`, "POST", { name: f.name, mime: f.type || "application/octet-stream", data });
    }
    await loadFiles();
    setToast("הקובץ צורף לדיוור");
  });
  const html = m.html || "";
  const trackedLinks = (html.match(/href\s*=\s*["']https?:\/\/[^"']+["']/gi) || []).length;
  const deadLinks = (html.match(/href\s*=\s*["']\s*(#[^"']*)?["']/gi) || []).length;
  const loadFile = (f?: File) => { if (!f) return; const r = new FileReader(); r.onload = () => set("html", String(r.result)); r.readAsText(f); };
  return (
    <>
      <Heading title={m.name || "דיוור"} sub="הדבק HTML מוכן (למשל מ־AI), צפה בתצוגה מקדימה, שלח בדיקה ושגר"
        action={<>
          <button className="secondary" onClick={back}><ArrowRight size={16} /> לכל הדיוורים</button>
          <button className="secondary" disabled={busy} onClick={() => void wrap(() => save())}>שמירה</button>
          <button className="primary" disabled={busy} onClick={() => void wrap(async () => { await save(true); setConfirm("now"); })}><Send size={16} /> שליחה…</button>
        </>} />
      <div className="mk-editor">
        <section className="panel pad mk-settings">
          <div className="form-grid">
            <label className="wide">שם הדיוור (פנימי)<input value={m.name} onChange={(e) => set("name", e.target.value)} /></label>
            <label>ערוץ<select value={m.channel} onChange={(e) => set("channel", e.target.value)}>
              <option value="email">מייל</option><option value="sms" disabled>SMS (בשלב הבא)</option><option value="voice" disabled>הודעה קולית (בשלב הבא)</option>
            </select></label>
            <label>שולח (מכללה)<select value={m.workspace_id} onChange={(e) => set("workspace_id", e.target.value)}>
              <option value="women">מכללת נשים · office@women.the-impact.net</option><option value="men">מכללת גברים · office@men.the-impact.net</option>
            </select></label>
            <label className="wide">שם השולח שיוצג<input value={m.from_name} placeholder="למשל: מכללת אימפקט" onChange={(e) => set("from_name", e.target.value)} /></label>
            <label className="wide">נושא<input value={m.subject} onChange={(e) => set("subject", e.target.value)} /></label>
            <label className="wide">טקסט מקדים (מופיע ליד הנושא בתיבה)<input value={m.preheader} onChange={(e) => set("preheader", e.target.value)} /></label>
            <label className="wide mk-check"><input type="checkbox" checked={!!m.ad_prefix} onChange={(e) => set("ad_prefix", e.target.checked)} /> להוסיף "פרסומת |" בתחילת הנושא</label>
          </div>
          <details className="mk-details" open={!!m.ab_percent}>
            <summary>בדיקת A/B לנושא</summary>
            <div className="form-grid">
              <label className="wide">נושא חלופי (B)<input value={m.subject_b} onChange={(e) => set("subject_b", e.target.value)} /></label>
              <label>% לכל גרסה בבדיקה<input type="number" min={0} max={50} value={m.ab_percent} onChange={(e) => set("ab_percent", e.target.value)} /></label>
              <label>שעות עד בחירת מנצח<input type="number" min={1} max={72} value={m.ab_hours} onChange={(e) => set("ab_hours", e.target.value)} /></label>
            </div>
            <small className="muted">לדוגמה 10%: 10% יקבלו A, 10% יקבלו B, ואחרי הזמן שנקבע הנושא המנצח (פתיחות+הקלקות) יישלח לשאר אוטומטית. 0 = ללא בדיקה.</small>
          </details>
          <h3 className="mk-h3">קהל יעד</h3>
          <label className="mk-check"><input type="checkbox" checked={aud.all} onChange={(e) => setAud("all", e.target.checked)} /> כל אנשי הקשר</label>
          <MultiPick label="רשימות" items={lists} value={aud.lists} onChange={(v) => setAud("lists", v)} />
          <MultiPick label="סגמנטים" items={segments} value={aud.segments} onChange={(v) => setAud("segments", v)} />
          <MultiPick label="להחריג רשימות" items={lists} value={aud.exclude_lists} onChange={(v) => setAud("exclude_lists", v)} />
          <MultiPick label="להחריג סגמנטים" items={segments} value={aud.exclude_segments} onChange={(v) => setAud("exclude_segments", v)} />
          {count && (
            <div className="mk-audience">
              <b>{num(count.sendable)}</b> יקבלו את הדיוור
              <small>מתוכם {num(count.consented)} עם הסכמה מתועדת · {num(count.sendable - count.consented)} ללא הסכמה מתועדת</small>
              {count.total > count.sendable && (
                <small className="mk-warn-text">לא יישלחו: {num(count.excluded?.no_email)} ללא מייל · {num(count.excluded?.unsubscribed)} הוסרו · {num(count.excluded?.bounced)} כתובת שגויה · {num(count.excluded?.complained)} סימנו ספאם</small>
              )}
            </div>
          )}
          <h3 className="mk-h3">קבצים מצורפים</h3>
          <div className="filter-row">
            {files.map((f) => (
              <span key={f.id} className="chip">📎 {f.name} · {Math.round(f.size / 1024)}KB
                <button className="icon" aria-label="הסרת קובץ" onClick={() => void wrap(async () => { await api(`/campaigns/${id}/attachments/${f.id}`, "DELETE"); await loadFiles(); })}><X size={12} /></button>
              </span>
            ))}
            <label className="chip"><Upload size={13} /> צירוף קובץ<input type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} /></label>
          </div>
          <small className="muted">עד 1.9MB לקובץ, 4MB לדיוור. הקבצים נשלחים לכל נמען וגם במייל הבדיקה.</small>
          <h3 className="mk-h3">שליחת בדיקה</h3>
          <div className="mk-inline">
            <input dir="ltr" placeholder="you@example.com, other@example.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            <button className="secondary" disabled={busy || !testTo} onClick={() => void wrap(async () => {
              await save(true);
              await api(`/campaigns/${id}/test`, "POST", { emails: testTo.split(/[,\s;]+/).filter(Boolean) });
              setToast("מייל בדיקה נשלח");
            })}><Send size={15} /> שלח בדיקה</button>
          </div>
        </section>
        <section className="panel mk-html">
          <div className="mk-html-bar">
            <span className="muted">HTML</span>
            {PLACEHOLDERS.map(([p, l]) => <button key={p} className="chip" title={p} onClick={() => insert(p)}>+ {l}</button>)}
            <label className="chip"><Upload size={13} /> קובץ HTML<input type="file" accept=".html,.htm,text/html" hidden onChange={(e) => loadFile(e.target.files?.[0])} /></label>
            <span className="mk-spacer" />
            <button className={"chip" + (device === "desktop" ? " active" : "")} onClick={() => setDevice("desktop")}><Monitor size={13} /></button>
            <button className={"chip" + (device === "mobile" ? " active" : "")} onClick={() => setDevice("mobile")}><Smartphone size={13} /></button>
          </div>
          <div className="mk-split">
            <textarea ref={code} className="mk-code" dir="ltr" spellCheck={false} placeholder="<html>… הדבק כאן את ה־HTML …</html>" value={m.html} onChange={(e) => set("html", e.target.value)} />
            <div className={"mk-preview " + device}>
              {m.html ? <iframe title="תצוגה מקדימה" sandbox="" srcDoc={preview(m.html)} /> : <p className="muted pad">התצוגה המקדימה תופיע כאן</p>}
            </div>
          </div>
          <div className="pad mk-track">
            <span><Eye size={14} /> פתיחות: נמדדות אוטומטית (תמונת מעקב בלתי נראית נוספת לכל מייל).</span>
            <span><MousePointerClick size={14} /> הקלקות: {trackedLinks ? `${trackedLinks} קישורים יימדדו` : "אין עדיין קישורים למדידה"} — כל קישור שמתחיל ב־https:// נמדד אוטומטית.</span>
            {deadLinks > 0 && <span className="mk-warn-text"><AlertTriangle size={14} /> {deadLinks} קישורים ריקים או "#" — לא יובילו לשום מקום ולא ייספרו. החלף ב־https://… אמיתי.</span>}
            <span className="muted">קישור הסרה וכתובת העסק נוספים אוטומטית בתחתית, אלא אם הוספת "קישור הסרה" בעצמך.</span>
          </div>
        </section>
      </div>
      {confirm && (
        <Modal title="שיגור הדיוור" onClose={() => setConfirm(null)}>
          <p><b>{num(count?.sendable)}</b> נמענים יקבלו "{m.subject}"{m.ab_percent ? ` (A/B: ${m.ab_percent}% לכל גרסה)` : ""}.</p>
          {count && count.total > count.sendable && <p className="mk-warn-text">{num(count.total - count.sendable)} לא יקבלו: ללא מייל, הוסרו, כתובת שגויה או סימנו ספאם.</p>}
          <p className="muted">השליחה מתבצעת במנות של 300. אם מכסת Brevo תיגמר — הדיוור יושהה ויתחדש אוטומטית, והסיבה תוצג בדוח.</p>
          <div className="mk-inline">
            <label>מועד (ריק = עכשיו)<input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
          </div>
          <footer className="form-footer">
            <span />
            <button className="primary" disabled={busy} onClick={() => void wrap(async () => {
              const r = await api(`/campaigns/${id}/launch`, "POST", { scheduled_at: when ? new Date(when).toISOString() : "" });
              setConfirm(null);
              await run(async () => undefined, when ? `תוזמן ל־${new Date(when).toLocaleString("he-IL")} · ${r.total} נמענים` : `השליחה התחילה · ${r.total} נמענים`);
              openCampaign(id, "report");
            })}><Send size={16} /> {when ? "תזמון" : "שליחה עכשיו"}</button>
          </footer>
        </Modal>
      )}
    </>
  );
}
function CampaignReport({ id, run, openCampaign, back, setToast }: Ctx & { id: string; back: () => void }) {
  const [m, setM] = useState<Row | null>(null), [r, setR] = useState<Row | null>(null);
  const [filter, setFilter] = useState("all"), [rec, setRec] = useState<Row>({ total: 0, recipients: [] }), [page, setPage] = useState(0);
  const load = useCallback(async () => {
    const [c, rep] = await Promise.all([api(`/campaigns/${id}`), api(`/campaigns/${id}/report`)]);
    setM(c); setR(rep);
  }, [id]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 30000); return () => clearInterval(t); }, [load]);
  useEffect(() => { api(`/campaigns/${id}/recipients?filter=${filter}&page=${page}`).then(setRec).catch(() => undefined); }, [id, filter, page, r]);
  if (!m || !r) return <div className="loading">טוען דוח…</div>;
  const s = statsOf(r.stats), st = STATUS[m.status] || [m.status, "gray"];
  const ex = JSON.parse(m.excluded || "{}");
  const start = new Date(m.started_at || m.scheduled_at || m.created_at).getTime();
  const tl: Row = {};
  for (const t of r.timeline) {
    const hr = Math.floor((new Date(t.h + ":00:00Z").getTime() - start) / 3600000);
    if (hr < 0 || hr > 71) continue;
    tl[hr] = tl[hr] || { o: 0, k: 0 }; tl[hr][t.event === "opened" ? "o" : "k"] += t.n;
  }
  const tlMax = Math.max(1, ...Object.values(tl).map((x: any) => x.o));
  return (
    <>
      <Heading title={m.name} sub={`נושא: ${m.subject}${m.ab_winner ? ` · מנצח A/B: ${m.ab_winner}` : ""}`}
        action={<>
          <button className="secondary" onClick={back}><ArrowRight size={16} /> לכל הדיוורים</button>
          <button className="secondary" onClick={() => void load()}><RefreshCw size={15} /> רענון</button>
          <button className="secondary" onClick={() => void run(async () => { const d = await api(`/campaigns/${id}/duplicate`, "POST", {}); openCampaign(d.id, "edit"); }, "שוכפל לטיוטה")}><Copy size={15} /> שכפול</button>
          {m.status === "paused" && <button className="primary" onClick={() => void run(async () => { await api(`/campaigns/${id}/resume`, "POST", {}); await load(); }, "השליחה חודשה")}>חידוש שליחה</button>}
          {["scheduled", "sending", "testing", "paused"].includes(m.status) && <button className="secondary" onClick={() => confirm("לבטל את המשך השליחה?") && void run(async () => { await api(`/campaigns/${id}/cancel`, "POST", {}); await load(); }, "בוטל")}>ביטול</button>}
        </>} />
      <div className="mk-status-line">
        <Badge color={st[1]}>{st[0]}</Badge>
        <span>{m.status === "scheduled" ? `מתוזמן ל־${fmt(m.scheduled_at)}` : m.status === "testing" ? `בדיקת A/B — המנצח יישלח לשאר ${m.ab_hours} שעות אחרי סיום הבדיקה` : `התחיל ${fmt(m.started_at)}${m.finished_at ? ` · הסתיים ${fmt(m.finished_at)}` : ""}`}</span>
      </div>
      {m.last_error && <div className="error-banner"><AlertTriangle size={16} /> {m.last_error}{m.resume_at ? ` · ניסיון הבא: ${fmt(m.resume_at)}` : ""}</div>}
      <div className="stats-grid mk-six">
        <Kpi label="נשלחו" value={`${num(s.sent)} / ${num(m.total)}`} sub={`${pct(s.sent, m.total)}% מהקהל`} icon={<Send />} />
        <Kpi label="נמסרו" value={num(s.delivered)} sub={`${pct(s.delivered, s.sent)}% מהנשלחים`} icon={<Mail />} />
        <Kpi label="פתחו" value={`${s.openRate}%`} sub={`${num(s.opened)} אנשים · ${num(s.opens)} פתיחות`} icon={<Eye />} />
        <Kpi label="הקליקו" value={`${s.ctr}%`} sub={`${num(s.clicked)} אנשים · ${s.ctor}% מהפותחים`} icon={<MousePointerClick />} />
        <Kpi label="הסרות" value={num(s.unsubscribed)} sub={`${pct(s.unsubscribed, s.delivered)}%`} />
        <Kpi label="חזרות / נכשלו" value={`${num(s.bounced)} / ${num(s.failed)}`} sub="פירוט למטה" />
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <header className="panel-header"><div><h2>מה נשלח ומה לא — ולמה</h2></div></header>
          <div className="pad mk-reasons">
            <p><Badge color="green">נשלח</Badge> {num(s.sent)} נמענים</p>
            {r.errors.map((e: Row) => (
              <p key={e.reason}><Badge color={["pending", "held", "sending"].includes(e.reason) ? "blue" : "orange"}>{REASONS[e.reason] || e.reason}</Badge> {num(e.n)}{e.error ? <small className="muted"> — {e.error}</small> : null}</p>
            ))}
            {Object.entries(ex).some(([, v]) => Number(v) > 0) && (
              <p className="muted">לא נכנסו לתור מראש: {num(ex.no_email)} ללא מייל · {num(ex.unsubscribed)} הוסרו · {num(ex.bounced)} כתובת שגויה · {num(ex.complained)} סימנו ספאם</p>
            )}
          </div>
        </section>
        <section className="panel">
          <header className="panel-header"><div><h2>פתיחות לפי שעות מהשליחה</h2><p>72 השעות הראשונות</p></div></header>
          <div className="mk-timeline pad">
            {Array.from({ length: 72 }, (_, i) => (
              <i key={i} title={`שעה ${i}: ${tl[i]?.o || 0} פתיחות, ${tl[i]?.k || 0} הקלקות`} style={{ height: `${((tl[i]?.o || 0) / tlMax) * 100}%` }} />
            ))}
          </div>
        </section>
      </div>
      {r.variants.length > 1 && (
        <section className="panel mk-gap">
          <header className="panel-header"><div><h2>השוואת A/B</h2></div></header>
          <div className="table-wrap"><table>
            <thead><tr><th>גרסה</th><th>נושא</th><th>נשלחו</th><th>פתיחה</th><th>הקלקה</th></tr></thead>
            <tbody>{r.variants.filter((v: Row) => v.variant !== "W").map((v: Row) => { const vs = statsOf(v); return (
              <tr key={v.variant}><td><b>{v.variant}</b>{m.ab_winner === v.variant && <Badge color="green">מנצח</Badge>}</td><td>{v.variant === "B" ? m.subject_b : m.subject}</td><td>{num(vs.sent)}</td><td>{vs.openRate}%</td><td>{vs.ctr}%</td></tr>
            ); })}</tbody>
          </table></div>
        </section>
      )}
      <section className="panel mk-gap">
        <header className="panel-header"><div><h2>הקלקות לפי קישור</h2></div></header>
        <Bars data={r.links.map((l: Row) => ({ label: l.link, value: l.clicks, sub: `${l.people} אנשים` }))} />
      </section>
      <section className="panel mk-gap">
        <header className="panel-header">
          <div><h2>נמענים</h2><p>{num(rec.total)} בתצוגה</p></div>
          <button className="secondary" onClick={() => { const name = prompt("שם הרשימה החדשה:", `${m.name} — ${filter}`); if (name) void run(() => api(`/campaigns/${id}/to-list`, "POST", { filter, name }), "נוצרה רשימה"); }}><ListChecks size={15} /> שמירה כרשימה</button>
        </header>
        <div className="filter-row pad">
          {[["all", "הכול"], ["opened", "פתחו"], ["not_opened", "לא פתחו"], ["clicked", "הקליקו"], ["not_clicked", "לא הקליקו"], ["bounced", "חזרו"], ["unsubscribed", "הוסרו"], ["failed", "נכשלו"]].map(([k, l]) => (
            <button key={k} className={"chip" + (filter === k ? " active" : "")} onClick={() => { setFilter(k); setPage(0); }}>{l}</button>
          ))}
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>מייל</th><th>שם</th><th>גרסה</th><th>סטטוס</th><th>נשלח</th><th>נפתח</th><th>הקליק</th><th>פתיחות</th><th>הקלקות</th><th>הערה</th></tr></thead>
          <tbody>{rec.recipients.map((x: Row) => (
            <tr key={x.contact_id}><td dir="ltr">{x.email}</td><td>{x.name}</td><td>{x.variant}</td><td>{REASONS[x.bounced] || (x.status === "sent" ? "נשלח" : REASONS[x.status] || x.status)}</td>
              <td>{fmt(x.sent_at)}</td><td>{fmt(x.opened_at)}</td><td>{fmt(x.clicked_at)}</td><td>{x.opens}</td><td>{x.clicks}</td><td className="mk-ellipsis">{x.unsubscribed_at ? "הוסר/ה" : x.error}</td></tr>
          ))}</tbody>
        </table></div>
        <Pager page={page} total={rec.total} setPage={setPage} />
      </section>
      <p className="muted mk-gap">פתיחה נמדדת כשהתמונות במייל נטענות; חלק מתוכנות הדואר חוסמות זאת, ולכן אחוז הפתיחה הוא הערכה. הקלקה נמדדת במדויק. <button className="text-button" onClick={() => setToast("הנתונים מתעדכנים בזמן אמת מ־Brevo")}>?</button></p>
    </>
  );
}
function Pager({ page, total, setPage }: { page: number; total: number; setPage: (n: number) => void }) {
  const pages = Math.ceil(total / 100);
  if (pages <= 1) return null;
  return (
    <div className="mk-pager">
      <button className="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>הקודם</button>
      <span>עמוד {page + 1} מתוך {pages}</span>
      <button className="secondary" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>הבא</button>
    </div>
  );
}

// ---------- contacts ----------
function parseTable(text: string): string[][] {
  const first = text.split(/\r?\n/)[0] || "";
  const delim = first.includes("\t") ? "\t" : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";
  const out: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((c) => c.trim()));
}
const autoMap = (h: string) => {
  const s = h.trim().toLowerCase();
  if (/mail|מייל|דוא/.test(s)) return "email";
  if (/phone|tel|mobile|טלפון|נייד|פלאפון/.test(s)) return "phone";
  if (/tag|תגי/.test(s)) return "tags";
  if (/^name$|full.?name|^שם$|שם מלא|שם הלקוח|שם פרטי/.test(s)) return "name";
  return h.trim() ? `field:${h.trim().slice(0, 40)}` : "ignore";
};
function ImportModal({ lists, onClose, run }: { lists: Row[]; onClose: () => void; run: Ctx["run"] }) {
  const [text, setText] = useState(""), [map, setMap] = useState<string[]>([]), [listId, setListId] = useState(""), [newList, setNewList] = useState("");
  const [tags, setTags] = useState(""), [consent, setConsent] = useState(false), [progress, setProgress] = useState(""), [busy, setBusy] = useState(false);
  const table = useMemo(() => parseTable(text), [text]);
  const headers = table[0] || [];
  useEffect(() => { setMap(headers.map(autoMap)); }, [headers.join("|")]);
  const go = async () => {
    setBusy(true);
    try {
      let lid = listId;
      if (newList) lid = (await api("/lists", "POST", { name: newList })).id;
      const data = table.slice(1).map((r) => {
        const o: Row = { email: "", name: "", phone: "", tags: "", fields: {} };
        map.forEach((k, i) => { const v = (r[i] || "").trim(); if (!v || k === "ignore") return; if (k.startsWith("field:")) o.fields[k.slice(6)] = v; else o[k] = v; });
        return o;
      });
      let imported = 0, skipped = 0;
      for (let i = 0; i < data.length; i += 300) {
        setProgress(`מייבא ${Math.min(i + 300, data.length)} / ${data.length}…`);
        const r = await api("/contacts/import", "POST", { rows: data.slice(i, i + 300), list_id: lid, tags, consent });
        imported += r.imported; skipped += r.skipped;
      }
      await run(async () => undefined, `יובאו ${imported} אנשי קשר${skipped ? ` · ${skipped} דולגו (מייל לא תקין)` : ""}`);
      onClose();
    } catch (e) { setProgress((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title="ייבוא אנשי קשר" onClose={onClose} wide>
      <p className="muted">העתק מאקסל (כולל שורת כותרות) והדבק כאן, או בחר קובץ CSV. אנשי קשר קיימים (לפי מייל) יתעדכנו ולא יוכפלו.</p>
      <div className="mk-inline">
        <label className="chip"><Upload size={13} /> קובץ CSV<input type="file" accept=".csv,.txt,.tsv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(setText); }} /></label>
      </div>
      <textarea className="mk-code mk-paste" dir="auto" value={text} onChange={(e) => setText(e.target.value)} placeholder={"שם\tמייל\tטלפון\nשרה כהן\tsara@example.com\t0501234567"} />
      {headers.length > 0 && (
        <>
          <h3 className="mk-h3">התאמת עמודות · {table.length - 1} שורות</h3>
          <div className="mk-map">
            {headers.map((h, i) => (
              <label key={i}>{h || `עמודה ${i + 1}`} <small className="muted">{table[1]?.[i]}</small>
                <select value={map[i] || "ignore"} onChange={(e) => setMap(map.map((x, j) => (j === i ? e.target.value : x)))}>
                  <option value="email">מייל</option><option value="name">שם</option><option value="phone">טלפון</option><option value="tags">תגיות</option>
                  <option value={`field:${h.trim()}`}>שדה נוסף: {h}</option><option value="ignore">להתעלם</option>
                </select>
              </label>
            ))}
          </div>
          <div className="form-grid">
            <label>להוסיף לרשימה קיימת<select value={listId} onChange={(e) => setListId(e.target.value)}><option value="">—</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <label>או ליצור רשימה חדשה<input value={newList} onChange={(e) => setNewList(e.target.value)} /></label>
            <label>תגיות לכולם (מופרדות בפסיק)<input value={tags} onChange={(e) => setTags(e.target.value)} /></label>
            <label className="mk-check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> לסמן שיש הסכמה לדיוור</label>
          </div>
        </>
      )}
      <footer className="form-footer"><span className="muted">{progress}</span><button className="primary" disabled={busy || table.length < 2} onClick={() => void go()}><Upload size={15} /> ייבוא</button></footer>
    </Modal>
  );
}
function ContactModal({ contact, onClose, run }: { contact: Row | null; onClose: () => void; run: Ctx["run"] }) {
  const [d, setD] = useState<Row>(() => ({ email: "", name: "", phone: "", tags: "", consent: false, status: "active", fields: {} }));
  const [hist, setHist] = useState<Row[]>([]);
  useEffect(() => {
    if (!contact) return;
    api(`/contacts/${contact.id}`).then((r) => {
      setD({ ...r.contact, tags: String(r.contact.tags).replace(/^,|,$/g, ""), consent: !!r.contact.consent, fields: JSON.parse(r.contact.fields || "{}") });
      setHist(r.history);
    }).catch(() => undefined);
  }, [contact]);
  const save = () => run(async () => {
    const body = { email: d.email, name: d.name, phone: d.phone, tags: d.tags, consent: d.consent, status: d.status, fields: d.fields };
    if (contact) await api(`/contacts/${contact.id}`, "PUT", body); else await api("/contacts", "POST", body);
    onClose();
  }, "נשמר");
  return (
    <Modal title={contact ? d.name || d.email : "איש קשר חדש"} onClose={onClose} wide>
      <div className="form-grid">
        <label>מייל<input dir="ltr" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} /></label>
        <label>שם<input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
        <label>טלפון<input dir="ltr" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} /></label>
        <label>תגיות<input value={d.tags} onChange={(e) => setD({ ...d, tags: e.target.value })} /></label>
        <label>סטטוס<select value={d.status} onChange={(e) => setD({ ...d, status: e.target.value })}>{Object.entries(CONTACT_STATUS).map(([k, v]) => <option key={k} value={k}>{v as string}</option>)}</select></label>
        <label className="mk-check"><input type="checkbox" checked={d.consent} onChange={(e) => setD({ ...d, consent: e.target.checked })} /> הסכמה לדיוור</label>
        {Object.entries(d.fields || {}).map(([k, v]) => <label key={k}>{k}<input value={v as string} onChange={(e) => setD({ ...d, fields: { ...d.fields, [k]: e.target.value } })} /></label>)}
      </div>
      {contact && (
        <p className="muted mk-gap">מקור: {d.source || "—"} · קמפיין: {d.campaign || "—"} · שלב: {d.stage || "—"} · קורס: {d.course || "—"} · {d.opens || 0} פתיחות · {d.clicks || 0} הקלקות · פתיחה אחרונה {fmt(d.last_open_at)}</p>
      )}
      {hist.length > 0 && (
        <div className="table-wrap"><table>
          <thead><tr><th>דיוור</th><th>נשלח</th><th>נפתח</th><th>הקליק</th></tr></thead>
          <tbody>{hist.map((h) => <tr key={h.campaign_id}><td>{h.campaign_name}</td><td>{fmt(h.sent_at)}</td><td>{fmt(h.opened_at)}</td><td>{fmt(h.clicked_at)}</td></tr>)}</tbody>
        </table></div>
      )}
      <footer className="form-footer"><span /><button className="primary" onClick={() => void save()}>שמירה</button></footer>
    </Modal>
  );
}
function Contacts({ lists, segments, run }: Ctx) {
  const [q, setQ] = useState(""), [list, setList] = useState(""), [segment, setSegment] = useState(""), [status, setStatus] = useState(""), [page, setPage] = useState(0);
  const [data, setData] = useState<Row>({ total: 0, contacts: [] }), [sel, setSel] = useState<string[]>([]), [modal, setModal] = useState<ReactNode>(null), [tick, setTick] = useState(0);
  const filter = useMemo(() => ({ q, list, segment, status }), [q, list, segment, status]);
  const qs = new URLSearchParams({ ...filter, page: String(page) }).toString();
  useEffect(() => { const t = setTimeout(() => api(`/contacts?${qs}`).then(setData).catch(() => undefined), 250); return () => clearTimeout(t); }, [qs, tick]);
  const refresh = () => { setSel([]); setTick((t) => t + 1); };
  const bulk = (action: string, value = "") => {
    const scope = sel.length ? { ids: sel } : { filter };
    if (!sel.length && !confirm(`לבצע על כל ${data.total} אנשי הקשר בתצוגה?`)) return;
    void run(async () => { await api("/contacts/bulk", "POST", { ...scope, action, value }); refresh(); }, "עודכן");
  };
  const askList = (action: string) => { const name = prompt("מספר/שם הרשימה:\n" + lists.map((l, i) => `${i + 1}. ${l.name}`).join("\n")); const l = lists[Number(name) - 1] || lists.find((x) => x.name === name); if (l) bulk(action, l.id); };
  return (
    <>
      <Heading title="אנשי קשר" sub={`${num(data.total)} בתצוגה · כל הלידים מהמכללות נכנסים אוטומטית`}
        action={<>
          <button className="secondary" onClick={() => void run(async () => { await api("/sync-leads", "POST", {}); refresh(); }, "סונכרן מה־CRM")}><RefreshCw size={15} /> סנכרון לידים</button>
          <a className="secondary" href={`${BASE}api/mk/contacts/export?${qs}`}><Download size={15} /> ייצוא</a>
          <button className="secondary" onClick={() => setModal(<ImportModal lists={lists} run={async (fn, ok) => { await run(fn, ok); refresh(); }} onClose={() => setModal(null)} />)}><Upload size={15} /> ייבוא</button>
          <button className="primary" onClick={() => setModal(<ContactModal contact={null} run={async (fn, ok) => { await run(fn, ok); refresh(); }} onClose={() => setModal(null)} />)}><Plus size={15} /> איש קשר</button>
        </>} />
      <div className="mk-filters">
        <div className="search"><Search size={16} /><input value={q} placeholder="חיפוש שם / מייל / טלפון" onChange={(e) => { setQ(e.target.value); setPage(0); }} /></div>
        <select value={list} onChange={(e) => { setList(e.target.value); setPage(0); }}><option value="">כל הרשימות</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        <select value={segment} onChange={(e) => { setSegment(e.target.value); setPage(0); }}><option value="">כל הסגמנטים</option>{segments.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}><option value="">כל הסטטוסים</option>{Object.entries(CONTACT_STATUS).map(([k, v]) => <option key={k} value={k}>{v as string}</option>)}</select>
      </div>
      <div className="filter-row mk-gap">
        <span className="muted">{sel.length ? `${sel.length} נבחרו:` : "פעולה על כל התצוגה:"}</span>
        <button className="chip" onClick={() => askList("add_list")}>הוספה לרשימה</button>
        <button className="chip" onClick={() => askList("remove_list")}>הסרה מרשימה</button>
        <button className="chip" onClick={() => { const t = prompt("תגית להוספה:"); if (t) bulk("tag", t); }}>הוספת תגית</button>
        <button className="chip" onClick={() => { const t = prompt("תגית להסרה:"); if (t) bulk("untag", t); }}>הסרת תגית</button>
        <button className="chip" onClick={() => bulk("consent")}>סימון הסכמה</button>
        <button className="chip" onClick={() => bulk("no_consent")}>ביטול הסכמה</button>
        <button className="chip" onClick={() => bulk("unsubscribe")}>הסרה מדיוור</button>
        <button className="chip" onClick={() => bulk("resubscribe")}>החזרה לדיוור</button>
        <button className="chip" onClick={() => confirm("למחוק לצמיתות?") && bulk("delete")}><Trash2 size={13} /> מחיקה</button>
      </div>
      <section className="panel">
        <div className="table-wrap"><table>
          <thead><tr>
            <th><input type="checkbox" checked={!!data.contacts.length && sel.length === data.contacts.length} onChange={(e) => setSel(e.target.checked ? data.contacts.map((c: Row) => c.id) : [])} /></th>
            <th>שם</th><th>מייל</th><th>טלפון</th><th>מכללה</th><th>מקור / קמפיין</th><th>שלב</th><th>תגיות</th><th>הסכמה</th><th>סטטוס</th><th>מעורבות</th><th>נוסף</th>
          </tr></thead>
          <tbody>{data.contacts.map((c: Row) => (
            <tr key={c.id} className="clickable" onClick={() => setModal(<ContactModal contact={c} run={async (fn, ok) => { await run(fn, ok); refresh(); }} onClose={() => setModal(null)} />)}>
              <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.includes(c.id)} onChange={(e) => setSel(e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id))} /></td>
              <td><b>{c.name}</b></td><td dir="ltr">{c.email}</td><td dir="ltr">{c.phone}</td>
              <td>{c.workspace_id === "women" ? "נשים" : c.workspace_id === "men" ? "גברים" : "—"}</td>
              <td className="mk-ellipsis">{[c.source, c.campaign].filter(Boolean).join(" · ") || "—"}</td>
              <td>{c.stage || "—"}</td>
              <td>{String(c.tags).split(",").filter(Boolean).map((t: string) => <Badge key={t}>{t}</Badge>)}</td>
              <td>{c.consent ? <Badge color="green">יש</Badge> : <Badge>אין</Badge>}</td>
              <td><Badge color={c.status === "active" ? "green" : "orange"}>{CONTACT_STATUS[c.status] || c.status}</Badge></td>
              <td>{c.opens} פתיחות · {c.clicks} הקלקות</td>
              <td>{fmt(c.created_at)}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <Pager page={page} total={data.total} setPage={setPage} />
      </section>
      {modal}
    </>
  );
}

// ---------- lists ----------
function Lists({ lists, run, go }: Ctx & { go: (v: string) => void }) {
  return (
    <>
      <Heading title="רשימות תפוצה" sub="רשימות קבועות; איש קשר יכול להיות בכמה רשימות"
        action={<button className="primary" onClick={() => { const name = prompt("שם הרשימה:"); if (name) void run(() => api("/lists", "POST", { name }), "נוצרה רשימה"); }}><Plus size={15} /> רשימה חדשה</button>} />
      <section className="panel"><div className="table-wrap"><table>
        <thead><tr><th>שם</th><th>תיאור</th><th>חברים</th><th>פעילים לשליחה</th><th>נוצרה</th><th /></tr></thead>
        <tbody>{lists.map((l) => (
          <tr key={l.id}>
            <td><b>{l.name}</b></td><td>{l.description}</td><td>{num(l.members)}</td><td>{num(l.active)}</td><td>{fmt(l.created_at)}</td>
            <td className="button-group">
              <button className="text-button" onClick={() => go("contacts")}>אנשי קשר</button>
              <button className="text-button" onClick={() => { const name = prompt("שם:", l.name); if (name) void run(() => api(`/lists/${l.id}`, "PUT", { name, description: prompt("תיאור:", l.description) || "" }), "עודכן"); }}>עריכה</button>
              <button className="text-button" onClick={() => confirm(`למחוק את "${l.name}"? אנשי הקשר עצמם יישארו.`) && void run(() => api(`/lists/${l.id}`, "DELETE"), "נמחק")}>מחיקה</button>
            </td>
          </tr>
        ))}</tbody>
      </table></div>{!lists.length && <p className="muted pad">אין עדיין רשימות. צור רשימה או ייבא אנשי קשר לרשימה חדשה.</p>}</section>
    </>
  );
}

// ---------- segments ----------
const FIELDS: { k: string; l: string; t: string }[] = [
  { k: "workspace_id", l: "מכללה (women/men)", t: "text" }, { k: "source", l: "מקור ליד", t: "text" }, { k: "campaign", l: "קמפיין CRM", t: "text" },
  { k: "stage", l: "שלב מכירה (new/first_call/in_progress/won/irrelevant)", t: "text" }, { k: "course", l: "קורס", t: "text" },
  { k: "name", l: "שם", t: "text" }, { k: "email", l: "מייל", t: "text" }, { k: "phone", l: "טלפון", t: "text" },
  { k: "tag", l: "תגית", t: "tag" }, { k: "consent", l: "הסכמה לדיוור", t: "bool" }, { k: "status", l: "סטטוס (active/unsubscribed/bounced)", t: "text" },
  { k: "list", l: "חבר ברשימה", t: "list" }, { k: "opens", l: "סה״כ פתיחות", t: "num" }, { k: "clicks", l: "סה״כ הקלקות", t: "num" },
  { k: "last_open", l: "פתח בימים האחרונים", t: "days" }, { k: "last_click", l: "הקליק בימים האחרונים", t: "days" },
  { k: "opened_campaign", l: "פתח דיוור מסוים", t: "campaign" }, { k: "clicked_campaign", l: "הקליק בדיוור מסוים", t: "campaign" },
  { k: "received_campaign", l: "קיבל דיוור מסוים", t: "campaign" }, { k: "created_at", l: "נוסף בתאריך", t: "date" },
];
const OPS: Row = {
  text: [["eq", "שווה ל"], ["neq", "שונה מ"], ["contains", "מכיל"], ["not_contains", "לא מכיל"], ["empty", "ריק"], ["not_empty", "לא ריק"]],
  tag: [["has", "יש"], ["not_has", "אין"]], bool: [["yes", "כן"], ["no", "לא"]], list: [["in", "כן"], ["not_in", "לא"]],
  num: [["gte", "לפחות"], ["lte", "לכל היותר"]], days: [["within", "כן, בתוך X ימים"], ["not_within", "לא, בתוך X ימים"]],
  campaign: [["yes", "כן"], ["no", "לא"]], date: [["after", "אחרי"], ["before", "לפני"]],
};
function SegmentModal({ seg, lists, campaigns, onClose, run }: { seg: Row | null; lists: Row[]; campaigns: Row[]; onClose: () => void; run: Ctx["run"] }) {
  const init = seg ? JSON.parse(seg.rules || "{}") : { match: "all", conditions: [] };
  const [name, setName] = useState(seg?.name || ""), [match, setMatch] = useState(init.match || "all"), [conds, setConds] = useState<Row[]>(init.conditions || []);
  const [count, setCount] = useState<Row | null>(null);
  const key = JSON.stringify({ match, conditions: conds });
  useEffect(() => { const t = setTimeout(() => api("/segments/preview", "POST", JSON.parse(key)).then(setCount).catch(() => setCount(null)), 300); return () => clearTimeout(t); }, [key]);
  const upd = (i: number, k: string, v: string) => setConds(conds.map((c, j) => (j === i ? { ...c, [k]: v, ...(k === "field" ? { op: OPS[FIELDS.find((f) => f.k === v)?.t || "text"][0][0], value: "" } : {}) } : c)));
  return (
    <Modal title={seg ? "עריכת סגמנט" : "סגמנט חדש"} onClose={onClose} wide>
      <div className="form-grid">
        <label>שם<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>התאמה<select value={match} onChange={(e) => setMatch(e.target.value)}><option value="all">כל התנאים (וגם)</option><option value="any">אחד התנאים (או)</option></select></label>
      </div>
      {conds.map((c, i) => {
        const f = FIELDS.find((x) => x.k === c.field) || (c.field?.startsWith("field:") ? { k: c.field, l: c.field.slice(6), t: "text" } : FIELDS[0]);
        return (
          <div key={i} className="mk-cond">
            <select value={c.field} onChange={(e) => upd(i, "field", e.target.value)}>
              {FIELDS.map((x) => <option key={x.k} value={x.k}>{x.l}</option>)}
              {c.field?.startsWith("field:") && <option value={c.field}>{f.l}</option>}
            </select>
            <select value={c.op} onChange={(e) => upd(i, "op", e.target.value)}>{OPS[f.t].map(([k, l]: string[]) => <option key={k} value={k}>{l}</option>)}</select>
            {f.t === "list" ? <select value={c.value} onChange={(e) => upd(i, "value", e.target.value)}><option value="">בחר רשימה</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
              : f.t === "campaign" ? <select value={c.value} onChange={(e) => upd(i, "value", e.target.value)}><option value="">בחר דיוור</option>{campaigns.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
              : f.t === "bool" || ["empty", "not_empty"].includes(c.op) ? <span />
              : <input type={f.t === "num" || f.t === "days" ? "number" : f.t === "date" ? "date" : "text"} value={c.value} onChange={(e) => upd(i, "value", e.target.value)} />}
            <button className="icon" onClick={() => setConds(conds.filter((_, j) => j !== i))}><X size={15} /></button>
          </div>
        );
      })}
      <div className="mk-inline">
        <button className="secondary" onClick={() => setConds([...conds, { field: "source", op: "eq", value: "" }])}><Plus size={14} /> תנאי</button>
        <button className="secondary" onClick={() => { const k = prompt("שם השדה הנוסף (כפי שיובא):"); if (k) setConds([...conds, { field: `field:${k}`, op: "eq", value: "" }]); }}><Plus size={14} /> תנאי על שדה מיובא</button>
      </div>
      <p className="mk-audience">{count ? <><b>{num(count.total)}</b> אנשי קשר תואמים · {num(count.sendable)} פעילים לשליחת מייל</> : "…"}</p>
      <footer className="form-footer"><span className="muted">הסגמנט מתעדכן אוטומטית — כל איש קשר חדש שעומד בתנאים ייכלל.</span>
        <button className="primary" disabled={!name} onClick={() => void run(async () => { const body = { name, rules: { match, conditions: conds } }; if (seg) await api(`/segments/${seg.id}`, "PUT", body); else await api("/segments", "POST", body); onClose(); }, "נשמר")}>שמירה</button>
      </footer>
    </Modal>
  );
}
function Segments({ segments, lists, campaigns, run }: Ctx) {
  const [modal, setModal] = useState<ReactNode>(null);
  const open = (seg: Row | null) => setModal(<SegmentModal seg={seg} lists={lists} campaigns={campaigns} run={run} onClose={() => setModal(null)} />);
  return (
    <>
      <Heading title="סגמנטים דינמיים" sub="קהלים לפי תנאים — מקור, קמפיין, שלב, תגיות, פתיחות והקלקות" action={<button className="primary" onClick={() => open(null)}><Plus size={15} /> סגמנט חדש</button>} />
      <section className="panel"><div className="table-wrap"><table>
        <thead><tr><th>שם</th><th>תנאים</th><th>נוצר</th><th /></tr></thead>
        <tbody>{segments.map((s) => { const r = JSON.parse(s.rules || "{}"); return (
          <tr key={s.id} className="clickable" onClick={() => open(s)}>
            <td><b>{s.name}</b></td>
            <td>{(r.conditions || []).map((c: Row) => `${FIELDS.find((f) => f.k === c.field)?.l || c.field} ${c.value || ""}`).join(r.match === "any" ? " או " : " וגם ") || "—"}</td>
            <td>{fmt(s.created_at)}</td>
            <td><button className="text-button" onClick={(e) => { e.stopPropagation(); if (confirm("למחוק?")) void run(() => api(`/segments/${s.id}`, "DELETE"), "נמחק"); }}>מחיקה</button></td>
          </tr>
        ); })}</tbody>
      </table></div>{!segments.length && <p className="muted pad">דוגמאות: "לידים חמים שלא פתחו בחודש האחרון", "הקליקו בדיוור הקודם ולא נרשמו".</p>}</section>
      {modal}
    </>
  );
}

// ---------- analytics ----------
function Analytics({ campaigns, openCampaign }: Ctx) {
  const [days, setDays] = useState(180), [a, setA] = useState<Row | null>(null), [cmp, setCmp] = useState<string[]>([]);
  useEffect(() => { api(`/analytics?days=${days}`).then(setA).catch(() => undefined); }, [days]);
  const sent = campaigns.filter((c) => Number(c.stats?.sent) > 0);
  const heat = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const h of a?.hours || []) if (h.event === "opened") { const d = new Date(h.h + ":00:00Z"); g[d.getDay()][d.getHours()] += h.n; }
    return g;
  }, [a]);
  const heatMax = Math.max(1, ...heat.flat());
  const peak = peakHours(a?.hours || []);
  const byHour = useMemo(() => {
    const m: Row = {};
    for (const c of sent) { const h = new Date(c.started_at || c.created_at).getHours(); const s = statsOf(c.stats); m[h] = m[h] || { d: 0, o: 0, n: 0 }; m[h].d += s.delivered; m[h].o += s.opened; m[h].n++; }
    const rows = Object.entries(m).map(([h, v]: [string, any]) => ({ label: `${h}:00`, value: pct(v.o, v.d), sub: `${v.n} דיוורים` }));
    const best = Math.max(0, ...rows.map((r) => r.value));
    return rows.sort((x, y) => parseInt(x.label) - parseInt(y.label)).map((r) => ({ ...r, best: r.value === best }));
  }, [sent]);
  const byDay = useMemo(() => {
    const m: Row = {};
    for (const c of sent) { const d = new Date(c.started_at || c.created_at).getDay(); const s = statsOf(c.stats); m[d] = m[d] || { d: 0, o: 0, n: 0 }; m[d].d += s.delivered; m[d].o += s.opened; m[d].n++; }
    return Object.entries(m).sort().map(([d, v]: [string, any]) => ({ label: `יום ${DAYS[Number(d)]}`, value: pct(v.o, v.d), sub: `${v.n} דיוורים` }));
  }, [sent]);
  const subjects = useMemo(() => {
    const out: { label: string; value: number; sub: string }[] = [];
    for (const c of sent) {
      const s = statsOf(c.stats);
      out.push({ label: c.subject, value: s.openRate, sub: `הקלקה ${s.ctr}% · ${c.name}` });
    }
    return out.sort((x, y) => y.value - x.value).slice(0, 12);
  }, [sent]);
  const trend = [...sent].sort((x, y) => String(x.started_at).localeCompare(String(y.started_at))).map((c) => ({ label: `${new Date(c.started_at || c.created_at).toLocaleDateString("he-IL")} · ${c.name}`, value: statsOf(c.stats).openRate, sub: `הקלקה ${statsOf(c.stats).ctr}%` }));
  const chosen = sent.filter((c) => cmp.includes(c.id));
  const metrics: [string, (s: ReturnType<typeof statsOf>) => number, string][] = [
    ["נשלחו", (s) => s.sent, ""], ["אחוז פתיחה", (s) => s.openRate, "%"], ["אחוז הקלקה", (s) => s.ctr, "%"], ["הקלקה מתוך פותחים", (s) => s.ctor, "%"],
    ["הסרות", (s) => pct(s.unsubscribed, s.delivered), "%"], ["חזרות", (s) => pct(s.bounced, s.sent), "%"],
  ];
  return (
    <>
      <Heading title="אנליטיקס והשוואות" sub="זמני שיא, ניסוחים מנצחים, מגמות והשוואה בין דיוורים"
        action={<select value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={30}>30 יום</option><option value={90}>90 יום</option><option value={180}>חצי שנה</option><option value={365}>שנה</option><option value={730}>שנתיים</option></select>} />
      <div className="stats-grid">
        <Kpi label="שעת שיא לפתיחה" value={peak.hour >= 0 ? `${peak.hour}:00` : "—"} sub="לפי זמן הפתיחה בפועל" icon={<Eye />} />
        <Kpi label="יום שיא" value={peak.day >= 0 ? DAYS[peak.day] : "—"} sub="היום עם הכי הרבה פתיחות" icon={<BarChart3 />} />
        <Kpi label="נושא מנצח" value={subjects[0] ? `${subjects[0].value}%` : "—"} sub={subjects[0]?.label || "יתעדכן אחרי דיוורים"} icon={<Mail />} />
        <Kpi label="אנשי קשר מעורבים" value={num(a?.contacts?.engaged)} sub={`פתחו ב־90 יום · ${num(a?.contacts?.unsubscribed)} הוסרו`} icon={<Users />} />
      </div>
      <section className="panel mk-gap">
        <header className="panel-header"><div><h2>מפת חום — מתי פותחים</h2><p>יום בשבוע × שעה (שעון ישראל)</p></div></header>
        <div className="mk-heat pad">
          <span />{Array.from({ length: 24 }, (_, h) => <small key={h}>{h}</small>)}
          {heat.map((row, d) => [<small key={"d" + d}>{DAYS[d]}</small>, ...row.map((n, h) => <i key={d + "-" + h} title={`${DAYS[d]} ${h}:00 — ${n} פתיחות`} style={{ opacity: n ? 0.15 + (n / heatMax) * 0.85 : 0.05 }} />)])}
        </div>
      </section>
      <div className="dashboard-grid">
        <section className="panel"><header className="panel-header"><div><h2>אחוז פתיחה לפי שעת שליחה</h2><p>מתי כדאי לשגר</p></div></header><Bars data={byHour} unit="%" /></section>
        <section className="panel"><header className="panel-header"><div><h2>אחוז פתיחה לפי יום שליחה</h2></div></header><Bars data={byDay} unit="%" /></section>
      </div>
      <div className="dashboard-grid">
        <section className="panel"><header className="panel-header"><div><h2>ניסוחי שיא — נושאים מובילים</h2><p>לפי אחוז פתיחה</p></div></header><Bars data={subjects} unit="%" max={100} /></section>
        <section className="panel"><header className="panel-header"><div><h2>מגמה לאורך זמן</h2><p>אחוז פתיחה בכל דיוור</p></div></header><Bars data={trend} unit="%" max={100} /></section>
      </div>
      <section className="panel mk-gap">
        <header className="panel-header"><div><h2>השוואת דיוורים</h2><p>סמן 2 דיוורים או יותר</p></div></header>
        {chosen.length >= 2 && (
          <div className="table-wrap"><table>
            <thead><tr><th>מדד</th>{chosen.map((c) => <th key={c.id}>{c.name}</th>)}</tr></thead>
            <tbody>{metrics.map(([label, f, u]) => {
              const vals = chosen.map((c) => f(statsOf(c.stats)));
              const best = label === "הסרות" || label === "חזרות" ? Math.min(...vals) : Math.max(...vals);
              return <tr key={label}><td><b>{label}</b></td>{vals.map((v, i) => <td key={i} className={v === best ? "mk-best" : ""}>{v}{u}</td>)}</tr>;
            })}
              <tr><td><b>נושא</b></td>{chosen.map((c) => <td key={c.id} className="mk-ellipsis">{c.subject}</td>)}</tr>
              <tr><td><b>מועד</b></td>{chosen.map((c) => <td key={c.id}>{fmt(c.started_at)}</td>)}</tr>
            </tbody>
          </table></div>
        )}
        <CampaignTable campaigns={sent} openCampaign={openCampaign} select={{ ids: cmp, set: setCmp }} />
      </section>
      <section className="panel mk-gap">
        <header className="panel-header"><div><h2>גידול אנשי קשר</h2><p>חדשים לפי חודש</p></div></header>
        <Bars data={[...(a?.growth || [])].reverse().map((g: Row) => ({ label: g.month, value: g.n }))} />
      </section>
    </>
  );
}
