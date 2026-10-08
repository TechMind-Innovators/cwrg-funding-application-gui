# CLAUDE.md — CWRG Employer Support Form generator

Context for an AI agent taking over this project. For the human operator workflow
(adding programs, deploying), see [README.md](README.md); this file covers the internals,
invariants, and gotchas the README does not.

## What this is

A **static, config-driven site generator**. For each program defined in `programs.json`,
`build.js` writes one self-contained HTML page under `docs/`. An employer opens their
page, fills a guided form, and clicks **Download** — the page generates a PDF **in their
own browser** (jsPDF) that faithfully recreates the **official BC CWRG Employer Support
Form (Updated March 2026)**. No backend, no AI, no network calls except loading jsPDF
from cdnjs. Nothing is submitted anywhere; the employer emails the downloaded PDF back to
whoever sent them the link.

**Owner:** TechMind Innovators (registered Canadian charity). CWRG = BC Community
Workforce Response Grant, a skills-training grant the charity applies to. Employers do a
poor job filling the real government form, so this makes it dead-simple and nudges answers
toward what the funder wants to hear.

## Architecture

```
programs.json   ┐
phrasings.json  ├─►  node build.js  ─►  docs/<collegeSlug>/<programSlug>/index.html
assets/bc-logo.png ┘                    (self-contained; CSS/JS inlined; only jsPDF via CDN)
```

- **`build.js`** (~1600 lines, Node, zero deps) — the whole generator. Three big
  `String.raw` template literals define the generated page: `STYLES` (CSS), `BODY_HTML`,
  and `APP_JS` (the in-page client script). `renderPage(p, d)` merges shared + per-program
  config, fills `{programTitle}`/`{college}`/`{charityName}` placeholders, and emits the
  page. `build()` loops programs and writes files.
- **`programs.json`** — **program-SPECIFIC data only.** Slugs, college, programTitle,
  credential, roles. One entry per page. Keys starting with `_` (`_README`, `_FIELDS`) are
  docs, ignored by the build.
- **`phrasings.json`** — **everything program-NEUTRAL**, shared by *every* generated page:
  intro copy, question definitions (label/hint/type/order/mapsTo), notes, and all
  suggested/auto-generated answer pools. Top-level keys: `intro`, `notes`, `questions`,
  plus one pool key per question id.
- **`docs/`** — generated output, **committed** (GitHub Pages serves `/docs`; no Actions).
  `.nojekyll` is written automatically. There is **no index page** — employers only ever
  see their own program's form; never add cross-linking or a landing page.
- **`assets/bc-logo.png`** — BC logo, read at build time and embedded in each page as a
  base64 data URI. Currently the **official horizontal lockup** (emblem + "BRITISH
  COLUMBIA"), flattened on white and trimmed (~750×205). The PDF caps it at maxW=110 /
  maxH=40pt. Swap the file and rebuild to change it.

## The config split (the single most important rule)

**If wording is the same across all programs, it lives in `phrasings.json`. If it is
specific to one program, it lives in `programs.json`.** This is deliberate and the owner
cares about it. All suggested answers are program-neutral and shared. Don't move neutral
copy into `programs.json`, and don't bake program facts into `phrasings.json`.

## The 7 questions and how they map

The employer-facing form is reordered/simplified from the official 7 questions, then
mapped back for the PDF via each question's `mapsTo`. Current mapping (from
`phrasings.json` → `questions`):

| id              | type         | mapsTo | official question (March 2026 wording)                          |
|-----------------|--------------|--------|------------------------------------------------------------------|
| `communities`   | `textarea`   | q1     | Which community/communities is your business operating in?       |
| `roleDemand`    | `rolegrid`   | q2     | Do you currently have vacant positions… (see attached course outline)? List position(s) and openings. |
| `postings`      | `sourcegrid` | q3     | Where do you regularly post positions for your openings?         |
| `hardToFill`    | `textarea`   | q4     | Have you had a hard time filling these positions… describe any challenges you faced. |
| `futureOpenings`| `countanswer`| q5     | Do you foresee future openings… how many over the next 6 to 12 months? |
| `practicum`     | `practicum`  | q6     | As a part of training, if a practicum is required, are you providing a practicum space? If so, how many placements? |
| `comments`      | `textarea`   | q7     | How will your business support this project (recruitment, presentations, anticipate hiring, etc.)? |

The exact official wording is in `OFFICIAL_Q` inside `build.js` (used verbatim in the PDF).
If BC updates the form, update `OFFICIAL_Q` **and** the footer string ("Updated March 2026
/ Page X of 2") **and** re-measure geometry (below).

## Custom control types (in APP_JS)

- **`textarea`** — free text with an autogrowing box; shows **at most 2** click-to-insert
  suggestions picked at random per load from the question's `pool` in phrasings.json (or
  inline `suggestions`, which take priority). "Rewrite it differently" / "Show different
  examples" rotation.
- **`rolegrid`** (q2) — roles from `programs.json` as a name+counter grid, plus spare
  rows for employer-typed roles and a "no current openings" checkbox. Auto-writes an
  editable prose answer from `positive[]`/`negative[]` pools (positive if any counter > 0,
  negative otherwise). Slot: `{roles}`.
- **`sourcegrid`** (q3) — checklist of posting sources + a write-your-own box; auto-writes
  from `sources[]` + `templates[]`. Slot: `{sources}`. Templates use source-agnostic verbs
  ("through/via/using") to stay grammatical.
- **`countanswer`** (q5) — single number stepper → auto sentence from `positive[]`/
  `negative[]`. Slot: `{n}`. Count shown only when > 1.
- **`practicum`** (q6) — yes/no + (if yes) a placements counter. Framed as **purely
  hypothetical** (this program has no real placement). Yes → positive pool + count; No →
  positive-toned-negative pool.

Each grid/counter control writes into a hidden-ish `<id>_answer` textarea that the employer
can edit; editing sets `dataset.edited` so "rewrite" won't clobber their edits silently.

## PDF generation (`buildAndSavePDF` in APP_JS)

Pixel-measured recreation of the official PDF. Key constants (letter, 612×792 pt, y grows
down): `TX0=67.5, TX1=544.5` (info-table edges), `BX0=64.5, BX1=540.5` (answer-box edges),
`ROWH=36` (7 info rows), logo at `LX,20`. Fonts: jsPDF standard Helvetica (≈ Arial /
official ArialMT), Latin-1 only. `pdfSafe()` converts curly quotes/dashes/ellipsis/
bullets/™ to WinAnsi-safe and drops anything outside Latin-1 (so non-Latin scripts vanish
rather than render as boxes — a known limit). `officialAnswers()` assembles q1–q7 from the
controls before drawing. **If you change geometry, re-verify visually** (see below).

## Gotchas / invariants (read before editing)

- **jsPDF `save` is an instance own-property**, not on the prototype — patching
  `jsPDF.prototype.save` does NOT intercept downloads. To capture the PDF for testing, wrap
  the constructor (`window.jspdf.jsPDF`) and override `save` on each instance.
- **Download button gating:** `recompute()` sets `formComplete`; the button only fires when
  all non-optional questions + required contacts (business name, address, valid email) +
  the **certify** checkbox are done. `certify` is `#certify` specifically — there are other
  checkboxes (role/source grids), so don't grab "the first checkbox".
- **`isTrusted`** distinguishes real keystrokes from programmatic `input` dispatches, used
  to manage the `fromSuggestion`/`edited` flags. Keep that in mind when scripting the form.
- **UTF-8 in build.js:** the file contains many multibyte chars (— · ' ✓ ⏱ −). **NEVER run
  `perl -pi` without `-C`/UTF-8 mode on it** — it double-encodes and corrupts every
  multibyte char. Use the Edit tool or Python with `encoding='utf-8'`.
- **Stepper classes:** `.rg-step` / `.ca-step` / `.pr-step` are excluded from the generic
  `.stepper` handler to avoid double-increment. Preserve that if you add steppers.
- Slugs must be `^[a-z0-9]+(-[a-z0-9]+)*$`; non-conforming values are auto-slugified with a
  warning. Per-program `questions` are **optional overrides** — the validator does not
  require them.

## Local build & preview

```bash
cd /Users/andres/Desktop/TechMind/github/cwrg-application-gui
node build.js
cd docs && python3 -m http.server 8000
```

Then open a real page, e.g. `http://localhost:8000/sprott-shaw/computer-aided-design-technology/`.
(The README's `vcc/...` example URL is stale — there is no VCC program. Current programs:
`sprott-shaw/computer-aided-design-technology`, `lasalle/artificial-intelligence-and-machine-learning`,
`lasalle/network-management`, `lasalle/cibersecurity`.)

**Common footgun:** `Error: ENOENT: uv_cwd … cd: no such file or directory: docs` means
your shell's working directory was deleted out from under it (stale shell), **not** a bug
in build.js. `cd` into a path that exists, or open a fresh terminal.

## Verifying the PDF (how to actually check a change)

The in-app browser sandbox blocks real file downloads, so to inspect the generated PDF:
1. Start a tiny Node HTTP receiver that writes a POSTed base64 body to a file, plus a
   `python3 -m http.server` for `docs/`.
2. In the page, wrap `window.jspdf.jsPDF` so each instance's `save` POSTs
   `this.output('datauristring')` to the receiver instead of downloading.
3. Fill the form (set field values + dispatch `input`/`change`; check `#certify`), click
   Download, then `pdftoppm -png` the saved PDF and read the images.

Do **not** chunk-paste base64 into the transcript — it wastes tokens.

## Browser compatibility (audited 2026-10-07)

Employers open these on whatever they have — Windows/Mac/phones, Chrome/Edge/Safari/
Firefox — so the generated code is deliberately conservative. Verified:

- **Generated JS is ES5-style**: `var` + `function` only. No arrow functions, template
  literals, optional chaining (`?.`), nullish (`??`), spread, or async/await. Works on
  anything from the last decade. **Keep it this way** when editing APP_JS — don't
  introduce modern syntax into the in-page script.
- **CSS** uses only broadly-supported features: custom properties `var(--…)`, flex `gap`
  (Safari 14.1+ / 2021), grid, `clamp/min/max`. No `:has()`, `color-mix`, `oklch`, `dvh`,
  `@container`, or `backdrop-filter`. Verified with `CSS.supports()` in-browser.
- **localStorage** (draft autosave) is fully wrapped in try/catch, so Safari Private Mode
  and blocked-site-data just no-op — the form still works without the draft feature.
- **jsPDF load failure** (corporate firewall blocking cdnjs) is guarded: the Download
  handler checks `window.jspdf.jsPDF` and shows a friendly message instead of crashing.
- **Mobile**: no horizontal overflow at 375px; all text inputs are ≥16px so iOS Safari
  doesn't auto-zoom on focus. Sticky footer (progress + Clear/Download) renders correctly.
- **Date input**: `<input type="date">` auto-filled to today's ISO string; `prettyDate()`
  parses with the Safari-safe `new Date(iso+"T00:00:00")` pattern (plain ISO date strings
  are parsed inconsistently across engines).
- **PDF verified** generating cleanly on multiple programs at both desktop and mobile.

If you add features, keep these guarantees. The in-app test browser is Chromium; for a
true Safari/Firefox check, open the served page in those browsers manually.

## Known rough edges

- None outstanding. (The earlier `lasalle/cibersecurity` slug typo was corrected to
  `cybersecurity`, and the stale `vcc/...` URLs in README were fixed. If the old
  `cibersecurity` link was already sent to an employer, that URL now 404s — resend the
  corrected link.)

## Related owner context

The parent folder `/Users/andres/Desktop/TechMind` is the charity's admin hub and has its
own `CLAUDE.md` governing Notion/Gmail/Drive access (charity account via `.env` + `scripts/`,
never the built-in connectors). That does not apply to code work in this subfolder, but the
CWRG Applicant Guide (which defines what the funder wants the answers to say) lives in the
charity Drive and is referenced there.
