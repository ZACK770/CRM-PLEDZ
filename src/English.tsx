import { useEffect, useState } from "react";
type Row = Record<string, any>;
const ils = (v: number) => "₪" + Math.round(v || 0).toLocaleString("he-IL");
const num = (v: number, d = 0) => (v || 0).toLocaleString("he-IL", { maximumFractionDigits: d });
const date = (v?: string) => (v ? new Date(v).toLocaleDateString("he-IL") : "—");
const colors: Row = { free: "gray", capped: "orange", paying: "green", low_balance: "orange", ended: "purple", churned: "gray" };
const modes: Row = { free: "חינם", basic: "בסיסי", paid: "בתשלום", blocked: "נחסם", unrestricted: "ללא הגבלה" };
const products: Row = { school: "בית הספר", translator: "מתרגם" };
async function get(path: string) {
  const res = await fetch(import.meta.env.BASE_URL + "api" + path);
  const d = (await res.json()) as Row;
  if (!res.ok) throw new Error(d.error || "הטעינה נכשלה");
  return d as Row;
}
function Status({ s, labels }: { s: string; labels: Row }) {
  return <span className={"badge " + (colors[s] || "gray")}>{labels[s] || s}</span>;
}
function Card({ title, value, caption }: { title: string; value: string; caption: string }) {
  return (
    <section className="stat">
      <div><span>{title}</span></div>
      <strong>{value}</strong>
      <small>{caption}</small>
    </section>
  );
}
export function English({ ws, view }: { ws: string; view: string }) {
  const [d, setD] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [open, setOpen] = useState<Row | null>(null);
  useEffect(() => {
    get(`/w/${ws}/en/overview`).then(setD, (e) => setError(e.message));
  }, [ws]);
  if (error) return <div className="error-banner" role="alert">{error}</div>;
  if (!d) return <div className="loading">טוען את נתוני בית הספר…</div>;
  const labels = d.labels as Row,
    month = new Date().toISOString().slice(0, 7),
    sale = d.sales.find((r: Row) => r.month === month) || {},
    use = d.usage.find((r: Row) => r.month === month) || {},
    count = (k: string) => d.statuses.find((r: Row) => r.status === k)?.n || 0,
    f = d.funnel || {},
    aiIls = (use.cost_usd || 0) * d.usd_ils,
    pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + "%" : "—");
  const openCard = (id: string) => get(`/w/${ws}/en/subscribers/${encodeURIComponent(id)}`).then(setOpen, (e) => setError(e.message));
  if (open)
    return (
      <section className="panel">
        <header className="panel-header">
          <div>
            <h2>{open.subscriber.name}</h2>
            <p>{open.subscriber.phone} {open.subscriber.email && "· " + open.subscriber.email}</p>
          </div>
          <button className="secondary" onClick={() => setOpen(null)}>חזרה לרשימה</button>
        </header>
        <p><Status s={open.subscriber.status} labels={labels} /> · הצטרף {date(open.subscriber.created_at)} · שיחה אחרונה {date(open.subscriber.last_call_at)}</p>
        <h3>חבילות ותשלומים</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>תאריך</th><th>חבילה</th><th>מוצר</th><th>סכום</th><th>דקות</th><th>נשארו</th><th>בתוקף עד</th></tr></thead>
          <tbody>{open.purchases.map((p: Row) => (
            <tr key={p.id}><td>{date(p.created_at)}</td><td>{p.package_name}</td><td>{products[p.product]}</td><td>{ils(p.amount)}</td><td>{p.minutes}</td><td>{num(Math.max(0, p.remaining_minutes))}</td><td>{date(p.expires_at)}</td></tr>
          ))}</tbody>
        </table></div>
        {!open.purchases.length && <p>עדיין לא רכש חבילה.</p>}
        <h3>שיחות</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>תאריך</th><th>מוצר</th><th>מצב</th><th>דקות</th><th>עלות AI</th></tr></thead>
          <tbody>{open.calls.map((k: Row) => (
            <tr key={k.call_id}><td>{new Date(k.started_at).toLocaleString("he-IL")}</td><td>{products[k.product] || k.product || "—"}</td><td>{modes[k.mode] || k.mode || "—"}</td><td>{num(k.seconds / 60, 1)}</td><td>{ils(k.cost_usd * d.usd_ils)}</td></tr>
          ))}</tbody>
        </table></div>
      </section>
    );
  if (view === "packages")
    return (
      <section className="panel">
        <header className="panel-header"><div><h2>חבילות ומחירים</h2><p>מסונכרן מהמערכת הטלפונית. עריכה מכאן תגיע בשלב הבא.</p></div></header>
        <div className="table-wrap"><table>
          <thead><tr><th>חבילה</th><th>מוצר</th><th>דקות</th><th>מחיר</th><th>מחיר לדקה</th><th>תוקף</th><th>מצב</th></tr></thead>
          <tbody>{d.packages.map((p: Row) => (
            <tr key={p.id}><td>{p.name}</td><td>{products[p.product]}</td><td>{p.minutes}</td><td>{ils(p.price)}</td><td>₪{num(p.price / Math.max(1, p.minutes), 2)}</td><td>{p.validity_days} יום</td><td>{p.active ? <span className="badge green">פעילה</span> : <span className="badge gray">כבויה</span>}</td></tr>
          ))}</tbody>
        </table></div>
      </section>
    );
  if (view === "subscribers") {
    const list = d.subscribers.filter(
      (s: Row) => (!status || s.status === status) && (!q || [s.name, s.phone, s.email].some((v) => String(v || "").includes(q))),
    );
    return (
      <section className="panel">
        <header className="panel-header"><div><h2>מנויים ושימוש</h2><p>כל מתקשר נכנס לבד. השלב מתעדכן אוטומטית לפי שיחות ותשלומים.</p></div></header>
        <div className="toolbar">
          <div className="search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי טלפון, שם או מייל…" aria-label="חיפוש" /></div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="סינון לפי שלב">
            <option value="">כל השלבים ({d.subscribers.length})</option>
            {Object.entries(labels).map(([k, v]) => <option key={k} value={k}>{v as string} ({count(k)})</option>)}
          </select>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>לקוח</th><th>שלב</th><th>יתרת דקות</th><th>בתוקף עד</th><th>חבילה אחרונה</th><th>שולם בסה"כ</th><th>דקות החודש</th><th>שיחה אחרונה</th></tr></thead>
          <tbody>{list.map((s: Row) => (
            <tr key={s.lead_id} className="clickable" onClick={() => void openCard(s.lead_id)}>
              <td><strong>{s.name}</strong><br /><small>{s.phone}</small></td><td><Status s={s.status} labels={labels} /></td><td>{num(s.balance_minutes)}</td><td>{date(s.expires_at)}</td><td>{s.last_package || "—"}</td><td>{ils(s.total_paid)}</td><td>{num(s.minutes_month, 1)}</td><td>{date(s.last_call_at)}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {!list.length && <p>אין מנויים בסינון הזה.</p>}
      </section>
    );
  }
  return (
    <>
      <div className="stats-grid">
        <Card title="הכנסה נטו החודש" value={ils(sale.net)} caption={`${sale.purchases || 0} רכישות · ${sale.payers || 0} משלמים`} />
        <Card title="משלמים פעילים" value={num(count("paying") + count("low_balance"))} caption={`${count("low_balance")} ביתרה נמוכה`} />
        <Card title="עלות AI החודש" value={ils(aiIls)} caption={`רווח גולמי ${ils((sale.net || 0) - aiIls)}`} />
        <Card title="עלות המתרגם החינמי" value={ils((use.free_cost_usd || 0) * d.usd_ils)} caption={`${num(use.free_minutes)} דקות חינם · עלות פרסום`} />
      </div>
      <div className="stats-grid">
        <Card title="נכנסו למשפך" value={num(f.total)} caption="כל המתקשרים" />
        <Card title="נתקעו בתקרה" value={num(f.reached_cap)} caption={pct(f.reached_cap, f.total) + " מהנכנסים"} />
        <Card title="קנו חבילה" value={num(f.paid)} caption={pct(f.paid, f.total) + " המרה כוללת"} />
        <Card title="קנו שוב" value={num(f.repeat)} caption={pct(f.repeat, f.paid) + " מהקונים"} />
      </div>
      <section className="panel">
        <header className="panel-header"><div><h2>לפי חודש</h2><p>עלויות AI משוערות לפי שער {d.usd_ils} ₪ לדולר.</p></div></header>
        <div className="table-wrap"><table>
          <thead><tr><th>חודש</th><th>מצטרפים</th><th>מתקשרים</th><th>דקות</th><th>הכנסה נטו</th><th>בית ספר</th><th>מתרגם</th><th>רכישות חוזרות</th><th>עלות AI</th><th>רווח גולמי</th></tr></thead>
          <tbody>{Array.from(new Set([...d.sales, ...d.usage, ...d.joined].map((r: Row) => r.month as string))).sort().reverse().map((m) => {
            const a = d.sales.find((r: Row) => r.month === m) || {},
              u = d.usage.find((r: Row) => r.month === m) || {},
              j = d.joined.find((r: Row) => r.month === m) || {};
            return (
              <tr key={m}><td>{m}</td><td>{num(j.n)}</td><td>{num(u.callers)}</td><td>{num(u.minutes)}</td><td>{ils(a.net)}</td><td>{ils(a.school_net)}</td><td>{ils(a.translator_net)}</td><td>{num(a.repeat_purchases)}</td><td>{ils((u.cost_usd || 0) * d.usd_ils)}</td><td>{ils((a.net || 0) - (u.cost_usd || 0) * d.usd_ils)}</td></tr>
            );
          })}</tbody>
        </table></div>
      </section>
      <section className="panel">
        <header className="panel-header"><div><h2>לקוחות לפי שלב</h2><p>הקהלים האלה זמינים בפלטפורמת הדיוור (שדה "שלב").</p></div></header>
        <div className="stats-grid">{Object.entries(labels).map(([k, v]) => <Card key={k} title={v as string} value={num(count(k))} caption="לקוחות" />)}</div>
      </section>
    </>
  );
}
