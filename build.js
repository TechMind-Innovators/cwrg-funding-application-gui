#!/usr/bin/env node
/* ============================================================
   CWRG Employer Form — static site generator
   Reads programs.json and writes one self-contained page per
   program to  docs/<collegeSlug>/<programSlug>/index.html

   Usage:  node build.js
   Then:   commit the docs/ folder and push (GitHub Pages serves /docs).

   No external build dependencies — plain Node.
   ============================================================ */

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const CONFIG = path.join(ROOT, "programs.json");
const OUT = path.join(ROOT, "docs");

/* ---------- helpers ---------- */
function slugOk(s) { return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s); }
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// allow a small, safe subset of inline HTML in intro/note copy
function safeInline(s) {
  if (s == null) return "";
  // escape everything, then re-allow <strong> <em> <br>
  let out = esc(s);
  out = out.replace(/&lt;(\/?)(strong|em|br)\s*&gt;/g, "<$1$2>");
  return out;
}
function rimraf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

/* ---------- load config ---------- */
let raw;
try {
  raw = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
} catch (e) {
  console.error("✗ Could not parse programs.json:", e.message);
  process.exit(1);
}
const defaults = raw.defaults || {};
const programs = Array.isArray(raw.programs) ? raw.programs : [];

/* ---------- load shared, program-neutral content from phrasings.json ----------
   Holds: intro (copy), notes (reassurance/footer), questions (neutral definitions),
   and per-question auto-answer pools keyed by question id. */
let sharedIntro = {}, sharedNotes = {}, sharedQuestions = [], phrasings = {};
const PHRASINGS = path.join(ROOT, "phrasings.json");
try {
  if (fs.existsSync(PHRASINGS)) {
    const pr = JSON.parse(fs.readFileSync(PHRASINGS, "utf8"));
    sharedIntro = pr.intro || {};
    sharedNotes = pr.notes || {};
    sharedQuestions = Array.isArray(pr.questions) ? pr.questions : [];
    Object.keys(pr).forEach(function (k) {
      if (!k.startsWith("_") && k !== "intro" && k !== "notes" && k !== "questions") phrasings[k] = pr[k];
    });
  }
} catch (e) {
  console.error("✗ Could not parse phrasings.json:", e.message);
  process.exit(1);
}
if (!sharedQuestions.length) {
  console.error("✗ phrasings.json has no shared `questions` array.");
  process.exit(1);
}
/* ---------- load the BC logo (embedded as a data URI for the PDF header) ---------- */
let logoDataURI = "", logoW = 0, logoH = 0;
const LOGO = path.join(ROOT, "assets", "bc-logo.png");
try {
  if (fs.existsSync(LOGO)) {
    const buf = fs.readFileSync(LOGO);
    logoDataURI = "data:image/png;base64," + buf.toString("base64");
    // PNG dimensions from the IHDR chunk (bytes 16-23)
    logoW = buf.readUInt32BE(16);
    logoH = buf.readUInt32BE(20);
  }
} catch (e) { /* logo optional */ }

if (!programs.length) {
  console.error("✗ No programs defined in programs.json");
  process.exit(1);
}

/* ---------- validate ---------- */
// turn "Sprott Shaw College" into "sprott-shaw-college"
function slugify(s){
  return String(s||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
}
const seen = new Set();
let errors = 0;
programs.forEach((p, i) => {
  const where = `programs[${i}] (${p.programTitle || "untitled"})`;
  ["collegeSlug", "programSlug", "college", "programTitle", "credential"].forEach(k => {
    if (!p[k]) { console.error(`✗ ${where}: missing "${k}"`); errors++; }
  });
  // auto-normalize slugs that aren't already URL-safe, and warn (don't hard-fail)
  ["collegeSlug", "programSlug"].forEach(k => {
    if (p[k] && !slugOk(p[k])) {
      const fixed = slugify(p[k]);
      if (fixed) { console.warn(`  ! ${where}: ${k} "${p[k]}" normalized to "${fixed}"`); p[k] = fixed; }
      else { console.error(`✗ ${where}: ${k} "${p[k]}" can't be turned into a URL slug`); errors++; }
    }
  });
  const key = (p.collegeSlug || "") + "/" + (p.programSlug || "");
  if (seen.has(key)) { console.error(`✗ ${where}: duplicate path "${key}"`); errors++; }
  seen.add(key);
  // questions come from shared phrasings.json; per-program `questions` is only optional overrides
  if (p.questions !== undefined && !Array.isArray(p.questions)) { console.error(`✗ ${where}: optional "questions" must be an array of overrides`); errors++; }
});
if (errors) { console.error(`\n${errors} error(s) — nothing was written.`); process.exit(1); }

/* ---------- render (invoked at the bottom, after templates are defined) ---------- */
function build() {
  rimraf(OUT);
  fs.mkdirSync(OUT, { recursive: true });
  // .nojekyll so GitHub Pages serves files/folders as-is
  fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

  let written = 0;
  programs.forEach(p => {
    const html = renderPage(p, defaults);
    const dir = path.join(OUT, p.collegeSlug, p.programSlug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), html, "utf8");
    console.log(`  ✓ ${p.collegeSlug}/${p.programSlug}/  —  ${p.college} · ${p.programTitle}`);
    written++;
  });
  console.log(`\nDone. ${written} form page(s) written to docs/.`);
  console.log("Next: commit the docs/ folder and push. GitHub Pages (serving /docs) will publish them.");
}

/* ============================================================
   PAGE TEMPLATE
   ============================================================ */
function renderPage(p, d) {
  const charityName = d.charityName || "TechMind Innovators";
  const charityDescriptor = d.charityDescriptor || "a registered Canadian charity";
  // fill {programTitle}/{college}/{charityName} placeholders in shared copy
  const fill = (s) => String(s == null ? "" : s)
    .replace(/\{programTitle\}/g, p.programTitle || "")
    .replace(/\{college\}/g, p.college || "")
    .replace(/\{charityName\}/g, charityName);
  // questions: shared neutral definitions, with optional per-program override by id
  const overrides = {};
  (Array.isArray(p.questions) ? p.questions : []).forEach((q) => { if (q && q.id) overrides[q.id] = q; });
  const questions = sharedQuestions.map((q) => Object.assign({}, q, overrides[q.id] || {}));

  const intro = {
    badge: sharedIntro.badge || "Interactive form",
    heading: sharedIntro.heading || "",
    builtByHtml: safeInline(fill(sharedIntro.builtByHtml || "")),
    timeEstimate: sharedIntro.timeEstimate || "",
    goalHtml: safeInline(fill((p.intro && p.intro.goalHtml) || sharedIntro.goalHtml || ""))
  };

  const data = {
    college: p.college,
    programTitle: p.programTitle,
    credential: p.credential,
    charityName: charityName,
    charityDescriptor: charityDescriptor,
    intro: intro,
    notCommittedNote: safeInline(fill(sharedNotes.notCommittedNote || "")),
    footerNote: safeInline(fill(sharedNotes.footerNote || "")),
    returnInstruction: safeInline(fill(sharedNotes.returnInstruction || "")),
    roles: Array.isArray(p.roles) ? p.roles : [],
    questions: questions,
    phrasings: phrasings,
    logo: logoDataURI || null,
    logoW: logoW || 1,
    logoH: logoH || 1
  };
  const CONFIG_JSON = JSON.stringify(data).replace(/</g, "\\u003c");

  const title = `${data.programTitle} — Employer Form`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="Employer support form for the ${esc(data.programTitle)} program — a collaboration between ${esc(data.charityName)} and ${esc(data.college)}.">
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<style>
${STYLES}
</style>
</head>
<body>
${BODY_HTML}
<script id="program-config" type="application/json">${CONFIG_JSON}</script>
<script>
${APP_JS}
</script>
</body>
</html>
`;
}

/* ---------- STYLES (shared across all pages) ---------- */
const STYLES = String.raw`
  :root {
    --bc-blue: #234075; --bc-gold: #e3a82b;
    --ink: #1a1a1a; --muted: #5b6472;
    --line: #d4d9e0; --line-strong: #9aa3b0;
    --bg: #f4f6f9; --card: #ffffff;
    --subtle: #fafbfc; --subtle-2: #f7f9fc;
    --note-bg: #f0f4fb; --note-border: #d7e1f2; --note-ink: #2b3a57;
    --header-ink: #ffffff;
    --good: #1f8a4c; --good-bg: #ecf8f0;
    --warn: #b4690e; --warn-bg: #fdf3e6;
    --bad: #b42318; --bad-bg: #fdeceb;
    --accent: #234075; --accent-ink: #2d508f; --focus: rgba(35,64,117,.14);
    --radius: 10px;
    --shadow: 0 1px 3px rgba(16,24,40,.06), 0 1px 2px rgba(16,24,40,.04);
  }
  @media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
    --ink:#e8ecf2; --muted:#9aa5b5; --line:#313a47; --line-strong:#4a5564;
    --bg:#11151b; --card:#1a202a; --subtle:#1f2630; --subtle-2:#202834;
    --note-bg:#1b2534; --note-border:#2b3c54; --note-ink:#bcd0ee;
    --good:#4cc47d; --good-bg:#16281d; --warn:#e0a243; --warn-bg:#2a2114;
    --bad:#f0786b; --bad-bg:#2c1817;
    --accent:#7ea2dd; --accent-ink:#9bb8e8; --focus:rgba(126,162,221,.24);
    --shadow:0 1px 3px rgba(0,0,0,.4),0 1px 2px rgba(0,0,0,.3);
    color-scheme: dark;
  }}
  :root[data-theme="dark"]{
    --ink:#e8ecf2; --muted:#9aa5b5; --line:#313a47; --line-strong:#4a5564;
    --bg:#11151b; --card:#1a202a; --subtle:#1f2630; --subtle-2:#202834;
    --note-bg:#1b2534; --note-border:#2b3c54; --note-ink:#bcd0ee;
    --good:#4cc47d; --good-bg:#16281d; --warn:#e0a243; --warn-bg:#2a2114;
    --bad:#f0786b; --bad-bg:#2c1817;
    --accent:#7ea2dd; --accent-ink:#9bb8e8; --focus:rgba(126,162,221,.24);
    --shadow:0 1px 3px rgba(0,0,0,.4),0 1px 2px rgba(0,0,0,.3);
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: var(--ink); background: var(--bg); line-height: 1.5; font-size: 16px;
    -webkit-text-size-adjust: 100%;
  }
  img { max-width: 100%; }

  .topbar { background: var(--bc-blue); color: var(--header-ink); border-bottom: 4px solid var(--bc-gold); }
  .topbar-inner { max-width: 760px; margin: 0 auto; padding: 16px 20px; display: flex; align-items: center; gap: 14px; }
  .crest { width: 40px; height: 40px; flex: none; border-radius: 6px; background: #fff; display: grid; place-items: center; }
  .crest svg { width: 32px; height: 32px; display: block; }
  .topbar h1 { font-size: 1rem; margin: 0; font-weight: 600; letter-spacing: .2px; }
  .topbar p { margin: 2px 0 0; font-size: .8rem; opacity: .88; }

  .wrap { max-width: 760px; margin: 0 auto; padding: 22px 20px 220px; }

  .intro { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 20px 22px; box-shadow: var(--shadow); margin-bottom: 20px; }
  .intro-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
  .intro-badge { font-size: .72rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--accent-ink); background: var(--note-bg); border: 1px solid var(--note-border); border-radius: 99px; padding: 3px 10px; }
  .intro-time { font-size: .82rem; color: var(--muted); font-weight: 500; }
  .intro h2 { margin: 0 0 6px; font-size: 1.12rem; text-wrap: balance; }
  .collab { font-size: .9rem; color: var(--muted); margin: 0 0 12px; }
  .collab strong { color: var(--accent-ink); }
  .intro .goal { margin: 0 0 14px; font-size: .95rem; }
  .note { border-radius: 8px; padding: 12px 15px; font-size: .9rem; margin-top: 4px; }
  .note.reassure { background: var(--good-bg); border: 1px solid var(--good); color: var(--ink); }
  .note.reassure .pill { display:inline-block; font-weight:700; color: var(--good); font-size:.76rem; letter-spacing:.04em; text-transform:uppercase; margin-bottom:4px; }

  .baked { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 14px 0 0; padding: 12px 15px; background: var(--subtle-2); border: 1px solid var(--line); border-radius: 8px; font-size: .88rem; }
  .baked dt { color: var(--muted); font-weight: 500; }
  .baked dd { margin: 0; font-weight: 600; }

  .progress-wrap { margin-top: 18px; }
  .progress-label { font-size: .8rem; color: var(--muted); margin-bottom: 6px; display: flex; justify-content: space-between; }
  .progress-track { height: 8px; background: var(--line); border-radius: 99px; overflow: hidden; }
  .progress-fill { height: 100%; width: 0; background: var(--bc-blue); border-radius: 99px; transition: width .3s ease; }
  @media (prefers-color-scheme: dark){ :root:not([data-theme="light"]) .progress-fill { background: var(--accent); } }
  :root[data-theme="dark"] .progress-fill { background: var(--accent); }

  .section { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); margin-bottom: 18px; overflow: hidden; }
  .section-head { padding: 13px 20px; border-bottom: 1px solid var(--line); background: var(--subtle); }
  .section-head h3 { margin: 0; font-size: .98rem; color: var(--accent-ink); }
  .section-body { padding: 18px 20px; }

  .field { margin-bottom: 20px; }
  .field:last-child { margin-bottom: 0; }
  label.q { display: block; font-weight: 600; font-size: .95rem; margin-bottom: 3px; }
  label.q .num { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--bc-blue); color: #fff; font-size: .76rem; font-weight: 700; margin-right: 8px; vertical-align: middle; }
  .req { color: var(--bad); font-weight: 700; }
  .opt { color: var(--muted); font-weight: 500; font-size: .82rem; }
  .hint { font-size: .85rem; color: var(--muted); margin: 2px 0 9px; }

  input[type=text], input[type=email], input[type=tel], input[type=date], textarea {
    width: 100%; font: inherit; font-size: .95rem; padding: 10px 12px;
    border: 1.5px solid var(--line-strong); border-radius: 8px; background: var(--card); color: var(--ink);
    transition: border-color .15s, box-shadow .15s;
  }
  input::placeholder, textarea::placeholder { color: var(--muted); opacity: .7; }
  input:focus, textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--focus); }
  textarea { resize: vertical; min-height: 84px; }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  @media (max-width: 520px){ .row2 { grid-template-columns: 1fr; } }

  /* suggestions */
  .suggests { margin-top: 9px; display: flex; flex-direction: column; gap: 7px; }
  .suggests-list { display: flex; flex-direction: column; gap: 7px; }
  .suggest-more { align-self: flex-start; margin-top: 2px; }
  .suggests-label { font-size: .78rem; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }
  .suggest { text-align: left; font: inherit; font-size: .86rem; line-height: 1.45; color: var(--ink);
    background: var(--subtle-2); border: 1px solid var(--line); border-radius: 8px; padding: 9px 12px 9px 34px; cursor: pointer; position: relative; transition: border-color .15s, background .15s; }
  .suggest:hover { border-color: var(--accent); }
  .suggest::before { content: "+"; position: absolute; left: 12px; top: 8px; font-weight: 700; color: var(--accent-ink); font-size: 1rem; line-height: 1.2; }
  .suggest .cap { display:block; font-size:.72rem; color: var(--muted); margin-top: 3px; }

  /* roles checklist */
  .roles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  @media (max-width: 520px){ .roles { grid-template-columns: 1fr; } }
  .role { display: flex; align-items: center; gap: 9px; padding: 9px 12px; border: 1.5px solid var(--line-strong); border-radius: 8px; cursor: pointer; font-size: .9rem; transition: border-color .15s, background .15s; }
  .role:hover { border-color: var(--accent); }
  .role input { width: 17px; height: 17px; accent-color: var(--bc-blue); flex: none; }
  .role.checked { border-color: var(--accent); background: var(--note-bg); }
  .roles-other { margin-top: 12px; }
  .roles-other-label { display: block; font-size: .85rem; font-weight: 500; margin-bottom: 5px; color: var(--ink); }
  .roles-other textarea { min-height: 54px; }

  /* role + counter grid (Question 2) */
  .rg-rows { display: flex; flex-direction: column; gap: 8px; }
  .rg-row { display: flex; align-items: center; gap: 10px; }
  .rg-name { flex: 1 1 auto; min-width: 0; font-size: .92rem; }
  .rg-name.rg-fixed { padding: 9px 12px; border: 1.5px solid var(--line); border-radius: 8px; background: var(--subtle); }
  input.rg-name { padding: 9px 12px; border: 1.5px dashed var(--line-strong); border-radius: 8px; background: var(--card); color: var(--ink); font: inherit; font-size: .92rem; }
  input.rg-name:focus { outline: none; border-style: solid; border-color: var(--accent); box-shadow: 0 0 0 3px var(--focus); }
  .rg-step { flex: 0 0 auto; }
  .rg-step button { width: 38px; height: 40px; }
  .rg-step input { width: 52px; }
  .rg-none { display: flex; align-items: center; gap: 9px; margin-top: 12px; font-size: .9rem; cursor: pointer; }
  .rg-none input { width: 17px; height: 17px; accent-color: var(--bc-blue); flex: none; }
  .rg-answer-wrap { margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--line); }
  .rg-answer-label { font-size: .82rem; font-weight: 600; color: var(--accent-ink); margin-bottom: 6px; }
  .rg-answer { width: 100%; font: inherit; font-size: .95rem; padding: 10px 12px; border: 1.5px solid var(--line-strong); border-radius: 8px; background: var(--card); color: var(--ink); resize: vertical; min-height: 74px; }
  .rg-answer:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--focus); }
  .rg-regen { margin-top: 9px; background: var(--card); border: 1.5px solid var(--line-strong); color: var(--accent-ink); font: inherit; font-size: .84rem; font-weight: 600; cursor: pointer; padding: 7px 14px; border-radius: 99px; display: inline-flex; align-items: center; gap: 5px; }
  .rg-regen:hover { border-color: var(--accent); background: var(--subtle); }

  /* source checklist (Question 3) */
  .src-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  @media (max-width: 520px){ .src-list { grid-template-columns: 1fr; } }
  .src-item { display: flex; align-items: center; gap: 9px; padding: 9px 12px; border: 1.5px solid var(--line-strong); border-radius: 8px; cursor: pointer; font-size: .9rem; transition: border-color .15s, background .15s; }
  .src-item:hover { border-color: var(--accent); }
  .src-item input { width: 17px; height: 17px; accent-color: var(--bc-blue); flex: none; }
  .src-item.checked { border-color: var(--accent); background: var(--note-bg); }
  .src-custom-rows { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
  input.src-custom { width: 100%; padding: 9px 12px; border: 1.5px dashed var(--line-strong); border-radius: 8px; background: var(--card); color: var(--ink); font: inherit; font-size: .9rem; }
  input.src-custom:focus { outline: none; border-style: solid; border-color: var(--accent); box-shadow: 0 0 0 3px var(--focus); }

  /* single count + answer (Question 5) */
  .ca-row { display: flex; align-items: center; gap: 10px; }

  /* number stepper */
  .stepper { display: inline-flex; align-items: center; border: 1.5px solid var(--line-strong); border-radius: 8px; overflow: hidden; }
  .stepper button { font: inherit; font-size: 1.1rem; width: 42px; height: 42px; border: none; background: var(--subtle); color: var(--ink); cursor: pointer; }
  .stepper button:hover { background: var(--line); }
  .stepper input { width: 64px; text-align: center; border: none; border-left: 1.5px solid var(--line-strong); border-right: 1.5px solid var(--line-strong); border-radius: 0; font-size: 1rem; -moz-appearance: textfield; }
  .stepper input::-webkit-outer-spin-button, .stepper input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .stepper-unit { margin-left: 10px; color: var(--muted); font-size: .9rem; }

  /* practicum (radio yes/no + conditional) */
  .yesno { display: flex; gap: 10px; margin-bottom: 10px; }
  .yesno label { flex: 1; text-align: center; padding: 9px; border: 1.5px solid var(--line-strong); border-radius: 8px; cursor: pointer; font-size: .9rem; font-weight: 500; }
  .yesno input { position: absolute; opacity: 0; pointer-events: none; }
  .yesno label.sel { border-color: var(--accent); background: var(--note-bg); color: var(--accent-ink); font-weight: 600; }
  .yesno label:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }

  .feedback { font-size: .82rem; margin-top: 7px; min-height: 1em; display: flex; gap: 6px; align-items: flex-start; }
  .feedback.good { color: var(--good); } .feedback.warn { color: var(--warn); } .feedback.bad { color: var(--bad); }
  .feedback svg { flex: none; margin-top: 2px; }

  .certify { display: flex; gap: 10px; align-items: flex-start; background: var(--subtle-2); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; font-size: .9rem; }
  .certify input { margin-top: 3px; width: 18px; height: 18px; flex: none; accent-color: var(--bc-blue); }

  .actionbar { position: fixed; left: 0; right: 0; bottom: 0; background: var(--card); border-top: 1px solid var(--line); box-shadow: 0 -4px 20px rgba(16,24,40,.08); z-index: 50; padding-bottom: env(safe-area-inset-bottom, 0px); }
  .actionbar-inner { max-width: 760px; margin: 0 auto; padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .status-msg { font-size: .85rem; color: var(--muted); min-width: 0; flex: 1 1 140px; }
  .status-msg.done { color: var(--good); font-weight: 500; }
  .status-msg.err { color: var(--bad); font-weight: 500; }
  .btns { display: flex; gap: 10px; flex: 0 0 auto; }
  @media (max-width: 420px){
    .actionbar-inner { padding: 10px 16px; }
    .btns { flex: 1 1 100%; }
    .btns button { flex: 1; }
    button.primary, button.ghost { padding: 11px 12px; }
  }
  button.primary, button.ghost { font: inherit; font-weight: 600; font-size: .92rem; padding: 11px 18px; border-radius: 8px; cursor: pointer; border: 1.5px solid transparent; }
  button.primary { background: var(--bc-blue); color: #fff; }
  button.primary:hover { background: #1b3460; }
  /* muted until the form is complete; still clickable so it can guide the user to what's missing */
  button.primary[aria-disabled="true"] { opacity: .5; }
  button.primary.is-ready { opacity: 1; }
  button.ghost { background: var(--card); color: var(--accent-ink); border-color: var(--line-strong); }
  button.ghost:hover { background: var(--subtle); }

  a:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* iOS zooms the page when a focused input is <16px; force 16px on small screens */
  @media (max-width: 640px){
    input[type=text], input[type=email], input[type=tel], input[type=date], textarea,
    input.rg-name, input.src-custom, .rg-answer, .stepper input, .rg-step input, .ca-step input, .pr-step input { font-size: 16px; }
  }
  .footnote { text-align: center; color: var(--muted); font-size: .78rem; margin-top: 24px; }
  .field.invalid input, .field.invalid textarea { border-color: var(--bad); }
  @media (prefers-reduced-motion: reduce){ * { animation-duration: .001ms !important; transition-duration: .001ms !important; } }
`;

/* ---------- BODY (static shell; fields injected by JS) ---------- */
const BODY_HTML = String.raw`
<div class="topbar">
  <div class="topbar-inner">
    <div class="crest" aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="18" r="8" fill="#e3a82b"/>
        <path d="M4 38 L18 22 L28 32 L38 20 L44 38 Z" fill="#234075"/>
        <rect x="2" y="37" width="44" height="4" fill="#234075"/>
      </svg>
    </div>
    <div>
      <h1>Community Workforce Response Grant</h1>
      <p id="topSub">Employer Support Form</p>
    </div>
  </div>
</div>
<div class="wrap">
  <div class="intro" id="intro"><!-- filled by JS --></div>
  <form id="form"><!-- filled by JS --></form>
  <p class="footnote" id="footnote"></p>
</div>
<div class="actionbar">
  <div class="actionbar-inner">
    <div class="status-msg" id="statusMsg"></div>
    <div class="btns">
      <button type="button" class="ghost" id="resetBtn">Clear</button>
      <button type="button" class="primary" id="downloadBtn" aria-disabled="true">Download completed PDF</button>
    </div>
  </div>
</div>
`;

/* ---------- APP JS (runs on each page, reads #program-config) ---------- */
const APP_JS = String.raw`
(function () {
  "use strict";
  var CFG = JSON.parse(document.getElementById("program-config").textContent);
  var STORAGE_KEY = "cwrg_" + location.pathname;

  var ICON = {
    good: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3 3 7-7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warn: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1.5L15 14H1L8 1.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6v3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.6" r=".9" fill="currentColor"/></svg>'
  };
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  function el(id){ return document.getElementById(id); }
  function words(s){ return (s.trim().match(/\S+/g)||[]).length; }
  // pick up to n distinct random items from arr (order randomized)
  function pickN(arr, n){
    var a = (arr||[]).slice();
    for (var i=a.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=a[i]; a[i]=a[j]; a[j]=t; }
    return a.slice(0, Math.max(0, n));
  }

  /* ---- top subtitle ---- */
  el("topSub").textContent = CFG.programTitle + " · " + CFG.college;

  /* ---- intro ---- */
  var intro = CFG.intro || {};
  el("intro").innerHTML =
    '<div class="intro-top">' +
      (intro.badge ? '<span class="intro-badge">' + esc(intro.badge) + '</span>' : '') +
      (intro.timeEstimate ? '<span class="intro-time">\u23f1\ufe0f ' + esc(intro.timeEstimate) + '</span>' : '') +
    '</div>' +
    (intro.heading ? '<h2>' + esc(intro.heading) + '</h2>' : '') +
    (intro.builtByHtml ? '<p class="collab">' + intro.builtByHtml + '</p>' : '') +
    (intro.goalHtml ? '<p class="goal">' + intro.goalHtml + '</p>' : '') +
    '<div class="note reassure"><span class="pill">No hiring commitment</span><div>' + (CFG.notCommittedNote||'') + '</div></div>' +
    '<dl class="baked">' +
      '<dt>Program</dt><dd>' + esc(CFG.programTitle) + '</dd>' +
      '<dt>Credential</dt><dd>' + esc(CFG.credential) + '</dd>' +
      '<dt>In partnership with</dt><dd>' + esc(CFG.college) + '</dd>' +
    '</dl>' +
    '<div class="progress-wrap"><div class="progress-label"><span>Your progress</span><span id="progressPct">0%</span></div>' +
    '<div class="progress-track"><div class="progress-fill" id="progressFill"></div></div></div>';

  el("footnote").innerHTML = CFG.footerNote || '';

  /* ---- build fields ---- */
  var form = el("form");
  var sec = document.createElement("div"); sec.className = "section";
  sec.innerHTML = '<div class="section-head"><h3>A few questions about your employment needs</h3></div>';
  var body = document.createElement("div"); body.className = "section-body";
  sec.appendChild(body); form.appendChild(sec);

  var qIndex = 0;
  CFG.questions.forEach(function(q){
    qIndex++;
    var f = document.createElement("div");
    f.className = "field"; f.dataset.qid = q.id; f.dataset.type = q.type;
    if (q.optional) f.dataset.optional = "1";

    var optLabel = q.optional ? ' <span class="opt">(optional)</span>' : ' <span class="req">*</span>';
    var head = '<label class="q" for="' + q.id + '"><span class="num">' + qIndex + '</span>' + esc(q.label) + optLabel + '</label>' +
               (q.hint ? '<div class="hint">' + esc(q.hint) + '</div>' : '');

    var hasPool = !!((q.suggestions && q.suggestions.length) ||
      (CFG.phrasings && CFG.phrasings[q.id] && CFG.phrasings[q.id].pool && CFG.phrasings[q.id].pool.length));
    var control = "";
    if (q.type === "textarea") {
      var ph = q.placeholder != null
        ? q.placeholder
        : (hasPool
            ? "Write your answer here — or tap a suggested answer below to start from, then edit it to fit."
            : "Write your answer here…");
      control = '<textarea id="' + q.id + '" rows="3" placeholder="' + esc(ph) + '"></textarea>';
    } else if (q.type === "text") {
      var phT = q.placeholder != null ? q.placeholder : "Write your answer here…";
      control = '<input type="text" id="' + q.id + '" placeholder="' + esc(phT) + '">';
    } else if (q.type === "number") {
      control = numberControl(q);
    } else if (q.type === "roles") {
      control = rolesControl(q);
    } else if (q.type === "rolegrid") {
      control = roleGridControl(q);
    } else if (q.type === "sourcegrid") {
      control = sourceGridControl(q);
    } else if (q.type === "countanswer") {
      control = countAnswerControl(q);
    } else if (q.type === "practicum") {
      control = practicumControl(q);
    }

    // suggestion pool: inline q.suggestions, OR a pool in phrasings[q.id].pool (e.g. Q4).
    // Show at most 2, picked at random at page load. Only for free-text questions
    // (textarea/text) — grid/number/practicum types generate their own answers.
    var canSuggest = (q.type === "textarea" || q.type === "text");
    var pool = !canSuggest ? [] : ((q.suggestions && q.suggestions.length)
      ? q.suggestions
      : ((CFG.phrasings && CFG.phrasings[q.id] && CFG.phrasings[q.id].pool) || []));
    var suggests = "";
    if (pool.length) {
      // the 2 buttons are rendered into .suggests-list by JS (so they can rotate);
      // "Show different examples" re-rolls 2 fresh picks when the pool has more than 2.
      suggests = '<div class="suggests" data-suggest-for="' + q.id + '">' +
        '<div class="suggests-label">Suggested answers — click to use, then add your own detail</div>' +
        '<div class="suggests-list"></div>' +
        (pool.length > 2 ? '<button type="button" class="rg-regen suggest-more" data-suggest-more="' + q.id + '">↺ Show different examples</button>' : '') +
        '</div>';
    }

    f.innerHTML = head + control + suggests + '<div class="feedback"></div>';
    body.appendChild(f);
  });

  /* ---- business/contact section (required: business name, address, email; optional: name, phone, date) ---- */
  var cSec = document.createElement("div"); cSec.className = "section";
  cSec.innerHTML = '<div class="section-head"><h3>Your business &amp; contact details</h3></div>' +
    '<div class="section-body">' +
      field2("businessName", "Business name", "organization", "e.g. Ozz Electric Ltd.") +
      '<div class="field" data-contact="1" data-min="5"><label class="q" for="businessAddress">Business address and/or website <span class="req">*</span></label>' +
        '<div class="hint">Both your full address and website is best, but a website on its own is fine too.</div>' +
        '<input type="text" id="businessAddress" placeholder="e.g. 101 – 1680 Broadway St, Port Coquitlam, BC · www.example.com"><div class="feedback"></div></div>' +
      '<div class="row2">' +
        '<div class="field" data-contact="1" data-kind="email"><label class="q" for="repEmail">Representative email <span class="req">*</span></label>' +
          '<div class="hint">Where the charity can reach you if they have a question.</div>' +
          '<input type="email" id="repEmail" autocomplete="email" placeholder="name@company.com"><div class="feedback"></div></div>' +
        field2opt("repName", "Representative name & title", "name", "e.g. Cara Ramage – HR Manager") +
      '</div>' +
      '<div class="row2">' +
        '<div class="field" data-contact="1" data-optional="1" data-kind="tel"><label class="q" for="repPhone">Representative phone <span class="opt">(optional)</span></label><input type="tel" id="repPhone" autocomplete="tel" placeholder="604-555-1234"><div class="feedback"></div></div>' +
        '<div class="field" data-contact="1" data-optional="1"><label class="q" for="formDate">Date</label><input type="date" id="formDate"><div class="feedback"></div></div>' +
      '</div>' +
    '</div>';
  form.appendChild(cSec);

  /* ---- certification (at the very end, after the business details it refers to) ---- */
  var certSec = document.createElement("div"); certSec.className = "section";
  var certBody = document.createElement("div"); certBody.className = "section-body";
  var cert = document.createElement("div"); cert.className = "field";
  cert.innerHTML = '<div class="certify"><input type="checkbox" id="certify"><label for="certify" style="font-weight:500;cursor:pointer;">' +
    'I confirm I’m authorized to submit this on behalf of the business above, and that the information is correct to the best of my knowledge. <span class="req">*</span></label></div>';
  certBody.appendChild(cert); certSec.appendChild(certBody);
  form.appendChild(certSec);

  function field2(id, label, ac, ph, min) {
    return '<div class="field" data-contact="1"' + (min?' data-min="'+min+'"':'') + '>' +
      '<label class="q" for="' + id + '">' + esc(label) + ' <span class="req">*</span></label>' +
      '<input type="text" id="' + id + '" autocomplete="' + ac + '" placeholder="' + esc(ph) + '"><div class="feedback"></div></div>';
  }
  function field2opt(id, label, ac, ph) {
    return '<div class="field" data-contact="1" data-optional="1">' +
      '<label class="q" for="' + id + '">' + esc(label) + ' <span class="opt">(optional)</span></label>' +
      '<input type="text" id="' + id + '" autocomplete="' + ac + '" placeholder="' + esc(ph) + '"><div class="feedback"></div></div>';
  }
  function numberControl(q){
    var min = q.min!=null?q.min:0, max = q.max!=null?q.max:99, step = q.step||1;
    return '<div class="stepper" data-min="'+min+'" data-max="'+max+'" data-step="'+step+'">' +
      '<button type="button" data-step-dir="-1" aria-label="decrease">−</button>' +
      '<input type="text" inputmode="numeric" id="'+q.id+'" value="0">' +
      '<button type="button" data-step-dir="1" aria-label="increase">+</button>' +
      '</div>' + (q.unit?'<span class="stepper-unit">'+esc(q.unit)+'</span>':'');
  }
  // Role + counter grid: preset roles each with a stepper, plus blank custom rows,
  // a "no openings" toggle, and a live auto-generated (editable) Q2 answer box.
  function roleGridControl(q){
    var presets = CFG.roles || [];
    var CUSTOM_ROWS = 3;
    function row(name, i, isCustom){
      var rid = q.id + "_r" + i;
      return '<div class="rg-row' + (isCustom?' rg-custom':'') + '">' +
        (isCustom
          ? '<input type="text" class="rg-name" id="'+rid+'_name" placeholder="Add a role…" data-rg="'+q.id+'">'
          : '<span class="rg-name rg-fixed" id="'+rid+'_name" data-role-name="'+esc(name)+'">'+esc(name)+'</span>') +
        '<div class="stepper rg-step" data-min="0" data-max="99" data-step="1" data-rg="'+q.id+'">' +
          '<button type="button" data-step-dir="-1" aria-label="decrease">−</button>' +
          '<input type="text" inputmode="numeric" id="'+rid+'_n" value="0" aria-label="number of openings">' +
          '<button type="button" data-step-dir="1" aria-label="increase">+</button>' +
        '</div></div>';
    }
    var out = '<div class="rolegrid" id="'+q.id+'" data-rolegrid="'+q.id+'">';
    out += '<div class="rg-rows">';
    presets.forEach(function(r,i){ out += row(r, i, false); });
    for (var c=0;c<CUSTOM_ROWS;c++){ out += row("", presets.length + c, true); }
    out += '</div>';
    // "no openings right now" toggle
    out += '<label class="rg-none"><input type="checkbox" id="'+q.id+'_none" data-rg="'+q.id+'">' +
           '<span>No vacancies right now — but note our interest for the future</span></label>';
    // live, editable generated answer
    out += '<div class="rg-answer-wrap">' +
      '<div class="rg-answer-label">✓ We drafted this answer for you <span class="opt">— please check it fits, and feel free to edit or add more detail</span></div>' +
      '<textarea id="'+q.id+'_answer" class="rg-answer" rows="3" data-rg-answer="'+q.id+'" placeholder="Set a number beside a role above, or tick “No vacancies right now”, and we’ll draft your answer here."></textarea>' +
      '<button type="button" class="rg-regen" data-rg-regen="'+q.id+'" hidden>↺ Rewrite it differently</button>' +
      '</div>';
    out += '</div>';
    return out;
  }
  // Source checklist (Question 3): common sources to tick + custom rows + auto-generated answer.
  // Sources come from this question's phrasings entry (CFG.phrasings[q.id].sources).
  function sourceGridControl(q){
    var pool = (CFG.phrasings && CFG.phrasings[q.id]) || {};
    var sources = pool.sources || [];
    var CUSTOM = 3;
    var out = '<div class="sourcegrid" id="'+q.id+'" data-sourcegrid="'+q.id+'">';
    out += '<div class="src-list">';
    sources.forEach(function(s, i){
      out += '<label class="src-item"><input type="checkbox" class="src-check" value="'+esc(s)+'" data-sg="'+q.id+'"><span>'+esc(s)+'</span></label>';
    });
    out += '</div>';
    out += '<div class="src-custom-rows">';
    for (var c=0;c<CUSTOM;c++){
      out += '<input type="text" class="src-custom" id="'+q.id+'_c'+c+'" placeholder="Add another source…" data-sg="'+q.id+'">';
    }
    out += '</div>';
    out += '<div class="rg-answer-wrap">' +
      '<div class="rg-answer-label">✓ We drafted this answer for you <span class="opt">— please check it fits, and feel free to edit or add more detail</span></div>' +
      '<textarea id="'+q.id+'_answer" class="rg-answer" rows="2" data-sg-answer="'+q.id+'" placeholder="Tick the places you post, or add your own, and we’ll draft your answer here."></textarea>' +
      '<button type="button" class="rg-regen" data-sg-regen="'+q.id+'" hidden>↺ Rewrite it differently</button>' +
      '</div>';
    out += '</div>';
    return out;
  }
  // Single count + auto-generated answer (Question 5): one stepper, a "none" toggle,
  // and a live editable answer from this question's phrasing pool (slot {n}).
  function countAnswerControl(q){
    var max = q.max!=null?q.max:50, step = q.step||1;
    var unit = q.unit || "anticipated openings";
    var out = '<div class="countanswer" id="'+q.id+'" data-countanswer="'+q.id+'">';
    out += '<div class="ca-row">' +
      '<div class="stepper ca-step" data-min="0" data-max="'+max+'" data-step="'+step+'">' +
        '<button type="button" data-step-dir="-1" aria-label="decrease">−</button>' +
        '<input type="text" inputmode="numeric" id="'+q.id+'_n" value="0" aria-label="'+esc(unit)+'">' +
        '<button type="button" data-step-dir="1" aria-label="increase">+</button>' +
      '</div><span class="stepper-unit">'+esc(unit)+'</span></div>';
    out += '<label class="rg-none"><input type="checkbox" id="'+q.id+'_none" data-ca="'+q.id+'">' +
           '<span>No specific number yet — but note our future interest</span></label>';
    out += '<div class="rg-answer-wrap">' +
      '<div class="rg-answer-label">✓ We drafted this answer for you <span class="opt">— please check it fits, and feel free to edit or add more detail</span></div>' +
      '<textarea id="'+q.id+'_answer" class="rg-answer" rows="2" data-ca-answer="'+q.id+'" placeholder="Set a number above, or tick “No specific number yet”, and we’ll draft your answer here."></textarea>' +
      '<button type="button" class="rg-regen" data-ca-regen="'+q.id+'" hidden>↺ Rewrite it differently</button>' +
      '</div>';
    out += '</div>';
    return out;
  }
  function rolesControl(q){
    var hasPreset = (CFG.roles||[]).length > 0;
    var out = '<div class="roles-group" data-roles-group="'+q.id+'">';
    if (hasPreset) {
      out += '<div class="roles" id="'+q.id+'" data-roles="1">';
      (CFG.roles||[]).forEach(function(r){
        out += '<label class="role"><input type="checkbox" value="'+esc(r)+'"><span>'+esc(r)+'</span></label>';
      });
      out += '</div>';
    } else {
      // no preset roles configured — still need the container for querying
      out += '<div class="roles" id="'+q.id+'" data-roles="1" hidden></div>';
    }
    // free-text "other roles" — one per line or comma-separated
    out += '<div class="roles-other">' +
      '<label class="roles-other-label" for="'+q.id+'_other">' +
        (hasPreset ? 'Other roles not listed above' : 'List the roles graduates could fill') +
        ' <span class="opt">(one per line, or separated by commas)</span></label>' +
      '<textarea id="'+q.id+'_other" data-roles-other="'+q.id+'" rows="2" placeholder="e.g. Survey Assistant, Design Coordinator"></textarea>' +
      '</div>';
    out += '</div>';
    return out;
  }
  // collect checked preset roles + any typed in the "other" box, de-duplicated, order preserved
  function collectRoles(qid){
    var list = [];
    document.querySelectorAll('#'+qid+' input:checked').forEach(function(cb){ list.push(cb.value); });
    var other = el(qid+"_other");
    if (other && other.value.trim()){
      other.value.split(/[\n,;]+/).forEach(function(part){
        var r = part.trim();
        if (r && list.indexOf(r) === -1) list.push(r);
      });
    }
    return list;
  }
  function practicumControl(q){
    return '<div data-practicum="1" id="'+q.id+'">' +
      '<div class="yesno">' +
        '<label data-val="yes"><input type="radio" name="'+q.id+'_yn" value="yes">Yes, we could host</label>' +
        '<label data-val="no"><input type="radio" name="'+q.id+'_yn" value="no">No, not at this time</label>' +
      '</div>' +
      '<div class="practicum-detail" hidden>' +
        '<div class="ca-row">' +
          '<div class="stepper pr-step" data-min="1" data-max="20" data-step="1">' +
            '<button type="button" data-step-dir="-1" aria-label="decrease">−</button>' +
            '<input type="text" inputmode="numeric" id="'+q.id+'_count" value="1" aria-label="placements">' +
            '<button type="button" data-step-dir="1" aria-label="increase">+</button>' +
          '</div><span class="stepper-unit">placement(s)</span>' +
        '</div>' +
      '</div>' +
      // auto-generated, editable answer (appears once Yes/No is chosen)
      '<div class="rg-answer-wrap" data-pr-answerwrap="'+q.id+'" hidden>' +
        '<div class="rg-answer-label">✓ We drafted this answer for you <span class="opt">— please check it fits, and feel free to edit or add more detail</span></div>' +
        '<textarea id="'+q.id+'_answer" class="rg-answer" rows="2" data-pr-answer="'+q.id+'" placeholder="Choose Yes or No above and we’ll draft your answer here."></textarea>' +
        '<button type="button" class="rg-regen" data-pr-regen="'+q.id+'" hidden>↺ Rewrite it differently</button>' +
      '</div>' +
      '</div>';
  }

  /* default date */
  el("formDate").value = new Date().toISOString().slice(0,10);

  /* ================= interactions ================= */
  var touched = {};  // tracks which number/roles/practicum questions the employer has engaged
  var initializing = true;  // true only during the initial render/restore; user edits clear "restored"
  // after a user interaction, a saved-wording box should regenerate on the next refresh
  function clearRestored(qid){ if (initializing) return; var b=el(qid+"_answer"); if(b) delete b.dataset.restored; }
  // grow a textarea to fit its content so the whole drafted answer is visible
  function autogrow(ta){ if(!ta) return; ta.style.height="auto"; ta.style.height=(ta.scrollHeight+2)+"px"; }
  // add ArrowUp/ArrowDown keyboard support to a stepper's number input
  function wireStepperKeys(input, min, max, step, onChange){
    input.addEventListener("keydown", function(e){
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      var v = parseInt(input.value,10); if(isNaN(v)) v=min;
      v += (e.key==="ArrowUp"?step:-step);
      v = Math.max(min, Math.min(max, v));
      input.value = v;
      if (onChange) onChange();
    });
  }

  /* ---- suggestions: 2 shown, rotatable through the pool ---- */
  function suggestPool(qid){
    var q = null; CFG.questions.forEach(function(x){ if(x.id===qid) q=x; });
    if (!q) return [];
    return (q.suggestions && q.suggestions.length) ? q.suggestions
      : ((CFG.phrasings && CFG.phrasings[qid] && CFG.phrasings[qid].pool) || []);
  }
  // render 2 (new random) suggestion buttons into a question's list
  function renderSuggestions(qid){
    var wrap = document.querySelector('[data-suggest-for="'+qid+'"]');
    if (!wrap) return;
    var listEl = wrap.querySelector('.suggests-list');
    var picks = pickN(suggestPool(qid), 2);
    listEl.innerHTML = "";
    picks.forEach(function(s){
      var b = document.createElement("button");
      b.type = "button"; b.className = "suggest";
      b.textContent = s;            // textContent avoids any escaping issues
      b._text = s;                  // keep the raw text for insertion
      listEl.appendChild(b);
    });
  }
  document.querySelectorAll('[data-suggest-for]').forEach(function(wrap){
    renderSuggestions(wrap.getAttribute('data-suggest-for'));
  });
  // delegated click: insert a suggestion (buttons are re-created on rotate)
  document.getElementById("form").addEventListener("click", function(ev){
    var btn = ev.target.closest(".suggest");
    if (!btn) return;
    var wrap = btn.closest("[data-suggest-for]");
    var qid = wrap ? wrap.getAttribute("data-suggest-for") : null;
    if (!qid) return;
    var t = el(qid), text = btn._text != null ? btn._text : btn.textContent;
    var existing = (t.value||"").trim();
    // Only confirm before overwriting text the employer typed/edited themselves.
    // Swapping between suggestions (box still holds an unedited inserted one) is instant.
    if (existing && t.dataset.fromSuggestion !== "1") {
      if (!window.confirm("Replace what you've written with this example? You can edit it afterwards.")) return;
    }
    t.value = text;
    t.dispatchEvent(new Event("input", {bubbles:true}));   // programmatic (isTrusted=false)
    t.dataset.fromSuggestion = "1";                        // mark AFTER dispatch so the listener's clear doesn't win
    t.focus();
    try { t.setSelectionRange(t.value.length, t.value.length); } catch(e){}
  });
  // "Show different examples" — re-roll 2 fresh picks from the pool
  document.querySelectorAll("[data-suggest-more]").forEach(function(btn){
    btn.addEventListener("click", function(){ renderSuggestions(btn.getAttribute("data-suggest-more")); });
  });
  // steppers (standalone number & practicum) — clamp on every input, mark touched on interaction.
  // Role-grid steppers (.rg-step) are handled by their own block below.
  document.querySelectorAll(".stepper").forEach(function(st){
    if (st.classList.contains("rg-step") || st.classList.contains("ca-step") || st.classList.contains("pr-step")) return;
    var input = st.querySelector("input");
    var min = +st.dataset.min, max = +st.dataset.max, step = +st.dataset.step;
    var qid = input.id.replace(/_count$/, "");
    function clamp(v){ v = parseInt(v,10); if(isNaN(v)) v=min; return Math.max(min, Math.min(max, v)); }
    st.querySelectorAll("button").forEach(function(b){
      b.addEventListener("click", function(){ touched[qid]=true; input.value = clamp((+input.value||0) + step*(+b.dataset.stepDir)); input.dispatchEvent(new Event("input",{bubbles:true})); });
    });
    input.addEventListener("input", function(){ touched[qid]=true; recompute(); });
    input.addEventListener("blur", function(){ input.value = clamp(input.value); recompute(); });
    input.addEventListener("keydown", function(e){
      if (e.key === "ArrowUp"){ e.preventDefault(); touched[qid]=true; input.value = clamp((+input.value||0)+step); input.dispatchEvent(new Event("input",{bubbles:true})); }
      if (e.key === "ArrowDown"){ e.preventDefault(); touched[qid]=true; input.value = clamp((+input.value||0)-step); input.dispatchEvent(new Event("input",{bubbles:true})); }
    });
  });

  /* ---- role-grid (Question 2): steppers + custom rows + "none" toggle + auto-answer ---- */
  function rgClamp(v){ v = parseInt(v,10); if(isNaN(v)||v<0) v=0; return Math.min(99, v); }
  // gather [{name, count}] for a role-grid question (only rows with a name and count>0)
  function rgRoles(qid){
    var list = [];
    document.querySelectorAll('#'+qid+' .rg-row').forEach(function(rowEl){
      var nameEl = rowEl.querySelector('.rg-name');
      var name = nameEl.classList.contains('rg-fixed') ? nameEl.getAttribute('data-role-name') : (nameEl.value||'').trim();
      var n = rgClamp(rowEl.querySelector('.rg-step input').value);
      if (name && n > 0) list.push({ name: name, count: n });
    });
    return list;
  }
  function rgNone(qid){ var c = el(qid+'_none'); return !!(c && c.checked); }
  // pluralize a role name simply for counts > 1
  function pluralize(name){
    if (/s$/i.test(name)) return name;                 // already plural-ish
    if (/(ch|sh|x|z)$/i.test(name)) return name + "es";
    if (/[^aeiou]y$/i.test(name)) return name.replace(/y$/i, "ies");
    return name + "s";
  }
  // natural-prose list: "2 Estimators, a BIM Designer, and 3 CAD Technicians"
  function rolesPhrase(list){
    var parts = list.map(function(r){
      if (r.count > 1) return r.count + " " + pluralize(r.name);
      var article = /^[aeiou]/i.test(r.name) ? "an " : "a ";
      return article + r.name;
    });
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[0] + " and " + parts[1];
    return parts.slice(0, -1).join(", ") + ", and " + parts[parts.length - 1];
  }
  function pick(arr){ return arr && arr.length ? arr[Math.floor(Math.random()*arr.length)] : ""; }
  // generate the Q2 answer text for current state, from this question's phrasing pool
  function rgGenerate(qid){
    var pool = (CFG.phrasings && CFG.phrasings[qid]) || {};
    var list = rgRoles(qid);
    if (list.length > 0){
      var tmpl = pick(pool.positive) || "Yes. Graduates could fill {roles}.";
      return tmpl.replace(/\{roles\}/g, rolesPhrase(list));
    }
    if (rgNone(qid)){
      return pick(pool.negative) || "No openings right now, but we'd welcome qualified graduates as we grow.";
    }
    return "";
  }
  // write a fresh generated answer into the box (unless the employer has hand-edited it)
  function rgRefresh(qid, force){
    var box = el(qid+'_answer');
    if (!box) return;
    clearRestored(qid);
    var regenBtn = document.querySelector('[data-rg-regen="'+qid+'"]');
    var list = rgRoles(qid), none = rgNone(qid);
    var hasBasis = list.length > 0 || none;
    if (regenBtn) regenBtn.hidden = !hasBasis;
    if (!hasBasis){ if (!box.dataset.edited){ box.value=""; } validateRoleGrid(qid); recompute(); return; }
    // only auto-overwrite if the employer hasn't manually edited the text
    if (force || (!box.dataset.edited && !box.dataset.restored)){
      box.value = rgGenerate(qid);
    }
    autogrow(box); validateRoleGrid(qid); recompute();
  }
  document.querySelectorAll('[data-rolegrid]').forEach(function(grid){
    var qid = grid.getAttribute('data-rolegrid');
    // steppers
    grid.querySelectorAll('.rg-step').forEach(function(st){
      var input = st.querySelector('input');
      st.querySelectorAll('button').forEach(function(b){
        b.addEventListener('click', function(){ touched[qid]=true; input.value = rgClamp((+input.value||0) + (+b.dataset.stepDir)); rgRefresh(qid); });
      });
      input.addEventListener('input', function(){ touched[qid]=true; input.value = input.value.replace(/[^0-9]/g,''); rgRefresh(qid); });
      input.addEventListener('blur', function(){ input.value = rgClamp(input.value); rgRefresh(qid); });
      wireStepperKeys(input, 0, 99, 1, function(){ touched[qid]=true; rgRefresh(qid); });
    });
    // custom role name inputs
    grid.querySelectorAll('.rg-custom .rg-name').forEach(function(nm){
      nm.addEventListener('input', function(){ touched[qid]=true; rgRefresh(qid); });
    });
    // "no openings" toggle — mutually exclusive-ish with counts
    var none = el(qid+'_none');
    if (none) none.addEventListener('change', function(){
      touched[qid]=true;
      if (none.checked){ // clearing counts would be destructive; just let generate prefer counts if present
      }
      rgRefresh(qid, true); // force a fresh suggestion on toggle
    });
    // mark the answer box as hand-edited once the user types in it
    var box = el(qid+'_answer');
    if (box) box.addEventListener('input', function(){ box.dataset.edited = "1"; touched[qid]=true; autogrow(box); validateRoleGrid(qid); recompute(); });
    // regenerate button — fresh random phrasing, clears the hand-edited flag
    var regen = document.querySelector('[data-rg-regen="'+qid+'"]');
    if (regen) regen.addEventListener('click', function(){ if(box) delete box.dataset.edited; rgRefresh(qid, true); if(box) box.focus(); });
  });

  /* ---- source-grid (Question 3): checklist + custom + auto-answer ---- */
  function sgSources(qid){
    var list = [];
    document.querySelectorAll('#'+qid+' .src-check:checked').forEach(function(cb){ if(list.indexOf(cb.value)===-1) list.push(cb.value); });
    document.querySelectorAll('#'+qid+' .src-custom').forEach(function(inp){
      var v=(inp.value||'').trim(); if(v && list.indexOf(v)===-1) list.push(v);
    });
    return list;
  }
  // natural list of sources (no articles/pluralization — they're already phrases)
  function sourcesPhrase(list){
    if (list.length === 1) return list[0];
    if (list.length === 2) return list[0] + " and " + list[1];
    return list.slice(0,-1).join(", ") + ", and " + list[list.length-1];
  }
  function sgGenerate(qid){
    var pool = (CFG.phrasings && CFG.phrasings[qid]) || {};
    var list = sgSources(qid);
    if (!list.length) return "";
    var tmpl = pick(pool.templates) || "We post our openings on {sources}.";
    return tmpl.replace(/\{sources\}/g, sourcesPhrase(list));
  }
  function sgRefresh(qid, force){
    var box = el(qid+'_answer'); if(!box) return;
    clearRestored(qid);
    var regenBtn = document.querySelector('[data-sg-regen="'+qid+'"]');
    var list = sgSources(qid);
    if (regenBtn) regenBtn.hidden = (list.length===0);
    if (!list.length){ if(!box.dataset.edited) box.value=""; validateSourceGrid(qid); recompute(); return; }
    if (force || (!box.dataset.edited && !box.dataset.restored)){ box.value = sgGenerate(qid); }
    autogrow(box); validateSourceGrid(qid); recompute();
  }
  document.querySelectorAll('[data-sourcegrid]').forEach(function(grid){
    var qid = grid.getAttribute('data-sourcegrid');
    grid.querySelectorAll('.src-check').forEach(function(cb){
      cb.addEventListener('change', function(){ touched[qid]=true; cb.closest('.src-item').classList.toggle('checked', cb.checked); sgRefresh(qid); });
    });
    grid.querySelectorAll('.src-custom').forEach(function(inp){
      inp.addEventListener('input', function(){ if(inp.value.trim()) touched[qid]=true; sgRefresh(qid); });
    });
    var box = el(qid+'_answer');
    if (box) box.addEventListener('input', function(){ box.dataset.edited="1"; touched[qid]=true; autogrow(box); validateSourceGrid(qid); recompute(); });
    var regen = document.querySelector('[data-sg-regen="'+qid+'"]');
    if (regen) regen.addEventListener('click', function(){ if(box) delete box.dataset.edited; sgRefresh(qid, true); if(box) box.focus(); });
  });

  /* ---- count-answer (Question 5): single stepper + "none" toggle + auto-answer ---- */
  function caValue(qid){ var e=el(qid+'_n'); var v=parseInt(e?e.value:'',10); return isNaN(v)?0:Math.max(0,v); }
  function caNone(qid){ var c=el(qid+'_none'); return !!(c && c.checked); }
  function caGenerate(qid){
    var pool = (CFG.phrasings && CFG.phrasings[qid]) || {};
    var n = caValue(qid);
    if (n > 0){
      var tmpl = pick(pool.positive) || "Yes — we anticipate about {n} openings over the next 6 to 12 months.";
      return tmpl.replace(/\{n\}/g, n);
    }
    if (caNone(qid)){
      return pick(pool.negative) || "No specific number yet, but we expect to need these skills as we grow.";
    }
    return "";
  }
  function caRefresh(qid, force){
    var box = el(qid+'_answer'); if(!box) return;
    clearRestored(qid);
    var regenBtn = document.querySelector('[data-ca-regen="'+qid+'"]');
    var n = caValue(qid), none = caNone(qid);
    var hasBasis = n > 0 || none;
    if (regenBtn) regenBtn.hidden = !hasBasis;
    if (!hasBasis){ if(!box.dataset.edited) box.value=""; validateCountAnswer(qid); recompute(); return; }
    if (force || (!box.dataset.edited && !box.dataset.restored)){ box.value = caGenerate(qid); }
    autogrow(box); validateCountAnswer(qid); recompute();
  }
  document.querySelectorAll('[data-countanswer]').forEach(function(ca){
    var qid = ca.getAttribute('data-countanswer');
    var st = ca.querySelector('.ca-step'), input = st.querySelector('input');
    var max = +st.dataset.max, step = +st.dataset.step;
    function clamp(v){ v=parseInt(v,10); if(isNaN(v)||v<0) v=0; return Math.min(max, v); }
    st.querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){ touched[qid]=true; input.value = clamp((+input.value||0) + step*(+b.dataset.stepDir)); caRefresh(qid); });
    });
    input.addEventListener('input', function(){ touched[qid]=true; input.value = input.value.replace(/[^0-9]/g,''); caRefresh(qid); });
    input.addEventListener('blur', function(){ input.value = clamp(input.value); caRefresh(qid); });
    wireStepperKeys(input, 0, max, step, function(){ touched[qid]=true; caRefresh(qid); });
    var none = el(qid+'_none');
    if (none) none.addEventListener('change', function(){ touched[qid]=true; caRefresh(qid, true); });
    var box = el(qid+'_answer');
    if (box) box.addEventListener('input', function(){ box.dataset.edited="1"; touched[qid]=true; autogrow(box); validateCountAnswer(qid); recompute(); });
    var regen = document.querySelector('[data-ca-regen="'+qid+'"]');
    if (regen) regen.addEventListener('click', function(){ if(box) delete box.dataset.edited; caRefresh(qid, true); if(box) box.focus(); });
  });

  // roles — preset checkboxes
  document.querySelectorAll(".role input").forEach(function(cb){
    cb.addEventListener("change", function(){
      var holder = cb.closest("[data-roles]");
      touched[holder.id] = true;
      cb.closest(".role").classList.toggle("checked", cb.checked);
      validateRoles(holder.id); recompute();
    });
  });
  // roles — free-text "other" box
  document.querySelectorAll("[data-roles-other]").forEach(function(ta){
    var qid = ta.getAttribute("data-roles-other");
    ta.addEventListener("input", function(){ if(ta.value.trim()) touched[qid]=true; validateRoles(qid); recompute(); });
  });
  /* ---- practicum (Question 6): yes/no + count (if yes) + auto-generated answer ---- */
  function prYN(qid){ var r=document.querySelector('input[name="'+qid+'_yn"]:checked'); return r?r.value:""; }
  function prCount(qid){ var e=el(qid+'_count'); var v=parseInt(e?e.value:'',10); return isNaN(v)?1:Math.max(1,v); }
  function prGenerate(qid){
    var pool = (CFG.phrasings && CFG.phrasings[qid]) || {};
    var yn = prYN(qid);
    if (yn === "yes"){
      var tmpl = pick(pool.positive) || "Yes, in principle we could host {n}.";
      var n = prCount(qid);
      var nPhrase = (n > 1) ? (n + " students") : "a student";
      return tmpl.replace(/\{n\}/g, nPhrase);
    }
    if (yn === "no"){
      return pick(pool.negative) || "Not at this time, but we think placements are a great idea and would revisit it.";
    }
    return "";
  }
  function prRefresh(qid, force){
    var box = el(qid+'_answer'); if(!box) return;
    clearRestored(qid);
    var wrap = document.querySelector('[data-pr-answerwrap="'+qid+'"]');
    var regenBtn = document.querySelector('[data-pr-regen="'+qid+'"]');
    var yn = prYN(qid);
    var hasBasis = (yn === "yes" || yn === "no");
    if (wrap) wrap.hidden = !hasBasis;
    if (regenBtn) regenBtn.hidden = !hasBasis;
    if (!hasBasis){ if(!box.dataset.edited) box.value=""; validatePracticum(qid); recompute(); return; }
    if (force || (!box.dataset.edited && !box.dataset.restored)){ box.value = prGenerate(qid); }
    autogrow(box); validatePracticum(qid); recompute();
  }
  document.querySelectorAll("[data-practicum]").forEach(function(pr){
    var qid = pr.id;
    var detail = pr.querySelector(".practicum-detail");
    pr.querySelectorAll(".yesno input").forEach(function(r){
      r.addEventListener("change", function(){
        touched[qid] = true;
        pr.querySelectorAll(".yesno label").forEach(function(l){ l.classList.toggle("sel", l.dataset.val === r.value); });
        detail.hidden = (r.value !== "yes");
        prRefresh(qid, true); // fresh suggestion whenever yes/no changes
      });
    });
    // count stepper (only relevant when "yes")
    var st = pr.querySelector('.pr-step');
    if (st){
      var input = st.querySelector('input');
      var max = +st.dataset.max, step = +st.dataset.step;
      function clamp(v){ v=parseInt(v,10); if(isNaN(v)||v<1) v=1; return Math.min(max, v); }
      st.querySelectorAll('button').forEach(function(b){
        b.addEventListener('click', function(){ touched[qid]=true; input.value = clamp((+input.value||1) + step*(+b.dataset.stepDir)); prRefresh(qid); });
      });
      input.addEventListener('input', function(){ touched[qid]=true; input.value=input.value.replace(/[^0-9]/g,''); prRefresh(qid); });
      input.addEventListener('blur', function(){ input.value = clamp(input.value); prRefresh(qid); });
      wireStepperKeys(input, 1, max, step, function(){ touched[qid]=true; prRefresh(qid); });
    }
    var box = el(qid+'_answer');
    if (box) box.addEventListener('input', function(){ box.dataset.edited="1"; touched[qid]=true; autogrow(box); validatePracticum(qid); recompute(); });
    var regen = document.querySelector('[data-pr-regen="'+qid+'"]');
    if (regen) regen.addEventListener('click', function(){ if(box) delete box.dataset.edited; prRefresh(qid, true); if(box) box.focus(); });
  });

  /* ---- validation + progress ---- */
  var contactFields = [].slice.call(document.querySelectorAll('[data-contact="1"]'));
  var requiredContacts = contactFields.filter(function(f){ return f.dataset.optional !== "1"; });
  contactFields.forEach(function(f){
    var input = f.querySelector("input");
    input.addEventListener("input", function(){ validateContact(f); recompute(); });
    input.addEventListener("blur", function(){ validateContact(f); });
  });
  el("certify").addEventListener("change", recompute);
  CFG.questions.forEach(function(q){
    if (q.type === "textarea" || q.type === "text") {
      var ctl = el(q.id);
      ctl.addEventListener("input", function(ev){ if(ev && ev.isTrusted) delete ctl.dataset.fromSuggestion; if(ctl.tagName==="TEXTAREA") autogrow(ctl); validateQ(q); recompute(); });
      ctl.addEventListener("blur", function(){ validateQ(q); });
    }
  });
  // every textarea grows to fit its content so nothing is hidden; also catches the
  // "other roles" box and the practicum note. Runs once at init for restored drafts.
  form.querySelectorAll("textarea").forEach(function(ta){
    ta.addEventListener("input", function(){ autogrow(ta); });
    autogrow(ta);
  });

  function setFb(fb, kind, msg){ fb.className = "feedback" + (kind?" "+kind:""); fb.innerHTML = msg ? ((ICON[kind]||"")+"<span>"+esc(msg)+"</span>") : ""; }

  function validateContact(f){
    var input = f.querySelector("input"), fb = f.querySelector(".feedback"), v = input.value.trim();
    if (!v){ setFb(fb,"",""); return false; }
    if (f.dataset.kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)){ setFb(fb,"warn","That doesn't look like a complete email."); return false; }
    if (f.dataset.kind === "tel" && v.replace(/\D/g,"").length < 10){ setFb(fb,"warn","Please include a full 10-digit phone number."); return true; }
    var min = +(f.dataset.min||0);
    if (min && v.length < min){ setFb(fb,"warn","A little more detail helps."); return true; }
    setFb(fb,"good","Looks good."); return true;
  }
  function validateQ(q){
    var input = el(q.id), f = input.closest(".field"), fb = f.querySelector(".feedback"), v = input.value.trim();
    if (q.optional){ setFb(fb, v?"good":"", v?"Thanks for the detail.":""); return true; }
    if (!v){ setFb(fb,"",""); return false; }
    if (words(v) < 4 || v.length < 18){ setFb(fb,"warn","Try to be a bit more specific — it makes a stronger case."); return true; }
    setFb(fb,"good","Great — clear and specific."); return true;
  }
  function fieldFb(id){ var f = el(id).closest(".field"); return f ? f.querySelector(".feedback") : null; }
  function validateRoles(id){
    var fb = fieldFb(id); if(!fb) return;
    var n = collectRoles(id).length;
    if (!touched[id] && n===0){ setFb(fb,"",""); return; }
    if (n===0) setFb(fb,"warn","Pick at least one role, or type one in the box below.");
    else setFb(fb,"good", n + " role" + (n===1?"":"s") + " listed.");
  }
  function validateRoleGrid(id){
    var fb = fieldFb(id); if(!fb) return;
    var list = rgRoles(id), none = rgNone(id);
    if (!touched[id] && list.length===0 && !none){ setFb(fb,"",""); return; }
    if (list.length === 0 && !none){ setFb(fb,"warn","Set a number beside a role, or tick “No vacancies right now”."); return; }
    if (list.length > 0){
      var total = list.reduce(function(s,r){return s+r.count;},0);
      setFb(fb,"good", total + " position" + (total===1?"":"s") + " across " + list.length + " role" + (list.length===1?"":"s") + ".");
    } else {
      setFb(fb,"good","Noted — we'll record your interest for the future.");
    }
  }
  function validateSourceGrid(id){
    var fb = fieldFb(id); if(!fb) return;
    var n = sgSources(id).length;
    if (!touched[id] && n===0){ setFb(fb,"",""); return; }
    if (n===0){ setFb(fb,"warn","Tick at least one place you post, or add your own."); return; }
    setFb(fb,"good", n + " source" + (n===1?"":"s") + " selected.");
  }
  function validateCountAnswer(id){
    var fb = fieldFb(id); if(!fb) return;
    var n = caValue(id), none = caNone(id);
    if (!touched[id] && n===0 && !none){ setFb(fb,"",""); return; }
    if (n===0 && !none){ setFb(fb,"warn","Set a number, or tick “No specific number yet”."); return; }
    if (n>0) setFb(fb,"good", n + " opening" + (n===1?"":"s") + " anticipated.");
    else setFb(fb,"good","Noted — we'll record your future interest.");
  }
  function validatePracticum(id){
    var fb = fieldFb(id); if(!fb) return;
    var r = document.querySelector('input[name="'+id+'_yn"]:checked');
    if (!touched[id] && !r){ setFb(fb,"",""); return; }
    if (!r) setFb(fb,"warn","Please choose Yes or No.");
    else setFb(fb,"good","Thanks.");
  }
  function validateNumber(q){
    var fb = fieldFb(q.id); if(!fb) return;
    if (!touched[q.id]){ setFb(fb,"",""); return; }
    setFb(fb,"good","Got it.");
  }

  function isQuestionFilled(q){
    if (q.optional) return true;
    if (q.type === "textarea" || q.type === "text") return !!el(q.id).value.trim();
    if (q.type === "number") return !!touched[q.id];            // must be deliberately set (0 is valid, but only once touched)
    if (q.type === "roles") return collectRoles(q.id).length > 0;
    if (q.type === "rolegrid" || q.type === "sourcegrid" || q.type === "countanswer") return !!(el(q.id+"_answer") && el(q.id+"_answer").value.trim());
    if (q.type === "practicum") { return !!(el(q.id+"_answer") && el(q.id+"_answer").value.trim()); }
    return true;
  }

  // is the email filled and well-formed? (the one validity that blocks submit)
  function emailOk(){
    var v = (el("repEmail").value||"").trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }
  var formComplete = false;
  // return the DOM element of the first incomplete required field, or null
  function firstIncomplete(){
    for (var i=0;i<CFG.questions.length;i++){ var q = CFG.questions[i];
      if (!q.optional && !isQuestionFilled(q)) return el(q.id).closest(".field");
    }
    for (var j=0;j<requiredContacts.length;j++){
      var f = requiredContacts[j], v = f.querySelector("input").value.trim();
      if (!v) return f;
      if (f.dataset.kind === "email" && !emailOk()) return f;  // present but malformed
    }
    if (!el("certify").checked) return el("certify").closest(".field");
    return null;
  }
  function recompute(){
    var req = [], done = 0;
    CFG.questions.forEach(function(q){ if(!q.optional){ req.push(q); if(isQuestionFilled(q)) done++; } });
    var total = req.length + requiredContacts.length + 1; // +certify
    requiredContacts.forEach(function(f){
      var v = f.querySelector("input").value.trim();
      if (!v) return;
      if (f.dataset.kind === "email" && !emailOk()) return; // malformed email doesn't count as done
      done++;
    });
    if (el("certify").checked) done++;

    var pct = Math.round(done/total*100);
    el("progressFill").style.width = pct + "%";
    el("progressPct").textContent = pct + "%";
    formComplete = done >= total;
    // keep the button clickable so an incomplete click can guide the user; show state via class + aria
    el("downloadBtn").classList.toggle("is-ready", formComplete);
    el("downloadBtn").setAttribute("aria-disabled", formComplete ? "false" : "true");
    var left = total - done;
    el("statusMsg").className = "status-msg" + (formComplete?" done":"");
    el("statusMsg").textContent = formComplete ? "All set — download your completed PDF." : (left + " question" + (left===1?"":"s") + " left.");
    saveDraft();
  }

  /* ---- draft autosave ---- */
  function saveDraft(){
    try {
      var d = { v:{}, roles:{}, radios:{}, checks:{}, edited:{} };
      d.srcChecks = {};  // source-grid checkboxes keyed by "<qid>::<value>"
      form.querySelectorAll("input, textarea").forEach(function(e){
        if (e.type === "checkbox"){
          if (e.id==="certify") d.v.certify = e.checked;
          else if (e.classList.contains("src-check")){ d.srcChecks[e.getAttribute("data-sg")+"::"+e.value] = e.checked; }
          else if (e.closest(".roles")) d.roles[e.value] = e.checked;
          else if (e.id) d.checks[e.id] = e.checked;   // e.g. role-grid "no openings"
        }
        else if (e.type === "radio"){ if (e.checked) d.radios[e.name] = e.value; }
        else if (e.id) d.v[e.id] = e.value;
      });
      // remember which grid answer boxes the employer hand-edited
      document.querySelectorAll("[data-rg-answer], [data-sg-answer], [data-ca-answer], [data-pr-answer]").forEach(function(b){ if(b.dataset.edited) d.edited[b.id]=1; });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    } catch(e){}
  }
  function loadDraft(){
    try {
      var raw = localStorage.getItem(STORAGE_KEY); if(!raw) return;
      var d = JSON.parse(raw);
      Object.keys(d.v||{}).forEach(function(id){ if(id==="certify"){ el("certify").checked=!!d.v.certify; return;} var e=el(id); if(e) e.value=d.v[id]; });
      // restore roles and mark the roles question touched if any was saved
      document.querySelectorAll(".role input").forEach(function(cb){
        if(d.roles && d.roles[cb.value]){ cb.checked=true; cb.closest(".role").classList.add("checked"); var h=cb.closest("[data-roles]"); if(h) touched[h.id]=true; }
      });
      // restore hand-edit flags FIRST, and mark saved answer boxes as "restored" so the
      // init-time refreshers below don't overwrite their wording (A1/A2 fix)
      Object.keys(d.edited||{}).forEach(function(id){ var b=el(id); if(b) b.dataset.edited="1"; });
      document.querySelectorAll("[data-rg-answer],[data-sg-answer],[data-ca-answer],[data-pr-answer]").forEach(function(b){
        if ((b.value||"").trim()) b.dataset.restored="1";
      });
      // restore generic checkboxes (role-grid / count "no openings") BEFORE re-firing radios
      Object.keys(d.checks||{}).forEach(function(id){ var c=el(id); if(c) c.checked=!!d.checks[id]; });
      // restore radios (practicum) and re-fire change so the conditional UI re-applies
      Object.keys(d.radios||{}).forEach(function(name){
        var r=document.querySelector('input[name="'+name+'"][value="'+d.radios[name]+'"]');
        if(r){ r.checked=true; r.dispatchEvent(new Event("change",{bubbles:true})); }
      });
      // a restored number value means it was deliberately set before — mark touched
      CFG.questions.forEach(function(q){ if(q.type==="number" && d.v && d.v[q.id]!=null && d.v[q.id]!=="") touched[q.id]=true; });
      // a restored "other roles" value also counts as touching the roles question
      CFG.questions.forEach(function(q){ if(q.type==="roles" && d.v && (d.v[q.id+"_other"]||"").trim()) touched[q.id]=true; });
      CFG.questions.forEach(function(q){
        if(q.type!=="rolegrid") return;
        var answered = (d.v && (d.v[q.id+"_answer"]||"").trim());
        var noneOn = d.checks && d.checks[q.id+"_none"];
        if (answered || noneOn) touched[q.id]=true;
      });
      // restore source-grid checkboxes + checked styling, and mark touched
      document.querySelectorAll(".src-check").forEach(function(cb){
        var key = cb.getAttribute("data-sg")+"::"+cb.value;
        if (d.srcChecks && d.srcChecks[key]){ cb.checked=true; cb.closest(".src-item").classList.add("checked"); touched[cb.getAttribute("data-sg")]=true; }
      });
      CFG.questions.forEach(function(q){
        if(q.type!=="sourcegrid") return;
        if (d.v && (d.v[q.id+"_answer"]||"").trim()) touched[q.id]=true;
      });
      // count-answer: a restored number, answer, or "none" toggle means it was touched
      CFG.questions.forEach(function(q){
        if(q.type!=="countanswer") return;
        var hasN = d.v && d.v[q.id+"_n"]!=null && d.v[q.id+"_n"]!=="" && d.v[q.id+"_n"]!=="0";
        var answered = d.v && (d.v[q.id+"_answer"]||"").trim();
        var noneOn = d.checks && d.checks[q.id+"_none"];
        if (hasN || answered || noneOn) touched[q.id]=true;
      });
      // practicum: restored yes/no or answer means touched; show the answer wrap
      CFG.questions.forEach(function(q){
        if(q.type!=="practicum") return;
        var yn = d.radios && d.radios[q.id+"_yn"];
        var answered = d.v && (d.v[q.id+"_answer"]||"").trim();
        if (yn || answered) touched[q.id]=true;
        var wrap = document.querySelector('[data-pr-answerwrap="'+q.id+'"]'); if(wrap && (yn||answered)) wrap.hidden=false;
      });
      // the radio re-fire above may have regenerated grid/practicum answers with force;
      // re-apply any saved answer text the employer had (so edits and prior wording survive a reload)
      Object.keys(d.v||{}).forEach(function(id){
        if (/_answer$/.test(id)){ var b=el(id); if(b && (d.v[id]||"").length) b.value=d.v[id]; }
      });
    } catch(e){}
  }
  loadDraft();
  contactFields.forEach(validateContact);
  CFG.questions.forEach(function(q){
    if(q.type==="textarea"||q.type==="text") validateQ(q);
    else if(q.type==="roles") validateRoles(q.id);
    else if(q.type==="rolegrid") rgRefresh(q.id);
    else if(q.type==="sourcegrid") sgRefresh(q.id);
    else if(q.type==="countanswer") caRefresh(q.id);
    else if(q.type==="practicum") prRefresh(q.id);
    else if(q.type==="number") validateNumber(q);
  });
  recompute();
  initializing = false;  // from here on, user interactions regenerate restored wording

  /* ---- reset ---- */
  el("resetBtn").addEventListener("click", function(){
    if(!window.confirm("Clear all your answers? This can't be undone.")) return;
    form.querySelectorAll("input, textarea").forEach(function(e){
      if(e.type==="checkbox"||e.type==="radio") e.checked=false; else e.value="";
    });
    touched = {};
    document.querySelectorAll(".role").forEach(function(r){ r.classList.remove("checked"); });
    document.querySelectorAll(".yesno label").forEach(function(l){ l.classList.remove("sel"); });
    document.querySelectorAll(".practicum-detail").forEach(function(dd){ dd.hidden = true; });
    document.querySelectorAll(".stepper input").forEach(function(i){ i.value = i.closest("[data-practicum]") ? 1 : 0; });
    // clear grid hand-edit flags and answer boxes
    document.querySelectorAll("[data-rg-answer], [data-sg-answer], [data-ca-answer], [data-pr-answer]").forEach(function(b){ delete b.dataset.edited; b.value=""; });
    document.querySelectorAll(".src-item").forEach(function(s){ s.classList.remove("checked"); });
    document.querySelectorAll(".feedback").forEach(function(fb){ fb.className="feedback"; fb.innerHTML=""; });
    try { localStorage.removeItem(STORAGE_KEY); } catch(e){}
    el("formDate").value = new Date().toISOString().slice(0,10);
    document.querySelectorAll("[data-pr-answerwrap]").forEach(function(w){ w.hidden = true; });
    document.querySelectorAll("[data-rolegrid]").forEach(function(g){ rgRefresh(g.getAttribute("data-rolegrid")); });
    document.querySelectorAll("[data-sourcegrid]").forEach(function(g){ sgRefresh(g.getAttribute("data-sourcegrid")); });
    document.querySelectorAll("[data-countanswer]").forEach(function(g){ caRefresh(g.getAttribute("data-countanswer")); });
    document.querySelectorAll("[data-practicum]").forEach(function(g){ prRefresh(g.id); });
    recompute();
    window.scrollTo({top:0, behavior:"smooth"});
  });

  /* ================= PDF ================= */
  // If incomplete, guide the employer to the first missing field instead of generating.
  el("downloadBtn").addEventListener("click", function(){
    if (!formComplete){
      var f = firstIncomplete();
      if (f){
        var input = f.querySelector("input, textarea, [data-roles], .yesno");
        f.scrollIntoView({behavior:"smooth", block:"center"});
        setTimeout(function(){ try{ (f.querySelector("input, textarea")||{}).focus && f.querySelector("input, textarea").focus(); }catch(e){} }, 350);
        // flash the feedback for that field
        var fb = f.querySelector(".feedback");
        if (fb && !fb.textContent) setFb(fb, "warn", "This one still needs an answer.");
      }
      return;
    }
    generatePDF();
  });
  function val(id){ var e=el(id); return e ? (e.value||"").trim() : ""; }
  function prettyDate(iso){ if(!iso) return ""; var d=new Date(iso+"T00:00:00"); return isNaN(d)?iso:d.toLocaleDateString("en-CA",{year:"numeric",month:"long",day:"numeric"}); }

  // Assemble the 7 official-form answers from the (possibly reordered) questions
  function officialAnswers(){
    var a = { q1:"", q2:"", q3:"", q4:"", q5:"", q6:"", q7:"" };
    var get = function(id){ return val(id); };
    var byMap = {};
    CFG.questions.forEach(function(q){ byMap[q.mapsTo] = q; });

    // q1 community
    CFG.questions.forEach(function(q){ if(q.mapsTo==="q1") a.q1 = get(q.id); });

    // q2 = the role-grid's generated (and possibly edited) answer; fall back for other types
    CFG.questions.forEach(function(q){
      if(q.mapsTo!=="q2") return;
      if(q.type==="rolegrid") a.q2 = get(q.id+"_answer");
      else if(q.type==="roles") a.q2 = collectRoles(q.id).join(", ");
      else a.q2 = get(q.id);
    });

    // q3 postings
    CFG.questions.forEach(function(q){ if(q.mapsTo==="q3") a.q3 = (q.type==="sourcegrid") ? get(q.id+"_answer") : get(q.id); });
    // q4 hard to fill
    CFG.questions.forEach(function(q){ if(q.mapsTo==="q4") a.q4 = get(q.id); });
    // q5 future openings — the count-answer's generated (and possibly edited) text;
    // fall back to the legacy count+detail split if an older config is used.
    var q5done = false;
    CFG.questions.forEach(function(q){ if(q.mapsTo==="q5" && q.type==="countanswer"){ a.q5 = get(q.id+"_answer"); q5done = true; } });
    if (!q5done){
      var futCount="", futDetail="";
      CFG.questions.forEach(function(q){ if(q.mapsTo==="q5a") futCount=get(q.id); if(q.mapsTo==="q5b") futDetail=get(q.id); });
      var futN = parseInt(futCount, 10); if (isNaN(futN)) futN = null;
      var q5=[];
      if (futN != null) q5.push(futN > 0 ? "Yes — approximately " + futN + " anticipated over the next 6 to 12 months." : "No additional openings anticipated at this time.");
      if (futDetail) q5.push(futDetail);
      a.q5 = q5.join(" ");
    }
    // q6 practicum — the generated (and possibly edited) answer
    CFG.questions.forEach(function(q){ if(q.mapsTo==="q6") a.q6 = get(q.id+"_answer"); });
    // q7 comments
    CFG.questions.forEach(function(q){ if(q.mapsTo==="q7") a.q7 = get(q.id); });
    return a;
  }

  // Official BC CWRG Employer Support Form question wording (Updated March 2026) — verbatim.
  var OFFICIAL_Q = {
    q1: "Which community or communities is your business operating in?",
    q2: "Do you currently have vacant positions that successful graduates of this training would be qualified to fill (see attached course outline)? Please list the names of the position(s) and how many openings.",
    q3: "Where do you regularly post positions for your openings?",
    q4: "Have you had a hard time filling these positions in the past? If yes, please describe any challenges you faced.",
    q5: "Do you foresee future openings in these positions? If yes, how many job openings do you anticipate over the next 6 to 12 months?",
    q6: "As a part of training, if a practicum is required, are you providing a practicum space? If so, how many placements?",
    q7: "How will your business support this project (for example: support with recruitment of participants, offer presentations, anticipate hiring graduates of this cohort, etc.)?"
  };

  // Map characters jsPDF's standard (WinAnsi) fonts can't render to safe equivalents.
  // Covers the common mobile-autocorrect curly quotes/dashes and a few accents.
  function pdfSafe(s){
    if (s == null) return "";
    return String(s)
      .replace(/[‘’‚‛]/g, "'")
      .replace(/[“”„‟]/g, '"')
      .replace(/[–—―]/g, "-")
      .replace(/…/g, "...")
      .replace(/[   ]/g, " ")
      .replace(/[•●]/g, "-")
      .replace(/™/g, "(TM)")
      .replace(/[^\x00-\xFF]/g, "");
  }

  function generatePDF(){
    if (!(window.jspdf && window.jspdf.jsPDF)){
      el("statusMsg").className = "status-msg err";
      el("statusMsg").textContent = "Couldn\u2019t load the PDF tool \u2014 please check your connection and reload the page.";
      return;
    }
    try {
      buildAndSavePDF();
    } catch (e){
      el("statusMsg").className = "status-msg err";
      el("statusMsg").textContent = "Something went wrong creating the PDF. Please reload and try again.";
    }
  }
  function buildAndSavePDF(){
    // Faithful recreation of the official BC CWRG Employer Support Form (Updated March 2026).
    // Positions are measured from the official PDF (612x792). jsPDF y grows downward, so the
    // measured "top" values from the official layout are used directly as y.
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({unit:"pt", format:"letter"});
    var PW = 612, PH = 792, INK = [0,0,0];
    var LX = 72;                 // left text margin
    var TX0 = 67.5, TX1 = 544.5; // info-table left/right
    var BX0 = 64.5, BX1 = 540.5; // answer-box left/right
    var pageNum = 0;

    function sz(n){ doc.setFontSize(n); }
    function font(style){ doc.setFont("helvetica", style||"normal"); }
    function wrap(text, width){
      text = pdfSafe(text);
      var broken = text.split(/(\s+)/).map(function(tok){
        if (!tok.trim()) return tok;
        if (doc.getTextWidth(tok) <= width) return tok;
        var out="", cur="";
        for (var i=0;i<tok.length;i++){ var t2=cur+tok[i];
          if (doc.getTextWidth(t2)>width && cur){ out+=cur+"\u0001"; cur=tok[i]; } else cur=t2; }
        return out+cur;
      }).join("");
      return doc.splitTextToSize(broken.replace(/\u0001/g,"\n"), width);
    }

    function headerAndFooter(){
      pageNum++;
      doc.setTextColor.apply(doc, INK);
      if (CFG.logo){
        try {
          // fit the logo within a short header band; cap height so it clears the intro
          // (page 1, y~86) and the page-2 Q3 heading (y~76).
          var maxH = 40, maxW = 110;
          var lh = maxH, lw = lh * (CFG.logoW/CFG.logoH);
          if (lw > maxW){ lw = maxW; lh = lw * (CFG.logoH/CFG.logoW); }
          doc.addImage(CFG.logo, "PNG", LX, 20, lw, lh);
        } catch(e){}
      }
      font("normal"); sz(11); doc.setTextColor.apply(doc, INK);
      doc.text("Community Workforce Response Grant", TX1, 44, {align:"right"});
      doc.text("Employer Support Form", TX1, 58, {align:"right"});
      sz(9);
      doc.text("Community Workforce Response Grant Employer Support Form – Updated March 2026", PW/2, 748, {align:"center"});
      doc.text("Page " + pageNum + " of 2", PW/2, 760, {align:"center"});
      doc.setTextColor.apply(doc, INK);
    }
    function box(x0, top, x1, bottom){
      doc.setDrawColor(0,0,0); doc.setLineWidth(1);
      doc.rect(x0, top, x1-x0, bottom-top);
    }
    // paragraph with a leading plain run + trailing bold run, word-wrapped
    function drawRichParagraph(plain, bold, x, yTop, xRight, lineH){
      var tokens = [];
      pdfSafe(plain).split(/(\s+)/).forEach(function(t){ if(t) tokens.push({t:t,b:false}); });
      pdfSafe(bold).split(/(\s+)/).forEach(function(t){ if(t) tokens.push({t:t,b:true}); });
      var cx=x, cy=yTop;
      tokens.forEach(function(tok){
        font(tok.b?"bold":"normal"); sz(11);
        var w = doc.getTextWidth(tok.t);
        if (/^\s+$/.test(tok.t)){ if (cx+w>xRight){ cx=x; cy+=lineH; } else cx+=w; return; }
        if (cx+w>xRight){ cx=x; cy+=lineH; }
        doc.text(tok.t, cx, cy); cx+=w;
      });
    }
    function drawQuestion(num, qtext, qTop, bx0, bTop, bx1, bBottom, answer){
      font("normal"); sz(11); doc.setTextColor.apply(doc, INK);
      var textX = 90;
      var lines = wrap(qtext, TX1 - textX);
      doc.text(num + ".", LX, qTop);
      doc.text(lines, textX, qTop);
      box(bx0, bTop, bx1, bBottom);
      if (answer){
        font("normal"); sz(11);
        var al = wrap(answer, (bx1-bx0)-12);
        var maxLines = Math.floor((bBottom-bTop-10)/13);
        if (al.length > maxLines) al = al.slice(0, maxLines);
        doc.text(al, bx0+6, bTop+14);
      }
    }

    var ans = officialAnswers();
    var ROWH = 36;

    /* ---- PAGE 1 ---- */
    headerAndFooter();
    drawRichParagraph(
      "This form must be completed by an employer supporting the skills training project and returned to the applicant. ",
      "This form is strictly to provide sector information on current employment needs. Completion of this form does not imply a commitment to hire on behalf of the employer.",
      LX, 86, TX1, 13);

    var tblTop = 128.5;
    var rows = [
      ["Business name:", val("businessName")],
      ["Business address and/or website:", val("businessAddress")],
      ["Date:", prettyDate(val("formDate"))],
      ["Representative first/last name & title:", val("repName")],
      ["Representative email & phone number:", (val("repEmail") + (val("repPhone") ? "   " + val("repPhone") : "")).trim()],
      ["Skills training course title:", CFG.programTitle],
      ["Credential/certification name:", CFG.credential]
    ];
    box(TX0, tblTop, TX1, tblTop + ROWH*7);
    for (var r=1;r<7;r++){ doc.setLineWidth(1); doc.setDrawColor(0,0,0); doc.line(TX0, tblTop+ROWH*r, TX1, tblTop+ROWH*r); }
    rows.forEach(function(row, i){
      var top = tblTop + ROWH*i;
      font("bold"); sz(10); doc.setTextColor.apply(doc, INK);
      doc.text(pdfSafe(row[0]), LX, top + 11);
      if (row[1]){ font("normal"); sz(10); doc.text(wrap(row[1], TX1-LX-6), LX, top + 23); }
    });

    var certTop = 399.5;
    doc.setLineWidth(1); doc.setDrawColor(0,0,0); doc.rect(LX, certTop, 14, 14);
    if (el("certify").checked){ doc.setLineWidth(1.4);
      doc.line(LX+2.5, certTop+7.5, LX+5.5, certTop+11); doc.line(LX+5.5, certTop+11, LX+12, certTop+2.5); }
    font("normal"); sz(11); doc.setTextColor.apply(doc, INK);
    doc.text(wrap("I certify that I am authorized to submit this form on behalf of the organization named above and that all information provided on this form is correct to the best of my knowledge.", TX1-(LX+20)), LX+20, certTop+8);

    drawQuestion(1, OFFICIAL_Q.q1, 445.9, BX0, 466.5, BX1, 538.5, ans.q1);
    drawQuestion(2, OFFICIAL_Q.q2, 558.0, BX0, 587.5, BX1, 674.5, ans.q2);

    /* ---- PAGE 2 ---- */
    doc.addPage();
    headerAndFooter();
    drawQuestion(3, OFFICIAL_Q.q3, 76.5,  BX0, 96.5,  BX1, 173.5, ans.q3);
    drawQuestion(4, OFFICIAL_Q.q4, 187.7, BX0, 221.5, BX1, 294.5, ans.q4);
    drawQuestion(5, OFFICIAL_Q.q5, 309.0, BX0, 343.5, BX1, 415.5, ans.q5);
    drawQuestion(6, OFFICIAL_Q.q6, 430.3, BX0, 464.5, BX1, 548.5, ans.q6);
    drawQuestion(7, OFFICIAL_Q.q7, 563.0, BX0, 597.5, BX1, 681.5, ans.q7);

    var safeBiz = (val("businessName")||"").replace(/[^\w\s-]/g,"").trim().replace(/\s+/g,"_").slice(0,60);
    if (!safeBiz) safeBiz = "Employer";
    var safeDate = val("formDate") || new Date().toISOString().slice(0,10);
    doc.save("CWRG_Employer_Support_" + safeBiz + "_" + safeDate + ".pdf");
    el("statusMsg").className = "status-msg done";
    el("statusMsg").textContent = "Downloaded. " + (CFG.returnInstruction || "Please email the PDF back to the sender.");
  }
})();
`;

/* ---------- run ---------- */
build();
