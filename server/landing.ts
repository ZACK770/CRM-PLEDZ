type Station = { tone: string; num: string; name: string; text: string; facts: string[]; art: string };

const stations: Station[] = [
  {
    tone: "var(--rose)", num: "תחנה א׳", name: "שידוכים",
    text: "לראות שני אנשים, ולהבין מה יכול להיבנות ביניהם. מסלול למי שרוצה לעסוק בשידוכים מתוך הקשבה, אחריות ועדינות.",
    facts: ["16 מפגשים", "כארבעה חודשים"],
    art: `<path pathLength="1" d="M8 64C58 64 70 100 100 100S142 136 192 136"/><path pathLength="1" d="M8 136C58 136 70 100 100 100S142 64 192 64"/><circle class="dot" cx="100" cy="100" r="3.2"/>`,
  },
  {
    tone: "var(--gold)", num: "תחנה ב׳", name: "הדרכת כלות",
    text: "ללוות כלה אל הבית שהיא עומדת לבנות – בשפה נכונה, בחום ובצניעות, מתוך יראת שמים ורגישות.",
    facts: ["24 מפגשים", "כחצי שנה"],
    art: `<circle pathLength="1" cx="100" cy="112" r="46" transform="rotate(-90 100 112)"/><path pathLength="1" d="M100 66l-11-13 11-14 11 14z"/><path pathLength="1" d="M100 39V22M84 47l-9-8M116 47l9-8"/>`,
  },
  {
    tone: "var(--sage)", num: "תחנה ג׳", name: "ייעוץ זוגי",
    text: "כלים להקשבה, לשיח ולבניית אמון – כדי ללוות זוגות שרוצים לחזק את מה שכבר קיים ביניהם.",
    facts: ["28 מפגשים", "כשבעה חודשים"],
    art: `<path pathLength="1" d="M6 100C30 58 56 58 78 100S126 142 148 100 178 58 194 78"/><path pathLength="1" d="M6 100C30 142 56 142 78 100S126 58 148 100 178 142 194 122"/>`,
  },
  {
    tone: "var(--stone)", num: "תחנה ד׳", name: "הנחיית הורים",
    text: "להנחות אבות ואמהות בדרך החינוך – מתוך הבנה, סמכות רכה ואהבה, עם כלים שאפשר לקחת הביתה.",
    facts: ["24 מפגשים", "כחצי שנה"],
    art: `<path pathLength="1" d="M34 176V96c0-46 132-46 132 0v80"/><circle pathLength="1" cx="88" cy="140" r="22"/><circle pathLength="1" cx="128" cy="152" r="11"/><path class="base" pathLength="1" d="M12 176h176"/>`,
  },
];

const art = (inner: string, cls = "") =>
  `<svg class="art ${cls}" viewBox="0 0 200 200" aria-hidden="true"><circle class="bg" cx="100" cy="100" r="96"/>${inner}</svg>`;

export const womenPage = (opts: { preview: boolean; intakeKey?: string }) => `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>מכללת נשים · ארבעה מסלולי לימוד ממוקדים</title>
<meta name="description" content="מכללה לנשים: שידוכים, הדרכת כלות, ייעוץ זוגי והנחיית הורים.">
${opts.preview ? '<meta name="robots" content="noindex">' : ""}
<link rel="preload" href="/crm/lp/frank-he.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/crm/lp/assistant-he.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/crm/lp/women.css?v=1">
</head><body>
${opts.preview ? '<div class="draft">עמוד דוגמה · הטקסטים ממתינים לאישורך</div>' : ""}
<svg class="thread" aria-hidden="true"><path/></svg>
<header class="top"><div class="wrap"><a class="mark" href="#"><i></i>מכללת נשים</a>
<nav><a href="#paths">המסלולים</a><a href="#how">איך לומדים</a><a href="#join">לפרטים</a><button class="motion" type="button" aria-pressed="false">עצירת אנימציות</button></nav></div></header>
<main>
<section class="wrap hero">
<div>
<p class="kicker reveal">ארבעה מסלולי לימוד ממוקדים</p>
<h1><span class="l"><span>בית נארג</span></span><span class="l"><span>חוט אחר חוט.</span></span></h1>
<p class="lede reveal">מכללה לנשים שבוחרות ללוות אחרות ברגעים החשובים של הבית – מהשידוך, דרך החופה, אל הזוגיות וההורות.</p>
<a class="cta reveal" href="#join">לשיחת היכרות</a>
</div>
<svg class="art hero-art anchor" viewBox="0 0 400 400" aria-hidden="true"><path pathLength="1" d="M20 300C90 300 120 150 210 150S300 270 230 270 170 110 290 80 380 120 380 120"/><path pathLength="1" d="M60 340C140 340 170 230 250 230"/><circle class="dot" cx="230" cy="270" r="4"/></svg>
</section>

<section class="paths" id="paths"><div class="wrap">
<div class="sec-h reveal"><h2><small>המסלולים</small>ארבע תחנות,<br>חוט אחד.</h2>
<p>כל מסלול מתמקד בתחום אחד, ונלמד במסגרת מואצת של חודשים ספורים. אפשר להתחיל בתחנה אחת, ואפשר להמשיך הלאה.</p></div>
${stations
  .map(
    (s) => `<article class="station" style="--tone:${s.tone}">
<div class="s-art anchor">${art(s.art)}</div>
<div class="reveal"><div class="s-num">${s.num}</div><h3>${s.name}</h3><p>${s.text}</p>
<ul class="facts">${s.facts.map((f) => `<li>${f}</li>`).join("")}</ul></div></article>`,
  )
  .join("\n")}
</div></section>

<section class="how" id="how"><div class="wrap">
<div class="sec-h reveal"><h2><small>איך לומדים</small>בקצב שמתאים לבית.</h2></div>
<div class="grid">
<div class="reveal"><h4><b>01</b>מסלול ממוקד</h4><p>תחום אחד, לעומק, במסגרת של חודשים ספורים – בלי שנים של לימודים כלליים.</p></div>
<div class="reveal"><h4><b>02</b>קבוצה קטנה</h4><p>עד עשרים משתתפות במחזור, כדי שיהיה מקום לכל שאלה ולשיח אמיתי.</p></div>
<div class="reveal"><h4><b>03</b>שיחה לפני הכל</h4><p>לפני ההרשמה נשוחח, נכיר, ונבחר יחד את המסלול הנכון לך.</p></div>
</div></div></section>

<section class="join" id="join"><div class="wrap">
<div class="reveal"><h2>נשמח<br>להכיר.</h2><p class="intro">השאירי פרטים, ונחזור אלייך לשיחה קצרה על המסלולים, המועדים והתנאים.</p>
<svg class="art knot anchor" viewBox="0 0 200 200" aria-hidden="true"><circle class="bg" cx="100" cy="100" r="60"/><path pathLength="1" d="M4 128C52 128 86 70 112 76S128 120 102 116 90 74 126 72 170 128 196 128"/></svg></div>
<form class="reveal" data-intake="${opts.intakeKey || ""}" novalidate>
<div class="two"><div class="f"><input id="f-name" name="name" placeholder=" " autocomplete="name" required><label for="f-name">שם מלא</label></div>
<div class="f"><input id="f-phone" name="phone" type="tel" inputmode="tel" placeholder=" " autocomplete="tel" required><label for="f-phone">טלפון</label></div></div>
<div class="f"><input id="f-email" name="email" type="email" placeholder=" " autocomplete="email"><label for="f-email">דוא״ל (לא חובה)</label></div>
<div class="f"><select id="f-course" name="course"><option value="">עוד לא החלטתי</option>${stations.map((s) => `<option>${s.name}</option>`).join("")}</select><label for="f-course">המסלול שמעניין אותך</label></div>
<label class="consent"><input type="checkbox" name="consent" value="1"><span>אני מסכימה לקבל מהמכללה עדכונים ומידע שיווקי בדוא״ל ובטלפון. אפשר להסיר את ההסכמה בכל עת.</span></label>
<button class="cta send" type="submit">שליחת פרטים</button>
<p class="note" role="status" aria-live="polite"></p>
</form></div></section>
</main>
<footer><div class="wrap"><span>מכללת נשים · סוקולוב 43, בני ברק</span><a href="mailto:office@women.the-impact.net">office@women.the-impact.net</a></div></footer>
<script src="/crm/lp/women.js?v=1" defer></script>
</body></html>`;
