/* Deets profile — the account's home page (docs/accounts.md, "The
   profile page").

   Everything on the page is painted from DeetsAccount state: signed out
   it's one invitation box, signed in it's the bento grid — Appearance
   (display name + color) today, more boxes as phase 2 lands. Edits go
   through DeetsAccount.update() → PATCH /me, so the nav button and any
   other tab pick the change up through the same listener plumbing.

   The color picker deliberately mirrors the lobby seat picker in
   games/table.js (six presets + a custom hex "Become..." row) — same
   anatomy, same colors.js validation — minus the clash checks, because a
   profile has no other seats to clash with. Copy here is inline, the
   accounts-chrome precedent (account.js, auth/done.html), not the games'
   strings.js convention. */

(function () {
  "use strict";

  var title = document.querySelector("[data-profile-title]");
  var toolbar = document.querySelector("[data-profile-toolbar]");
  var meta = document.querySelector("[data-profile-meta]");
  var grid = document.querySelector("[data-profile-grid]");
  if (!title || !toolbar || !meta || !grid) return;

  /* Drafts survive re-renders: a broadcast-driven repaint (the initial
     /me revalidate, a save landing) must not eat what's mid-typing —
     same reason the lobby picker keeps ui.colorDraft. */
  var ui = { nameDraft: null, hexDraft: null };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function toast(msg, kind) {
    if (window.DeetsToast && window.DeetsToast.show) window.DeetsToast.show(msg, kind);
  }
  function saveFailed() { toast("That didn't save. Try again in a moment.", "error"); }

  /* ── the boxes ──────────────────────────────────────────────────── */

  function signedOutBox() {
    var box = el("section", "profile-box profile-box--invite");
    box.appendChild(el("h2", "profile-box__title", "Not signed in"));
    box.appendChild(el("p", "profile-box__text",
      "Sign in and your display name and color follow you to every game table on the site."));
    var btn = el("button", "tb-pill", "Sign in with Google");
    btn.type = "button";
    btn.addEventListener("click", function () {
      window.DeetsAccount.signIn();
      toast("Finish signing in over in the new tab.", "info");
    });
    box.appendChild(btn);
    return box;
  }

  function appearanceBox(user) {
    var box = el("section", "profile-box");
    box.appendChild(el("h2", "profile-box__title", "Appearance"));

    /* Display name — the one thing the lobby picker doesn't let you
       edit, and the whole reason this box exists beyond the swatches. */
    var nameField = el("div", "profile-field");
    var nameId = "profile-name";
    var nameLabel = el("label", "profile-field__label", "Display name");
    nameLabel.setAttribute("for", nameId);
    nameField.appendChild(nameLabel);
    var nameRow = el("div", "profile-field__row");
    var input = el("input", "profile-field__input");
    input.id = nameId;
    input.type = "text";
    input.maxLength = 24;
    input.spellcheck = false;
    input.autocomplete = "nickname";
    input.value = ui.nameDraft != null ? ui.nameDraft : (user.name || "");
    var saveBtn = el("button", "tb-pill", "Save");
    saveBtn.type = "button";
    function nameChanged() {
      var v = input.value.trim().slice(0, 24);
      return v && v !== (user.name || "") ? v : null;
    }
    function paintSave() { saveBtn.disabled = !nameChanged(); }
    function commitName() {
      var v = nameChanged();
      if (!v) return;
      saveBtn.disabled = true;
      window.DeetsAccount.update({ name: v }).then(function (u) {
        if (!u) { saveFailed(); paintSave(); return; }
        ui.nameDraft = null;           // the account is the draft now
        toast("You're " + u.name + " now.", "info");
      });
    }
    input.addEventListener("input", function () { ui.nameDraft = input.value; paintSave(); });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") commitName(); });
    saveBtn.addEventListener("click", commitName);
    paintSave();
    nameRow.appendChild(input);
    nameRow.appendChild(saveBtn);
    nameField.appendChild(nameRow);
    box.appendChild(nameField);

    /* Color — the lobby picker's anatomy, solo edition. */
    var Colors = window.DeetsColors;
    var current = Colors ? Colors.norm(user.color) : null;
    var colorField = el("div", "profile-field");
    colorField.appendChild(el("span", "profile-field__label", "Color"));

    var sw = el("div", "profile-swatches");
    (Colors ? Colors.PRESETS : []).forEach(function (hex) {
      var b = el("button", "profile-swatch");
      b.type = "button";
      b.style.background = hex;
      if (hex === current) b.classList.add("is-current");
      b.setAttribute("aria-label", "Become " + hex);
      b.addEventListener("click", function () { commitColor(hex); });
      sw.appendChild(b);
    });
    /* 7th slot: your custom color, when the account is wearing one.
       Otherwise the dashed empty ring that just focuses the hex field. */
    var custom = current && Colors.PRESETS.indexOf(current) < 0 ? current : null;
    var cb = el("button", "profile-swatch profile-swatch--custom");
    cb.type = "button";
    if (custom) {
      cb.style.background = custom;
      cb.classList.add("is-current");
      cb.setAttribute("aria-label", "Your custom color, " + custom);
    } else {
      cb.classList.add("is-empty");
      cb.setAttribute("aria-label", "Pick a custom color");
    }
    cb.addEventListener("click", function () { hexInput.focus(); });
    sw.appendChild(cb);
    colorField.appendChild(sw);

    var row = el("div", "profile-field__row");
    row.appendChild(el("span", "profile-field__hexlabel", "Hex"));
    var hexInput = el("input", "profile-field__input profile-field__input--hex");
    hexInput.type = "text";
    hexInput.spellcheck = false;
    hexInput.maxLength = 8;
    hexInput.value = ui.hexDraft != null ? ui.hexDraft : (current || "");
    var become = el("button", "tb-pill", "Become...");
    become.type = "button";
    var note = el("span", "profile-field__msg");
    function validateHex() {
      var hex = Colors ? Colors.norm(hexInput.value) : null;
      note.textContent = !hex && hexInput.value.trim() ? "Hex colors look like #a1b2c3." : "";
      become.disabled = !hex || hex === current;
      return become.disabled ? null : hex;
    }
    function becomeCustom() {
      var hex = validateHex();
      if (hex) commitColor(hex);
    }
    hexInput.addEventListener("input", function () { ui.hexDraft = hexInput.value; validateHex(); });
    hexInput.addEventListener("keydown", function (e) { if (e.key === "Enter") becomeCustom(); });
    become.addEventListener("click", becomeCustom);
    validateHex();
    row.appendChild(hexInput);
    row.appendChild(become);
    row.appendChild(note);
    colorField.appendChild(row);
    box.appendChild(colorField);

    box.appendChild(el("p", "profile-box__text",
      "Tables offer your color first when it's free; a color already claimed at a table stays claimed."));
    return box;
  }

  function commitColor(hex) {
    window.DeetsAccount.update({ color: hex }).then(function (u) {
      if (!u) { saveFailed(); return; }
      ui.hexDraft = null;
      toast("Color saved.", "info");
    });
  }

  /* ── the frame ──────────────────────────────────────────────────── */

  function render(user) {
    toolbar.textContent = "";
    grid.textContent = "";

    if (user == null && window.DeetsAccount.get() == null) {
      title.textContent = "Profile";
      meta.textContent = "Checking who you are…";
      return;
    }
    user = user || window.DeetsAccount.get();

    if (!user) {
      title.textContent = "Profile";
      meta.textContent = "A name and a color that follow you around the site.";
      grid.appendChild(signedOutBox());
      return;
    }

    title.textContent = user.name || "Profile";
    meta.textContent = "Signed in with Google. Tables pick these up automatically — a name typed at a gate still wins.";

    var out = el("button", "tb-pill", "Sign out");
    out.type = "button";
    out.addEventListener("click", function () {
      out.disabled = true;
      window.DeetsAccount.signOut().then(function () { toast("Signed out.", "info"); });
    });
    toolbar.appendChild(out);

    grid.appendChild(appearanceBox(user));
  }

  window.DeetsAccount.onChange(render);
})();
