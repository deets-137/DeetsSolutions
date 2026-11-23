/* The download gate (Portfolio's Resume button, 2026-11-23).
   A [data-gate] link holds an arrow over a line split in two. On click the
   halves swing down like a gate, the arrow drops through, and both come
   back (the keyframes are main.css's "Download gate"). This file only
   restarts that animation on every click; the download is the link's own,
   so it works with no JS at all. Reduced motion: the CSS plays nothing. */
(function () {
  document.addEventListener("click", function (e) {
    var link = e.target.closest && e.target.closest("[data-gate]");
    if (!link) return;
    link.classList.remove("is-opening");
    void link.offsetWidth; // a reflow, so the same class starts the animation over
    link.classList.add("is-opening");
  });
  document.addEventListener("animationend", function (e) {
    if (e.animationName !== "gate-arrow") return;
    var link = e.target.closest("[data-gate]");
    if (link) link.classList.remove("is-opening");
  });
})();
