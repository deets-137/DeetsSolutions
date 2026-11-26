/* The section nav for a long page (Resume, Cool Stuff): DeetsHealth's
   nav.ts and picker.ts, 2026-11-22, as a scroll nav. Shared: one copy, each
   page that has a .section-nav loads it. The links are plain #anchors and jump without this
   file; this file marks the section in view and slides the pill onto its
   link. On a narrow screen the list becomes DeetsHealth's compact dropdown:
   one pill naming the section in view, its menu every section. Both are
   views of one list. No strings (the labels are the links'), no storage. */
(function () {
  "use strict";

  var nav = document.querySelector(".section-nav");
  if (!nav) return;
  var pill = nav.querySelector(".section-nav__pill");
  var links = Array.prototype.slice.call(nav.querySelectorAll(".section-nav__item"));
  var hrefs = links.map(function (a) { return a.getAttribute("href"); });
  var sections = hrefs.map(function (h) { return document.getElementById(h.slice(1)); });
  var current = -1;
  var held = -1;      // a clicked section stays chosen while the page scrolls to it
  var holdTimer = 0;
  // A clicked section near the page's foot can't scroll up to the line, so
  // after the jump it stays chosen until you scroll yourself.
  var pinned = -1;
  function unpin() { pinned = -1; }
  ["wheel", "touchstart", "keydown"].forEach(function (t) {
    window.addEventListener(t, unpin, { passive: true });
  });

  // ---- the compact dropdown (DeetsHealth's picker.ts). Built here so a
  // page without JS keeps the plain row of links.
  var pick = document.createElement("div");
  pick.className = "pick";
  pick.innerHTML =
    '<button class="pick__button" type="button" aria-expanded="false" aria-controls="section-pick-menu">' +
    '<span class="pick__name"></span><span class="pick__chev" aria-hidden="true">▾</span></button>' +
    '<ul class="pick__menu" id="section-pick-menu" hidden></ul>';
  var button = pick.querySelector(".pick__button");
  var nameEl = pick.querySelector(".pick__name");
  var menu = pick.querySelector(".pick__menu");
  var rows = links.map(function (a) {
    var li = document.createElement("li");
    var row = document.createElement("a");
    row.className = "pick__row";
    row.href = a.getAttribute("href");
    row.textContent = a.textContent;
    li.appendChild(row);
    menu.appendChild(li);
    return row;
  });
  nav.appendChild(pick);

  // On a narrow screen the dropdown is the right half of the header's
  // compact bar (controls.js builds it, and runs first: both scripts are
  // deferred, it is listed first). The nav then steps aside (.has-pick).
  // Wide again, the dropdown comes back here and waits, hidden.
  var compact = window.matchMedia("(max-width: 56rem)"); // chrome.css's compact bar
  function dock() {
    var aside = document.querySelector(".compact-bar__aside");
    var inBar = compact.matches && !!aside;
    if (inBar && pick.parentNode !== aside) aside.appendChild(pick);
    else if (!inBar && pick.parentNode !== nav) nav.appendChild(pick);
    nav.classList.toggle("has-pick", inBar);
  }
  dock();

  function openMenu(focus) {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    if (focus) (rows[current] || rows[0]).focus();
  }
  function closeMenu(refocus) {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (refocus) button.focus();
  }
  // e.detail is 0 for a keyboard press: then focus moves into the menu.
  button.addEventListener("click", function (e) {
    if (menu.hidden) openMenu(e.detail === 0);
    else closeMenu(false);
  });
  button.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openMenu(true); }
  });
  menu.addEventListener("keydown", function (e) {
    var at = rows.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); closeMenu(true); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      rows[(at + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length].focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      rows[e.key === "Home" ? 0 : rows.length - 1].focus();
    } else if (e.key === "Tab") closeMenu(false);
  });
  document.addEventListener("pointerdown", function (e) {
    if (!pick.contains(e.target)) closeMenu(false);
  });
  window.addEventListener("blur", function () { closeMenu(false); });
  // Across the line: an open menu closes, and the dropdown moves.
  compact.addEventListener("change", function () { closeMenu(false); dock(); });

  /** Moves the pill onto link i, in whole pixels. */
  function place(i, animate) {
    var a = links[i];
    if (!a || !a.offsetWidth) return; // the list is hidden (compact)
    pill.classList.toggle("no-anim", !animate);
    pill.style.width = a.offsetWidth + "px";
    pill.style.height = a.offsetHeight + "px";
    pill.style.transform = "translate(" + a.offsetLeft + "px, " + a.offsetTop + "px)";
    pill.classList.add("is-placed");
  }

  function choose(i) {
    if (i === current || i < 0) return;
    var first = current === -1;
    current = i;
    [links, rows].forEach(function (list) {
      list.forEach(function (a, j) {
        if (j === i) a.setAttribute("aria-current", "location");
        else a.removeAttribute("aria-current");
      });
    });
    nameEl.textContent = links[i].textContent;
    place(i, !first);
  }

  /** The section in view: the last one whose top has passed a line a third
   *  of the way down the window, or the last section at the page's foot. */
  function inView() {
    var line = window.innerHeight / 3;
    var atFoot = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (atFoot) return pinned !== -1 ? pinned : sections.length - 1;
    var at = 0;
    for (var i = 0; i < sections.length; i++) {
      if (sections[i] && sections[i].getBoundingClientRect().top <= line) at = i;
    }
    return at;
  }

  // Runs on every scroll event: five rect reads, and choose() does nothing
  // until the section changes. (Not batched into an animation frame: a
  // hidden tab runs none, and the nav would wake up stale.)
  function onScroll() {
    if (held !== -1) return;
    choose(inView());
  }

  // A link in the list or a row in the dropdown: the browser jumps (the
  // link is an #anchor); this only marks it.
  // The dropdown listens on its own: it may sit in the compact bar.
  nav.addEventListener("click", function (e) { onPick(e, e.target.closest(".section-nav__item")); });
  pick.addEventListener("click", function (e) {
    var row = e.target.closest(".pick__row");
    if (row) closeMenu(e.detail === 0);
    onPick(e, row);
  });
  function onPick(e, a) {
    if (!a) return;
    // The pill goes straight to the clicked link, not through every section
    // the smooth scroll passes; the scroll takes over again once it settles.
    held = hrefs.indexOf(a.getAttribute("href"));
    pinned = held;
    choose(held);
    clearTimeout(holdTimer);
    holdTimer = setTimeout(release, 1200);
  }

  function release() {
    held = -1;
    onScroll();
  }
  // Ends the hold as soon as the scroll stops, where the browser says so.
  window.addEventListener("scrollend", function () {
    if (held === -1) return;
    clearTimeout(holdTimer);
    release();
  });

  window.addEventListener("scroll", onScroll, { passive: true });
  // A new width moves every section without a scroll.
  window.addEventListener("resize", onScroll);
  // The nav's size changes with the window and between its two forms.
  new ResizeObserver(function () { place(current, false); }).observe(nav);

  // ---- the rail (re-dezine, 2026-11-23). From 82rem the site nav is a
  // column down the left edge (chrome.css, "The left rail"), and this list
  // moves into it, under the current page's link, so the page has one left
  // column, not two. Below 82rem it goes back to its place in the page.
  // The pages load this file with blocking="render", so the move happens
  // before the first frame: no jump, and the page transition (chrome.css)
  // captures the panel already finished.
  var RAIL = window.matchMedia("(min-width: 82rem)"); // chrome.css's rail breakpoint
  var layout = nav.parentNode;                         // .section-layout
  var home = document.createComment(" section-nav ");
  layout.insertBefore(home, nav);
  function seat() {
    var here = document.querySelector('.site-nav a[aria-current="page"]');
    if (RAIL.matches && here) {
      here.insertAdjacentElement("afterend", nav);
      nav.classList.add("in-rail");
      layout.classList.add("is-railed");
    } else if (nav.classList.contains("in-rail")) {
      layout.insertBefore(nav, home);
      nav.classList.remove("in-rail");
      layout.classList.remove("is-railed");
    }
    place(current, false);
  }
  RAIL.addEventListener("change", seat);

  var start = hrefs.indexOf(location.hash);
  choose(start !== -1 ? start : inView());
  seat();
})();
