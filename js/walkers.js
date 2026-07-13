/* Sprite walkers — Deets and Happy from the DeetsLife game, out for a
   stroll across the bottom of the viewport. Pure decoration: fixed
   overlay, pointer-events none, aria-hidden, and never spawned when the
   visitor prefers reduced motion.

   The art is the game's own pixel art (assets/sprites/<name>/), untouched:
   4-frame side-walk strips that CSS plays with steps(4), matching the
   game's 7 fps walk. Side art faces LEFT, so a left-to-right walker is
   mirrored with scaleX(-1) — exactly what the game does with flip_h.
   Sprite geometry (frame sizes, strips) is intrinsic to the art and lives
   here + in the walkers section of main.css, the same way the ocean's
   wave geometry lives in controls.js.

   Pages opt in by including this script. One stroll starts shortly after
   load and the gap between strolls never exceeds 30s, so a lingering
   visitor is never far from the next one. On skins with a ride (Ocean's
   boat, Glass's balloon) some strolls become the ride instead — composite
   sprites with both characters aboard, graybox until Aditya draws them.
   window.DeetsWalkers.spawn("pair"|"boat"|...) from the console summons
   one on demand. */
(function () {
  "use strict";

  // Native (unscaled) frame sizes, matching the PNGs in assets/sprites/.
  // deets/happy are the game rigs (4-frame walk cycle at 7 fps; sit marks
  // a rig with a sit pose). The rest are skin-specific rides: single-frame
  // composites with both characters aboard, spawned only while `skin`
  // matches, at `speed` px/s (default SPEED) and, for flyers, a random
  // `altitude` (vh above the viewport bottom) instead of walking on it.
  var SPRITES = {
    deets:   { w: 32, h: 64 },
    happy:   { w: 32, h: 32, sit: true },
    boat:    { w: 96, h: 72, skin: "ocean" },
    balloon: { w: 64, h: 96, skin: "glass", speed: 40, altitude: [35, 60] },
  };
  var SCALE = 2;          // integer only — pixel art
  var SPEED = 70;         // screen px/s; a stroll, not a sprint
  var FIRST_DELAY = [4, 12];   // seconds after load until the first walker
  var NEXT_DELAY = [12, 30];   // between strolls after that; 30s wait, max
  var VEHICLE_CHANCE = 0.4;    // odds a stroll is the skin's ride instead
  var SIT_CHANCE = 0.4;        // a solo Happy may pause for a sit
  var SIT_TIME = [1.2, 2.6];   // seconds of sitting

  function reducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
  }

  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

  /* Build one walker: an outer .walker that travels (Web Animations API,
     so the sit gag can pause it) around an inner sprite div that plays the
     walk cycle (CSS steps animation, per-character class). */
  function makeWalker(name, dir, delayMs) {
    var ch = SPRITES[name];
    var w = ch.w * SCALE;
    var speed = ch.speed || SPEED;

    var el = document.createElement("div");
    el.className = "walker";
    el.setAttribute("aria-hidden", "true");
    if (ch.altitude) {
      el.style.bottom = rand(ch.altitude[0], ch.altitude[1]).toFixed(1) + "vh";
    }

    var sprite = document.createElement("div");
    sprite.className = "walker__sprite walker__sprite--" + name;
    // Mirror to face the travel direction (art faces left); scale from the
    // feet so the sprite stands on the viewport bottom.
    sprite.style.transform = "scale(" + dir * -SCALE + ", " + SCALE + ")";
    el.appendChild(sprite);

    // Travel fully across, offscreen edge to offscreen edge. calc strings
    // keep it honest through a mid-walk window resize.
    var from = dir > 0 ? -w + "px" : "calc(100vw + " + w + "px)";
    var to = dir > 0 ? "calc(100vw + " + w + "px)" : -w + "px";
    var dist = document.documentElement.clientWidth + 2 * w;
    var travel = el.animate(
      [{ transform: "translateX(" + from + ")" },
       { transform: "translateX(" + to + ")" }],
      { duration: (dist / speed) * 1000, delay: delayMs, fill: "both" }
    );
    // The finished PROMISE, not onfinish: throttled/occluded tabs can skip
    // the finish event entirely, stranding invisible walkers in the DOM.
    travel.finished.then(function () { el.remove(); }, function () {});

    document.body.appendChild(el);
    return { el: el, sprite: sprite, travel: travel };
  }

  // Mid-stroll sit break: pause the travel, swap to the sit pose, resume.
  function sitBreak(walker) {
    var travel = walker.travel;
    var wait = travel.effect.getTiming().delay +
               travel.effect.getTiming().duration * rand(0.3, 0.7);
    setTimeout(function () {
      if (travel.playState !== "running") return;
      travel.pause();
      walker.sprite.classList.add("walker__sprite--sitting");
      setTimeout(function () {
        walker.sprite.classList.remove("walker__sprite--sitting");
        travel.play();
      }, rand(SIT_TIME[0], SIT_TIME[1]) * 1000);
    }, wait);
  }

  /* One stroll. kind: "pair" (Deets with Happy trailing behind, like the
     game's breadcrumb follower) or any SPRITES name. */
  function spawn(kind) {
    if (reducedMotion()) return;
    var dir = Math.random() < 0.5 ? 1 : -1;
    if (kind === "pair") {
      makeWalker("deets", dir, 0);
      // Same path, delayed = trailing at a fixed gap.
      makeWalker("happy", dir, (56 * SCALE / SPEED) * 1000);
    } else {
      var walker = makeWalker(kind, dir, 0);
      if (SPRITES[kind].sit && Math.random() < SIT_CHANCE) sitBreak(walker);
    }
  }

  function randomKind() {
    // A skin with a ride sends the pair out in it some of the time.
    var skin = document.documentElement.getAttribute("data-skin");
    for (var name in SPRITES) {
      if (SPRITES[name].skin === skin && Math.random() < VEHICLE_CHANCE) {
        return name;
      }
    }
    var r = Math.random();
    return r < 0.4 ? "deets" : r < 0.75 ? "happy" : "pair";
  }

  function schedule(delayRange) {
    setTimeout(function () {
      // A hidden tab skips its turn — the stroll would play to nobody.
      if (!document.hidden) spawn(randomKind());
      schedule(NEXT_DELAY);
    }, rand(delayRange[0], delayRange[1]) * 1000);
  }

  function init() {
    if (reducedMotion()) return;   // no spawns, ever, for reduced motion
    schedule(FIRST_DELAY);
  }

  // Console toy + testing hook:
  // DeetsWalkers.spawn("deets"|"happy"|"pair"|"boat"|"balloon").
  window.DeetsWalkers = { spawn: spawn };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
