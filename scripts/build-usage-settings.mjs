// `node --import ../DeetsMusic/tests/setup.mjs scripts/build-usage-settings.mjs`
// Writes deetsmusic/admin/usage-settings.js, the admin page's map of DeetsMusic's reported
// settings (support.md, "The dashboard" › Settings): each key's section, its name and its
// options' names as the app's settings list shows them, and the value a fresh install
// reports. Run it after DeetsMusic adds, renames or re-defaults a setting. A key missing from
// the map still shows on the page, under "Other", with no default marked.
//
// How it reads them: the app's own spec list (src/agent-settings.ts, the one its agent and
// its usage report read) is loaded for real, with the settings store, so with an empty
// localStorage each spec answers DEFAULTS: what a fresh install sends. The modules that need
// Tauri or the DOM are swapped for inert stand-ins (STUB below). A setting Rust owns cannot be
// read without Tauri; RUST_DEFAULTS holds those, from DeetsMusic's src-tauri settings.rs, and
// the script fails if a Rust-owned reported key is missing there.
//
// Runs from this repo against the sibling ../DeetsMusic checkout; nothing it loads ships.
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, basename } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dm = join(root, "..", "DeetsMusic", "src");
const out = join(root, "deetsmusic", "admin", "usage-settings.js");

// The modules loaded for real: the spec list and the pure files it reads values from.
const REAL = new Set(["agent-settings.ts", "settings-store.ts", "usage-rules.ts", "usage-keys.ts", "layout-rules.ts", "look-schedule.ts", "look-ids.ts"]);

/* Every other module of the app (and Tauri) becomes a stand-in exporting the same names, each
   an inert value: callable, readable at any depth, never a promise. */
const STUB = `
const any = new Proxy(function () {}, {
  get: (t, k) => (k === "then" ? undefined : k === Symbol.iterator ? [][Symbol.iterator].bind([]) : k === Symbol.toPrimitive ? () => "" : any),
  apply: () => any,
  construct: () => any,
});
`;
function exportNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function\*?|class|enum)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    m[1].split(",").forEach((p) => {
      const n = p.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop();
      if (n && !/^type\b/.test(p.trim())) names.add(n);
    });
  }
  return [...names];
}
/* settings.rs `impl Default for SettingsData`, as the front end receives it (serde camelCase,
   enums lowercase). Only literal fields; the rest are left out and read as unknown. */
function rustDefaults() {
  const src = readFileSync(join(dm, "..", "src-tauri", "src", "settings.rs"), "utf8");
  const body = /impl Default for SettingsData[\s\S]*?Self\s*\{([\s\S]*?)\n\s*\}\s*\n\s*\}/.exec(src);
  if (!body) throw new Error("settings.rs: no Default for SettingsData");
  const out = {};
  for (const m of body[1].matchAll(/^\s*([a-z_0-9]+):\s*([^,\n]+),/gm)) {
    const key = m[1].replace(/_([a-z0-9])/g, (x, c) => c.toUpperCase());
    const v = m[2].trim();
    if (v === "true" || v === "false") out[key] = v === "true";
    else if (/^\d+$/.test(v)) out[key] = Number(v);
    else if (/^[A-Z]\w*::[A-Z]\w*$/.test(v)) out[key] = v.split("::")[1].toLowerCase();
    else if (/^"[^"]*"\.into\(\)$/.test(v)) out[key] = v.slice(1, v.indexOf('"', 1));
    else if (v === "String::new()") out[key] = "";
  }
  return out;
}
registerHooks({
  load(url, ctx, next) {
    if (/\.(css|svg|png|webp|woff2?)(\?.*)?$/.test(url)) return { format: "module", source: "export default '';", shortCircuit: true };
    if (url.startsWith("file:") && /\/DeetsMusic\/src\//.test(decodeURIComponent(url)) && !REAL.has(basename(fileURLToPath(url)))) {
      const names = exportNames(readFileSync(fileURLToPath(url), "utf8"));
      return { format: "module", shortCircuit: true, source: STUB + names.map((n) => `export const ${n} = any;`).join("\n") + "\nexport default any;" };
    }
    // The spec list itself is private to its module; expose it to this script only.
    if (/agent-settings\.ts$/.test(url)) {
      const src = readFileSync(fileURLToPath(url), "utf8") + "\nexport { SPECS as __SPECS };\n";
      return { format: "module-typescript", shortCircuit: true, source: src };
    }
    // Tauri answers the two reads the Rust-owned rows make: settings.rs's defaults, and the
    // Run key (on: the first installed run enrolls it, lib.rs `autostart_seeded`).
    if (/@tauri-apps\//.test(url)) {
      return { format: "module", shortCircuit: true, source:
        `const RUST = ${JSON.stringify(rustDefaults())};
         export const invoke = (cmd) => cmd === "settings_get" ? Promise.resolve(RUST)
           : cmd === "autostart_get" ? Promise.resolve(true)
           : Promise.reject(new Error("no tauri: " + cmd));
         export default {};` };
    }
    return next(url, ctx);
  },
});

// Adaptive sound's rows exist only behind its DevTools flag (settings-store.ts), read at load.
localStorage.setItem("deets.dev.adaptiveSound", "on");
const load = (f) => import(pathToFileURL(join(dm, f)).href);
const { REPORTED } = await load("usage-keys.ts");
const agent = await load("agent-settings.ts");
const fresh = await agent.reportedSettings(REPORTED);
const specs = agent.__SPECS.filter((s) => REPORTED.includes(s.key));

/* The rows a fresh install cannot answer alone. Theme and skin follow the OS's light or dark
   mode (look-ids.ts `defaultTheme` / `defaultSkin`), so both of each pair are defaults. The
   surface is where the window was left, not a pick, so it has none. */
const ids = await load("look-ids.ts");
const both = (f) => [false, true].map((dark) => {
  globalThis.matchMedia = () => ({ matches: dark, addEventListener() {}, removeEventListener() {} });
  return f();
});
const SPECIAL = { theme: both(ids.defaultTheme), skin: both(ids.defaultSkin), surface: [] };

const keys = {}, sections = [], problems = [];
specs.forEach((s) => {
  if (!sections.includes(s.section)) sections.push(s.section);
  const options = {};
  (s.options || []).forEach((o) => { options[o.value] = o.label; });
  let def = SPECIAL[s.key] || (fresh[s.key] != null && fresh[s.key] !== "other" ? [fresh[s.key]] : []);
  def = [...new Set(def)];
  if (!SPECIAL[s.key] && !def.length) problems.push(s.key);
  keys[s.key] = { section: s.section, label: s.label, options, def };
});
const missing = REPORTED.filter((k) => !keys[k]);
if (missing.length || problems.length) {
  console.error(`[usage-settings] no spec for: ${missing.join(", ") || "none"}; no default read for: ${problems.join(", ") || "none"}`);
  process.exit(1);
}

const file = [
  "/* GENERATED by `node --import ../DeetsMusic/tests/setup.mjs scripts/build-usage-settings.mjs`",
  "   from DeetsMusic's src/agent-settings.ts, src/settings-store.ts and src-tauri/src/settings.rs.",
  "   Do not edit: regenerate (support.md, \"The dashboard\" › Settings). Each reported setting's",
  "   section, name, option names, and `def`: the value(s) a fresh install reports. */",
  "window.DM_USAGE_SETTINGS = {",
  "  sections: " + JSON.stringify(sections) + ",",
  "  keys: {",
  ...Object.keys(keys).map((k) => "    " + JSON.stringify(k) + ": " + JSON.stringify(keys[k]) + ","),
  "  },",
  "};",
  "",
].join("\n");
writeFileSync(out, file);
console.log(`[usage-settings] wrote ${specs.length} settings in ${sections.length} sections to ${out}`);
