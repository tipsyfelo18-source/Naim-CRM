# Hermes integration contract

The Naim CRM is the **single source of truth** for candidates, jobs, documents, tasks and appointments. Every
powerful automation engine (CV Builder, Leads Engine, follow-up machines, WhatsApp flows, document OCR) runs in the
**Hermes Agent** on the owner's VPS. **n8n is retired.** The CRM never calls an LLM and holds no AI keys; it only
exposes the surfaces below. **Money law:** no surface records payments, fees or charges (enforcement lives in the
NAIM SYSTEM compliance guard).

```
 Browser (staff)                      Supabase (RLS)                          Hermes (VPS, service_role)
 ───────────────                      ──────────────                          ─────────────────────────
 "Build CV with AI"  ── insert ──▶  automation_jobs (pending) ◀── claim_automation_job ── Juma / Salmin / Ali …
 "Send via agent"                   leads, cv_drafts, documents ◀── upsert_lead / save_cv_draft / …
 "Enrich with agent" ◀─ poll 5 s ── status: claimed → done|failed ◀── complete_automation_job
```

* **Backend port:** `mcp-server/server.py` (FastMCP, stdio). Tool reference: [`mcp-server/README.md`](../mcp-server/README.md).
* **Browser port:** WebMCP ([`docs/WEBMCP.md`](WEBMCP.md)). A browser agent can hand work to Hermes with
  `enqueue_automation_job` (after the user approves the on-screen dialog).
* **Envelope:** every MCP tool returns `{ok, data, error}`; see the README for error codes.
* **Time:** stored UTC; dates/times given to or shown by agents are Africa/Nairobi (EAT, UTC+3).

## Agent team and their surfaces

| Agent | Role | Consumes | Produces |
| --- | --- | --- | --- |
| **Naim** | Chief of staff (default profile) | everything read-only; `get_reports_summary`, `list_pending_jobs` | delegates; may `enqueue_automation_job` |
| **Juma** | Operator | `claim_automation_job` for `whatsapp_send`, `doc_ocr`, `followup_sweep`; pipeline sweeps via `list_candidates`, `get_candidate_full` | `complete_automation_job`, `move_candidate_stage`, `add_task`, `update_task` |
| **Salmin** | Designer (CV Builder engine) | `claim_automation_job(job_type="cv_build")`, `get_candidate_full` | `save_cv_draft` (PDF → private storage → `Resume/CV` document → `cv_drafts` pending_review) |
| **Jamal** | Strategist | `get_reports_summary`, `get_dashboard_stats`, `get_candidate_stats`, `get_candidates_by_country` | reports outside the CRM (no writes needed) |
| **Ali** | Researcher (Leads Engine) | `claim_automation_job(job_type="lead_enrich")`, `list_leads` | `upsert_lead` (new leads + enrichment), `complete_automation_job` |
| **Mohamed** | Assistant (intake + scheduling) | `list_candidates`, `list_appointments`, `list_tasks` | `add_candidate`, `update_candidate`, `schedule_appointment`, `add_task` |

## Table shapes

### `automation_jobs` (migrations 003 + 005): the job queue

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | |
| `job_type` | text | `^[a-z][a-z0-9_]{1,40}$`; contract below |
| `payload` | jsonb | job input |
| `status` | text | `pending` → `claimed` → `done` \| `failed` (CHECK) |
| `result` | jsonb | job output; on failure `result.error` is shown to staff |
| `requested_by` | uuid → users_profiles | forced to the signed-in user for browser inserts |
| `claimed_at`, `claimed_by`, `finished_at`, `created_at` | | `claimed_by` = worker name |

RLS: authenticated users may **read** and **insert** (a trigger forces `status='pending'`, clears result/claim fields
and stamps `requested_by`). There is no browser UPDATE/DELETE policy: only Hermes (service_role) claims and completes.
`claim_automation_jobs(p_worker, p_job_types, p_limit)` is `SECURITY DEFINER`, executable by `service_role` only, and
uses `FOR UPDATE SKIP LOCKED`, so several Hermes workers can poll the same queue safely.

Worker loop (every engine):

```
loop:
  r = claim_automation_job(job_type=<mine>, worker=<agent name>)
  if r.data is null: sleep 15-60 s; continue
  try:   work(r.data.payload); complete_automation_job(job_id=r.data.id, status="done", result={...})
  except e: complete_automation_job(job_id=r.data.id, status="failed", error=str(e)[:500])
```

Jobs stuck in `claimed` for more than 30 minutes should be re-queued by Juma's sweep (enqueue a fresh job with the
same payload and complete the stale one as `failed` with `error: "timed out"`).

### `leads` (migration 005)

`id, name, phone (normalised 2547…), email, source, country_interest, job_interest, status (new | contacted |
qualified | converted | disqualified), notes, external_ref (unique among live rows), enrichment jsonb,
converted_candidate_id, converted_at, converted_by, created_by, deleted_at, created_at, updated_at`.
Staff read/insert/update; delete is admin-only; `converted` can only be set by `convert_lead_to_candidate()`
(one click on the Leads page: creates the candidate in stage New and links it; idempotent).

### `cv_drafts` (schema + migration 005)

`id, candidate_id, title, template, full_name, email, phone, objective, experience, education, skills, languages,
references, content jsonb, status (draft | pending_review | approved | rejected), source (manual | hermes),
automation_job_id, document_id → documents, pdf_path, review_notes, reviewed_by/at, approved_by/at, created_by`.
Browser users cannot set `source`, `automation_job_id` or `pdf_path`; reviewer fields are stamped by trigger when a
staff member approves/rejects on the candidate profile → **CV drafts** tab.

### `documents`, `activity_log`

Documents live in the **private** `documents` bucket; the CRM views them only via 10-minute signed URLs. Hermes
writes to `<candidate_id>/hermes/<ms>_<file>.pdf`. `activity_log` is append-only; changes made by service_role on
`candidates` are logged by trigger (`Hermes / system`), and tools that touch other entities log
`Hermes / <HERMES_WORKER_NAME>` themselves.

## `job_type` contract

Minimum payload keys are enforced in the browser (`src/utils/constants.js JOB_PAYLOAD_REQUIRED`) and in the MCP server
(`crm_helpers.JOB_PAYLOAD_REQUIRED`); `tests/hermes-contract.test.mjs` fails if they drift.

### `cv_build` (Salmin)

* **Enqueued by:** candidate profile → **Build CV with AI**; or `enqueue_automation_job` (MCP / WebMCP).
* **Payload:** `{ "candidate_id": uuid, "candidate_name"?: string, "template"?: string, "job_id"?: uuid }`
* **Work:** `get_candidate_full` → build the CV (English; Arabic block optional) → `save_cv_draft(candidate_id, title,
  content, pdf_base64, automation_job_id=<job id>)`.
* **Result:** `{ "cv_draft_id": uuid, "document_id": uuid }`. UI: profile shows "CV ready for review" and the draft
  appears under **CV drafts** for one-click approve / reject.

### `lead_enrich` (Ali)

* **Enqueued by:** Leads page → **Enrich with agent**.
* **Payload:** `{ "lead_id": uuid, "name", "phone"?, "email"?, "country_interest"?, "job_interest"? }`
* **Work:** research the prospect → `upsert_lead(name, phone|email|external_ref, enrichment={...}, status="contacted"|"qualified"|…)`.
* **Result:** `{ "lead_id": uuid, "fields_added": [..] }`. UI: status chip on the lead card; the enrichment fields
  appear under "Hermes research". The Researcher engine may also call `upsert_lead` on its own schedule without a job.

### `whatsapp_send` (Juma)

* **Enqueued by:** WhatsApp page → **Send via agent** (template body from `whatsapp_templates`, placeholders filled).
* **Payload:** `{ "to": "2547XXXXXXXX", "message": string, "template_key"?: string, "candidate_id"?: uuid }`
* **Work:** send through Hermes' WhatsApp flow. Never send payment requests (money law).
* **Result:** `{ "provider_message_id"?: string, "delivered"?: bool }`. UI: status column on the WhatsApp page.

### `doc_ocr` (Juma)

* **Payload:** `{ "document_id": uuid, "candidate_id"?: uuid }`
* **Work:** download the file with service_role from `documents.file_path`, OCR it, then write back what you are sure
  of: `update_candidate` (e.g. `passport_number`, `date_of_birth`, `nationality`) and, for expiring documents, the
  expiry date (`documents.expiry_date`, via a follow-up tool or SQL).
* **Result:** `{ "fields": {..}, "confidence": 0-1 }`.

### `followup_sweep` (Juma)

* **Payload:** `{}` or `{ "stale_days"?: int, "stage"?: canonical stage }`
* **Work:** find candidates with no update in N days / tasks overdue / documents expiring (same rules as the
  notification bell) and create `add_task` reminders or `whatsapp_send` jobs.
* **Result:** `{ "tasks_created": int, "messages_queued": int }`.

## Security checklist for the VPS

* `SUPABASE_SERVICE_ROLE_KEY` lives only in `mcp-server/.env` on the VPS (chmod 600); never in the CRM repo, a
  `VITE_*` variable or the browser. The server refuses anon keys.
* Hermes' AI provider keys stay in Hermes. The CRM frontend and WebMCP tools contain no model keys.
* Stage moves go through `move_candidate_stage` (validated; the DB trigger enforces the same rule).
* Stage names are canonical only: `New, Source, Screening, Interview, Assessment, Shortlist, Offer, Contract Signing,
  Visa Processing, Onboarding, Placed, Completed, Rejected, Withdrawn, Pending, Draft`.
