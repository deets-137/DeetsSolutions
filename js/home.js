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
