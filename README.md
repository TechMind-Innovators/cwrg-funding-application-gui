# CWRG Employer Support Forms

Static, config-driven employer forms for TechMind Innovators' Community Workforce
Response Grant (CWRG) applications. An employer opens a simple, guided web form, and
downloads a **completed PDF** that faithfully recreates the official BC CWRG Employer
Support Form. No backend, no AI, nothing is sent anywhere — the PDF is generated in the
employer's own browser.

Each **program** you define gets its own self-contained page at its own URL. Employers
only ever see the form for the program they're supporting — there is no index, no
cross-linking, and no mention of other programs or colleges.

---

## How it works

```
programs.json   ──►   node build.js   ──►   docs/<college>/<program>/index.html
 (you edit)                                  (generated — commit these)
```

- **`programs.json`** — the only file you normally edit. One entry per program.
- **`build.js`** — reads the config and writes one finished HTML page per program.
- **`docs/`** — the generated site. GitHub Pages serves this folder.

The generated pages are fully self-contained (all CSS/JS inlined; only jsPDF loads from a
CDN), so each one works on its own at its own URL.

---

## Add or change a program

1. Open **`programs.json`** and copy an existing entry inside `"programs": [ ... ]`.
2. Change at least these keys:
   - `collegeSlug`, `programSlug` — lowercase-with-hyphens; they become the URL path
     (`/<collegeSlug>/<programSlug>/`).
   - `college`, `programTitle`, `credential` — the baked-in facts employers won't be asked.
   - `intro.goalHtml` — one or two sentences on the purpose for this program.
   - `roles` — the candidate roles this program prepares people for (the checklist).
   - `questions[].suggestions` — the click-to-insert example answers. Swap in real,
     strong answers as you collect them.
3. Run the build:
   ```bash
   node build.js
   ```
4. Commit **both** `programs.json` and the regenerated `docs/` folder, then push.

The field reference is inside `programs.json` under `_FIELDS` (and `_README`). Keys
starting with `_` are documentation and are ignored by the build.

---

## Deploy on GitHub Pages

1. Create a GitHub repo and push this folder to it.
2. In the repo: **Settings → Pages → Build and deployment**
   - Source: **Deploy from a branch**
   - Branch: **main**, folder: **/docs**
3. Save. Your forms will be live at:
   ```
   https://<your-user>.github.io/<repo>/<collegeSlug>/<programSlug>/
   ```
   e.g. `https://techmind.github.io/cwrg-forms/sprott-shaw/computer-aided-design-technology/`

A `.nojekyll` file is written into `docs/` automatically so GitHub serves the folders
as-is.

Send each employer **only** the link to their specific program's form.

---

## What the employer experiences

- A short, plain-language form — reordered and simplified from the official 7 questions
  so it's easy to fill. Fixed facts (college, program, credential) are shown but not asked.
- A prominent **"no hiring commitment"** note up top.
- **Suggested answers** they can click to insert and then edit — modelling what a strong,
  funder-aligned answer looks like. They can always write their own instead.
- Helper inputs: a **roles checklist**, **number steppers**, a **yes/no practicum** control.
- Live validation, a progress bar, and an autosaved draft (stored only in their browser).
- A **Download completed PDF** button that produces the official-format form, filled in.

The questions, hints and suggestions are written to reflect what the CWRG program is
actually looking for: a genuine, local, **skills-based** labour shortage with countable
openings. (See the hint on the "hard to fill" question — it steers employers toward a
skills/credential gap, which is what the training addresses, and away from pay/location
framing, which it doesn't.)

---

## Notes & limits

- **Output is a faithful recreation**, not a byte-identical copy of BC's Word file. BC
  accepts typed and handwritten versions, so an accurate typed recreation is appropriate.
- The PDF uses jsPDF's standard fonts (Latin-1). Curly quotes, dashes and common accents
  from phones are converted to safe equivalents automatically; characters outside Latin-1
  (e.g. non-Latin scripts) are dropped rather than rendered as boxes.
- No analytics, no tracking, no network calls except loading jsPDF from cdnjs.

---

## Local preview

```bash
node build.js
cd docs && python3 -m http.server 8000
# then open http://localhost:8000/sprott-shaw/computer-aided-design-technology/
```
