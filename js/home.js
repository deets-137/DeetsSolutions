/* Home — live teasers on the section cards.
   Reads the same generated JSONs the journal pages render
   (sotd/songs.json, movies/movies.json) and fills each card's
   [data-live] line with a count + latest entry. Purely additive:
   if a fetch fails, the static fallback copy simply stays. */
(function () {
  function fill(key, text) {
    var el = document.querySelector('[data-live="' + key + '"]');
    if (el && text) el.textContent = text;
  }

  function latestBy(list, dateKey) {
    return list.reduce(function (best, item) {
      var d = item[dateKey] || "";
      return !best || d > (best[dateKey] || "") ? item : best;
    }, null);
  }

  function stars(rating) {
    if (typeof rating !== "number") return "";
    return "★".repeat(Math.floor(rating)) + (rating % 1 ? "½" : "");
  }

  /* Vibe panel — the home appearance previewer. Reads the shared axes from
     controls.js (window.DeetsAppearance), so the option lists live in one
     place. The panel carries the PENDING theme×skin on itself, so its whole
     interior re-tastes that combo — including its own scoped storm/ocean —
     while the rest of the page stays on the confirmed look. Confirm promotes
     pending site-wide; Reset reverts to the confirmed baseline. */
  function initVibe() {
    var A = window.DeetsAppearance;
    var panel = document.querySelector("[data-vibe]");
    if (!A || !panel) return;

    var stage = panel.querySelector(".vibe__stage");
    var resetBtn = panel.querySelector("[data-vibe-reset]");
    var confirmBtn = panel.querySelector("[data-vibe-confirm]");
    var confirmLabel = confirmBtn.textContent;

    // Baseline = the site's confirmed combo; pending = what the panel previews.
    var confirmed = { theme: A.get("theme"), skin: A.get("skin") };
    var pending = { theme: confirmed.theme, skin: confirmed.skin };

    // Scoped decorative layers, pinned to the panel by CSS (.vibe__stage > …).
    // Ocean gets a unique id suffix so its <pattern> refs don't collide with
    // the page-level ocean.
    stage.insertBefore(A.buildOcean("vibe"), stage.firstChild);
    stage.insertBefore(A.buildStorm(), stage.firstChild);

    function paint() {
      panel.setAttribute("data-theme", pending.theme);
      panel.setAttribute("data-skin", pending.skin);
    }
    function dirty() {
      return pending.theme !== confirmed.theme || pending.skin !== confirmed.skin;
    }
    function refresh() {
      resetBtn.hidden = !dirty();
      confirmBtn.disabled = !dirty();
    }
    function syncChecked(name) {
      var axis = A.axes[name];
      panel
        .querySelectorAll('[data-vibe-list="' + name + '"] .flyout__item')
        .forEach(function (el) {
          el.setAttribute("aria-checked",
            String(el.getAttribute(axis.attr) === pending[name]));
        });
    }

    ["theme", "skin"].forEach(function (name) {
      var axis = A.axes[name];
      var list = panel.querySelector('[data-vibe-list="' + name + '"]');
      axis.options.forEach(function (opt) {
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "flyout__item";
        chip.setAttribute("role", "radio");
        chip.setAttribute(axis.attr, opt.id); // self-taste this option
        chip.setAttribute("aria-checked", String(opt.id === pending[name]));
        chip.textContent = opt.label;
        chip.addEventListener("click", function () {
          pending[name] = opt.id;
          paint();
          syncChecked(name);
          refresh();
        });
        list.appendChild(chip);
      });
    });

    resetBtn.addEventListener("click", function () {
      pending.theme = confirmed.theme;
      pending.skin = confirmed.skin;
      paint();
      syncChecked("theme");
      syncChecked("skin");
      refresh();
    });

    confirmBtn.addEventListener("click", function () {
      A.set("theme", pending.theme);
      A.set("skin", pending.skin);
      confirmed.theme = pending.theme;
      confirmed.skin = pending.skin;
      refresh();
      confirmBtn.textContent = "Applied";
      setTimeout(function () { confirmBtn.textContent = confirmLabel; }, 1200);
    });

    paint();
    refresh();
    panel.hidden = false;
  }
  initVibe();

  fetch("sotd/songs.json")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var songs = data.songs || [];
      var last = latestBy(songs, "date");
      if (!last) return;
      fill(
        "sotd",
        songs.length + " songs · latest: “" + last.track_name +
          "” - " + last.artist_name + " →"
      );
    })
    .catch(function () {});

  fetch("movies/movies.json")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var movies = (data.movies || []).filter(function (m) {
        return m.status === "watched";
      });
      var last = latestBy(movies, "watched_date");
      if (!last) return;
      var s = stars(last.rating);
      fill(
        "movies",
        movies.length + " films · latest: " + last.name +
          " (" + last.year + ")" + (s ? " " + s : "") + " →"
      );
    })
    .catch(function () {});
})();
