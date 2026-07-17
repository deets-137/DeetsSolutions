/* Home — the SOTD hub, live card teasers, and the Vibe panel.
   Reads the same generated JSONs the journal pages render
   (sotd/songs.json, movies/movies.json) plus the League worker's
   D1-only /players route. Purely additive: if a fetch fails, the
   static fallback copy simply stays (and the SOTD hub never shows,
   leaving the plain fallback card in the side stack).

   NOTE: the shared-audio preview and cover-fallback patterns are
   deliberately duplicated from sotd/sotd.js (same convention as the
   toolbar kit) — fix a bug there, mirror it here. */
(function () {
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function fill(key, text) {
    var e = document.querySelector('[data-live="' + key + '"]');
    if (e && text) e.textContent = text;
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

  var MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];

  function ordinal(n) {
    var t = n % 100;
    if (t >= 11 && t <= 13) return n + "th";
    return n + (["th", "st", "nd", "rd"][n % 10] || "th");
  }

  // "2026-06-29" -> "June 29th, 2026". Parsed from the string parts (not
  // new Date) so a UTC date never shifts a day in the local timezone.
  function prettyDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    if (!m) return iso || "";
    var mo = +m[2];
    if (mo < 1 || mo > 12) return iso;
    return MONTHS[mo - 1] + " " + ordinal(+m[3]) + ", " + m[1];
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
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
        .forEach(function (e) {
          e.setAttribute("aria-checked",
            String(e.getAttribute(axis.attr) === pending[name]));
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

  /* ── SOTD hub ──────────────────────────────────────────────────
     The showcase column: hero (latest pick), stat chips, and a cover
     calendar where clicking a day loads that day's song into the hero.
     Deets-only on purpose — friends' picks stay behind the journal's
     vanity gate, so the home page can't leak them. Returns false when
     it can't build, which leaves the fallback card visible. */
  function initHub(songs) {
    var hub = document.querySelector("[data-sotd-hub]");
    if (!hub) return false;

    var picks = songs.filter(function (s) {
      return s.author === "Deets" && /^\d{4}-\d{2}-\d{2}$/.test(s.date || "");
    });
    if (!picks.length) return false;

    // One pick per day: on multi-post days the latest post wins.
    var byDate = {};
    picks.forEach(function (p) {
      var cur = byDate[p.date];
      if (!cur || (p.posted_at || "") > (cur.posted_at || "")) byDate[p.date] = p;
    });
    var dates = Object.keys(byDate).sort();
    var latestDate = dates[dates.length - 1];
    var TODAY = todayISO();

    /* One <audio> for the hub, same contract as the journal: starting a
       new preview stops the one already playing. */
    var audio = new Audio();
    var playingBtn = null;
    audio.addEventListener("ended", resetPlaying);
    function resetPlaying() {
      if (playingBtn) {
        playingBtn.classList.remove("is-playing");
        playingBtn.setAttribute("aria-label", "Play preview");
        playingBtn.textContent = "►";
        playingBtn = null;
      }
    }
    function togglePreview(btn, url) {
      if (playingBtn === btn) { audio.pause(); resetPlaying(); return; }
      resetPlaying();
      audio.src = url;
      audio.play().catch(function () { resetPlaying(); });
      playingBtn = btn;
      btn.classList.add("is-playing");
      btn.setAttribute("aria-label", "Pause preview");
      btn.textContent = "❚❚";
    }

    // Cover with monogram fallback, mirroring sotd.js buildCover.
    function buildCover(song) {
      var cover = el("div", "song__cover");
      var initial = (song.track_name || "?").trim().charAt(0).toUpperCase() || "?";
      cover.appendChild(el("span", "song__mono", initial));
      if (song.artwork_url) {
        var img = el("img", "song__art");
        img.alt = song.album ? song.track_name + " — " + song.album : song.track_name;
        img.addEventListener("load", function () { cover.classList.add("has-art"); });
        img.addEventListener("error", function () { img.remove(); });
        img.src = song.artwork_url;
        cover.appendChild(img);
      }
      if (song.preview_url) {
        var play = el("button", "song__play", "►");
        play.type = "button";
        play.setAttribute("aria-label", "Play preview");
        play.addEventListener("click", function () { togglePreview(play, song.preview_url); });
        cover.appendChild(play);
      }
      return cover;
    }

    // ── Hero ────────────────────────────────────────────────────
    var heroBox = hub.querySelector("[data-hub-hero]");
    function renderHero(song) {
      resetPlaying();
      audio.pause();
      heroBox.textContent = "";
      heroBox.appendChild(buildCover(song));

      var d = el("div", "sotd-hub__details");
      d.appendChild(el("p", "sotd-hub__when",
        song.date === TODAY ? "Today's pick" : prettyDate(song.date)));
      var track = el("h3", "sotd-hub__track", song.track_name || "(unresolved link)");
      track.title = song.track_name || "";
      d.appendChild(track);
      if (song.artist_name) d.appendChild(el("p", "sotd-hub__artist", song.artist_name));
      var albumParts = [];
      if (song.album) albumParts.push(song.album);
      if (song.release_year) albumParts.push(song.release_year);
      if (albumParts.length) d.appendChild(el("p", "sotd-hub__album", albumParts.join(" · ")));

      var tags = el("div", "song__tags");
      if (song.genre) tags.appendChild(el("span", "song__chip", song.genre));
      if (song.duration) tags.appendChild(el("span", "song__chip song__chip--soft", song.duration));
      if (tags.childNodes.length) d.appendChild(tags);

      var links = el("div", "song__links");
      if (song.apple_music_url) {
        var am = el("a", "song__link", "Apple Music");
        am.href = song.apple_music_url; am.target = "_blank"; am.rel = "noopener";
        links.appendChild(am);
      } else if (song.url) {
        var src = el("a", "song__link", "Listen");
        src.href = song.url; src.target = "_blank"; src.rel = "noopener";
        links.appendChild(src);
      }
      if (links.childNodes.length) d.appendChild(links);
      heroBox.appendChild(d);
    }

    // ── Stat chips: pick count, streak, top genre ───────────────
    var statsBox = hub.querySelector("[data-hub-stats]");
    if (statsBox) {
      statsBox.appendChild(el("span", "song__chip", picks.length + " picks"));

      // Streak: consecutive days with a pick, counting back from the
      // latest pick (so a not-yet-posted today doesn't zero it out).
      var streak = 0;
      var cursor = /^(\d{4})-(\d{2})-(\d{2})$/.exec(latestDate);
      var cd = new Date(+cursor[1], +cursor[2] - 1, +cursor[3]);
      while (byDate[cd.getFullYear() + "-" + pad2(cd.getMonth() + 1) + "-" + pad2(cd.getDate())]) {
        streak++;
        cd.setDate(cd.getDate() - 1);
      }
      if (streak > 1) statsBox.appendChild(el("span", "song__chip song__chip--soft", streak + "-day streak"));

      // Genre leaderboard — the top three by pick count, ranked.
      var counts = {};
      picks.forEach(function (p) { if (p.genre) counts[p.genre] = (counts[p.genre] || 0) + 1; });
      Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })
        .slice(0, 3)
        .forEach(function (g, i) {
          statsBox.appendChild(el("span", "song__chip song__chip--soft",
            "#" + (i + 1) + " " + g + " · " + counts[g]));
        });
    }

    // ── Calendar ────────────────────────────────────────────────
    var calBox = hub.querySelector("[data-hub-cal]");
    var calGrid = hub.querySelector("[data-cal-grid]");
    var calLabel = hub.querySelector("[data-cal-label]");
    var prevBtn = hub.querySelector("[data-cal-prev]");
    var nextBtn = hub.querySelector("[data-cal-next]");
    var selectedDate = latestDate;

    /* Hover card — one shared element, filled and positioned over the
       hovered/focused day (popover material, like the toolbar pops).
       Delegated from the grid so month re-renders need no rebinding. */
    var tip = el("div", "sotd-cal__tip");
    tip.hidden = true;
    tip.setAttribute("aria-hidden", "true");
    var tipDate = el("p", "sotd-cal__tip-date");
    var tipTrack = el("p", "sotd-cal__tip-track");
    var tipArtist = el("p", "sotd-cal__tip-artist");
    var tipMeta = el("p", "sotd-cal__tip-meta");
    tip.appendChild(tipDate);
    tip.appendChild(tipTrack);
    tip.appendChild(tipArtist);
    tip.appendChild(tipMeta);
    calBox.appendChild(tip);

    function showTip(btn) {
      var pick = byDate[btn.getAttribute("data-date")];
      if (!pick) return;
      tipDate.textContent = prettyDate(pick.date);
      tipTrack.textContent = pick.track_name || "(unresolved link)";
      tipArtist.textContent = pick.artist_name || "";
      tipArtist.hidden = !pick.artist_name;
      var meta = [];
      if (pick.genre) meta.push(pick.genre);
      if (pick.duration) meta.push(pick.duration);
      if (pick.release_year) meta.push(pick.release_year);
      tipMeta.textContent = meta.join(" · ");
      tipMeta.hidden = !meta.length;
      tip.hidden = false;
      // Above the cell, centered, clamped to the calendar box; flips below
      // when the top row would push it out.
      var box = calBox.getBoundingClientRect();
      var r = btn.getBoundingClientRect();
      var left = r.left - box.left + r.width / 2 - tip.offsetWidth / 2;
      left = Math.max(0, Math.min(left, box.width - tip.offsetWidth));
      var top = r.top - box.top - tip.offsetHeight - 6;
      if (top < 0) top = r.bottom - box.top + 6;
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    }
    function hideTip() { tip.hidden = true; }
    calGrid.addEventListener("mouseover", function (e) {
      var b = e.target.closest && e.target.closest("button.sotd-cal__day");
      if (b) showTip(b); else hideTip();
    });
    calGrid.addEventListener("mouseleave", hideTip);
    calGrid.addEventListener("focusin", function (e) {
      var b = e.target.closest && e.target.closest("button.sotd-cal__day");
      if (b) showTip(b); else hideTip();
    });
    calGrid.addEventListener("focusout", hideTip);

    // View month starts at the latest pick; nav is clamped to the months
    // that hold picks (plus the current month, so "today" is reachable).
    var view = { y: +latestDate.slice(0, 4), m: +latestDate.slice(5, 7) };
    var minKey = dates[0].slice(0, 7);
    var maxKey = TODAY.slice(0, 7) > latestDate.slice(0, 7) ? TODAY.slice(0, 7) : latestDate.slice(0, 7);
    function viewKey() { return view.y + "-" + pad2(view.m); }

    function markSelection() {
      calGrid.querySelectorAll("button.sotd-cal__day").forEach(function (b) {
        var on = b.getAttribute("data-date") === selectedDate;
        b.classList.toggle("is-selected", on);
        b.setAttribute("aria-pressed", String(on));
      });
    }

    function renderCal() {
      hideTip();
      calLabel.textContent = MONTHS[view.m - 1] + " " + view.y;
      prevBtn.disabled = viewKey() <= minKey;
      nextBtn.disabled = viewKey() >= maxKey;
      calGrid.textContent = "";
      ["S", "M", "T", "W", "T", "F", "S"].forEach(function (d) {
        calGrid.appendChild(el("span", "sotd-cal__dow", d));
      });
      var lead = new Date(view.y, view.m - 1, 1).getDay();
      for (var i = 0; i < lead; i++) {
        calGrid.appendChild(el("span", "sotd-cal__day sotd-cal__day--blank"));
      }
      var days = new Date(view.y, view.m, 0).getDate();
      for (var day = 1; day <= days; day++) {
        var iso = view.y + "-" + pad2(view.m) + "-" + pad2(day);
        var pick = byDate[iso];
        var cell;
        if (pick) {
          cell = el("button", "sotd-cal__day");
          cell.type = "button";
          cell.setAttribute("data-date", iso);
          // No title attr — the richer hover card covers pointer users, and
          // this label carries the same info for screen readers.
          cell.setAttribute("aria-label", prettyDate(iso) + " — " +
            (pick.track_name || "unresolved") +
            (pick.artist_name ? " by " + pick.artist_name : "") +
            (pick.genre ? " · " + pick.genre : ""));
          if (pick.artwork_url) {
            var thumb = el("img", "sotd-cal__thumb");
            thumb.loading = "lazy";
            thumb.alt = "";
            // Apple artwork URLs encode their size; ask for a thumb, not 600px.
            thumb.src = pick.artwork_url.replace("600x600bb", "160x160bb");
            thumb.addEventListener("error", function (e) { e.target.remove(); });
            cell.appendChild(thumb);
          }
          cell.appendChild(el("span", "sotd-cal__num", String(day)));
          cell.addEventListener("click", (function (p, d8) {
            return function () { selectedDate = d8; renderHero(p); markSelection(); };
          })(pick, iso));
        } else {
          cell = el("span", "sotd-cal__day", String(day));
        }
        if (iso === TODAY) cell.classList.add("is-today");
        calGrid.appendChild(cell);
      }
      markSelection();
    }

    function step(dir) {
      view.m += dir;
      if (view.m < 1) { view.m = 12; view.y--; }
      if (view.m > 12) { view.m = 1; view.y++; }
      renderCal();
    }
    prevBtn.addEventListener("click", function () { step(-1); });
    nextBtn.addEventListener("click", function () { step(1); });

    // ── Liner notes — journal-wide fun stats ────────────────────
    // Each fact only renders when it has something worth saying; the
    // whole block stays hidden if none do.
    var factsBox = hub.querySelector("[data-hub-facts]");
    if (factsBox) {
      function fact(label, value, note) {
        var f = el("div", "sotd-fact");
        f.appendChild(el("span", "sotd-fact__label", label));
        f.appendChild(el("span", "sotd-fact__value", value));
        if (note) f.appendChild(el("span", "sotd-fact__note", note));
        factsBox.appendChild(f);
      }
      function topOf(counts) {
        var best = null;
        Object.keys(counts).forEach(function (k) {
          if (!best || counts[k] > counts[best]) best = k;
        });
        return best;
      }
      // "2026-03-04" -> "Mar 4th" (the journal is young; years would be noise).
      function shortDate(iso) {
        return MONTHS[+iso.slice(5, 7) - 1].slice(0, 3) + " " + ordinal(+iso.slice(8, 10));
      }

      // Most featured artist.
      var artistCounts = {};
      picks.forEach(function (p) {
        if (p.artist_name) artistCounts[p.artist_name] = (artistCounts[p.artist_name] || 0) + 1;
      });
      var topArtist = topOf(artistCounts);
      if (topArtist && artistCounts[topArtist] > 1) {
        fact("Most featured", topArtist, artistCounts[topArtist] + " picks");
      }

      // On repeat — the most re-picked song, or bragging rights if none.
      var songCounts = {}, songNames = {};
      picks.forEach(function (p) {
        if (!p.track_name) return;
        var key = p.track_name + "|" + (p.artist_name || "");
        songCounts[key] = (songCounts[key] || 0) + 1;
        songNames[key] = p.track_name;
      });
      var topSong = topOf(songCounts);
      if (topSong && songCounts[topSong] > 1) {
        fact("On repeat", songNames[topSong],
          songCounts[topSong] === 2 ? "picked twice" : "picked " + songCounts[topSong] + " times");
      } else if (topSong) {
        fact("On repeat", "Nothing yet", picks.length + " picks, zero repeats");
      }

      // Genre × weekday — the strongest day/genre association, if any day
      // has enough picks (8+) and its top genre carries a third of them.
      var DAY_FULL = { Sun: "Sunday", Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday",
                       Thu: "Thursday", Fri: "Friday", Sat: "Saturday" };
      var byDay = {};
      picks.forEach(function (p) {
        if (!p.day || !p.genre) return;
        var d = byDay[p.day] || (byDay[p.day] = { total: 0, genres: {} });
        d.total++;
        d.genres[p.genre] = (d.genres[p.genre] || 0) + 1;
      });
      var pattern = null;
      Object.keys(byDay).forEach(function (day) {
        var d = byDay[day];
        if (d.total < 8) return;
        var g = topOf(d.genres);
        var share = d.genres[g] / d.total;
        if (share >= 1 / 3 && (!pattern || share > pattern.share)) {
          pattern = { day: day, genre: g, n: d.genres[g], total: d.total, share: share };
        }
      });
      if (pattern) {
        fact("Pattern found", pattern.genre + " " + DAY_FULL[pattern.day] + "s",
          pattern.n + " of " + pattern.total + " " + DAY_FULL[pattern.day] + " picks");
      }

      // Longest streak of consecutive days, with its range.
      var best = null, run = null;
      dates.forEach(function (iso) {
        if (run) {
          var next = new Date(+run.end.slice(0, 4), +run.end.slice(5, 7) - 1, +run.end.slice(8, 10));
          next.setDate(next.getDate() + 1);
          var nextIso = next.getFullYear() + "-" + pad2(next.getMonth() + 1) + "-" + pad2(next.getDate());
          if (iso === nextIso) { run.end = iso; run.n++; }
          else run = { start: iso, end: iso, n: 1 };
        } else {
          run = { start: iso, end: iso, n: 1 };
        }
        if (!best || run.n > best.n) best = { start: run.start, end: run.end, n: run.n };
      });
      if (best && best.n > 1) {
        fact("Longest streak", best.n + " days",
          shortDate(best.start) + " – " + shortDate(best.end));
      }

      // Favorite era — the modal release decade.
      var decades = {};
      picks.forEach(function (p) {
        if (p.release_year) {
          var dec = Math.floor(p.release_year / 10) * 10 + "s";
          decades[dec] = (decades[dec] || 0) + 1;
        }
      });
      var topDecade = topOf(decades);
      if (topDecade) fact("Favorite era", topDecade, decades[topDecade] + " picks");

      // Hot off the press — picked within a week of release.
      var fresh = 0;
      picks.forEach(function (p) {
        if (!p.release_date) return;
        var gap = (Date.parse(p.date) - Date.parse(p.release_date)) / 86400000;
        if (gap >= 0 && gap <= 7) fresh++;
      });
      if (fresh) {
        fact("Hot off the press", fresh + (fresh === 1 ? " pick" : " picks"),
          "within a week of release");
      }

      factsBox.hidden = !factsBox.childNodes.length;
    }

    renderHero(byDate[latestDate]);
    renderCal();
    hub.hidden = false;
    return true;
  }

  fetch("sotd/songs.json")
    .then(function (r) { return r.json(); })
    .then(function (data) { initHub(data.songs || []); })
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

  /* League card — profile snapshot from the worker's /players route,
     which serves straight from D1 (zero Riot key spend, per the
     riotFetch rule), including the rank snapshot handlePlayer persists
     on each League-tab visit. Profile icon art comes from Data Dragon
     directly, same as the League tab. */
  fetch("https://api.deets.solutions/players")
    .then(function (r) { return r.json(); })
    .then(function (list) {
      var me = (list || []).filter(function (p) { return p.gameName === "D33TS"; })[0];
      if (!me) return;
      var sub = document.querySelector("[data-league-sub]");
      if (sub) sub.textContent = "Level " + me.summonerLevel + " · " +
        me.matchesCrawled + " games tracked";

      // Rank line, mirroring league.js rankLine: "Solo Silver I · 5 LP (5W–3L)".
      var rankEl = document.querySelector("[data-league-rank]");
      if (rankEl && me.rank) {
        var parts = [];
        [["RANKED_SOLO_5x5", "Solo"], ["RANKED_FLEX_SR", "Flex"]].forEach(function (q) {
          var e = me.rank.filter(function (x) { return x.queueType === q[0]; })[0];
          if (e) parts.push(q[1] + " " + e.tier.charAt(0) + e.tier.slice(1).toLowerCase() +
            " " + e.rank + " · " + e.leaguePoints + " LP (" + e.wins + "W–" + e.losses + "L)");
        });
        if (parts.length) {
          rankEl.textContent = parts.join("  ·  ");
          rankEl.hidden = false;
        }
      }
      if (me.profileIconId == null) return;
      return fetch("https://ddragon.leagueoflegends.com/api/versions.json")
        .then(function (r) { return r.json(); })
        .then(function (versions) {
          var pfp = document.querySelector("[data-league-pfp]");
          if (!pfp || !versions || !versions[0]) return;
          var img = el("img");
          img.alt = "";
          img.loading = "lazy";
          img.src = "https://ddragon.leagueoflegends.com/cdn/" + versions[0] +
            "/img/profileicon/" + me.profileIconId + ".png";
          img.addEventListener("error", function () { img.remove(); });
          pfp.appendChild(img);
        });
    })
    .catch(function () {});
})();
