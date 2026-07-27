/* Deets accounts — shared sign-in chrome (design: docs/accounts.md).

   One copy on every page, like controls.js and toast.js. It owns:
     - the profile (display name + seat colour) fetched from
       id.deets.solutions, cached in localStorage so navigating between
       pages doesn't flash a signed-out state on every load
     - the sign-in button injected into the Games nav dropdown
     - the cross-tab handshake that lets a sign-in completed in a NEW
       TAB light up the tab that started it

   Sign-in deliberately opens a new tab: the original tab is never
   navigated away from, so a live game socket survives signing in.

   Guests are first class. Nothing here gates anything — a signed-out
   visitor sees exactly the site they saw before accounts existed. */

(function () {
  "use strict";

  var API = "https://id.deets.solutions";
  var CACHE_KEY = "deets-account";
  var PING_KEY = "deets-account-ping";   // localStorage fallback signal
  var CHANNEL = "deets-account";

  /* ?mock mirrors the game transports' dev opt-out: the session cookie is
     scoped to .deets.solutions and is invisible to localhost, so real
     sign-in CANNOT work locally. This fakes the signed-in half so the
     button and the gate prefill can be iterated on without deploying.
     It does not exercise the OAuth handshake — that needs the real
     worker, same caveat as the games' disconnect handling. */
  var MOCK = /(\?|&)mock(&|=|$)/.test(location.search);
  var MOCK_USER = { id: "mock-user", name: "Deets", color: 0 };

  var state = null;      // null = unknown, false = signed out, object = user
  var listeners = [];
  var pending = false;

  /* ── tiny helpers (same shapes controls.js/toast.js use) ────────── */

  function load(key, fb) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fb : v; }
    catch (e) { return fb; }
  }
  function save(key, v) {
    try {
      if (v == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(v));
    } catch (e) {}
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function toast(msg, kind) {
    if (window.DeetsToast && window.DeetsToast.show) window.DeetsToast.show(msg, kind);
  }

  /* account-state sigils — the same anatomy as the radio account button
     (radio/radio.js): the icon IS the status, no separate status line. */
  var ICON_CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_X = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var ICON_SPINNER = '<span class="account-btn__spinner"></span>';

  /* ── the profile ────────────────────────────────────────────────── */

  function emit() {
    listeners.forEach(function (fn) { try { fn(state); } catch (e) {} });
  }
  function setState(next) {
    state = next;
    save(CACHE_KEY, next || null);
    emit();
  }

  function refresh() {
    if (MOCK) { setState(MOCK_USER); return Promise.resolve(MOCK_USER); }
    return fetch(API + "/me", { credentials: "include" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (u) { setState(u || false); return state; })
      .catch(function () {
        /* Network failure is NOT a sign-out — keep whatever the cache
           said rather than blanking a good session on a flaky hop. */
        if (state == null) setState(load(CACHE_KEY, false) || false);
        return state;
      });
  }

  function signIn() {
    if (MOCK) { setState(MOCK_USER); return; }
    var ret = location.origin + "/auth/done.html";
    /* window.open MUST be synchronous inside the click handler or the
       popup blocker eats it — nothing may be awaited before this line.

       NOT the "noopener" feature string: that makes open() return null
       even on success, which would make the blocked-tab toast fire on
       every sign-in. Instead the handle comes back real (so a genuine
       block is detectable) and the opener link is severed by hand while
       the tab is still same-origin about:blank — same isolation, working
       detection. */
    var w = window.open(
      API + "/login?return=" + encodeURIComponent(ret),
      "deets-signin");
    if (!w) {
      toast("Your browser blocked the sign-in tab. Allow popups for deets.solutions and try again.", "error");
      return;
    }
    try { w.opener = null; } catch (e) {}
    pending = true;
  }

  function signOut() {
    if (MOCK) { setState(false); return Promise.resolve(); }
    return fetch(API + "/logout", { method: "POST", credentials: "include" })
      .then(function () { setState(false); })
      .catch(function () { setState(false); });
  }

  /* ── cross-tab: the new tab tells this one it worked ────────────── */

  function onSignal() {
    if (!pending && state) return;
    pending = false;
    refresh();
  }

  try {
    if (window.BroadcastChannel) {
      var bc = new BroadcastChannel(CHANNEL);
      bc.addEventListener("message", function (e) {
        if (e && e.data && e.data.type === "signed-in") onSignal();
      });
    }
  } catch (e) {}

  /* Fallback for anything without BroadcastChannel — the site already
     listens for `storage` to sync theme/skin across tabs, so this is a
     pattern that exists here rather than a new trick. */
  window.addEventListener("storage", function (e) {
    if (e.key === PING_KEY && e.newValue) onSignal();
  });

  /* Coming back to a tab that was waiting on a sign-in finished
     elsewhere (phone, another window) — cheap catch-all. */
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && pending) onSignal();
  });

  /* ── the button ─────────────────────────────────────────────────── */

  function makeButton(cls) {
    var btn = el("button", cls);
    btn.type = "button";
    var label = el("span", "account-btn__label");
    var icon = el("span", "account-btn__icon");
    icon.setAttribute("aria-hidden", "true");
    btn.appendChild(label);
    btn.appendChild(icon);

    btn.addEventListener("click", function () {
      if (state) { paint(btn, "loading"); signOut(); }
      else { signIn(); paint(btn, "loading"); }
    });

    function paint(node, force) {
      var s = force || (state ? "in" : state === false ? "out" : "loading");
      /* Signed in, the label is your name — the useful thing to show.
         Signed out it's the invitation. (Radio's button keeps a fixed
         label because it has no name to show.) */
      label.textContent = s === "loading" ? "…" :
        s === "in" ? (state && state.name ? state.name : "Signed in") : "Sign in";
      icon.innerHTML = s === "in" ? ICON_CHECK : s === "out" ? ICON_X : ICON_SPINNER;
      if (s !== "loading") {
        node.dataset.state = s;
        node.setAttribute("aria-pressed", String(s === "in"));
      }
      node.disabled = s === "loading";
    }

    paint(btn);
    listeners.push(function () { paint(btn); });
    return btn;
  }

  /* Injected at runtime rather than written into markup: the nav is
     duplicated in every page's HTML, so a static button would need
     adding to all of them and keeping in sync forever. controls.js
     already establishes runtime nav injection. */
  function mount() {
    var groups = document.querySelectorAll(".nav-group");
    for (var i = 0; i < groups.length; i++) {
      var lbl = groups[i].querySelector(".nav-group__label");
      var menu = groups[i].querySelector(".nav-group__menu");
      if (!lbl || !menu) continue;
      if (!/^\s*Games/i.test(lbl.textContent || "")) continue;
      var item = makeButton("nav-group__item account-btn");
      item.setAttribute("role", "menuitem");
      menu.appendChild(item);
      break;
    }

    /* The mobile menu needs its own append: buildNavMenu() clones
       `a[data-nav-core]`, so a <button> never comes along for the ride
       and the control would silently vanish below the 56rem breakpoint. */
    var navMenu = document.querySelector(".nav-menu");
    if (navMenu) {
      var mItem = makeButton("nav-menu__item account-btn");
      mItem.setAttribute("role", "menuitem");
      navMenu.appendChild(mItem);
    }
  }

  /* ── public surface ─────────────────────────────────────────────── */

  window.DeetsAccount = {
    /* Synchronous best-guess for callers that need an answer NOW (the
       game gate prefills from this). null = not known yet. */
    get: function () { return state === null ? (load(CACHE_KEY, null) || null) : (state || null); },
    refresh: refresh,
    signIn: signIn,
    signOut: signOut,
    onChange: function (fn) { listeners.push(fn); fn(state); },
    /* Persist a profile edit. Callers pass {name} and/or {color}. */
    update: function (patch) {
      if (MOCK) {
        setState(Object.assign({}, state || MOCK_USER, patch));
        return Promise.resolve(state);
      }
      return fetch(API + "/me", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (u) { if (u) setState(u); return u; })
        .catch(function () { return null; });
    },
  };

  function init() {
    // Paint from cache first so there's no signed-out flash, then confirm.
    var cached = load(CACHE_KEY, null);
    if (cached) state = cached;
    mount();
    refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
