/* Copy editor — DEV ONLY. scripts/dev.js injects this into every HTML page
   it serves; nothing in the site loads it, so it can never reach Pages.

   A pill (bottom left, or Alt+E) turns edit mode on. Each piece of copy on
   screen is traced to where it lives, and becomes typeable:
   - a strings.js key: [data-s] nodes by name, and any other text that
     equals one key's value (a {token} matches anything). It shows the raw
     string, tokens included, and saves into strings.js.
   - the page's own HTML (pages with no strings.js, or inline text on ones
     that have it): text found exactly once in that file's body. It saves
     into the .html.
   Enter or clicking away saves; Esc reverts. Leaving edit mode reloads.
   [ph] strings get a dashed outline; text that maps to several places
   gets a dotted one and stays locked (its tooltip says where to edit).

   Never offered: the shared site header and settings menu (one copy per
   page — edit them in every page at once, not here), the resume (it
   mirrors his master resume and rebuilds a PDF), data rendered from JSON,
   alt text and placeholders, and anything a page draws after edit mode
   starts (toggle off and on again to pick it up). */
(function () {
  "use strict";

  if (window !== window.top) return;              // the DeetsMusic demo's app iframe
  if (/^\/resume\//.test(location.pathname)) return;

  var HTML_FILE = location.pathname.replace(/^\//, "");
  if (!/\.html$/.test(HTML_FILE)) HTML_FILE = HTML_FILE.replace(/\/?$/, "/").replace(/^\/$/, "") + "index.html";

  var tag = Array.prototype.find.call(document.scripts, function (t) {
    return /(^|\/)strings\.js(\?|$)/.test(t.getAttribute("src") || "");
  });
  var STR_FILE = tag ? new URL(tag.src).pathname.replace(/^\//, "") : null;
  var S = null;
  if (tag) {
    var named = Array.prototype.map.call(document.querySelectorAll("[data-s]"), function (n) { return n.getAttribute("data-s"); });
    S = Object.keys(window).filter(function (k) { return /_STRINGS$/.test(k) && window[k] && typeof window[k] === "object"; })
      .map(function (k) { return window[k]; })
      .sort(function (a, b) { return score(b) - score(a); })[0] || null;
    function score(o) { return named.filter(function (k) { return typeof o[k] === "string"; }).length + Object.keys(o).length / 1e4; }
  }

  var EXCLUDE = ".site-header, [data-settings], script, style, noscript, textarea, select, svg, .ce-pill";
  var on = false, saved = 0, recs = [], byHost = new Map();

  var css = document.createElement("style");
  css.textContent =
    ".ce-pill{position:fixed;left:var(--space-3);bottom:var(--space-3);z-index:2147483000;" +
    "font:inherit;font-family:var(--font-body);color:var(--text);background:var(--surface);" +
    "border:1px solid var(--border);border-radius:var(--radius-control);padding:var(--space-1) var(--space-2);cursor:pointer;opacity:.6}" +
    ".ce-pill:hover,.ce-pill[aria-pressed=true]{opacity:1}" +
    ".ce-pill[aria-pressed=true]{border-color:var(--title)}" +
    "[data-ce]{outline:1px solid var(--border);outline-offset:2px}" +
    "[data-ce=on],[data-ce=ph],[data-ce=ok],[data-ce=fail]{cursor:text;min-width:2ch}" +
    "[data-ce=ph]{outline-style:dashed;outline-color:var(--status-warn)}" +
    "[data-ce=dup]{outline-style:dotted;opacity:.7}" +
    "[data-ce]:focus{outline:2px solid var(--title)}" +
    "[data-ce=ok]{outline-color:var(--status-ok)}" +
    "[data-ce=fail]{outline:2px solid var(--status-fail)}";
  document.head.appendChild(css);

  var pill = document.createElement("button");
  pill.type = "button";
  pill.className = "ce-pill";
  pill.setAttribute("aria-pressed", "false");
  pill.title = "Dev only: type over this page's copy (Alt+E)";
  pill.textContent = "Edit copy";
  pill.addEventListener("click", toggle);
  document.body.appendChild(pill);

  document.addEventListener("keydown", function (e) {
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "e" || e.key === "E")) { e.preventDefault(); toggle(); }
  });

  function collapse(t) { return t.replace(/\s+/g, " ").trim(); }
  function esc(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // value → keys, and the {token} templates as patterns
  function keysFor(text) {
    if (!S) return [];
    var out = [];
    Object.keys(S).forEach(function (k) {
      var v = S[k];
      if (typeof v !== "string" || !v) return;
      if (v.indexOf("{") < 0) { if (collapse(v) === text) out.push(k); return; }
      if (!/[A-Za-z]{2}/.test(v.replace(/\{\w+\}/g, ""))) return;   // "{n}" alone would match anything
      var re = new RegExp("^" + esc(collapse(v)).replace(/\\\{\w+\\\}/g, "[\\s\\S]+?") + "$");
      if (re.test(text)) out.push(k);
    });
    return out;
  }

  // the element that holds exactly this text, or a span wrapped around it
  function hostFor(node) {
    var parent = node.parentNode;
    if (parent.childNodes.length === 1 && parent !== document.body) return { host: parent, wrap: null };
    var lead = node.nodeValue.match(/^\s*/)[0], trail = node.nodeValue.match(/\s*$/)[0];
    var span = document.createElement("span");
    span.textContent = node.nodeValue.slice(lead.length, node.nodeValue.length - trail.length);
    var frag = document.createDocumentFragment();
    if (lead) frag.appendChild(document.createTextNode(lead));
    frag.appendChild(span);
    if (trail) frag.appendChild(document.createTextNode(trail));
    var wrap = { original: node, parts: Array.prototype.slice.call(frag.childNodes) };
    parent.replaceChild(frag, node);
    return { host: span, wrap: wrap };
  }

  function editable(rec, raw) {
    var n = rec.host;
    rec.was = n.textContent;
    n.textContent = raw;
    rec.current = raw;
    try { n.contentEditable = "plaintext-only"; } catch (_) { n.contentEditable = "true"; }
    n.spellcheck = true;
    mark(rec);
  }

  function lock(rec, why) {
    rec.was = rec.host.textContent;
    rec.host.setAttribute("data-ce", "dup");
    rec.host.title = why;
  }

  function mark(rec) {
    var n = rec.host;
    n.setAttribute("data-ce", /^\[ph\]/.test(rec.current) ? "ph" : "on");
    n.title = rec.key ? STR_FILE + " › " + rec.key : HTML_FILE;
  }

  function add(rec) { recs.push(rec); byHost.set(rec.host, rec); return rec; }

  function start() {
    // 1. [data-s] nodes name their key
    if (S) document.querySelectorAll("[data-s]").forEach(function (n) {
      var key = n.getAttribute("data-s");
      if (typeof S[key] !== "string" || n.closest(EXCLUDE)) return;
      editable(add({ host: n, key: key }), S[key]);
    });

    // 2. every other text node: a strings value, or a probe of the HTML
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (t) {
        if (!/[A-Za-z0-9]/.test(t.nodeValue)) return NodeFilter.FILTER_REJECT;
        var p = t.parentElement;
        if (!p || p.closest(EXCLUDE) || p.closest("[data-ce]")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var texts = [];
    for (var t = walker.nextNode(); t; t = walker.nextNode()) texts.push(t);

    // The markup is checked first: text written into the .html lives there,
    // even when a strings.js value happens to read the same.
    var probe = texts.map(function (node) { return { node: node, text: collapse(node.nodeValue) }; });
    if (!probe.length) return done();
    fetch("/__copy/probe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: HTML_FILE, texts: probe.map(function (p) { return p.text; }) })
    }).then(function (r) { return r.json(); }).then(function (out) {
      if (!on) return;
      probe.forEach(function (p, i) {
        if (!p.node.parentNode) return;
        var count = out.counts[i] || 0;
        var keys = count ? [] : keysFor(p.text);
        if (!count && !keys.length) return;          // drawn from data: not copy
        var h = hostFor(p.node);
        var rec = add({ host: h.host, wrap: h.wrap, key: keys.length === 1 ? keys[0] : null });
        if (count === 1) editable(rec, p.text);
        else if (count > 1) lock(rec, "This text appears " + count + " times in " + HTML_FILE + " — edit it there.");
        else if (keys.length === 1) editable(rec, S[keys[0]]);
        else lock(rec, "Several strings.js keys read the same: " + keys.join(", ") + ". Edit it in " + STR_FILE + ".");
      });
      done();
    }).catch(done);
  }

  function done() {
    if (on && !recs.some(function (r) { return r.host.isContentEditable; })) pill.textContent = "Nothing editable here";
  }

  function stop() {
    if (saved) return location.reload();
    recs.slice().reverse().forEach(function (rec) {
      var n = rec.host;
      n.removeAttribute("data-ce");
      n.removeAttribute("contenteditable");
      n.removeAttribute("title");
      n.textContent = rec.was;
      if (rec.wrap && rec.wrap.parts[0].parentNode) {
        var parts = rec.wrap.parts;
        parts[0].parentNode.insertBefore(rec.wrap.original, parts[0]);
        parts.forEach(function (p) { p.parentNode.removeChild(p); });
      }
    });
    recs = [];
    byHost = new Map();
  }

  function toggle() {
    on = !on;
    pill.setAttribute("aria-pressed", String(on));
    pill.textContent = on ? "Done editing" : "Edit copy";
    if (on) start(); else stop();
  }

  function recOf(target) {
    var n = on && target.closest && target.closest("[data-ce]");
    var rec = n && byHost.get(n);
    return rec && rec.host.isContentEditable ? rec : null;
  }

  // links and buttons hold copy too: in edit mode a click places the caret
  document.addEventListener("click", function (e) {
    if (on && e.target.closest && e.target.closest("[data-ce]")) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  document.addEventListener("keydown", function (e) {
    var rec = recOf(e.target);
    if (!rec) return;
    if (e.key === "Enter") { e.preventDefault(); rec.host.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); rec.host.textContent = rec.current; rec.host.blur(); }
    else if (e.key === " " && rec.host.closest("button, a, summary")) {
      // Firefox swallows a space typed inside a <button>
      e.preventDefault();
      document.execCommand("insertText", false, " ");
    }
    e.stopPropagation();
  }, true);

  document.addEventListener("focusout", function (e) {
    var rec = recOf(e.target);
    if (!rec) return;
    var value = rec.host.textContent.replace(/\s*\n\s*/g, " ");
    if (value === rec.current) return;
    if (!value.trim()) { rec.host.textContent = rec.current; return; }
    var req = rec.key
      ? { url: "/__copy/save", body: { file: STR_FILE, key: rec.key, value: value } }
      : { url: "/__copy/save-html", body: { file: HTML_FILE, old: rec.current, value: value } };
    fetch(req.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req.body)
    }).then(function (r) { return r.json(); }).then(function (out) {
      if (!out.ok) throw new Error(out.error);
      saved++;
      if (rec.key) S[rec.key] = value;
      var same = rec.key ? recs.filter(function (r) { return r.key === rec.key; }) : [rec];
      same.forEach(function (r) {
        r.current = value;
        if (r !== rec) r.host.textContent = value;
        r.host.setAttribute("data-ce", "ok");
        setTimeout(function () { mark(r); }, 900);
      });
    }).catch(function (err) {
      rec.host.setAttribute("data-ce", "fail");
      rec.host.title = "Not saved: " + err.message;
      console.warn("copy-edit: not saved:", err.message);
    });
  });
})();
