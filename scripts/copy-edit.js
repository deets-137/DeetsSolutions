/* Copy editor — DEV ONLY. scripts/dev.js injects this into every HTML page
   it serves; nothing in the site loads it, so it can never reach Pages.

   On a page whose markup fills its copy from strings.js via [data-s], a
   pill (bottom left, or Alt+E) turns edit mode on: every [data-s] node
   shows its raw string, {tokens} included, and becomes typeable. Enter or
   clicking away saves that one key straight into the page's strings.js
   (POST /__copy/save); Esc reverts. Leaving edit mode reloads the page so
   tokens fill again. Strings still carrying [ph] get a dashed outline.

   Only [data-s] text is reachable this way: strings JS renders at runtime
   (status lines, board rows) and nodes that are hidden stay in strings.js. */
(function () {
  "use strict";

  var nodes = document.querySelectorAll("[data-s]");
  var tag = Array.prototype.find.call(document.scripts, function (t) {
    return /\/strings\.js(\?|$)/.test(t.getAttribute("src") || "");
  });
  if (!nodes.length || !tag) return;

  var FILE = new URL(tag.src).pathname.replace(/^\//, "");
  var keys = Array.prototype.map.call(nodes, function (n) { return n.getAttribute("data-s"); });
  // the page's strings object: the window.*_STRINGS that holds its keys
  var S = Object.keys(window).filter(function (k) { return /_STRINGS$/.test(k); })
    .map(function (k) { return window[k]; })
    .sort(function (a, b) { return hits(b) - hits(a); })[0];
  function hits(o) { return keys.filter(function (k) { return typeof o[k] === "string"; }).length; }
  if (!S || !hits(S)) return;

  var on = false, saved = 0, shown = [];

  var css = document.createElement("style");
  css.textContent =
    ".ce-pill{position:fixed;left:var(--space-3);bottom:var(--space-3);z-index:2147483000;" +
    "font:inherit;font-family:var(--font-body);color:var(--text);background:var(--surface);" +
    "border:1px solid var(--border);border-radius:var(--radius-control);padding:var(--space-1) var(--space-2);cursor:pointer;opacity:.6}" +
    ".ce-pill:hover,.ce-pill[aria-pressed=true]{opacity:1}" +
    ".ce-pill[aria-pressed=true]{border-color:var(--title)}" +
    "[data-ce]{outline:1px solid var(--border);outline-offset:2px;cursor:text;min-width:2ch;display:inline-block}" +
    "[data-ce=ph]{outline-style:dashed;outline-color:var(--status-warn)}" +
    "[data-ce]:focus{outline:2px solid var(--title)}" +
    "[data-ce=ok]{outline-color:var(--status-ok)}" +
    "[data-ce=fail]{outline:2px solid var(--status-fail)}";
  document.head.appendChild(css);

  var pill = document.createElement("button");
  pill.type = "button";
  pill.className = "ce-pill";
  pill.setAttribute("aria-pressed", "false");
  pill.title = "Dev only: type over this page's copy (Alt+E). Saves to " + FILE;
  pill.textContent = "Edit copy";
  pill.addEventListener("click", toggle);
  document.body.appendChild(pill);

  document.addEventListener("keydown", function (e) {
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "e" || e.key === "E")) { e.preventDefault(); toggle(); }
  });

  function mark(n) { n.setAttribute("data-ce", /^\[ph\]/.test(S[n.getAttribute("data-s")]) ? "ph" : "on"); }

  function toggle() {
    on = !on;
    pill.setAttribute("aria-pressed", String(on));
    pill.textContent = on ? "Done editing" : "Edit copy";
    if (!on) {
      if (saved) return location.reload();
      shown.forEach(function (n) { n.textContent = n.__ceWas; n.removeAttribute("data-ce"); n.removeAttribute("contenteditable"); });
      shown = [];
      return;
    }
    document.querySelectorAll("[data-s]").forEach(function (n) {
      var key = n.getAttribute("data-s");
      if (typeof S[key] !== "string") return;
      n.__ceWas = n.textContent;
      n.textContent = S[key];
      try { n.contentEditable = "plaintext-only"; } catch (_) { n.contentEditable = "true"; }
      n.spellcheck = true;
      n.title = key;
      mark(n);
      shown.push(n);
    });
  }

  // links and buttons hold copy too: in edit mode a click places the caret
  document.addEventListener("click", function (e) {
    if (on && e.target.closest && e.target.closest("[data-ce]")) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  document.addEventListener("keydown", function (e) {
    var n = on && e.target.closest && e.target.closest("[data-ce]");
    if (!n) return;
    if (e.key === "Enter") { e.preventDefault(); n.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); n.textContent = S[n.getAttribute("data-s")]; n.blur(); }
    else if (e.key === " " && n.closest("button, a, summary")) {
      // Firefox swallows a space typed inside a <button>
      e.preventDefault();
      document.execCommand("insertText", false, " ");
    }
    e.stopPropagation();
  }, true);

  document.addEventListener("focusout", function (e) {
    var n = on && e.target.closest && e.target.closest("[data-ce]");
    if (!n) return;
    var key = n.getAttribute("data-s");
    var value = n.textContent.replace(/\s*\n\s*/g, " ");
    if (value === S[key]) return;
    fetch("/__copy/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: FILE, key: key, value: value })
    }).then(function (r) { return r.json(); }).then(function (out) {
      if (!out.ok) throw new Error(out.error);
      S[key] = value;
      saved++;
      shown.forEach(function (m) {
        if (m.getAttribute("data-s") !== key) return;
        if (m !== n) m.textContent = value;
        m.setAttribute("data-ce", "ok");
        setTimeout(function () { mark(m); }, 900);
      });
    }).catch(function (err) {
      n.setAttribute("data-ce", "fail");
      n.title = key + " — not saved: " + err.message;
      console.warn("copy-edit: " + key + " not saved:", err.message);
    });
  });
})();
