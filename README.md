# BrandForge AI

A local hackathon prototype of **BrandDNA + BrandTwin**, built with Next.js, React, Tailwind CSS, React Flow, FastAPI, PyMuPDF, and SQLite.

## Run on Windows

From the project directory, install dependencies once:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
cd frontend
npm install
cd ..
```

Start the API in one terminal:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Start the frontend in a second terminal:

```powershell
cd frontend
npm run dev
```

Open **http://localhost:3000**. API documentation: **http://127.0.0.1:8000/docs**. Next.js forwards `/api/*` to FastAPI; no browser CORS configuration is needed. Set `BACKEND_URL` if the API runs elsewhere.

## Five-minute demo

### Use your own brand

- In **Overview**, choose **Add your brand**. Enter a brand name and product/service, then optionally add an industry, tagline, and website/account handle. Select one, two, or all three platforms: Instagram, LinkedIn, Website.
- Each brand has its own saved details, rules, drafts, review history, and uploads. New brands start without the Volt sample rules; add and approve your guidelines using the existing **Guidelines & rules** flow.
- In **BrandTwin**, choose platforms for the current draft and optionally upload an image or video (up to 10 MB). The selected platforms determine the available previews. Media is saved with the draft and restored when opening it as a new version.
- Image/video uploads are for preview and attachment. Compliance analysis still checks the written marketing copy.
- Return to **Overview → Active brand → Volt One — example brand** whenever you want to explore the original demo. Editors are recovered separately for each brand during the browser session.

### Explore Volt One

1. Explore the dashboard and BrandDNA graph. The fictional Volt brand starts with six approved rules.
2. Open BrandTwin. Run the intentionally incorrect sample: the engine identifies the 500 km claim, unsupported superiority claim, and missing disclaimer, with source evidence.
3. Apply the range correction and disclaimer. Edit out “best in the world,” or load the approved-facts sample, which uses your current rules. Recheck and save.
4. Open Content library and submit the passing draft. Open Approvals and approve it.
5. Open Guidelines & rules. Change the approved range from 400 to 350 and update its evidence. The saved draft now needs review, and the graph shows its dependencies.
6. Upload `samples/volt-guidelines.md` or a text-based PDF. Review extracted candidates before saving; edit existing facts to avoid duplicates.

## Implemented

- Persistent SQLite workspace, rules, drafts, and review history.
- Deterministic checks for kilometer range, dollar price, prohibited phrases, required disclaimers, and configured platform character limits.
- Source citations and rule versions on findings; numeric and missing-phrase corrections can be applied in the editor.
- Instagram, LinkedIn, and website preview mockups.
- React Flow graph with rule-to-draft dependencies.
- PDF/TXT/Markdown pattern extraction with human confirmation.
- Review state transitions, reviewer notes, and server-side guards against submitting or approving failing content. Rechecks preserve current review decisions.
- Conflict prevention for approved product facts, optimistic version checks for rule edits, and no-op saves that leave drafts untouched.
- Session-local recovery of the open editor, duplicate-save protection, accessible keyboard dialogs, and friendly connection/upload errors.
- Approved rule changes conservatively invalidate all saved drafts because every draft depends on the full approved rule set.

## Scope and next steps

This is a **local prototype with separate brand workspaces**. There is no authentication or separation of creator/reviewer permissions. Only bind the API to loopback for this demo. The SQLite database is created automatically at `backend/brandforge.db`; set `BRANDFORGE_DB` to use another path. Additional brand databases are stored alongside it as `brandforge.brand-<id>.db`; media attachments are stored in the corresponding brand database. Back up these files together to preserve all workspaces.

Extraction uses supported text patterns, **not an LLM**. No API key is required. Scanned PDFs need OCR, which is not included. Arbitrary natural-language rules are not interpreted. Color rules are reference data; the app does not inspect uploaded advertising images, typography, logos, or visual compliance.

Product checks currently assume one demo product, range in km, and price in USD. All matching numeric mentions are compared with the corresponding approved fact. Only one fact per supported unit can be approved at a time. The score is a demo heuristic (100 minus 15 per finding), not a probability of correctness; a workspace with no active text rules cannot pass. Platform limits (2,200 / 3,000 / 5,000) are workspace demo configurations, not a live platform-policy service. Preview artwork is decorative CSS and is not checked by the engine. Editing saved copy creates a new draft rather than overwriting review history.

Next milestones: LLM-assisted extraction with schema validation and citations, product scoping, reviewer accounts, semantic claim checks, OCR/image validation, full migrations, and deployment.

## Verification

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
cd frontend
npm test
npm run build
```

Backend tests use isolated temporary SQLite databases and cover evidence, approvals, knowledge invalidation, file extraction, and validation boundaries. React interaction tests use JSDOM with mocked API responses and graph rendering; they do not replace visual testing in a real browser.
