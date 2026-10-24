# BrandForge AI

A local hackathon prototype of **BrandDNA + BrandTwin**, built with Next.js, React, Tailwind CSS, React Flow, FastAPI, PyMuPDF, and SQLite.

## Deploy on Render

Use the root [render.yaml](render.yaml) Blueprint to deploy the frontend and backend together as one free web service. Add your NVIDIA key in Render when prompted. See [deployment steps, free-plan limitations, and persistent storage](docs/RENDER_DEPLOYMENT.md). The hosted judge demo has secure cookies and disables public owner signup. Free instances sleep and reset local data on restarts.

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

For NVIDIA analysis, configure `backend/.env` using [backend/.env.example](backend/.env.example), then restart the backend. On first visit, create the local owner account. See [NVIDIA integration setup, routes, limits, and verification](docs/NEMOTRON_INTEGRATION.md). If your virtual environment is inside `backend`, that guide includes the matching startup command.

## Five-minute demo

### Guided walkthrough and judge kit

After signing in, first-time visitors see a skippable, detailed spotlight tour. Use **Start walkthrough** in the header to replay it. Each tab is highlighted and must be clicked by the user before the tour continues; the tour never changes tabs itself. Next/Back and arrow keys move through explanations, but cannot bypass a required tab click. Escape, reduced-motion preferences, and small viewports are supported. The tour explains BrandDNA, BrandTwin, media checks, source evidence, the library, and human approval.

The welcome is shown again after every successful login or first-owner setup, even on a browser where an earlier visitor skipped or completed it. Refreshing within the same signed-in session does not reopen it. The access page displays a separate judge-demo ID and password with a one-click sign-in. Each judge login gets a fresh, isolated data sandbox; sign out between judges to trigger a new welcome. The private owner account remains separate. Starting the judge demo remains an explicit action and creates an isolated lab.

The final **Start judge demo** action and **Prepare judge demo** both create a fresh isolated lab and open BrandTwin with the first PNG and its caption loaded. It does not fabricate or automatically run an analysis: use **Run compliance check**, then load the other poster from the judge demo controls. A pending launch survives a refresh and is consumed only after the poster loads successfully. Preparation failures leave the final tour step open for retry. **Check Nemotron connection** makes an explicit live text probe; success confirms text connectivity, not successful image/video analysis. Rejected credentials remain a visible failure with setup guidance.

On **Overview**, find the **Judge demo kit** and select **Prepare judge demo**. It creates a separate **Volt Demo Lab** with six approved rules and does not reset any existing brand. The two PNG posters and sample guidelines are downloadable. **Try this poster** uploads the actual PNG and loads its matching caption in BrandTwin; select **Run compliance check** to run the configured analysis service.

- Sample A uses 400 km, $29,999, and the required range disclaimer.
- Sample B deliberately uses 500 km, $24,999, an unsupported “best in the world” claim, and omits the disclaimer.

These are clearly labeled testing fixtures, not precomputed AI outcomes. Nemotron checks require the configured server-side key; unavailable or failed analysis remains incomplete. Editing the lab rules changes the expected comparison. **Create a fresh demo lab** makes another isolated workspace rather than overwriting edited data. The walkthrough is also intended for ordinary users.

### Use your own brand

- In **Overview**, choose **Add your brand**. Enter a brand name and product/service, then optionally add an industry, tagline, and website/account handle. Select one, two, or all three platforms: Instagram, LinkedIn, Website.
- Each brand has its own saved details, rules, drafts, review history, and uploads. New brands start without the Volt sample rules; add and approve your guidelines using the existing **Guidelines & rules** flow.
- In **BrandTwin**, choose platforms for the current draft and optionally upload an image or video (up to 10 MB). The selected platforms determine the available previews. Media is saved with the draft and restored when opening it as a new version.
- JPEG/PNG images and MP4 videos can be reviewed alongside the copy, or without a caption. MP4 review is limited to 120 seconds; other existing upload formats are preview-only. Review model evidence and explicitly approve suggested corrections before applying them.
- Return to **Overview → Active brand → Volt One (example brand)** whenever you want to explore the original demo. Editors are recovered separately for each brand during the browser session.

### Explore Volt One

1. Explore the dashboard and BrandDNA graph. The fictional Volt brand starts with six approved rules.
2. Open BrandTwin. Run the intentionally incorrect sample: the engine identifies the 500 km claim, unsupported superiority claim, and missing disclaimer, with source evidence.
3. Edit the range and add the disclaimer manually in the editor. Edit out “best in the world,” or load the approved-facts sample, which uses your current rules. Recheck and save.
4. Open Content library and submit the passing draft. Open Approvals and approve it.
5. Open Guidelines & rules. Change the approved range from 400 to 350 and update its evidence. The saved draft now needs review, and the graph shows its dependencies.
6. Upload `samples/volt-guidelines.md` or a text-based PDF. Review extracted candidates before saving; edit existing facts to avoid duplicates.

## Implemented

- Persistent SQLite workspace, rules, drafts, and review history.
- Deterministic checks for kilometer range, dollar price, prohibited phrases, required disclaimers, and configured platform character limits.
- Source citations and rule versions on findings; suggested corrections guide manual edits in the editor.
- Instagram, LinkedIn, and website preview mockups.
- React Flow graph with rule-to-draft dependencies.
- PDF/TXT/Markdown pattern + Nemotron extraction, including rendered image-based pages, with human confirmation.
- Semantic claim/tone checks, model OCR/transcript observations, visual review, and timestamped video findings where supported by the endpoint.
- Single-owner login, authenticated media access, and persisted correction-review decisions.
- Explicit incomplete reports and server-side submission/approval blocks for failed or missing analysis.
- Review state transitions, reviewer notes, and server-side guards against submitting or approving failing content. Rechecks preserve current review decisions.
- Conflict prevention for approved product facts, optimistic version checks for rule edits, and no-op saves that leave drafts untouched.
- Session-local recovery of the open editor, duplicate-save protection, accessible keyboard dialogs, and friendly connection/upload errors.
- Approved rule changes conservatively invalidate all saved drafts because every draft depends on the full approved rule set.

## Scope and next steps

This is a **local prototype with a private owner account and isolated judge-demo sessions**. The owner controls creation and review; separate creator/reviewer accounts are not implemented. Only bind the API to loopback for this demo. The SQLite database is created automatically at `backend/brandforge.db`; set `BRANDFORGE_DB` to use another path. Additional brand databases are stored alongside it as `brandforge.brand-<id>.db`; media attachments are stored in the corresponding brand database. Back up these files together to preserve all workspaces.

Nemotron analysis requires a valid server-side NVIDIA API Catalog key. Uploaded content is untrusted data and never becomes an active rule without human approval. Explicit offline mode (`BRANDFORGE_DETERMINISTIC_ONLY=true`) retains the text-pattern demo but cannot pass semantic or media checks. Visual interpretation and model-read text/speech can be uncertain. Sampled image pixels are measured context, not exact brand color certification. Video samples can miss brief scenes. See the integration guide for all limits and known gaps.

Product checks currently assume one product per brand, range in km, and price in USD. All matching numeric mentions are compared with the corresponding approved fact. Only one fact per supported unit can be approved at a time. The score is a demo heuristic (100 minus 15 per finding), not a probability of correctness; incomplete analysis has no score, and a workspace without applicable approved rules cannot pass. Platform limits (2,200 / 3,000 / 5,000) are workspace demo configurations, not a live platform-policy service. Decorative CSS preview artwork is not submitted for analysis; uploaded creatives are. Editing saved copy creates a new draft rather than overwriting review history.

Next milestones: product scoping, separate reviewer accounts, exact reference-logo/region verification, long-video preprocessing, operational account recovery, and production deployment.

## Verification

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
cd frontend
npm test
npm run build
```

Backend tests use isolated temporary SQLite databases and cover evidence, approvals, knowledge invalidation, file extraction, and validation boundaries. React interaction tests use JSDOM with mocked API responses and graph rendering; they do not replace visual testing in a real browser.

## Judge demo access

The signup/sign-in page shows **ID `judge`** and **password `BrandForgeDemo2026!`**, plus **Sign in to judge demo**. These are intentionally public testing credentials, not the private owner credentials. Each successful judge login creates a fresh sandbox containing the Volt sample rules. Judges can create demo brands, upload creatives, check content, and review drafts inside that sandbox. They cannot list, fetch, or change the owner's brand data, and a later judge cannot read an earlier judge's sandbox. Owner credentials are never reset or displayed. Demo activity uses the configured backend/Nemotron service. Set `BRANDFORGE_DEMO_LOGIN=false` and restart the backend to disable demo sign-in.
