(function () {
  var root = document.documentElement;
  var btn = document.querySelector(".motion");
  var still = localStorage.getItem("lp-still") === "1" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  function setStill(v) {
    still = v;
    root.classList.toggle("still", v);
    if (btn) { btn.setAttribute("aria-pressed", String(v)); btn.textContent = v ? "הפעלת אנימציות" : "עצירת אנימציות"; }
    draw();
  }
  if (btn) btn.addEventListener("click", function () { localStorage.setItem("lp-still", still ? "0" : "1"); setStill(!still); });

  var svg = document.querySelector(".thread");
  var path = svg && svg.querySelector("path");
  var len = 0, y0 = 0, y1 = 1;
  function build() {
    if (!path) return;
    var pts = [].map.call(document.querySelectorAll(".anchor"), function (el) {
      var r = el.getBoundingClientRect();
      return [r.left + r.width / 2 + scrollX, r.top + r.height / 2 + scrollY];
    });
    var h = document.body.scrollHeight;
    svg.setAttribute("height", h);
    svg.setAttribute("viewBox", "0 0 " + innerWidth + " " + h);
    if (pts.length < 2) return;
    var d = "M" + pts[0][0] + " " + pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], dy = (b[1] - a[1]) * 0.55;
      d += " C" + a[0] + " " + (a[1] + dy) + " " + b[0] + " " + (b[1] - dy) + " " + b[0] + " " + b[1];
    }
    path.setAttribute("d", d);
    len = path.getTotalLength();
    path.style.strokeDasharray = len;
    y0 = pts[0][1]; y1 = pts[pts.length - 1][1];
    draw();
  }
  function draw() {
    if (!path || !len) return;
    var p = still ? 1 : Math.min(1, Math.max(0, (scrollY + innerHeight * 0.62 - y0) / (y1 - y0)));
    path.style.strokeDashoffset = len * (1 - p);
  }
  var top = document.querySelector(".top");
  addEventListener("scroll", function () { draw(); if (top) top.classList.toggle("scrolled", scrollY > 10); }, { passive: true });
  addEventListener("resize", build);
  addEventListener("load", build);
  if (document.fonts) document.fonts.ready.then(build);

  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { rootMargin: "0px 0px -12% 0px" });
  document.querySelectorAll(".reveal,.art").forEach(function (el) { io.observe(el); });

  var form = document.querySelector("form[data-intake]");
  if (form) form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var note = form.querySelector(".note");
    var f = new FormData(form);
    note.className = "note";
    if (!String(f.get("name") || "").trim() || !String(f.get("phone") || "").trim()) {
      note.className = "note err"; note.textContent = "נשמח לשם ולמספר טלפון כדי שנוכל לחזור אלייך."; return;
    }
    var key = form.getAttribute("data-intake");
    if (!key) { note.className = "note ok"; note.textContent = "זהו עמוד דוגמה – הטופס עדיין אינו שולח פרטים."; return; }
    var consent = form.querySelector("[name=consent]");
    f.set("consent", consent.checked ? "1" : "0");
    if (consent.checked) f.set("consent_text", consent.parentNode.textContent.trim());
    f.set("event_id", "lp:" + Date.now() + ":" + Math.random().toString(36).slice(2));
    f.set("key", key);
    var b = form.querySelector("button"); b.disabled = true;
    fetch("/crm/api/intake", { method: "POST", body: f }).then(function (r) {
      if (!r.ok) throw 0;
      form.reset(); note.className = "note ok"; note.textContent = "תודה, הפרטים התקבלו. ניצור קשר בהקדם.";
    }).catch(function () {
      note.className = "note err"; note.textContent = "משהו השתבש בשליחה. אפשר לנסות שוב, או לכתוב לנו למייל.";
    }).finally(function () { b.disabled = false; });
  });

  setStill(still);
  requestAnimationFrame(function () { root.classList.add("ready"); build(); });
})();
