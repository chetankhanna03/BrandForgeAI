# NVIDIA Nemotron integration

## Setup

Install the backend dependencies in the virtual environment used to run FastAPI:

```powershell
# From C:\BrandForgeAI when using the existing backend virtual environment:
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\backend\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

If running inside `C:\BrandForgeAI\backend`, use:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --app-dir .. --host 127.0.0.1 --port 8000
```

Keep the following in `backend/.env` (see `backend/.env.example`). Environment variables already set in the process take precedence over the file.

```dotenv
NVIDIA_API_KEY=your-server-side-nvidia-api-catalog-key
NVIDIA_MODEL=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
BRANDFORGE_DETERMINISTIC_ONLY=false
BRANDFORGE_FRONTEND_ORIGIN=http://localhost:3000
BRANDFORGE_SECURE_COOKIE=false
```

Restart FastAPI after changing configuration. Start the frontend with `npm run dev` in `frontend`. Open `http://localhost:3000`. On first use, create an owner account with a password of at least 12 characters. This account owns all brands in this local installation, including pre-existing Volt data. It is distinct from the NVIDIA credential. No password or API key is stored in browser storage.

The API key is read only by the backend. It is not included in prompts, browser bundles, reports, or provider error responses. `.env` and SQLite files are ignored by Git. No existing key was rewritten by this integration.

For an explicit offline text demo, set `BRANDFORGE_DETERMINISTIC_ONLY=true`. This mode is clearly labelled; it cannot pass media or semantic-only guidance. With normal mode enabled, a missing/invalid API key or provider failure produces an incomplete report, never a successful fallback.

## Existing workflow and changes

The Next.js interface still calls FastAPI through the same `/api/*` rewrite. Each brand retains its separate SQLite rules, media, drafts, and history. `X-Brand-ID` selects a workspace; it is not an authentication credential.

Guidelines → proposed rules → human approval → BrandTwin text/creative check → review suggested corrections → revise and recheck → save → submit → approve.

- Existing numeric, phrase, disclaimer, and platform checks remain active.
- Nemotron adds semantic interpretation and media observations. Literal OCR/transcript observations also go through the numeric and phrase checker.
- Ordinary typed copy, a creative with a caption, and a creative without a caption are supported.
- Only an explicit owner action approves a rule. Model proposals are always unapproved.
- Findings cite actual approved rule IDs and versions. Unknown rule IDs, absent media, invalid timestamps, invented copy excerpts, malformed JSON, truncated responses, or incomplete coverage invalidate the analysis.
- Duplicate findings on the same rule, asset, and literal violation are suppressed. Distinct claims and different assets remain separate findings.
- Accepting a suggested correction records intent. It never removes the finding, waives compliance, modifies an original media asset, or marks a draft approved. Text rewrites require an explicit “Approve and apply,” followed by a new check. Media guidance requires editing and re-uploading the original creative.
- Provider errors leave exact findings visible, set the score to null, and block submission/approval on the server. A missing score is shown as “Incomplete,” not `0%` or `100%`.
- Existing drafts without an analysis status are migrated to `needs_review` instead of inheriting an unearned multimodal pass.

## Verified request contract

The NVIDIA model card identifies `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`, image/text/video/audio input, JPEG/PNG images, MP4 video, and the two-minute video limit:

- [NVIDIA model card](https://build.nvidia.com/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning/modelcard)
- [NVIDIA multimodal request examples](https://docs.nvidia.com/nim/vision-language-models/1.7.0/examples/nemotron-3-nano-omni-30b-a3b-reasoning/api.html)

The backend uses the OpenAI-compatible client against `/v1/chat/completions`. It sends actual bytes in `image_url` or `video_url` content parts using base64 data URIs. Local filenames and private media URLs are never used as substitutes for media bytes. Video requests set `mm_processor_kwargs.use_audio_in_video` according to the validated audio track and `media_io_kwargs.video` for representative full-clip sampling. These extensions are backend-only.

The model is prompted for one JSON object matching a Pydantic schema. JSON is validated locally; the implementation does not assume the hosted endpoint supports every OpenAI structured-output parameter. Thinking is disabled for bounded extraction/review responses. Temperature is 0.2, response budget 7,000 tokens, request timeout 45 seconds, and SDK retries are limited to one transient retry. There are at most two concurrent model calls per backend process. SDK/provider retry-after delays can extend total request time; the UI and Next.js proxy allow 180 seconds.

An initial live text probe reached NVIDIA but received HTTP 401 for the credential configured at implementation time. Therefore successful live inference, image payload acceptance, and video/audio inference on that account have not been demonstrated. The documented payload and fail-closed behavior are covered by mocks. Supply a valid NVIDIA API Catalog key and run the live checklist below; do not assume an API key from another provider works here.

## Media and guideline limits

- Upload size: 10 MiB per creative or guideline file.
- Image analysis: decoded still JPEG/PNG, at most 20 million pixels. Actual decoding catches corrupt files and image bombs.
- Video analysis: decoded MP4, at most 120 seconds and 3840 × 2160 pixels, one video track and at most one audio track. Multiple tracks or separate subtitle streams require an explicit export with the intended audio and burned-in subtitles. Missing/unreadable timelines and corrupt audio are rejected. Full timeline inspection has a bounded decode budget.
- Representative video frames cover the full clip, capped at 128 above 720p or 256 for smaller frames, at approximately one frame per second. These are sampled frames, not an exhaustive every-frame audit. Very brief text/scenes can be missed. Full embedded audio is sent when present; no silent audio omission or text-only filename fallback is used.
- Longer video: trim or split it into explicitly labelled clips of at most two minutes and check every clip. There is no automatic long-video segmentation, summarisation, or silent truncation.
- Previously supported GIF/WebP/WebM/MOV previews remain available, but cannot receive a compliance pass. Export JPEG/PNG/MP4 for analysis.
- Guidelines: existing PDF/TXT/Markdown text extraction and pattern proposals are preserved. PDFs may contain at most 100 pages, at most six pages needing image-based analysis, and at most 60,000 extracted text characters per upload. Split longer documents explicitly. Image-based pages are rendered into bounded PNGs in memory and included in the extraction request. No pages beyond these limits are silently omitted.
- Text evidence must be a real quotation from the cited page. For rendered pages the quotation is model-read evidence requiring user verification. Bad semantic extraction is clearly reported; available pattern proposals remain unapproved and visible for manual review.

Image palette output measures sampled RGB pixels. It is informational, not proof that a color occurs in the correct logo or region. Model-only color/visual-identity findings are explicitly uncertain and capped at 0.65 confidence. The app does not perform reference-image logo registration, exact regional color certification, typography measurement, or professional legal review. Model confidence is an estimate, not a calibrated probability of compliance. Exact numeric checks on model-read OCR/transcripts remain subject to recognition error.

Video timestamps are model-reported references checked against the actual clip duration. They are not independently verified frame-by-frame alignments; compare them with the original video during review.

Instruction isolation, strict validation, and the absence of tools/credentials in prompts reduce prompt-injection exposure; they do not prove that adversarial media cannot influence a model's judgement. Human review remains part of the workflow.

## Authentication and storage

The local app now requires a single owner login. Setup is limited to loopback and only works before an owner exists. Passwords use salted PBKDF2-SHA256 with 600,000 iterations. Eight failed login attempts per client address within 15 minutes trigger rate limiting. Sessions use random tokens, store only token hashes server-side, expire after eight hours, and are revoked on logout.

Cookies are HttpOnly and SameSite Strict. Unsafe browser requests check the configured frontend Origin. All brand, media, extraction, analysis, rule, report-review, and draft routes require an authenticated owner. `brand_id` selects data only after this check. Media uses the same authenticated cookie, including video range requests. Set `BRANDFORGE_SECURE_COOKIE=true` behind HTTPS and configure the exact frontend origin when moving beyond the loopback demo.

This is a single-owner access model, not a multi-tenant account/invitation/role-management system. No password reset or account recovery UI is provided. Production deployment still needs operational account recovery, transport/security configuration, and infrastructure controls.

First-owner setup assumes both frontend and backend are bound to loopback, as the supplied development commands specify. Provision the owner before exposing a reverse-proxied installation; a proxy can make remote traffic appear local to the backend.

Schema upgrades add rule category/severity/rationale, an `analysis_reports` table to every workspace, and owner/session/login-attempt tables to the catalog. Report fingerprints bind copy, selected platforms, approved rules, media bytes, model configuration, and analysis version. Analysis can be reused for 15 minutes only when that fingerprint matches. Explicit rechecks always run a new analysis. Rule changes during an analysis or review cause a conflict instead of saving stale approval. No external model call holds a SQLite write transaction open.

Media remains in its existing brand SQLite database. Rendering, decoding, and provider payloads use memory, not publicly hosted files. FastAPI closes request upload spools after request handling. Reports retain excerpts/observations for the local review workflow, so back up and protect SQLite files together with the catalog. There is no newly introduced automatic deletion of the user's stored originals.

## API routes

Existing routes retain their purpose:

| Route | Integration behavior |
|---|---|
| `GET /api/workspace` | Existing data plus safe model-configuration status; no API key. |
| `POST /api/extract` | Pattern + model proposals with `analysis` status; approval remains manual. |
| `POST /api/analyze` | Unified exact/semantic/media report; accepts `media_id`. |
| `POST /api/media` | Existing storage with JPEG/PNG decoding and MP4 duration/audio validation. |
| `GET /api/media/{id}?brand_id=...` | Authenticated original bytes and video range requests. |
| `POST /api/drafts` | Saves a draft with media and an optional matching `report_id`. |
| `POST /api/drafts/{id}/review` | Rechecks or transitions review state; incomplete analysis cannot submit/approve. |
| `POST /api/rules`, `PUT /api/rules/{id}` | Adds semantic rules and category/severity/rationale alongside existing rule types. |
| Existing brand routes | Same brand creation/edit/switch behavior, now owner-protected. |

New routes:

| Route | Purpose |
|---|---|
| `GET /api/auth/status` | Public authentication/setup status. |
| `POST /api/auth/setup` | First local owner account. |
| `POST /api/auth/login` | Password authentication and session cookie. |
| `POST /api/auth/logout` | Session revocation. |
| `POST /api/reports/{report_id}/findings/{finding_id}/review` | Accept/reject correction guidance without waiving the underlying finding. |

`GET /api/health` stays public. API documentation stays at `/docs`; private API calls require the session cookie.

## Changed files and dependencies

- `backend/main.py`: migrations, existing endpoint integration, report persistence/cache, stale-rule guards, safe errors, and guideline ingestion.
- `backend/nemotron.py`: server-only provider calls, prompts, actual media payloads, bounded concurrency/timeouts/retries, safe failures.
- `backend/ai_schemas.py`: strict model output schemas.
- `backend/compliance.py`: grounded findings, exact checks on OCR/speech, deduplication, coverage and failure semantics.
- `backend/media_processing.py`: Pillow/PyAV inspection and sampled palette measurement.
- `backend/auth.py`: single-owner authentication, session protection, authorization and Origin checks.
- `backend/.env.example`, `backend/requirements.txt`, `backend/requirements.lock.txt`: safe setup and dependencies.
- `frontend/app/access-gate.tsx`: initial owner setup, login/logout, session-expiry handling.
- `frontend/app/compliance-report.tsx`, `frontend/app/compliance.css`: unified reports, evidence, confidence/uncertainty, timestamps and explicit correction decisions.
- `frontend/app/page.tsx`: integration into the existing editor, guideline review and draft workflow.
- `frontend/app/brand-media.tsx`: supported analysis formats and limits.
- `frontend/next.config.ts`: longer proxy timeout for analysis.
- Backend and frontend tests, this guide, and `README.md`.

New direct dependencies: `openai`, `python-dotenv`, `Pillow`, `av`. Existing PyMuPDF handles PDF text/rendering. PyAV includes the FFmpeg libraries used to decode media; an external `ffmpeg.exe` is not required for this implementation. No new frontend package is needed.

## Verification

```powershell
.\backend\.venv\Scripts\python.exe -m pytest backend/tests -q
cd frontend
npm test -- --pool=threads --maxWorkers=1 --testTimeout=15000
npm run typecheck
npm run build
```

Automated tests use fake provider responses and isolated SQLite databases; they never need or spend a live API key. They cover the existing workflow, direct/indirect claims, compliant paraphrases, OCR and visual inconsistencies, spoken/on-screen video claims and disclosures, uncertain observations, unsupported/corrupt/oversized/long media, provider errors and malformed output, citation/timestamp validation, prompt-injection boundaries, cache isolation, owner setup/login/authorization, and correction decisions. UI tests are JSDOM tests; they do not establish real-browser rendering or live model accuracy.

Implementation verification: 98 backend tests and 53 frontend tests passed; TypeScript validation, the production Next.js build, and `pip check` passed. Live inference remains unverified because the configured NVIDIA credential returned HTTP 401.

Live smoke checklist after correcting the key:

1. Create/sign in to the owner account and keep the Volt example selected.
2. Upload guidelines and verify proposed rules stay inactive until approval.
3. Run the bad Volt copy, inspect numeric and semantic findings, approve a rewrite, recheck and save.
4. Attach a JPEG/PNG ad with a visible unsupported claim and inspect OCR/evidence and palette context.
5. Attach a short MP4 with an audible claim and on-screen disclaimer. Verify `video_audio` coverage and sensible timestamps. A rejected media/audio extension must leave the report incomplete; do not disable audio to obtain a pass.
6. Simulate or encounter a provider failure and verify submission/approval are blocked.
