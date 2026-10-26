/* Dev driver, page half — the wire: the EventSource to the side port, and
   each command's answer POSTed back. Joined LAST: connecting starts it all. */

/* ── the wire ────────────────────────────────────────────────── */
function post(path, body) {
  // text/plain keeps it a "simple" cross-origin request (no preflight)
  return fetch(SIDE + path, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(body) })
    .catch(function () {});
}
function beat() { if (id) post("/beat", { id: id, info: info() }); }

function connect() {
  var es = new EventSource(SIDE + "/stream?id=" + encodeURIComponent(id || ""));
  es.addEventListener("hello", function (e) {
    id = JSON.parse(e.data).id;
    try { sessionStorage.setItem(ID_KEY, id); } catch (er) {}
    stamp(); beat();
  });
  es.addEventListener("cmd", function (e) {
    var m = JSON.parse(e.data), fn = C[m.cmd];
    Promise.resolve()
      .then(function () { if (!fn) throw new Error("unknown command " + m.cmd + " (have: " + Object.keys(C).join(", ") + ")"); return fn(m.args || {}); })
      .then(function (r) { return post("/reply", { id: id, rid: m.rid, ok: true, result: safe(r), info: info() }); },
            function (err) { return post("/reply", { id: id, rid: m.rid, ok: false, error: String(err && err.message || err), info: info() }); });
  });
  // EventSource retries on its own; nothing to do on error
}

function touch() { activeAt = Date.now(); beat(); }
window.addEventListener("focus", touch);
document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") touch(); });
window.addEventListener("pagehide", function () {
  if (id) navigator.sendBeacon(SIDE + "/bye", new Blob([id], { type: "text/plain" }));
});
window.addEventListener("hashchange", beat);
setInterval(beat, 3000);
connect();
