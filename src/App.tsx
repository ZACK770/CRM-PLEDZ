import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  LayoutDashboard,
  Users,
  CheckSquare,
  GraduationCap,
  BookOpen,
  Megaphone,
  BarChart3,
  Mail,
  Settings,
  Search,
  Plus,
  ChevronDown,
  ArrowUpLeft,
  ArrowLeft,
  Flame,
  MoreHorizontal,
  X,
  Check,
  CalendarDays,
  LogOut,
  Link2,
  Building2,
  PanelTop,
  Target,
  Clock,
  Send,
  ShieldCheck,
  Layers,
  ChevronLeft,
  Bell,
  Copy,
  KeyRound,
} from "lucide-react";
type Row = Record<string, any>;
type Field = {
  key: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  value?: any;
  placeholder?: string;
};
const stages = [
  { id: "new", name: "ליד חדש", color: "#6988aa" },
  { id: "first_call", name: "טלפון ראשון", color: "#b28b45" },
  { id: "in_progress", name: "בתהליך", color: "#8a71b5" },
  { id: "won", name: "נסגר בהצלחה", color: "#348b75" },
  { id: "irrelevant", name: "לא רלוונטי", color: "#92949c" },
];
const roleNames: Row = {
  owner: "בעלים",
  manager: "מנהל/ת מכללה",
  sales: "מכירות",
  class_manager: "ניהול כיתות",
  teacher: "הוראה",
};
const money = (n: number) =>
  new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(n);
const date = (v: string) =>
  v
    ? new Date(v).toLocaleDateString("he-IL", {
        day: "numeric",
        month: "short",
      })
    : "—";
const datetime = (v: string) =>
  v
    ? new Date(v).toLocaleString("he-IL", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const parse = (v: any, fallback: any = {}) => {
  try {
    return typeof v === "string" ? JSON.parse(v) : v || fallback;
  } catch {
    return fallback;
  }
};
async function request(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<Row> {
  const res = await fetch("/api" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = (await res.json()) as Row;
  if (!res.ok) throw new Error(d.error || "הפעולה לא הושלמה");
  return d;
}
function Empty({
  title = "עדיין אין כאן רשומות",
  description = "כל המידע יופיע כאן, ברגע שתתחילו לעבוד.",
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Layers size={28} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function Badge({
  children,
  color = "gray",
}: {
  children: ReactNode;
  color?: string;
}) {
  return <span className={"badge " + color}>{children}</span>;
}
function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span className={"avatar " + (small ? "small" : "")}>
      {name
        ?.trim()
        .split(" ")
        .map((s) => s[0])
        .slice(0, 2)
        .join("") || "?"}
    </span>
  );
}
function Modal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon" onClick={onClose} aria-label="סגירה">
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Form({
  fields,
  initial = {},
  submit = "שמירה",
  onSubmit,
}: {
  fields: Field[];
  initial?: Row;
  submit?: string;
  onSubmit: (v: Row) => Promise<void>;
}) {
  const [v, setV] = useState<Row>(() =>
    Object.fromEntries(
      fields.map((f) => [f.key, initial[f.key] ?? f.value ?? ""]),
    ),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(v);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save}>
      <div className="form-grid">
        {fields.map((f) => (
          <label key={f.key} className={f.type === "textarea" ? "wide" : ""}>
            {f.label}
            {f.required && <em> *</em>}
            {f.options ? (
              <select
                required={f.required}
                value={v[f.key]}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
              >
                <option value="">בחירה…</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                required={f.required}
                value={v[f.key]}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
              />
            ) : (
              <input
                autoComplete={f.type === "password" ? "new-password" : "off"}
                required={f.required}
                type={f.type || "text"}
                min={f.type === "number" ? 0 : undefined}
                maxLength={f.type === "password" ? 256 : undefined}
                minLength={f.type === "password" ? 12 : undefined}
                value={v[f.key]}
                placeholder={f.placeholder}
                onChange={(e) =>
                  setV({
                    ...v,
                    [f.key]:
                      f.type === "number"
                        ? e.target.value === ""
                          ? ""
                          : Number(e.target.value)
                        : e.target.value,
                  })
                }
              />
            )}
          </label>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer className="form-footer">
        <span className="muted">הנתונים נשמרים במכללה הנוכחית בלבד</span>
        <button className="primary" disabled={busy}>
          {busy ? "שומר…" : submit}
          <Check size={16} />
        </button>
      </footer>
    </form>
  );
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [setup, setSetup] = useState(false),
    [ready, setReady] = useState(false);
  useEffect(() => {
    request("/auth/status")
      .then((d) => setSetup(d.setup))
      .finally(() => setReady(true));
  }, []);
  return (
    <div className="login-page">
      <div className="login-brand">
        <div className="brandmark">
          <Layers />
        </div>
        <strong>
          מרחב<span>הכול מתחבר. העסק מתקדם.</span>
        </strong>
      </div>
      <section className="login-card">
        <Badge color="green">
          <ShieldCheck size={13} /> סביבת עבודה מאובטחת
        </Badge>
        <h1>{setup ? "מתחילים מרחב חדש." : "טוב שחזרת."}</h1>
        <p>המכירות, הצוות והלמידה — במקום אחד.</p>
        {ready ? (
          <Form
            key={String(setup)}
            submit={setup ? "הקמת המערכת" : "כניסה למרחב"}
            fields={[
              ...(setup
                ? [
                    { key: "name", label: "שם מלא", required: true },
                    {
                      key: "token",
                      label: "קוד הקמה מאובטח",
                      type: "password",
                      required: true,
                    },
                  ]
                : []),
              {
                key: "email",
                label: "כתובת מייל",
                type: "email",
                required: true,
              },
              {
                key: "password",
                label: "סיסמה · לפחות 12 תווים",
                type: "password",
                required: true,
              },
            ]}
            onSubmit={async (v) => {
              if (setup) {
                await request("/auth/setup", "POST", v);
                setSetup(false);
              } else {
                await request("/auth/login", "POST", v);
                onLogin();
              }
            }}
          />
        ) : (
          <p>טוען…</p>
        )}
        <p className="login-note">
          מכללת נשים ומכללת גברים · מידע נפרד, תמונה שלמה
        </p>
      </section>
      <span className="login-bottom">
        מרחב / ניהול מכללות שמפנה מקום לצמיחה
      </span>
    </div>
  );
}
const nav = [
  { id: "dashboard", label: "מבט על", icon: LayoutDashboard },
  { id: "leads", label: "לידים ומכירות", icon: Users },
  { id: "tasks", label: "משימות הצוות", icon: CheckSquare },
  { id: "courses", label: "קורסים וכיתות", icon: BookOpen },
  { id: "students", label: "תלמידים ולמידה", icon: GraduationCap },
  { id: "campaigns", label: "קמפיינים", icon: Megaphone },
  { id: "reports", label: "תקציב ורווחיות", icon: BarChart3 },
  { id: "messages", label: "מרכז הודעות", icon: Mail },
  { id: "entities", label: "ישויות וקשרים", icon: Layers },
  { id: "team", label: "אנשי צוות", icon: Users },
  { id: "settings", label: "הגדרות מרחב", icon: Settings },
];
export function App() {
  const [me, setMe] = useState<Row | null>(null),
    [authReady, setAuthReady] = useState(false),
    [ws, setWs] = useState(""),
    [state, setState] = useState<Row | null>(null),
    [tab, setTab] = useState("dashboard"),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [modal, setModal] = useState<ReactNode>(null),
    [selected, setSelected] = useState<string | null>(null),
    [mobileNav, setMobileNav] = useState(false);
  const loadMe = useCallback(async () => {
    try {
      const m = await request("/me");
      setMe(m);
      setWs((old) => old || m.workspaces[0]?.id);
    } catch {
      setMe(null);
    } finally {
      setAuthReady(true);
    }
  }, []);
  const loadVersion = useRef(0);
  const remindedTasks = useRef(new Set<string>());
  const load = useCallback(async () => {
    if (!ws) return;
    const version = ++loadVersion.current;
    try {
      const s = await request(`/w/${ws}/state`);
      if (version !== loadVersion.current) return;
      setState(s);
      setError("");
    } catch (e) {
      if (version !== loadVersion.current) return;
      setError((e as Error).message);
    }
  }, [ws]);
  useEffect(() => {
    void loadMe();
  }, [loadMe]);
  useEffect(() => {
    setState(null);
    setSelected(null);
    setModal(null);
    setSearch("");
    void load();
    return () => {
      loadVersion.current++;
    };
  }, [load]);
  useEffect(() => {
    if (!ws) return;
    const i = setInterval(() => void load(), 60000);
    return () => clearInterval(i);
  }, [load, ws]);
  useEffect(() => {
    if (!toast) return;
    const i = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(i);
  }, [toast]);
  useEffect(() => {
    const due =
      state?.tasks.filter(
        (t: Row) =>
          !t.done &&
          t.assignee_id === me?.user.id &&
          new Date(t.due_at) <= new Date() &&
          !remindedTasks.current.has(`${ws}:${t.id}`),
      ) || [];
    if (due.length) {
      for (const t of due) remindedTasks.current.add(`${ws}:${t.id}`);
      setToast(
        `תזכורת למשימה: ${due[0].title}${due.length > 1 ? ` ועוד ${due.length - 1}` : ""}`,
      );
    }
  }, [state, me, ws]);
  const act = async (path: string, body: unknown, method = "POST") => {
    await request(`/w/${ws}${path}`, method, body);
    await load();
  };
  const perform = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setToast("עודכן בהצלחה");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!authReady) return <div className="loading">טוען את המרחב…</div>;
  if (!me) return <Login onLogin={() => void loadMe()} />;
  const s = state,
    manager = s && ["owner", "manager"].includes(s.member.role),
    sales = s?.member.role === "sales",
    academic = s && ["teacher", "class_manager"].includes(s.member.role);
  const name = (list: string, rid: string) =>
    s?.[list]?.find((r: Row) => r.id === rid || r.user_id === rid)?.name || "—";
  const opts = (list: string) =>
    s?.[list]
      ?.filter((r: Row) => r.active !== 0)
      .map((r: Row) => ({ value: r.id || r.user_id, label: r.name })) || [];
  const customFields = (type: string): Field[] =>
    (s?.fields || [])
      .filter((f: Row) => f.entity_type === type)
      .map((f: Row) => ({
        key: f.id,
        label: f.label,
        type: f.type,
        required: !!f.required,
        options:
          f.type === "select"
            ? parse(f.options, []).map((x: string) => ({ value: x, label: x }))
            : undefined,
      }));
  const customData = (type: string, v: Row) =>
    Object.fromEntries(
      customFields(type).map((f) => [
        f.key,
        v[f.key] === "" ? null : (v[f.key] ?? null),
      ]),
    );
  function showForm(
    title: string,
    fields: Field[],
    save: (v: Row) => Promise<void>,
    initial: Row = {},
  ) {
    setModal(
      <Modal title={title} onClose={() => setModal(null)}>
        <Form
          fields={fields}
          initial={initial}
          onSubmit={async (v) => {
            await save(v);
            setModal(null);
            setToast("נשמר בהצלחה");
          }}
        />
      </Modal>,
    );
  }
  function leadForm(lead?: Row) {
    const f: Field[] = [
      { key: "name", label: "שם מלא", required: true },
      { key: "phone", label: "טלפון", type: "tel" },
      { key: "email", label: "מייל", type: "email" },
      {
        key: "source_id",
        label: "מקור הליד",
        options: opts("sources"),
        required: true,
      },
      { key: "campaign_id", label: "קמפיין", options: opts("campaigns") },
      { key: "assignee_id", label: "אחראי מכירות", options: opts("members") },
      { key: "course_id", label: "קורס מבוקש", options: opts("courses") },
      {
        key: "class_id",
        label: "כיתה מבוקשת",
        options: (s?.classes || []).map((cl: Row) => ({
          value: cl.id,
          label: `${cl.name} · ${name("courses", cl.course_id)}`,
        })),
      },
      ...(lead
        ? [
            {
              key: "stage",
              label: "שלב במכירה",
              options: stages.map((x) => ({ value: x.id, label: x.name })),
              required: true,
            },
          ]
        : []),
      { key: "notes", label: "פרטים מהשיחה / הערות", type: "textarea" },
      ...customFields("lead"),
    ];
    if (!manager)
      f.splice(
        f.findIndex((x) => x.key === "assignee_id"),
        1,
      );
    showForm(
      lead ? "עריכת כרטיס ליד" : "ליד חדש",
      f,
      async (v) => {
        await act(
          "/leads" + (lead ? "/" + lead.id : ""),
          {
            ...v,
            email: v.email || "",
            assignee_id: manager ? v.assignee_id || null : me!.user.id,
            source_id: v.source_id || null,
            campaign_id: v.campaign_id || null,
            course_id: v.course_id || null,
            class_id: v.class_id || null,
            stage: v.stage || "new",
            heat: lead?.heat || "warm",
            data: customData("lead", v),
          },
          lead ? "PUT" : "POST",
        );
      },
      lead ? { ...lead, ...parse(lead.data) } : {},
    );
  }
  function taskForm(leadId?: string) {
    showForm(
      "משימה ותזכורת חדשה",
      [
        { key: "title", label: "מה צריך לעשות?", required: true },
        {
          key: "assignee_id",
          label: "אחראי",
          options: manager
            ? opts("members")
            : [{ value: me!.user.id, label: me!.user.name }],
          required: true,
          value: me!.user.id,
        },
        {
          key: "due_at",
          label: "מועד התזכורת",
          type: "datetime-local",
          required: true,
        },
        {
          key: "lead_id",
          label: "קישור לליד",
          options: opts("leads"),
          value: leadId || "",
        },
      ],
      async (v) =>
        act("/tasks", {
          ...v,
          lead_id: v.lead_id || null,
          due_at: new Date(v.due_at).toISOString(),
        }),
    );
  }
  function resourceForm(type: string, record?: Row) {
    const fields: Record<string, Field[]> = {
      courses: [
        { key: "name", label: "שם הקורס", required: true },
        { key: "price", label: "מחיר מתוכנן לתלמיד", type: "number", value: 0 },
        { key: "description", label: "תיאור", type: "textarea" },
        ...customFields("course"),
      ],
      classes: [
        { key: "name", label: "שם הכיתה / המחזור", required: true },
        {
          key: "course_id",
          label: "קורס",
          options: opts("courses"),
          required: true,
        },
        { key: "teacher_id", label: "מורה", options: opts("members") },
        { key: "manager_id", label: "מנהל/ת כיתה", options: opts("members") },
        {
          key: "capacity",
          label: "מספר מקומות",
          type: "number",
          value: 30,
          required: true,
        },
        { key: "starts_at", label: "תאריך פתיחה", type: "date" },
        ...customFields("class"),
      ],
      campaigns: [
        { key: "name", label: "שם הקמפיין", required: true },
        { key: "budget", label: "תקציב מתוכנן", type: "number", value: 0 },
        ...customFields("campaign"),
      ],
      sources: [
        { key: "name", label: "שם המקור", required: true },
        {
          key: "heat",
          label: "חום התחלתי",
          required: true,
          options: [
            { value: "hot", label: "חם · עניין ישיר במוצר" },
            { value: "warm", label: "פושר · עניין ראשוני" },
            { value: "cold", label: "קר · טרם הביע עניין" },
          ],
        },
      ],
      assignment_rules: [
        {
          key: "source_id",
          label: "מקור (ריק = כולם)",
          options: opts("sources"),
        },
        {
          key: "course_id",
          label: "קורס (ריק = כולם)",
          options: opts("courses"),
        },
        {
          key: "assignee_id",
          label: "הקצאה לאיש מכירות",
          required: true,
          options: opts("members"),
        },
        {
          key: "priority",
          label: "עדיפות · מספר נמוך קודם",
          type: "number",
          value: 10,
        },
      ],
      entity_types: [
        { key: "name", label: "שם הישות, לדוגמה: שותפים", required: true },
      ],
      fields: [
        {
          key: "entity_type",
          label: "לאיזו ישות?",
          required: true,
          options: [
            { value: "lead", label: "ליד" },
            { value: "course", label: "קורס" },
            { value: "class", label: "כיתה" },
            { value: "campaign", label: "קמפיין" },
            ...opts("entity_types"),
          ],
        },
        { key: "label", label: "שם השדה", required: true },
        {
          key: "type",
          label: "סוג השדה",
          required: true,
          options: [
            { value: "text", label: "טקסט" },
            { value: "number", label: "מספר" },
            { value: "date", label: "תאריך" },
            { value: "select", label: "רשימת בחירה" },
          ],
        },
        { key: "options", label: "אפשרויות לבחירה · מופרדות בפסיקים" },
        {
          key: "required",
          label: "שדה חובה?",
          value: "0",
          options: [
            { value: "0", label: "לא" },
            { value: "1", label: "כן" },
          ],
        },
      ],
    };
    const titles: Row = {
      courses: "קורס חדש",
      classes: "כיתה חדשה",
      campaigns: "קמפיין חדש",
      sources: "מקור ליד חדש",
      assignment_rules: "כלל הקצאה חדש",
      entity_types: "ישות חדשה",
      fields: "שדה מותאם חדש",
    };
    showForm(
      record ? "עריכת " + record.name : titles[type],
      fields[type],
      async (v) => {
        const body = { ...v };
        for (const k of [
          "source_id",
          "course_id",
          "assignee_id",
          "teacher_id",
          "manager_id",
        ])
          if (k in body) body[k] = body[k] || null;
        if (type === "fields") {
          body.options = (v.options || "")
            .split(",")
            .map((x: string) => x.trim())
            .filter(Boolean);
          body.required = Number(v.required);
        }
        if (["courses", "classes", "campaigns"].includes(type)) {
          body.data = customData(
            type === "classes"
              ? "class"
              : type === "courses"
                ? "course"
                : "campaign",
            v,
          );
          for (const f of customFields(
            type === "classes"
              ? "class"
              : type === "courses"
                ? "course"
                : "campaign",
          ))
            delete body[f.key];
        }
        await act(
          "/resources/" + type + (record ? "/" + record.id : ""),
          body,
          record ? "PUT" : "POST",
        );
      },
      record ? { ...record, ...parse(record.data) } : {},
    );
  }
  function messageForm(leadId?: string) {
    showForm(
      "כתיבת הודעה",
      [
        {
          key: "lead_id",
          label: "נמען · ליד",
          options: opts("leads"),
          required: true,
          value: leadId || "",
        },
        { key: "subject", label: "נושא", required: true },
        {
          key: "kind",
          label: "סוג הודעה",
          required: true,
          value: "service",
          options: [
            { value: "service", label: "שירות · מענה אישי או מידע על הרשמה" },
            { value: "marketing", label: "שיווק · דורש הסכמה מתועדת" },
          ],
        },
        { key: "body", label: "תוכן ההודעה", type: "textarea", required: true },
      ],
      async (v) => act("/drafts", v),
    );
  }
  function memberForm() {
    showForm(
      "הוספת איש צוות",
      [
        { key: "name", label: "שם מלא", required: true },
        { key: "email", label: "מייל להתחברות", type: "email", required: true },
        {
          key: "password",
          label: "סיסמה למשתמש חדש · לקיים להשאיר ריק",
          type: "password",
          required: false,
        },
        {
          key: "role",
          label: "תפקיד",
          options: Object.entries(roleNames)
            .filter(
              ([k]) =>
                k !== "owner" &&
                (k !== "manager" || s?.member.role === "owner"),
            )
            .map(([value, label]) => ({ value, label: String(label) })),
          required: true,
        },
        {
          key: "capacity",
          label: "מכסת לידים פתוחים להקצאה",
          type: "number",
          value: 100,
        },
      ],
      async (v) => act("/members", v),
    );
  }
  function showClass(cl: Row) {
    setTab("students");
    setSearch(cl.name);
  }
  const filtered = (list: string) =>
    (s?.[list] || []).filter(
      (r: Row) =>
        !search ||
        [r.name, r.title, r.email, r.phone, name("classes", r.class_id)].some(
          (v) =>
            String(v || "")
              .toLowerCase()
              .includes(search.toLowerCase()),
        ),
    );
  const navigate = (id: string) => {
    setTab(id);
    setSearch("");
    setSelected(null);
    setMobileNav(false);
  };
  const openTasks = s?.tasks.filter((t: Row) => !t.done) || [],
    overdue = openTasks.filter((t: Row) => new Date(t.due_at) < new Date()),
    dueToday = openTasks.filter(
      (t: Row) =>
        new Date(t.due_at).toDateString() === new Date().toDateString(),
    );
  const sum = (kind: string) =>
    s?.finance
      .filter((f: Row) => f.kind === kind)
      .reduce((a: number, b: Row) => a + b.amount, 0) || 0;
  const total = s?.leads.length || 0,
    won = s?.leads.filter((l: Row) => l.stage === "won").length || 0;
  const headerActions: Row = {
    leads: () => leadForm(),
    tasks: () => taskForm(),
    courses: () => resourceForm("courses"),
    campaigns: () => resourceForm("campaigns"),
    messages: () => messageForm(),
    team: memberForm,
    entities: () => resourceForm("entity_types"),
  };
  const actionNames: Row = {
    leads: "ליד חדש",
    tasks: "משימה חדשה",
    courses: "קורס חדש",
    campaigns: "קמפיין חדש",
    messages: "כתיבת הודעה",
    team: "איש צוות",
    entities: "ישות חדשה",
  };
  const canNav = (navId: string) =>
    manager ||
    ["dashboard", "tasks"].includes(navId) ||
    (sales &&
      ["leads", "courses", "students", "campaigns", "messages"].includes(
        navId,
      )) ||
    (academic && ["courses", "students"].includes(navId));
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (mobileNav ? "mobile-open" : "")}>
        <a className="brand" onClick={() => navigate("dashboard")}>
          <span className="brandmark">
            <Layers size={24} />
          </span>
          <span>
            מרחב<small>ניהול מכללות, ביחד.</small>
          </span>
        </a>
        <div className="workspace-select">
          <Building2 size={18} />
          <select
            aria-label="בחירת מכללה"
            value={ws}
            onChange={(e) => {
              setWs(e.target.value);
              setTab("dashboard");
            }}
          >
            {me.workspaces.map((w: Row) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <ChevronDown size={15} />
        </div>
        <span className="nav-label">סביבת העבודה</span>
        <nav>
          {nav
            .filter((n) => canNav(n.id))
            .map((n) => (
              <button
                key={n.id}
                className={tab === n.id ? "active" : ""}
                onClick={() => navigate(n.id)}
              >
                <n.icon size={18} />
                <span>{n.label}</span>
                {n.id === "tasks" && openTasks.length > 0 && (
                  <b>{openTasks.length}</b>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-note">
          <span className="live-dot" /> מידע נפרד לכל מכללה
          <small>רק הצוות המורשה מקבל גישה.</small>
        </div>
        <div className="profile">
          <Avatar name={me.user.name} />
          <span>
            {me.user.name}
            <small>{s ? roleNames[s.member.role] : "טוען…"}</small>
          </span>
          <button
            title="יציאה"
            className="icon"
            onClick={() =>
              void perform(async () => {
                await request("/auth/logout", "POST", {});
                setMe(null);
                setState(null);
                loadVersion.current++;
                setWs("");
                setSelected(null);
                setModal(null);
                setTab("dashboard");
              })
            }
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon mobile-toggle"
              onClick={() => setMobileNav(!mobileNav)}
              aria-label="פתיחת תפריט"
            >
              <PanelTop size={20} />
            </button>
            <span>{s?.workspace.name || "המרחב שלי"}</span>
            <ChevronLeft size={14} />
            <strong>{nav.find((n) => n.id === tab)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="date-label">
              <CalendarDays size={15} />
              {new Date().toLocaleDateString("he-IL", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
            <button
              className="notification"
              title="משימות שממתינות לטיפול"
              onClick={() => navigate("tasks")}
            >
              <Bell size={20} />
              {overdue.length > 0 && <i />}
            </button>
            <button
              className="icon"
              aria-label="שינוי סיסמה"
              title="שינוי סיסמה"
              onClick={() =>
                showForm(
                  "שינוי סיסמה",
                  [
                    {
                      key: "current_password",
                      label: "סיסמה נוכחית",
                      type: "password",
                      required: true,
                    },
                    {
                      key: "password",
                      label: "סיסמה חדשה · לפחות 12 תווים",
                      type: "password",
                      required: true,
                    },
                  ],
                  async (v) => {
                    await request("/auth/password", "PUT", v);
                  },
                )
              }
            >
              <KeyRound size={18} />
            </button>
            <Avatar name={me.user.name} small />
          </div>
        </header>
        <div className="page">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {tab === "dashboard"
                  ? "התמונה השלמה, במקום אחד"
                  : "סביבת העבודה שלך"}
              </div>
              <h1>
                {tab === "dashboard"
                  ? `שלום, ${me.user.name.split(" ")[0]}.`
                  : nav.find((n) => n.id === tab)?.label}
              </h1>
              <p>
                {
                  (
                    {
                      dashboard:
                        "מה מתקדם, מה דורש תשומת לב, ולאן ממשיכים מכאן.",
                      leads:
                        "מהיכרות ראשונה ועד ההרשמה. אף ליד לא הולך לאיבוד.",
                      tasks:
                        "כל ההתחייבויות, האחראים והתזכורות — מסודרים לעבודה.",
                      courses: "מחברים בין הקורס, הכיתה, הצוות והתלמידים.",
                      students: "הדרך מהמכירה ללמידה: מפגשים, נוכחות והישגים.",
                      campaigns: "יודעים מאיפה מגיעים הלידים, ומה באמת עובד.",
                      reports:
                        "תכנון, עסקאות, תקבולים והוצאות — בלי לערבב ביניהם.",
                      messages: "כל התקשורת, מחוברת לכרטיס הנכון.",
                      entities: "המערכת מתאימה לעסק שלך, לא להפך.",
                      team: "כל אחד רואה את מה שהוא צריך כדי להתקדם.",
                      settings: "הכללים והחיבורים שמניעים את העבודה.",
                    } as Row
                  )[tab]
                }
              </p>
            </div>
            {headerActions[tab] &&
              (manager || ["leads", "tasks", "messages"].includes(tab)) && (
                <button className="primary" onClick={headerActions[tab]}>
                  <Plus size={17} />
                  {actionNames[tab]}
                </button>
              )}
            {tab === "dashboard" && !academic && (
              <button className="primary" onClick={() => leadForm()}>
                <Plus size={17} />
                הוספת ליד
              </button>
            )}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button
                onClick={() => {
                  setError("");
                  void load();
                }}
              >
                נסה שוב
              </button>
            </div>
          )}
          {!s ? (
            <div className="loading">טוען את הנתונים…</div>
          ) : (
            <>
              {tab === "dashboard" && (
                <>
                  <div className="welcome-strip">
                    <div>
                      <span className="live-dot" />
                      <strong>{s.workspace.name}</strong>
                      <span>מרחב אחד. כל התהליכים מחוברים.</span>
                    </div>
                    <Badge color="green">{roleNames[s.member.role]}</Badge>
                  </div>
                  <div className="stats-grid">
                    <Stat
                      title="לידים במרחב"
                      value={total}
                      caption={`${s.leads.filter((l: Row) => l.stage === "new").length} ממתינים לטיפול ראשון`}
                      icon={<Users />}
                      color="blue"
                    />
                    <Stat
                      title="הרשמות שהושלמו"
                      value={s.enrollments.length}
                      caption={
                        total
                          ? `${Math.round((won / total) * 100)}% מהלידים נסגרו`
                          : "מתחילים לבנות תהליך מכירה"
                      }
                      icon={<GraduationCap />}
                      color="green"
                    />
                    <Stat
                      title="משימות פתוחות"
                      value={openTasks.length}
                      caption={`${overdue.length} באיחור · ${dueToday.length} להיום`}
                      icon={<CheckSquare />}
                      color="orange"
                    />
                    {manager ? (
                      <Stat
                        title="תקבולים בפועל"
                        value={money(sum("receipt"))}
                        caption="לא כולל עסקאות שטרם נגבו"
                        icon={<BarChart3 />}
                        color="purple"
                      />
                    ) : (
                      <Stat
                        title="כיתות במרחב שלך"
                        value={s.classes.length}
                        caption="קורסים, מפגשים ואנשים"
                        icon={<BookOpen />}
                        color="purple"
                      />
                    )}
                  </div>
                  <div className="dashboard-grid">
                    <section className="panel pipeline-panel">
                      <PanelHeader
                        title="הדרך מליד לתלמיד"
                        subtitle="תמונת מצב במשפך המכירות"
                        action={
                          <button
                            className="text-button"
                            onClick={() => navigate("leads")}
                          >
                            לכל הלידים
                            <ArrowLeft size={15} />
                          </button>
                        }
                      />
                      <div className="pipeline-bars">
                        {stages.slice(0, 4).map((stage, i) => {
                          const n = s.leads.filter(
                            (l: Row) => l.stage === stage.id,
                          ).length;
                          return (
                            <div className="pipeline-row" key={stage.id}>
                              <span className="pipeline-step">0{i + 1}</span>
                              <span>{stage.name}</span>
                              <div className="bar-track">
                                <div
                                  style={{
                                    width: total
                                      ? `${Math.max(2, (n / total) * 100)}%`
                                      : "0%",
                                    background: stage.color,
                                  }}
                                />
                              </div>
                              <b>{n}</b>
                            </div>
                          );
                        })}
                      </div>
                      <div className="panel-bottom">
                        <span>מקור מדויק. אחראי ברור. פעולה הבאה.</span>
                        <Target size={17} />
                      </div>
                    </section>
                    <section className="panel">
                      <PanelHeader
                        title="על סדר היום"
                        subtitle="המשימות הקרובות של הצוות"
                        action={
                          <button
                            className="icon"
                            onClick={() => taskForm()}
                            title="משימה חדשה"
                          >
                            <Plus size={19} />
                          </button>
                        }
                      />
                      {openTasks.length ? (
                        <div className="task-preview">
                          {openTasks.slice(0, 4).map((t: Row) => (
                            <TaskLine
                              key={t.id}
                              t={t}
                              name={name("members", t.assignee_id)}
                              onToggle={() =>
                                void perform(() =>
                                  act("/tasks/" + t.id, { done: true }, "PUT"),
                                )
                              }
                            />
                          ))}
                        </div>
                      ) : (
                        <Empty
                          title="היום שלך מתחיל מסודר"
                          description="צרו משימה עם מועד, והיא תמתין כאן בזמן הנכון."
                          action={
                            <button
                              className="text-button"
                              onClick={() => taskForm()}
                            >
                              הוספת משימה ראשונה
                              <ArrowLeft size={15} />
                            </button>
                          }
                        />
                      )}
                    </section>
                  </div>
                  <div className="dashboard-grid bottom-grid">
                    <section className="panel">
                      <PanelHeader
                        title="השלב הבא במרחב"
                        subtitle="צעדים קטנים לתשתית שעובדת בשבילך"
                      />
                      <div className="onboarding">
                        {[
                          {
                            title: "הגדרת קורס וכיתה",
                            desc: "לאן נרשמים, מי מלמד ומתי מתחילים",
                            done: s.courses.length && s.classes.length,
                            action: () => navigate("courses"),
                          },
                          {
                            title: "הוספת אנשי צוות",
                            desc: "מכירות, ניהול כיתות והוראה — בהרשאות נפרדות",
                            done: s.members.length > 1,
                            action: () => navigate("team"),
                          },
                          {
                            title: "הכנסת הליד הראשון",
                            desc: "מקור, קורס, אחראי והפעולה הבאה",
                            done: s.leads.length,
                            action: () => leadForm(),
                          },
                        ].map((item, i) => (
                          <button key={item.title} onClick={item.action}>
                            <span
                              className={
                                "step-circle " + (item.done ? "done" : "")
                              }
                            >
                              {item.done ? <Check size={15} /> : i + 1}
                            </span>
                            <span>
                              <strong>{item.title}</strong>
                              <small>{item.desc}</small>
                            </span>
                            <ChevronLeft size={18} />
                          </button>
                        ))}
                      </div>
                    </section>
                    <section className="panel focus-panel">
                      <div className="focus-icon">
                        <Link2 size={24} />
                      </div>
                      <h2>לא עוד איים של מידע.</h2>
                      <p>
                        בכרטיס הליד תמצאו את הקורס והכיתה, השיחות והמשימות, וכל
                        ההודעות שנשלחו אליו.
                      </p>
                      <div className="connection-tags">
                        <span>ליד</span>
                        <Link2 size={14} />
                        <span>כיתה</span>
                        <Link2 size={14} />
                        <span>למידה</span>
                      </div>
                      <button
                        className="text-button"
                        onClick={() =>
                          navigate(academic ? "students" : "leads")
                        }
                      >
                        למרחב העבודה
                        <ArrowLeft size={16} />
                      </button>
                    </section>
                  </div>
                </>
              )}
              {tab === "leads" && (
                <Leads
                  s={s}
                  search={search}
                  setSearch={setSearch}
                  onSelect={setSelected}
                  name={name}
                />
              )}
              {tab === "tasks" && (
                <>
                  <Toolbar search={search} setSearch={setSearch} />
                  <div className="task-summary">
                    <Badge color="orange">{overdue.length} באיחור</Badge>
                    <Badge color="blue">{dueToday.length} להיום</Badge>
                    <Badge color="green">
                      {s.tasks.filter((t: Row) => t.done).length} הושלמו
                    </Badge>
                    <span className="muted">
                      תזכורות מוצגות כאן ובמבט־על · מתעדכן כל דקה
                    </span>
                  </div>
                  <section className="panel">
                    {filtered("tasks").length ? (
                      filtered("tasks").map((t: Row) => (
                        <TaskLine
                          key={t.id}
                          t={t}
                          name={name("members", t.assignee_id)}
                          onToggle={() =>
                            void perform(() =>
                              act("/tasks/" + t.id, { done: !t.done }, "PUT"),
                            )
                          }
                          onOpen={
                            t.lead_id ? () => setSelected(t.lead_id) : undefined
                          }
                        />
                      ))
                    ) : (
                      <Empty
                        title="יש מקום לעבודה החשובה"
                        description="הגדירו משימה, אחראי ותזכורת לזמן המתאים."
                        action={
                          <button
                            className="primary"
                            onClick={() => taskForm()}
                          >
                            משימה ראשונה
                            <Plus size={16} />
                          </button>
                        }
                      />
                    )}
                  </section>
                </>
              )}
              {tab === "courses" && (
                <>
                  <div className="section-title">
                    <h2>
                      הקורסים שלכם <span>{s.courses.length}</span>
                    </h2>
                    {manager && (
                      <button
                        className="secondary"
                        onClick={() => resourceForm("classes")}
                      >
                        <Plus size={16} />
                        פתיחת כיתה
                      </button>
                    )}
                  </div>
                  {!s.courses.length ? (
                    <section className="panel">
                      <Empty
                        title="כאן מתחילה הלמידה"
                        description="הוסיפו קורס, פתחו כיתה ושייכו אליה צוות ותלמידים."
                        action={
                          manager && (
                            <button
                              className="primary"
                              onClick={() => resourceForm("courses")}
                            >
                              הוספת קורס
                              <Plus size={16} />
                            </button>
                          )
                        }
                      />
                    </section>
                  ) : (
                    <div className="course-grid">
                      {s.courses.map((course: Row) => (
                        <section className="panel course-card" key={course.id}>
                          <div className="course-icon">
                            <BookOpen size={22} />
                          </div>
                          <Badge color="green">
                            {
                              s.classes.filter(
                                (cl: Row) => cl.course_id === course.id,
                              ).length
                            }{" "}
                            כיתות
                          </Badge>
                          <h2>{course.name}</h2>
                          {manager && (
                            <button
                              className="text-button"
                              onClick={() => resourceForm("courses", course)}
                            >
                              עריכת הקורס
                            </button>
                          )}
                          <p>
                            {course.description ||
                              "כל המידע, הצוות והתלמידים של הקורס."}
                          </p>
                          {manager && (
                            <div className="course-price">
                              {money(course.price)}
                              <small>מחיר מתוכנן לתלמיד</small>
                            </div>
                          )}
                          {s.classes
                            .filter((cl: Row) => cl.course_id === course.id)
                            .map((cl: Row) => (
                              <div key={cl.id}>
                                <button
                                  className="class-row"
                                  onClick={() => showClass(cl)}
                                >
                                  <span>
                                    <strong>{cl.name}</strong>
                                    <small>
                                      {name("members", cl.teacher_id)} ·{" "}
                                      {date(cl.starts_at)}
                                    </small>
                                  </span>
                                  <Badge>
                                    {
                                      s.enrollments.filter(
                                        (e: Row) => e.class_id === cl.id,
                                      ).length
                                    }
                                    /{cl.capacity}
                                  </Badge>
                                  <ChevronLeft size={16} />
                                </button>
                                {manager && (
                                  <button
                                    className="text-button"
                                    onClick={() => resourceForm("classes", cl)}
                                  >
                                    עריכת הכיתה והצוות
                                  </button>
                                )}
                              </div>
                            ))}
                        </section>
                      ))}
                    </div>
                  )}
                </>
              )}
              {tab === "students" && (
                <>
                  <Toolbar
                    search={search}
                    setSearch={setSearch}
                    placeholder="חיפוש תלמיד או כיתה…"
                  />
                  <section className="panel">
                    <PanelHeader
                      title="תלמידים רשומים"
                      subtitle="סגירת ליד יוצרת הרשמה אחת בכיתה שנבחרה"
                    />
                    {filtered("enrollments").length ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>שם</th>
                              <th>כיתה / קורס</th>
                              <th>מורה</th>
                              <th>נוכחות</th>
                              <th>ממוצע ציונים</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {filtered("enrollments").map((e: Row) => {
                              const a = s.attendance.filter(
                                  (r: Row) => r.enrollment_id === e.id,
                                ),
                                g = s.grades.filter(
                                  (r: Row) => r.enrollment_id === e.id,
                                );
                              return (
                                <tr key={e.id}>
                                  <td>
                                    <div className="person">
                                      <Avatar name={e.name} small />
                                      <strong>{e.name}</strong>
                                    </div>
                                  </td>
                                  <td>{name("classes", e.class_id)}</td>
                                  <td>{name("members", e.teacher_id)}</td>
                                  <td>
                                    {
                                      a.filter((r: Row) =>
                                        ["present", "late"].includes(r.status),
                                      ).length
                                    }{" "}
                                    /{" "}
                                    {
                                      s.lessons.filter(
                                        (l: Row) => l.class_id === e.class_id,
                                      ).length
                                    }
                                  </td>
                                  <td>
                                    {g.length
                                      ? Math.round(
                                          g.reduce(
                                            (a: number, r: Row) => a + r.score,
                                            0,
                                          ) / g.length,
                                        )
                                      : "טרם הוזנו"}
                                  </td>
                                  <td>
                                    <button
                                      className="text-button"
                                      onClick={() =>
                                        setModal(
                                          <Modal
                                            title={e.name}
                                            subtitle={name(
                                              "classes",
                                              e.class_id,
                                            )}
                                            onClose={() => setModal(null)}
                                          >
                                            <div className="student-detail">
                                              <h3>ציונים</h3>
                                              {g.length ? (
                                                g.map((r: Row) => (
                                                  <div
                                                    className="detail-row"
                                                    key={r.id}
                                                  >
                                                    <span>{r.title}</span>
                                                    <strong>{r.score}</strong>
                                                  </div>
                                                ))
                                              ) : (
                                                <p className="muted">
                                                  עדיין אין ציונים
                                                </p>
                                              )}
                                              <h3>נוכחות</h3>
                                              {s.lessons
                                                .filter(
                                                  (l: Row) =>
                                                    l.class_id === e.class_id,
                                                )
                                                .map((l: Row) => (
                                                  <div
                                                    className="detail-row"
                                                    key={l.id}
                                                  >
                                                    <span>
                                                      {l.title} ·{" "}
                                                      {date(l.held_at)}
                                                    </span>
                                                    <Badge>
                                                      {(
                                                        {
                                                          present: "נוכח/ת",
                                                          absent: "נעדר/ת",
                                                          late: "איחור",
                                                          excused:
                                                            "היעדרות מוצדקת",
                                                        } as Row
                                                      )[
                                                        a.find(
                                                          (r: Row) =>
                                                            r.lesson_id ===
                                                            l.id,
                                                        )?.status
                                                      ] || "טרם סומן"}
                                                    </Badge>
                                                  </div>
                                                ))}
                                            </div>
                                          </Modal>,
                                        )
                                      }
                                    >
                                      כרטיס תלמיד
                                      <ArrowUpLeft size={15} />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title="ההרשמה היא רק ההתחלה"
                        description="כשליד נסגר ומשויך לכיתה, הוא מופיע כאן כתלמיד."
                      />
                    )}
                  </section>
                  {(manager || academic) && (
                    <>
                      <div className="section-title">
                        <h2>ניהול מפגשים וציונים</h2>
                        <button
                          className="secondary"
                          onClick={() =>
                            showForm(
                              "מפגש חדש",
                              [
                                {
                                  key: "class_id",
                                  label: "כיתה",
                                  options: opts("classes"),
                                  required: true,
                                },
                                {
                                  key: "title",
                                  label: "נושא המפגש",
                                  required: true,
                                },
                                {
                                  key: "held_at",
                                  label: "מועד",
                                  type: "datetime-local",
                                  required: true,
                                },
                              ],
                              async (v) =>
                                act("/lessons", {
                                  ...v,
                                  held_at: new Date(v.held_at).toISOString(),
                                }),
                            )
                          }
                        >
                          <Plus size={16} />
                          מפגש חדש
                        </button>
                      </div>
                      <div className="learning-grid">
                        <section className="panel">
                          <PanelHeader
                            title="סימון נוכחות"
                            subtitle="הסימון נשמר מיד ולכל תלמיד בנפרד"
                          />
                          {s.lessons.length ? (
                            <Attendance s={s} act={act} perform={perform} />
                          ) : (
                            <Empty
                              title="צרו את המפגש הראשון"
                              description="אחר כך תוכלו לסמן נוכחות לתלמידי הכיתה."
                            />
                          )}
                        </section>
                        <section className="panel">
                          <PanelHeader
                            title="הזנת ציון"
                            subtitle="ציון 0–100, מחובר לכרטיס התלמיד"
                          />
                          <div className="pad">
                            <Form
                              fields={[
                                {
                                  key: "enrollment_id",
                                  label: "תלמיד/ה",
                                  options: s.enrollments.map((e: Row) => ({
                                    value: e.id,
                                    label: `${e.name} · ${name("classes", e.class_id)}`,
                                  })),
                                  required: true,
                                },
                                {
                                  key: "title",
                                  label: "שם המבחן",
                                  required: true,
                                },
                                {
                                  key: "score",
                                  label: "ציון",
                                  type: "number",
                                  required: true,
                                },
                              ]}
                              onSubmit={async (v) => {
                                await act("/grades", v);
                                setToast("הציון נשמר");
                              }}
                            />
                          </div>
                        </section>
                      </div>
                    </>
                  )}
                </>
              )}
              {tab === "campaigns" && (
                <>
                  <div className="insight-banner">
                    <Target size={20} />
                    <span>
                      כל ליד מקושר למקור ולקמפיין. חום הליד נקבע לפי המקור, לא
                      לפי ניחוש.
                    </span>
                  </div>
                  {!s.campaigns.length ? (
                    <section className="panel">
                      <Empty
                        title="מפרסום — לתוצאה"
                        description="הוסיפו קמפיין ושייכו אליו מקורות ולידים כדי למדוד המרות."
                        action={
                          manager && (
                            <button
                              className="primary"
                              onClick={() => resourceForm("campaigns")}
                            >
                              קמפיין ראשון
                              <Plus size={16} />
                            </button>
                          )
                        }
                      />
                    </section>
                  ) : (
                    <div className="course-grid">
                      {s.campaigns.map((c: Row) => {
                        const leads = s.leads.filter(
                            (l: Row) => l.campaign_id === c.id,
                          ),
                          closed = leads.filter((l: Row) => l.stage === "won");
                        return (
                          <section className="panel course-card" key={c.id}>
                            <div className="course-icon">
                              <Megaphone />
                            </div>
                            <h2>{c.name}</h2>
                            <div className="campaign-numbers">
                              <span>
                                <b>{leads.length}</b>לידים
                              </span>
                              <span>
                                <b>{closed.length}</b>נרשמו
                              </span>
                              <span>
                                <b>
                                  {leads.length
                                    ? Math.round(
                                        (closed.length / leads.length) * 100,
                                      )
                                    : 0}
                                  %
                                </b>
                                המרה
                              </span>
                            </div>
                            {manager && (
                              <div className="panel-bottom">
                                תקציב מתוכנן<strong>{money(c.budget)}</strong>
                              </div>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
              {tab === "reports" && manager && (
                <Reports
                  s={s}
                  sum={sum}
                  showForm={showForm}
                  act={act}
                  opts={opts}
                  name={name}
                />
              )}
              {tab === "messages" && (
                <>
                  <div className="insight-banner">
                    <Mail size={20} />
                    <span>
                      שליחה דרך Brevo · מענה נכנס דרך Cloudflare · פתיחה היא
                      אינדיקציה בלבד, לא הוכחת קריאה.
                    </span>
                  </div>
                  <div className="connection-state">
                    <Badge color={s.emailConnected ? "green" : "orange"}>
                      {s.emailConnected
                        ? "מפתח Brevo מחובר"
                        : "Brevo ממתין לחיבור"}
                    </Badge>
                    <span className="muted">
                      {s.workspace.sender_email
                        ? "שולח: " + s.workspace.sender_email
                        : "טרם הוגדר שולח למכללה"}{" "}
                      ·{" "}
                      {s.workspace.inbox_email
                        ? "דואר נכנס: " + s.workspace.inbox_email
                        : "קליטת מיילים ממתינה לבחירת דומיין וניתוב"}
                    </span>
                  </div>
                  <section className="panel">
                    {s.messages.length ? (
                      <div className="message-list">
                        {s.messages.map((m: Row) => (
                          <article key={m.id}>
                            <div className={"message-icon " + m.direction}>
                              {m.direction === "in" ? (
                                <Mail size={20} />
                              ) : (
                                <Send size={20} />
                              )}
                            </div>
                            <div className="message-body">
                              <strong>{m.subject}</strong>
                              <span>
                                {name("leads", m.lead_id)} · {m.recipient}
                              </span>
                              <p>{m.body}</p>
                              <div className="message-events">
                                {s.message_events
                                  .filter((e: Row) => e.message_id === m.id)
                                  .map((e: Row) => (
                                    <Badge key={e.event_id}>
                                      {(
                                        {
                                          delivered: "נמסר",
                                          opened: "נפתחה (אינדיקציה)",
                                          click: "לחיצה",
                                          unsubscribed: "הסרה",
                                          hard_bounce: "כתובת שגויה",
                                          soft_bounce: "דחייה זמנית",
                                        } as Row
                                      )[e.event] || e.event}{" "}
                                      · {datetime(e.at)}
                                    </Badge>
                                  ))}
                              </div>
                            </div>
                            <div className="message-meta">
                              <span>{datetime(m.created_at)}</span>
                              <Badge
                                color={
                                  m.status === "sent"
                                    ? "green"
                                    : m.status === "draft"
                                      ? "orange"
                                      : "gray"
                                }
                              >
                                {(
                                  {
                                    draft: "טיוטה",
                                    sent: "נשלח",
                                    received: "התקבל",
                                    sending: "בשליחה",
                                    rejected: "השליחה נדחתה",
                                    uncertain: "סטטוס שליחה לא ודאי",
                                  } as Row
                                )[m.status] || m.status}
                              </Badge>
                              {m.status === "draft" && (
                                <button
                                  className="secondary"
                                  onClick={() =>
                                    setModal(
                                      <Modal
                                        title="אישור שליחת מייל"
                                        subtitle="הודעה אחת לנמען אחד. זו פעולה אמיתית."
                                        onClose={() => setModal(null)}
                                      >
                                        <div className="pad">
                                          <p>
                                            <strong>{m.subject}</strong>
                                            <br />
                                            {m.recipient}
                                          </p>
                                          <button
                                            className="primary"
                                            onClick={() =>
                                              void perform(async () => {
                                                await act(
                                                  "/messages/" + m.id + "/send",
                                                  {},
                                                );
                                                setModal(null);
                                              })
                                            }
                                          >
                                            אישור ושליחה
                                            <Send size={16} />
                                          </button>
                                        </div>
                                      </Modal>,
                                    )
                                  }
                                >
                                  שליחה
                                  <Send size={14} />
                                </button>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        title="כל שיחה נשארת בהקשר"
                        description="כתבו הודעה אישית מתוך כרטיס ליד. היא תישמר כטיוטה עד לאישור שליחה."
                        action={
                          <button
                            className="primary"
                            onClick={() => messageForm()}
                          >
                            כתיבת הודעה
                            <Plus size={16} />
                          </button>
                        }
                      />
                    )}
                  </section>
                </>
              )}
              {tab === "team" && manager && (
                <>
                  <div className="stats-grid three">
                    <Stat
                      title="אנשי צוות פעילים"
                      value={s.members.filter((m: Row) => m.active).length}
                      caption="משויכים למכללה הנוכחית"
                      icon={<Users />}
                      color="blue"
                    />
                    <Stat
                      title="לידים ללא אחראי"
                      value={s.leads.filter((l: Row) => !l.assignee_id).length}
                      caption="מומלץ להקצות לפני טיפול"
                      icon={<Target />}
                      color="orange"
                    />
                    <Stat
                      title="כללי הקצאה"
                      value={s.assignment_rules.length}
                      caption="לפי מקור, קורס, עדיפות ומכסה"
                      icon={<Layers />}
                      color="purple"
                    />
                  </div>
                  <section className="panel">
                    <PanelHeader
                      title="ביצועי הצוות"
                      subtitle="לידים לפי שלב, כדי לזהות התקדמות וחסמים"
                    />
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>איש צוות</th>
                            <th>תפקיד</th>
                            <th>מכסה</th>
                            {stages.map((x) => (
                              <th key={x.id}>{x.name}</th>
                            ))}
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {s.members.map((m: Row) => (
                            <tr key={m.user_id}>
                              <td>
                                <div className="person">
                                  <Avatar name={m.name} small />
                                  <strong>{m.name}</strong>
                                  {!m.active && <Badge>מושבת</Badge>}
                                </div>
                              </td>
                              <td>{roleNames[m.role]}</td>
                              <td>{m.capacity}</td>
                              {stages.map((x) => (
                                <td key={x.id}>
                                  {
                                    s.leads.filter(
                                      (l: Row) =>
                                        l.assignee_id === m.user_id &&
                                        l.stage === x.id,
                                    ).length
                                  }
                                </td>
                              ))}
                              <td>
                                {m.role !== "owner" && (
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      showForm(
                                        "מכסת הקצאה ופעילות",
                                        [
                                          {
                                            key: "capacity",
                                            label: "מכסת לידים פתוחים",
                                            type: "number",
                                            required: true,
                                          },
                                          {
                                            key: "active",
                                            label: "פעיל/ה?",
                                            options: [
                                              { value: "1", label: "פעיל" },
                                              { value: "0", label: "מושבת" },
                                            ],
                                            required: true,
                                          },
                                        ],
                                        async (v) =>
                                          act(
                                            "/members/" + m.user_id,
                                            {
                                              capacity: v.capacity,
                                              active: Number(v.active),
                                            },
                                            "PUT",
                                          ),
                                        {
                                          capacity: m.capacity,
                                          active: String(m.active),
                                        },
                                      )
                                    }
                                  >
                                    ניהול
                                    <MoreHorizontal size={16} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <div className="section-title">
                    <h2>הקצאה אוטומטית</h2>
                    <button
                      className="secondary"
                      onClick={() => resourceForm("assignment_rules")}
                    >
                      <Plus size={16} />
                      כלל חדש
                    </button>
                  </div>
                  <section className="panel">
                    {s.assignment_rules.length ? (
                      s.assignment_rules.map((r: Row) => (
                        <div className="detail-row pad" key={r.id}>
                          <span>
                            עדיפות {r.priority} ·{" "}
                            {r.source_id
                              ? name("sources", r.source_id)
                              : "כל המקורות"}{" "}
                            ·{" "}
                            {r.course_id
                              ? name("courses", r.course_id)
                              : "כל הקורסים"}
                          </span>
                          <strong>{name("members", r.assignee_id)}</strong>
                        </div>
                      ))
                    ) : (
                      <Empty
                        title="כל ליד מגיע לאדם הנכון"
                        description="הכללים מקצים לפי מקור וקורס, תוך התחשבות במכסת לידים ובעומס. בלי כלל מתאים, הליד ממתין להקצאה ידנית."
                      />
                    )}
                  </section>
                </>
              )}
              {tab === "entities" && manager && (
                <Entities
                  s={s}
                  showForm={showForm}
                  resourceForm={resourceForm}
                  act={act}
                  customFields={customFields}
                  name={name}
                />
              )}
              {tab === "settings" && manager && (
                <>
                  <div className="settings-grid">
                    <section className="panel">
                      <PanelHeader
                        title="מקורות הלידים"
                        subtitle="חום התחלתי לפי רמת הכוונה של הפונה"
                        action={
                          <button
                            className="secondary"
                            onClick={() => resourceForm("sources")}
                          >
                            <Plus size={15} />
                            מקור
                          </button>
                        }
                      />
                      {s.sources.map((r: Row) => (
                        <div className="detail-row pad" key={r.id}>
                          <strong>{r.name}</strong>
                          <Badge color={r.heat === "hot" ? "orange" : "blue"}>
                            {
                              ({ hot: "חם", warm: "פושר", cold: "קר" } as Row)[
                                r.heat
                              ]
                            }
                          </Badge>
                        </div>
                      ))}
                    </section>
                    <section className="panel">
                      <PanelHeader
                        title="דואר המכללה"
                        subtitle="לכל מכללה כתובת שולח וכתובת קליטה נפרדות"
                      />
                      <div className="pad">
                        <Form
                          initial={s.workspace}
                          fields={[
                            {
                              key: "sender_email",
                              label: "כתובת שולח מאומתת ב־Brevo",
                              type: "email",
                            },
                            {
                              key: "inbox_email",
                              label: "כתובת דואר נכנס ב־Cloudflare",
                              type: "email",
                            },
                            {
                              key: "sender_address",
                              label: "כתובת העסק המלאה · נדרשת לדיוור שיווקי",
                            },
                          ]}
                          onSubmit={async (v) => {
                            await act("/email-settings", v, "PUT");
                            setToast(
                              "ההגדרות נשמרו; ניתוב הדומיין דורש הגדרה נפרדת",
                            );
                          }}
                        />
                        <p className="muted">
                          שמירת כתובת אינה משנה DNS ואינה מפעילה ניתוב אוטומטית.
                        </p>
                      </div>
                    </section>
                    <section className="panel">
                      <PanelHeader
                        title="שדות מותאמים"
                        subtitle="המידע שהצוות שואל בשיחה, במבנה שמתאים לכם"
                        action={
                          <button
                            className="secondary"
                            onClick={() => resourceForm("fields")}
                          >
                            <Plus size={15} />
                            שדה
                          </button>
                        }
                      />
                      {s.fields.length ? (
                        s.fields.map((f: Row) => (
                          <div className="detail-row pad" key={f.id}>
                            <strong>{f.label}</strong>
                            <Badge>
                              {f.entity_type} · {f.type}
                              {f.required ? " · חובה" : ""}
                            </Badge>
                          </div>
                        ))
                      ) : (
                        <Empty
                          title="כל שאלה מקבלת שדה"
                          description="טקסט, מספר, תאריך או רשימת בחירה — בלי שינוי קוד."
                        />
                      )}
                    </section>
                    <section className="panel">
                      <PanelHeader
                        title="חיבור טופס אתר"
                        subtitle="קליטת לידים עם מקור קבוע ומניעת כפילויות"
                      />
                      <div className="pad">
                        <p className="muted">
                          המפתח מיועד לשרת של האתר בלבד. אין לפרסם אותו בדפדפן.
                        </p>
                        <button
                          className="secondary"
                          onClick={() =>
                            showForm(
                              "מפתח קליטת לידים",
                              [
                                {
                                  key: "source_id",
                                  label: "מקור הלידים",
                                  options: opts("sources"),
                                  required: true,
                                },
                                {
                                  key: "campaign_id",
                                  label: "קמפיין",
                                  options: opts("campaigns"),
                                },
                              ],
                              async (v) => {
                                const result = await request(
                                  `/w/${ws}/intake-keys`,
                                  "POST",
                                  {
                                    source_id: v.source_id,
                                    campaign_id: v.campaign_id || null,
                                  },
                                );
                                await navigator.clipboard.writeText(
                                  result.token,
                                );
                                setToast("המפתח הועתק ללוח — שמרו אותו בסוד");
                                await load();
                              },
                            )
                          }
                        >
                          <Copy size={15} />
                          יצירת מפתח והעתקה
                        </button>
                        <p>{s.intake_keys.length} מפתחות קיימים</p>
                        <code dir="ltr">
                          POST /api/intake · Authorization: Bearer
                        </code>
                        <p className="muted">
                          כל אירוע חייב event_id ייחודי. שליחה חוזרת של אותו
                          אירוע אינה יוצרת ליד נוסף.
                        </p>
                      </div>
                    </section>
                  </div>
                  <section className="panel">
                    <PanelHeader
                      title="יומן פעילות"
                      subtitle="תיעוד השינויים שבוצעו במרחב"
                    />
                    {s.activity.length ? (
                      s.activity.map((a: Row) => (
                        <div className="detail-row pad" key={a.id}>
                          <span>
                            {a.user_name} · {a.action}
                          </span>
                          <small>{datetime(a.created_at)}</small>
                        </div>
                      ))
                    ) : (
                      <Empty
                        title="הפעילות תתועד כאן"
                        description="יצירת רשומות, שינויי שלב ופעולות צוות."
                      />
                    )}
                  </section>
                </>
              )}
            </>
          )}
        </div>
        <footer className="app-footer">
          <span>מרחב · ניהול מכללות</span>
          <span>
            <span className="live-dot" />
            כל המידע נשמר בשרת · מופרד לפי מכללה
          </span>
        </footer>
      </main>
      {selected && s && (
        <LeadDetail
          lead={s.leads.find((l: Row) => l.id === selected)}
          s={s}
          name={name}
          onClose={() => setSelected(null)}
          onEdit={leadForm}
          onTask={taskForm}
          onMessage={messageForm}
          act={act}
          perform={perform}
          manager={!!manager}
          showForm={showForm}
        />
      )}
      {modal}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
function Stat({
  title,
  value,
  caption,
  icon,
  color,
}: {
  title: string;
  value: ReactNode;
  caption: string;
  icon: ReactNode;
  color: string;
}) {
  return (
    <section className="stat">
      <div>
        <span>{title}</span>
        <i className={color}>{icon}</i>
      </div>
      <strong>{value}</strong>
      <small>{caption}</small>
    </section>
  );
}
function PanelHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="panel-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
function Toolbar({
  search,
  setSearch,
  placeholder = "חיפוש לפי שם, מייל או טלפון…",
}: {
  search: string;
  setSearch: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="toolbar">
      <div className="search">
        <Search size={17} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          aria-label="חיפוש"
        />
        {search && (
          <button
            className="icon"
            onClick={() => setSearch("")}
            aria-label="ניקוי חיפוש"
          >
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
function TaskLine({
  t,
  name,
  onToggle,
  onOpen,
}: {
  t: Row;
  name: string;
  onToggle: () => void;
  onOpen?: () => void;
}) {
  const late = !t.done && new Date(t.due_at) < new Date();
  return (
    <div className={"task-line " + (t.done ? "completed" : "")}>
      <button
        className={"checkbox " + (t.done ? "checked" : "")}
        onClick={onToggle}
        aria-label={t.done ? "פתיחה מחדש" : "סימון כהושלם"}
      >
        {t.done && <Check size={14} />}
      </button>
      <div>
        <strong>{t.title}</strong>
        <small>
          {name}
          {onOpen && (
            <button className="text-button" onClick={onOpen}>
              לכרטיס הליד
              <ArrowUpLeft size={12} />
            </button>
          )}
        </small>
      </div>
      <span className={late ? "due late" : "due"}>
        <Clock size={13} />
        {datetime(t.due_at)}
      </span>
    </div>
  );
}
function Leads({
  s,
  search,
  setSearch,
  onSelect,
  name,
}: {
  s: Row;
  search: string;
  setSearch: (v: string) => void;
  onSelect: (id: string) => void;
  name: (list: string, id: string) => string;
}) {
  const [view, setView] = useState("board"),
    [source, setSource] = useState(""),
    [owner, setOwner] = useState("");
  const leads = s.leads.filter(
    (l: Row) =>
      (!search ||
        [l.name, l.email, l.phone].some((v) =>
          v.toLowerCase().includes(search.toLowerCase()),
        )) &&
      (!source || l.source_id === source) &&
      (!owner || l.assignee_id === owner),
  );
  return (
    <>
      <div className="leads-toolbar">
        <Toolbar search={search} setSearch={setSearch} />
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          aria-label="סינון מקור"
        >
          <option value="">כל המקורות</option>
          {s.sources.map((r: Row) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          aria-label="סינון אחראי"
        >
          <option value="">כל האחראים</option>
          {s.members.map((r: Row) => (
            <option key={r.user_id} value={r.user_id}>
              {r.name}
            </option>
          ))}
        </select>
        <div className="view-toggle">
          <button
            className={view === "board" ? "active" : ""}
            onClick={() => setView("board")}
          >
            לוח
          </button>
          <button
            className={view === "table" ? "active" : ""}
            onClick={() => setView("table")}
          >
            טבלה
          </button>
        </div>
      </div>
      <div className="result-count">
        {leads.length} לידים במרחב <span>· לחצו על ליד למרחב עבודה מקושר</span>
      </div>
      {view === "board" ? (
        <div className="kanban">
          {stages.map((stage) => (
            <section className="kanban-column" key={stage.id}>
              <header>
                <span style={{ background: stage.color }} />
                <strong>{stage.name}</strong>
                <b>{leads.filter((l: Row) => l.stage === stage.id).length}</b>
              </header>
              <div className="kanban-cards">
                {leads
                  .filter((l: Row) => l.stage === stage.id)
                  .map((l: Row) => (
                    <button
                      className="lead-card"
                      key={l.id}
                      onClick={() => onSelect(l.id)}
                    >
                      <div className="lead-card-top">
                        <Badge
                          color={
                            l.heat === "hot"
                              ? "orange"
                              : l.heat === "warm"
                                ? "purple"
                                : "gray"
                          }
                        >
                          {l.heat === "hot" && <Flame size={11} />}
                          {
                            { hot: "חם", warm: "פושר", cold: "קר" }[
                              l.heat as string
                            ]
                          }
                        </Badge>
                        <MoreHorizontal size={17} />
                      </div>
                      <strong>{l.name}</strong>
                      <small>{name("courses", l.course_id)}</small>
                      <span className="lead-source">
                        {name("sources", l.source_id)}
                      </span>
                      <div className="lead-card-bottom">
                        <span>
                          <Avatar name={name("members", l.assignee_id)} small />
                          {l.assignee_id
                            ? name("members", l.assignee_id)
                            : "טרם הוקצה"}
                        </span>
                        <span>{date(l.created_at)}</span>
                      </div>
                      {!s.tasks.some(
                        (t: Row) => t.lead_id === l.id && !t.done,
                      ) &&
                        !["won", "irrelevant"].includes(l.stage) && (
                          <div className="next-action-warning">
                            טרם הוגדרה פעולה הבאה
                          </div>
                        )}
                    </button>
                  ))}
                {!leads.some((l: Row) => l.stage === stage.id) && (
                  <div className="empty-column">
                    <Layers size={19} />
                    <span>אין לידים בשלב הזה</span>
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>שם</th>
                  <th>מקור</th>
                  <th>שלב</th>
                  <th>אחראי</th>
                  <th>קורס / כיתה</th>
                  <th>טלפון</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l: Row) => (
                  <tr
                    key={l.id}
                    onClick={() => onSelect(l.id)}
                    className="clickable"
                  >
                    <td>
                      <strong>{l.name}</strong>
                    </td>
                    <td>{name("sources", l.source_id)}</td>
                    <td>
                      <Badge>
                        {stages.find((x) => x.id === l.stage)?.name}
                      </Badge>
                    </td>
                    <td>{name("members", l.assignee_id)}</td>
                    <td>
                      {name("courses", l.course_id)} /{" "}
                      {name("classes", l.class_id)}
                    </td>
                    <td dir="ltr">{l.phone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!leads.length && (
            <Empty
              title="לא נמצאו לידים"
              description="הוסיפו ליד חדש או נסו לשנות את החיפוש."
            />
          )}
        </section>
      )}
    </>
  );
}
function LeadDetail({
  lead: l,
  s,
  name,
  onClose,
  onEdit,
  onTask,
  onMessage,
  act,
  perform,
  manager,
  showForm,
}: {
  lead: Row | undefined;
  s: Row;
  name: (list: string, id: string) => string;
  onClose: () => void;
  onEdit: (l: Row) => void;
  onTask: (id: string) => void;
  onMessage: (id: string) => void;
  act: (path: string, body: any, method?: string) => Promise<void>;
  perform: (fn: () => Promise<unknown>) => Promise<void>;
  manager: boolean;
  showForm: (
    title: string,
    fields: Field[],
    save: (v: Row) => Promise<void>,
    initial?: Row,
  ) => void;
}) {
  const [tab, setTab] = useState("overview");
  if (!l) return null;
  const tasks = s.tasks.filter((t: Row) => t.lead_id === l.id),
    messages = s.messages.filter((m: Row) => m.lead_id === l.id),
    enrollment = s.enrollments.find((e: Row) => e.lead_id === l.id),
    cl = s.classes.find((c: Row) => c.id === l.class_id);
  return (
    <div
      className="drawer-overlay"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <section
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={"כרטיס " + l.name}
      >
        <header className="drawer-header">
          <span>
            <Users size={17} />
            מרחב עבודה · ליד
          </span>
          <button className="icon" onClick={onClose} aria-label="סגירת כרטיס">
            <X />
          </button>
        </header>
        <div className="drawer-title">
          <Avatar name={l.name} />
          <div>
            <h2>{l.name}</h2>
            <span>
              {name("sources", l.source_id)} · נוסף {date(l.created_at)}
            </span>
          </div>
          <Badge color={l.stage === "won" ? "green" : "blue"}>
            {stages.find((x) => x.id === l.stage)?.name}
          </Badge>
        </div>
        <div className="drawer-actions">
          <button className="secondary" onClick={() => onEdit(l)}>
            עריכת פרטים
          </button>
          <button className="secondary" onClick={() => onTask(l.id)}>
            <Plus size={15} />
            משימה
          </button>
          <button className="secondary" onClick={() => onMessage(l.id)}>
            <Mail size={15} />
            מייל
          </button>
        </div>
        <div className="drawer-tabs">
          {[
            { id: "overview", label: "סקירה וקשרים" },
            { id: "tasks", label: `משימות (${tasks.length})` },
            { id: "messages", label: `הודעות (${messages.length})` },
          ].map((t) => (
            <button
              className={tab === t.id ? "active" : ""}
              key={t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="drawer-content">
          {tab === "overview" && (
            <>
              <h3>פרטי קשר ומכירה</h3>
              <div className="detail-grid">
                <span>
                  טלפון<strong dir="ltr">{l.phone || "—"}</strong>
                </span>
                <span>
                  מייל<strong>{l.email || "—"}</strong>
                </span>
                <span>
                  אחראי<strong>{name("members", l.assignee_id)}</strong>
                </span>
                <span>
                  קמפיין<strong>{name("campaigns", l.campaign_id)}</strong>
                </span>
                <span>
                  מקור<strong>{name("sources", l.source_id)}</strong>
                </span>
                <span>
                  חום
                  <strong>
                    {({ hot: "חם", warm: "פושר", cold: "קר" } as Row)[l.heat]}
                  </strong>
                </span>
              </div>
              <h3>הקורס והכיתה המקושרים</h3>
              <div className="linked-box">
                <BookOpen size={20} />
                <div>
                  <strong>{name("courses", l.course_id)}</strong>
                  <small>
                    {cl
                      ? `${cl.name} · מורה: ${name("members", cl.teacher_id)}`
                      : "טרם נבחרה כיתה"}
                  </small>
                </div>
                <Link2 size={16} />
              </div>
              {enrollment && (
                <div className="insight-banner">
                  <GraduationCap size={18} />
                  <span>
                    הרשמה פעילה ·{" "}
                    {
                      s.attendance.filter(
                        (a: Row) =>
                          a.enrollment_id === enrollment.id &&
                          ["present", "late"].includes(a.status),
                      ).length
                    }{" "}
                    מפגשים בהשתתפות ·{" "}
                    {
                      s.grades.filter(
                        (g: Row) => g.enrollment_id === enrollment.id,
                      ).length
                    }{" "}
                    ציונים
                  </span>
                </div>
              )}
              <h3>מידע מהשיחה</h3>
              <p className="note-text">
                {l.notes || "עדיין לא נוספו הערות מהשיחה."}
              </p>
              {s.fields
                .filter((f: Row) => f.entity_type === "lead")
                .map((f: Row) => (
                  <div className="detail-row" key={f.id}>
                    <span>{f.label}</span>
                    <strong>{String(parse(l.data)[f.id] ?? "—")}</strong>
                  </div>
                ))}
              <h3>הסכמה לדיוור</h3>
              <div className="detail-row">
                <Badge color={l.marketing_consent ? "green" : "gray"}>
                  {l.marketing_consent ? "הסכמה מתועדת" : "אין הסכמה שיווקית"}
                </Badge>
                {manager && (
                  <button
                    className="text-button"
                    onClick={() =>
                      showForm(
                        "תיעוד הסכמה",
                        [
                          {
                            key: "consent",
                            label: "סטטוס",
                            options: [
                              { value: "1", label: "אישור הסכמה" },
                              { value: "0", label: "ביטול הסכמה" },
                            ],
                            required: true,
                          },
                          {
                            key: "source",
                            label: "היכן ומתי ניתנה ההסכמה?",
                            required: true,
                          },
                          {
                            key: "text",
                            label: "הנוסח שאושר / פרטי הביטול",
                            type: "textarea",
                            required: true,
                          },
                        ],
                        async (v) =>
                          act(
                            "/leads/" + l.id + "/consent",
                            { ...v, consent: v.consent === "1" },
                            "PUT",
                          ),
                      )
                    }
                  >
                    עדכון תיעוד
                    <ArrowLeft size={14} />
                  </button>
                )}
              </div>
              {l.consent_at && (
                <p className="muted">
                  {datetime(l.consent_at)} · {l.consent_source}
                  <br />
                  {l.consent_text}
                </p>
              )}
              {s.relations.filter(
                (r: Row) =>
                  (r.from_type === "lead" && r.from_id === l.id) ||
                  (r.to_type === "lead" && r.to_id === l.id),
              ).length > 0 && (
                <>
                  <h3>קשרים נוספים</h3>
                  {s.relations
                    .filter((r: Row) => r.from_id === l.id || r.to_id === l.id)
                    .map((r: Row) => {
                      return (
                        <LinkedRecord
                          key={r.id}
                          s={s}
                          label={r.label}
                          type={r.from_id === l.id ? r.to_type : r.from_type}
                          rid={r.from_id === l.id ? r.to_id : r.from_id}
                        />
                      );
                    })}
                </>
              )}
              {s.activity.filter((a: Row) => a.lead_id === l.id).length > 0 && (
                <>
                  <h3>ציר פעילות</h3>
                  {s.activity
                    .filter((a: Row) => a.lead_id === l.id)
                    .map((a: Row) => (
                      <div className="timeline-item" key={a.id}>
                        <i />
                        <span>
                          {a.action}
                          <small>
                            {a.user_name} · {datetime(a.created_at)}
                          </small>
                        </span>
                      </div>
                    ))}
                </>
              )}
            </>
          )}
          {tab === "tasks" &&
            (tasks.length ? (
              tasks.map((t: Row) => (
                <TaskLine
                  key={t.id}
                  t={t}
                  name={name("members", t.assignee_id)}
                  onToggle={() =>
                    void perform(() =>
                      act("/tasks/" + t.id, { done: !t.done }, "PUT"),
                    )
                  }
                />
              ))
            ) : (
              <Empty
                title="מה הפעולה הבאה?"
                description="קבעו תזכורת לחזרה, שליחת מידע או שיחת המשך."
                action={
                  <button className="primary" onClick={() => onTask(l.id)}>
                    הוספת משימה
                    <Plus size={16} />
                  </button>
                }
              />
            ))}
          {tab === "messages" &&
            (messages.length ? (
              messages.map((m: Row) => (
                <article className="detail-message" key={m.id}>
                  <strong>{m.subject}</strong>
                  <small>
                    {m.direction === "in" ? "התקבל" : "יוצא"} ·{" "}
                    {datetime(m.created_at)} · {m.status}
                  </small>
                  <p>{m.body}</p>
                </article>
              ))
            ) : (
              <Empty
                title="כאן תישמר התקשורת"
                description="הודעות שנשלחו ותשובות שיתקבלו יישארו מחוברות לליד."
              />
            ))}
        </div>
      </section>
    </div>
  );
}
function Attendance({
  s,
  act,
  perform,
}: {
  s: Row;
  act: (p: string, b: any) => Promise<void>;
  perform: (f: () => Promise<any>) => Promise<void>;
}) {
  const [lessonId, setLesson] = useState(s.lessons[0]?.id || "");
  const lesson = s.lessons.find((l: Row) => l.id === lessonId);
  return (
    <div className="pad">
      <label>
        בחירת מפגש
        <select value={lessonId} onChange={(e) => setLesson(e.target.value)}>
          {s.lessons.map((l: Row) => (
            <option key={l.id} value={l.id}>
              {s.classes.find((c: Row) => c.id === l.class_id)?.name} ·{" "}
              {l.title} · {date(l.held_at)}
            </option>
          ))}
        </select>
      </label>
      {s.enrollments
        .filter((e: Row) => e.class_id === lesson?.class_id)
        .map((e: Row) => (
          <div className="detail-row" key={e.id}>
            <span>{e.name}</span>
            <select
              aria-label={"נוכחות " + e.name}
              value={
                s.attendance.find(
                  (a: Row) =>
                    a.lesson_id === lessonId && a.enrollment_id === e.id,
                )?.status || ""
              }
              onChange={(v) =>
                void perform(() =>
                  act("/attendance", {
                    lesson_id: lessonId,
                    enrollment_id: e.id,
                    status: v.target.value,
                  }),
                )
              }
            >
              <option value="" disabled>
                טרם סומן
              </option>
              <option value="present">נוכח/ת</option>
              <option value="absent">נעדר/ת</option>
              <option value="late">איחור</option>
              <option value="excused">היעדרות מוצדקת</option>
            </select>
          </div>
        ))}
    </div>
  );
}
function Reports({
  s,
  sum,
  showForm,
  act,
  opts,
  name,
}: {
  s: Row;
  sum: (k: string) => number;
  showForm: (t: string, f: Field[], s: (v: Row) => Promise<void>) => void;
  act: (p: string, b: any) => Promise<void>;
  opts: (l: string) => { value: string; label: string }[];
  name: (l: string, id: string) => string;
}) {
  const kinds: Row = {
    forecast: "תחזית הכנסה",
    booked: "עסקה סגורה",
    receipt: "תקבול בפועל",
    expense_plan: "הוצאה מתוכננת",
    expense: "הוצאה בפועל",
  };
  return (
    <>
      <div className="insight-banner">
        <BarChart3 size={20} />
        <span>
          הנתונים מוזנים ידנית כרגע. חיבור האקסלים יתווסף בהמשך; זה אינו תחליף
          למערכת חשבונאית.
        </span>
      </div>
      <div className="stats-grid">
        <Stat
          title="עסקאות סגורות"
          value={money(sum("booked"))}
          caption="התחייבויות שנרשמו, לא תקבולים"
          icon={<Target />}
          color="blue"
        />
        <Stat
          title="תקבולים בפועל"
          value={money(sum("receipt"))}
          caption="כסף שנגבה לפי הרישומים"
          icon={<BarChart3 />}
          color="green"
        />
        <Stat
          title="הוצאות בפועל"
          value={money(sum("expense"))}
          caption="לא כולל הוצאות מתוכננות"
          icon={<ArrowUpLeft />}
          color="orange"
        />
        <Stat
          title="יתרה תזרימית"
          value={money(sum("receipt") - sum("expense"))}
          caption="תקבולים פחות הוצאות בפועל"
          icon={<Building2 />}
          color="purple"
        />
      </div>
      <div className="section-title">
        <h2>רישומי תקציב וביצוע</h2>
        <button
          className="primary"
          onClick={() =>
            showForm(
              "רישום כספי",
              [
                { key: "title", label: "תיאור", required: true },
                {
                  key: "kind",
                  label: "סוג",
                  options: Object.entries(kinds).map(([value, label]) => ({
                    value,
                    label: String(label),
                  })),
                  required: true,
                },
                {
                  key: "amount",
                  label: "סכום בש״ח",
                  type: "number",
                  required: true,
                },
                {
                  key: "date",
                  label: "תאריך",
                  type: "date",
                  required: true,
                  value: new Date().toISOString().slice(0, 10),
                },
                {
                  key: "course_id",
                  label: "שיוך לקורס",
                  options: opts("courses"),
                },
                {
                  key: "campaign_id",
                  label: "שיוך לקמפיין",
                  options: opts("campaigns"),
                },
              ],
              async (v) =>
                act("/resources/finance", {
                  ...v,
                  course_id: v.course_id || null,
                  campaign_id: v.campaign_id || null,
                }),
            )
          }
        >
          <Plus size={16} />
          רישום חדש
        </button>
      </div>
      <section className="panel">
        {s.finance.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>תיאור</th>
                  <th>סוג</th>
                  <th>סכום</th>
                  <th>קורס</th>
                  <th>קמפיין</th>
                  <th>תאריך</th>
                </tr>
              </thead>
              <tbody>
                {s.finance.map((f: Row) => (
                  <tr key={f.id}>
                    <td>{f.title}</td>
                    <td>
                      <Badge>{kinds[f.kind]}</Badge>
                    </td>
                    <td>{money(f.amount)}</td>
                    <td>{name("courses", f.course_id)}</td>
                    <td>{name("campaigns", f.campaign_id)}</td>
                    <td>{date(f.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="תמונה אמינה מתחילה בנתונים"
            description="אין נתונים כספיים עדיין. אפשר להזין ידנית; לא נציג מספרים מומצאים."
          />
        )}
      </section>
      <div className="section-title">
        <h2>תוצאה תפעולית לפי קורס</h2>
        <span className="muted">
          עסקאות סגורות פחות הוצאות בפועל · לא רווח חשבונאי
        </span>
      </div>
      <section className="panel">
        {s.courses.map((c: Row) => {
          const finance = s.finance.filter((f: Row) => f.course_id === c.id),
            booked = finance
              .filter((f: Row) => f.kind === "booked")
              .reduce((a: number, f: Row) => a + f.amount, 0),
            cost = finance
              .filter((f: Row) => f.kind === "expense")
              .reduce((a: number, f: Row) => a + f.amount, 0);
          return (
            <div className="detail-row pad" key={c.id}>
              <strong>{c.name}</strong>
              <span>
                {money(booked)} עסקאות · {money(cost)} הוצאות
              </span>
              <Badge color={booked - cost >= 0 ? "green" : "orange"}>
                {money(booked - cost)}
              </Badge>
            </div>
          );
        })}
        {!s.courses.length && (
          <Empty
            title="אין קורסים להשוואה"
            description="הרישומים משויכים לקורס ולקמפיין כדי למדוד כל פעילות בנפרד."
          />
        )}
      </section>
    </>
  );
}
function LinkedRecord({
  s,
  type,
  rid,
  label,
}: {
  s: Row;
  type: string;
  rid: string;
  label: string;
}) {
  const tables: Row = {
    lead: "leads",
    course: "courses",
    class: "classes",
    campaign: "campaigns",
  };
  const record = (s[tables[type] || "records"] || []).find(
    (x: Row) => x.id === rid,
  );
  if (!record) return null;
  const values = parse(record.data);
  return (
    <details className="linked-record">
      <summary>
        <Link2 size={14} /> {label ? label + " · " : ""}
        {record.name || record.title}
      </summary>
      <div className="linked-record-body">
        {["email", "phone", "description", "notes"]
          .filter((k) => record[k])
          .map((k) => (
            <p key={k}>{record[k]}</p>
          ))}
        {record.course_id && (
          <p>
            קורס:{" "}
            {s.courses.find((c: Row) => c.id === record.course_id)?.name || "—"}
          </p>
        )}
        {record.teacher_id && (
          <p>
            מורה:{" "}
            {s.members.find((m: Row) => m.user_id === record.teacher_id)
              ?.name || "—"}
          </p>
        )}
        {s.fields
          .filter((f: Row) => f.entity_type === type)
          .map((f: Row) => (
            <div className="detail-row" key={f.id}>
              <span>{f.label}</span>
              <strong>{String(values[f.id] ?? "—")}</strong>
            </div>
          ))}
      </div>
    </details>
  );
}
function Entities({
  s,
  showForm,
  resourceForm,
  act,
  customFields,
  name,
}: {
  s: Row;
  showForm: (t: string, f: Field[], save: (v: Row) => Promise<void>) => void;
  resourceForm: (t: string) => void;
  act: (p: string, b: any) => Promise<void>;
  customFields: (t: string) => Field[];
  name: (l: string, id: string) => string;
}) {
  const [type, setType] = useState("");
  const current = type || s.entity_types[0]?.id;
  const records = s.records.filter((r: Row) => r.type_id === current);
  const all = [
    ...s.leads.map((r: Row) => ({
      value: `lead:${r.id}`,
      label: `ליד · ${r.name}`,
    })),
    ...s.courses.map((r: Row) => ({
      value: `course:${r.id}`,
      label: `קורס · ${r.name}`,
    })),
    ...s.classes.map((r: Row) => ({
      value: `class:${r.id}`,
      label: `כיתה · ${r.name}`,
    })),
    ...s.campaigns.map((r: Row) => ({
      value: `campaign:${r.id}`,
      label: `קמפיין · ${r.name}`,
    })),
    ...s.records.map((r: Row) => ({
      value: `${r.type_id}:${r.id}`,
      label: `${name("entity_types", r.type_id)} · ${r.title}`,
    })),
  ];
  return (
    <>
      <div className="insight-banner">
        <Link2 size={20} />
        <span>
          ישויות נוספות כמו שותפים, ארגונים או ספקים — עם שדות וקשרים לרשומות
          הקיימות.
        </span>
      </div>
      <div className="section-title">
        <select
          value={current || ""}
          onChange={(e) => setType(e.target.value)}
          aria-label="סוג ישות"
        >
          <option value="">בחירת ישות</option>
          {s.entity_types.map((t: Row) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <div className="button-group">
          <button className="secondary" onClick={() => resourceForm("fields")}>
            שדה מותאם
            <Plus size={15} />
          </button>
          {current && (
            <button
              className="primary"
              onClick={() =>
                showForm(
                  "רשומה חדשה",
                  [
                    { key: "title", label: "שם הרשומה", required: true },
                    ...customFields(current),
                  ],
                  async (v) =>
                    act("/resources/records", {
                      type_id: current,
                      title: v.title,
                      data: Object.fromEntries(
                        customFields(current).map((f) => [
                          f.key,
                          v[f.key] ?? null,
                        ]),
                      ),
                    }),
                )
              }
            >
              רשומה חדשה
              <Plus size={15} />
            </button>
          )}
        </div>
      </div>
      <section className="panel">
        {records.length ? (
          records.map((r: Row) => (
            <div className="record-card" key={r.id}>
              <h3>{r.title}</h3>
              {customFields(current).map((f) => (
                <div className="detail-row" key={f.key}>
                  <span>{f.label}</span>
                  <strong>{String(parse(r.data)[f.key] ?? "—")}</strong>
                </div>
              ))}
              {s.relations
                .filter(
                  (rel: Row) => rel.from_id === r.id || rel.to_id === r.id,
                )
                .map((rel: Row) => {
                  const incoming = rel.to_id === r.id;
                  return (
                    <LinkedRecord
                      key={rel.id}
                      s={s}
                      label={rel.label}
                      type={incoming ? rel.from_type : rel.to_type}
                      rid={incoming ? rel.from_id : rel.to_id}
                    />
                  );
                })}
              <button
                className="text-button"
                onClick={() =>
                  showForm(
                    "קישור לרשומה אחרת",
                    [
                      {
                        key: "target",
                        label: "הרשומה המקושרת",
                        options: all.filter(
                          (x) => x.value !== `${current}:${r.id}`,
                        ),
                        required: true,
                      },
                      { key: "label", label: "מה הקשר? למשל: שותף בקורס" },
                    ],
                    async (v) => {
                      const [to_type, to_id] = v.target.split(":");
                      await act("/relations", {
                        from_type: current,
                        from_id: r.id,
                        to_type,
                        to_id,
                        label: v.label || "",
                      });
                    },
                  )
                }
              >
                הוספת קשר
                <Link2 size={14} />
              </button>
            </div>
          ))
        ) : (
          <Empty
            title={
              s.entity_types.length
                ? "הישות מוכנה, אפשר להתחיל למלא"
                : "יש מקום גם לתהליך המיוחד שלכם"
            }
            description="הוסיפו סוג ישות, הגדירו שדות, וקשרו אותה ללידים, לקורסים או לכיתות."
            action={
              !s.entity_types.length && (
                <button
                  className="primary"
                  onClick={() => resourceForm("entity_types")}
                >
                  יצירת ישות
                  <Plus size={16} />
                </button>
              )
            }
          />
        )}
      </section>
    </>
  );
}
