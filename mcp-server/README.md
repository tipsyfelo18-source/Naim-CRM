# Naim CRM MCP server (Hermes docking port)

`server.py` is a [FastMCP](https://github.com/jlowin/fastmcp) server. The Hermes Agent (on the owner's VPS) uses it to
operate the CRM 24/7. It is the **backend** port; the browser port is WebMCP (`docs/WEBMCP.md`). The integration
contract for every Hermes engine is in [`docs/HERMES-INTEGRATION.md`](../docs/HERMES-INTEGRATION.md).

## Run

```bash
cd mcp-server
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
python server.py            # stdio transport (what Hermes' MCP client launches)
python -m unittest test_crm_helpers -v
```

| Variable | Required | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | yes | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **server-side only.** The server refuses anon / publishable keys (`assert_service_role_key`). Never put it in a `VITE_*` variable, the browser or git. |
| `HERMES_WORKER_NAME` | no | Default worker name written to `automation_jobs.claimed_by` and to activity-log entries (`Hermes / <name>`). |

Hermes MCP client config (example):

```json
{ "mcpServers": { "naim-crm": { "command": "/opt/naim/mcp-server/.venv/bin/python", "args": ["/opt/naim/mcp-server/server.py"],
  "env": { "HERMES_WORKER_NAME": "juma" } } }
```

Database prerequisites: `supabase-schema.sql` then migrations `001` → `005` (005 creates `claim_automation_jobs()`,
`leads` and the `cv_drafts` review columns that the queue / lead / CV tools use).

## Response envelope

Every tool returns exactly one shape and never raises:

```json
{"ok": true,  "data": { ... }, "error": null}
{"ok": false, "data": null, "error": {"code": "invalid_transition", "message": "Can't jump from New to Placed: the candidate must pass Interview first. Allowed from New: Source, Screening, Interview, ..."}}
```

| `error.code` | Meaning |
| --- | --- |
| `invalid_input` | Bad argument: not a UUID, unknown enum, bad date, missing payload key, JSON not an object … |
| `not_found` | The referenced record does not exist (or is in the Recycle Bin) |
| `invalid_transition` | Stage move breaks the checkpoint rule (Interview → Offer → Visa Processing → Placed) |
| `constraint_violation` | A database CHECK / trigger refused the write |
| `conflict` | Duplicate, or the job is already finished |
| `forbidden` | Row-level security / permission refused |
| `internal_error` | Anything else (message is safe to show) |

Conventions: IDs are UUIDs; dates `YYYY-MM-DD`, times `HH:MM` 24 h, both **Africa/Nairobi** local; stored timestamps
are UTC and every read adds a `*_local` rendering (`2026-09-29 20:37 EAT`). Free-text `search` is sanitised
(`sanitize_search`) before it reaches a PostgREST filter. `limit` is clamped to 1–100. JSON arguments (`updates`,
`payload`, `result`, `content`, `enrichment`) may be passed as an object or a JSON string. Soft-deleted rows are
hidden. **The CRM never handles money**: there is no tool that records payments or charges.

## Tools

### Candidates

| Tool | Params | Returns |
| --- | --- | --- |
| `list_candidates` | `search=""`, `stage=""` (canonical), `country=""`, `limit=20`, `offset=0` | `{total, offset, candidates:[brief]}` |
| `get_candidate` | `candidate_id` | full row + `allowed_next_stages` + local timestamps (works for binned rows too) |
| `get_candidate_full` | `candidate_id` | `{candidate, documents, tasks, appointments, cv_drafts, stage_history, activity}`; call before acting on a candidate |
| `add_candidate` | `name`, `phone`, `email`, `stage="New"` (New or a stage legal from New), `job_title`, `country_applying_to`, `passport_number`, `nationality`, `notes` | brief |
| `update_candidate` | `candidate_id`, `updates` (JSON object; `stage` refused, `id/created_at/deleted_at` dropped) | `{id, updated_fields, candidate}` |
| `move_candidate_stage` | `candidate_id`, `new_stage` | `{id, name, from, to, candidate}`; transition-validated (same rules as the UI and the DB trigger) |
| `delete_candidate` | `candidate_id` | `{id, deleted:true}`; soft delete, only an admin restores |
| `get_candidate_stats` | – | `{total, by_stage}` over all 16 canonical stages |
| `get_candidates_by_country` | – | `{total, by_country}` |

### Jobs, appointments, tasks

| Tool | Params | Returns |
| --- | --- | --- |
| `list_jobs` | `search=""`, `status=""` (Active/Draft/Closed), `limit=20` | `{jobs}` |
| `add_job` | `title`, `country`, `salary_min`, `salary_max`, `currency="KWD"` (ISO-4217), `description`, `requirements`, `status="Active"` | job row (salary = the employer's offer, never a fee) |
| `update_job` | `job_id`, `updates` (JSON) | job row |
| `list_appointments` | `status=""`, `candidate_id=""`, `from_date=""`, `limit=20` | `{timezone, appointments}` with `candidate_name` |
| `schedule_appointment` | `title`, `date`, `time=""`, `candidate_id=""`, `appointment_type="Interview"`, `notes` | appointment row |
| `list_tasks` | `status=""`, `candidate_id=""`, `due_by=""`, `limit=20` | `{tasks}` |
| `add_task` | `title`, `description`, `priority="Medium"` (Low/Medium/High/Urgent), `due_date`, `candidate_id` | task row |
| `update_task` | `task_id`, `updates` (JSON; `status: Completed` stamps `completed_at`) | task row |

### Reporting (Jamal, Strategist)

| Tool | Params | Returns |
| --- | --- | --- |
| `get_dashboard_stats` | – | `{total_candidates, active_jobs, open_tasks, candidates_placed, generated_at_local}` |
| `get_reports_summary` | – | `{pipeline_funnel, off_pipeline, by_destination, placements_this_month, documents_expired, documents_expiring_30d, tasks_due_today, tasks_overdue, leads_by_status, total_active_candidates}`; same figures as the Dashboard/Reports pages |

### Automation job queue (Juma, Operator, and every engine)

| Tool | Params | Returns |
| --- | --- | --- |
| `enqueue_automation_job` | `job_type`, `payload="{}"` | job row (status `pending`) |
| `list_pending_jobs` | `job_type=""`, `status="pending"`, `limit=20` | `{jobs}` oldest first |
| `claim_automation_job` | `job_type=""`, `worker=""` | the claimed job, or `data: null` when the queue is empty. Atomic (`claim_automation_jobs()`, `FOR UPDATE SKIP LOCKED`), so parallel workers never double-claim |
| `complete_automation_job` | `job_id`, `status="done"` (done/failed), `result="{}"`, `error=""` | job row; `conflict` if already finished. On `failed`, `error` is copied to `result.error` and shown to staff |

Payload contract (minimum keys, extra keys allowed): `cv_build {candidate_id}`, `lead_enrich {lead_id}`,
`whatsapp_send {to, message}`, `doc_ocr {document_id}`, `followup_sweep {}`.

### Leads (Ali, Researcher)

| Tool | Params | Returns |
| --- | --- | --- |
| `upsert_lead` | `name`, `phone`, `email`, `source="hermes"`, `country_interest`, `job_interest`, `status` (not `converted`), `notes`, `external_ref`, `enrichment="{}"` | `{created, lead}`. De-duplicates by `external_ref`, then phone (normalised `2547…`), then email; enrichment is merged; converted leads are never downgraded |
| `list_leads` | `search=""`, `status=""`, `limit=20` | `{leads}` |

Conversion to a candidate is a **staff** action in the CRM (Leads page, one click → `convert_lead_to_candidate()`).

### CV drafts (Salmin, CV Builder engine)

| Tool | Params | Returns |
| --- | --- | --- |
| `save_cv_draft` | `candidate_id`, `title`, `content="{}"` (full_name, email, phone, objective, experience, education, skills, languages, references), `pdf_base64=""` (≤10 MB, must be a PDF), `file_name`, `automation_job_id`, `template="professional"` | cv_drafts row with `status: pending_review`. The PDF goes to the private `documents` bucket and is linked as the candidate's `Resume/CV` document |
| `list_cv_drafts` | `candidate_id=""`, `status=""` (draft/pending_review/approved/rejected), `limit=20` | `{cv_drafts}` |

## Example calls

```jsonc
// Juma: claim, work, finish
claim_automation_job({"job_type": "whatsapp_send", "worker": "juma"})
// -> {"ok": true, "data": {"id": "5b0c…", "job_type": "whatsapp_send", "payload": {"to": "254712345678", "message": "Dear Amina…"}, "status": "claimed"}, "error": null}
complete_automation_job({"job_id": "5b0c…", "status": "done", "result": {"provider_message_id": "wamid.HBg…"}})

// Salmin: finish a cv_build job
get_candidate_full({"candidate_id": "0f8f…"})
save_cv_draft({"candidate_id": "0f8f…", "title": "CV – Amina Hassan (Housemaid, Kuwait)", "pdf_base64": "JVBERi0x…",
               "content": {"full_name": "Amina Hassan", "skills": "Cooking, childcare"}, "automation_job_id": "9a1d…"})
complete_automation_job({"job_id": "9a1d…", "result": {"cv_draft_id": "c3e2…"}})

// Ali: add a researched lead
upsert_lead({"name": "Fatuma Said", "phone": "0712 345 678", "country_interest": "Saudi Arabia", "source": "facebook_group",
             "external_ref": "fb:post:1234", "enrichment": {"age": 27, "experience_years": 3}})

// Mohamed: intake + scheduling
add_candidate({"name": "Juma Ali", "phone": "+254711111111", "country_applying_to": "Qatar"})
schedule_appointment({"title": "Medical check", "date": "2026-10-05", "time": "10:30", "candidate_id": "…", "appointment_type": "Medical"})

// Refused move
move_candidate_stage({"candidate_id": "…", "new_stage": "Placed"})
// -> {"ok": false, "data": null, "error": {"code": "invalid_transition", "message": "Can't jump from New to Placed: the candidate must pass Interview first. Allowed from New: …"}}
```
