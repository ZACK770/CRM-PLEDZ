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
    var els = document.querySelectorAll(".anchor");
    var h = document.body.scrollHeight;
    svg.setAttribute("height", h);
    svg.setAttribute("viewBox", "0 0 " + innerWidth + " " + h);
    function pt(el, spec) {
      if (!spec) return null;
      var v = spec.split(",").map(Number), r = el.getBoundingClientRect(), vb = el.viewBox.baseVal;
      var sx = r.width / vb.width, sy = r.height / vb.height, m = Math.hypot(v[2], v[3]) || 1;
      return { x: r.left + scrollX + v[0] * sx, y: r.top + scrollY + v[1] * sy, dx: v[2] / m, dy: v[3] / m };
    }
    var d = "", prev = null, first = null, last = null;
    [].forEach.call(els, function (el) {
      var io = (el.getAttribute("data-io") || "|").split("|"), a = pt(el, io[0]), b = pt(el, io[1]);
      if (prev && a) {
        var k = Math.min(170, Math.max(70, Math.hypot(a.x - prev.x, a.y - prev.y) * 0.38));
        d += "M" + prev.x + " " + prev.y + " C" + (prev.x + prev.dx * k) + " " + (prev.y + prev.dy * k) + " " + (a.x - a.dx * k) + " " + (a.y - a.dy * k) + " " + a.x + " " + a.y + " ";
        last = a;
      }
      if (b) { prev = b; if (!first) first = b; }
    });
    if (!first || !last) return;
    path.setAttribute("d", d);
    len = path.getTotalLength();
    path.style.strokeDasharray = len;
    y0 = first.y; y1 = last.y;
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
