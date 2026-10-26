/* Dev driver, page half — looks: the skin × theme, set and put back. */

// look?skin=&theme= → through the settings menu's own chips when the menu
// has them (look-change cover and all), else DeetsAppearance.set. Reports
// the previous values; look/restore puts back this tab's first look's prev.
function lookNow() {
  var A = window.DeetsAppearance, root = document.documentElement, stored = {};
  if (A) Object.keys(A.axes).forEach(function (n) { stored[A.axes[n].key] = localStorage.getItem(A.axes[n].key); });
  return { skin: root.getAttribute("data-skin"), theme: root.getAttribute("data-theme"), stored: stored };
}
C.look = async function (a) {
  var prev = lookNow();
  try { if (!sessionStorage.getItem(LOOK_KEY)) sessionStorage.setItem(LOOK_KEY, JSON.stringify(prev)); } catch (e) {}
  var root = document.documentElement, axes = [["data-skin", "skin"], ["data-theme", "theme"]];
  for (var i = 0; i < axes.length; i++) {
    var p = axes[i], want = a[p[1]];
    if (!want || root.getAttribute(p[0]) === want) continue;
    var chip = document.querySelector(".flyout__item[" + p[0] + '="' + want + '"]');
    if (chip) chip.click();
    else if (window.DeetsAppearance) window.DeetsAppearance.set(p[1], want);
    else throw new Error("no appearance controls on this page");
    // the chip applies under the look-change cover, a beat later
    await until(function () { return root.getAttribute(p[0]) === want; }, 4000, p[1] + " " + want);
  }
  await sleep(Number(a.settle) || 50);
  return { prev: prev, now: lookNow() };
};
C["look/restore"] = function () {
  var raw = null;
  try { raw = sessionStorage.getItem(LOOK_KEY); } catch (e) {}
  if (!raw) return { restored: false, reason: "no look changed in this tab" };
  var prev = JSON.parse(raw), root = document.documentElement;
  Object.keys(prev.stored).forEach(function (k) {
    if (prev.stored[k] == null) localStorage.removeItem(k); else localStorage.setItem(k, prev.stored[k]);
  });
  if (prev.skin) root.setAttribute("data-skin", prev.skin);
  if (prev.theme) root.setAttribute("data-theme", prev.theme);
  document.dispatchEvent(new CustomEvent("deets:appearance", { detail: {} }));
  sessionStorage.removeItem(LOOK_KEY);
  return { restored: true, now: lookNow() };
};
