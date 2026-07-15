/* DeetsToast — the site's shared toast host (docs/ui.md, "Toasts").
   Shared chrome like controls.js, deliberately NOT part of the
   toolbar/popover kit the page scripts duplicate: a toast has no
   page-specific logic, so one copy serves every tab.

   window.DeetsToast.push({ kind, text, sticky, timeout, actions })
     kind     "info" | "success" | "warn" | "error"  (info default) —
              success/warn/error wear the theme's traffic-light roles
              (--go / --pause / --stop), info stays neutral
     text     the message — callers own their copy (the radio page feeds
              strings.js entries); this module ships none of its own
     sticky   true = no timer, stays until dismissed (give it an action)
     timeout  ms for timed toasts (default 3200; hover pauses the clock)
     actions  [{ label, onPick }] — buttons; any press dismisses after
              its onPick runs (a bare { label } is a plain Dismiss)
   returns { dismiss } so a caller can retire its own toast (the radio
   page's disconnected toast dies on reconnect). */
(function () {
  "use strict";

  var CAP = 4;              // stacked toasts; oldest timed one yields first
  var DEFAULT_MS = 3200;
  var host = null;

  function ensureHost() {
    if (host) return host;
    host = document.createElement("div");
    host.className = "toast-host";
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
    return host;
  }

  function push(opts) {
    opts = opts || {};
    ensureHost();

    var el = document.createElement("div");
    var kind = opts.kind === "success" || opts.kind === "warn" ||
               opts.kind === "error" ? opts.kind : "info";
    el.className = "toast toast--" + kind;
    el.setAttribute("role", kind === "error" ? "alert" : "status");

    var text = document.createElement("p");
    text.className = "toast__text";
    text.textContent = opts.text == null ? "" : String(opts.text);
    el.appendChild(text);

    var gone = false;
    var timer = null;
    var deadline = 0;
    var remaining = 0;
    function dismiss() {
      if (gone) return;
      gone = true;
      if (timer) { clearTimeout(timer); timer = null; }
      el.classList.add("toast--out");
      var reap = function () { if (el.parentNode) el.parentNode.removeChild(el); };
      el.addEventListener("transitionend", reap);
      setTimeout(reap, 600);           // transition lost? reap anyway
    }

    if (opts.actions && opts.actions.length) {
      var row = document.createElement("div");
      row.className = "toast__actions";
      opts.actions.forEach(function (a) {
        if (!a || !a.label) return;
        var b = document.createElement("button");
        b.type = "button";
        b.className = "tb-pill toast__btn";
        var lbl = document.createElement("span");
        lbl.className = "tb-pill__label";
        lbl.textContent = a.label;
        b.appendChild(lbl);
        b.addEventListener("click", function () {
          try { if (a.onPick) a.onPick(); } catch (e) {}
          dismiss();
        });
        row.appendChild(b);
      });
      el.appendChild(row);
    }

    if (!opts.sticky) {
      var ms = opts.timeout > 0 ? opts.timeout : DEFAULT_MS;
      var bar = document.createElement("div");
      bar.className = "toast__bar";
      bar.style.animationDuration = ms + "ms";
      el.appendChild(bar);
      remaining = ms;
      deadline = Date.now() + ms;
      timer = setTimeout(dismiss, ms);
      /* hover holds the clock — CSS pauses the bar, this pauses the reap */
      el.addEventListener("mouseenter", function () {
        if (gone || !timer) return;
        clearTimeout(timer);
        timer = null;
        remaining = Math.max(400, deadline - Date.now());
      });
      el.addEventListener("mouseleave", function () {
        if (gone || timer) return;
        deadline = Date.now() + remaining;
        timer = setTimeout(dismiss, remaining);
      });
    }

    /* newest on top; past the cap the oldest timed toast yields
       (sticky ones only go when nothing timed is left to shed) */
    while (host.children.length >= CAP) {
      var kids = host.children;
      var victim = null;
      for (var i = kids.length - 1; i >= 0; i--) {
        if (!kids[i].querySelector(".toast__bar")) continue;
        victim = kids[i];
        break;
      }
      var reaped = victim || kids[kids.length - 1];
      if (reaped.parentNode) reaped.parentNode.removeChild(reaped);
    }
    host.insertBefore(el, host.firstChild);

    return { dismiss: dismiss };
  }

  window.DeetsToast = { push: push };
})();
