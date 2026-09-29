# Naim CRM

Operations app of **Naim Investments Ltd** (recruitment agency, Mombasa, Kenya → Gulf placements).
The CRM is the single source of truth for **candidates, jobs, stages, documents, tasks and appointments**.

> Production URL: _pending the owner's Netlify deploy_ (fill in here after [docs/PRODUCTION-RUNBOOK.md](docs/PRODUCTION-RUNBOOK.md) step 2)
> · Task ledger: [STATUS.md](STATUS.md)

## Architecture

| Layer | What | Notes |
| --- | --- | --- |
| Frontend | React 19 + Vite + Tailwind SPA | Netlify, anon key + user session only; route-level code splitting |
| Data | Supabase Postgres + Auth + Storage | RLS on every table; `documents` bucket is **private** (signed URLs, 600 s) |
| Backend port | `mcp-server/server.py` (FastMCP) | Hermes Agent operates the CRM with the **service_role** key, server-side only; tools in [mcp-server/README.md](mcp-server/README.md) |
| Browser port | WebMCP (`document.modelContext`) | feature-detected, signed-in users only, human approval for every write; see [docs/WEBMCP.md](docs/WEBMCP.md) |
| Automation | Hermes Agent (Naim, Juma, Salmin, Jamal, Ali, Mohamed) | consumes `automation_jobs`, fills `leads` and `cv_drafts`; see [docs/HERMES-INTEGRATION.md](docs/HERMES-INTEGRATION.md). n8n is retired. |

The CRM never calls LLM APIs and never embeds AI keys. All intelligence runs in Hermes.

## Features

* **Dashboard 2.0** – live KPI cards (active candidates, placements this month, expiring documents, tasks due today /
  overdue) and real charts (pipeline funnel, 6-month intake, candidates by destination) from Supabase. Demo figures
  appear only in dev demo mode, labelled **Demo data**.
* **Global search (Ctrl/Cmd + K)** – pages, candidates, jobs, tasks, appointments, documents and CVs; every remote
  filter goes through `sanitizeSearch()`/`ilikeAny()` (CRM-8).
* **Pipeline board** (`/pipeline`) – drag-and-drop Kanban over the canonical stages, with a "Move to…" menu for
  keyboard and touch users. Moves are optimistic and roll back on failure.
* **Stage-transition rules** – checkpoints can't be skipped: **Interview → Offer → Visa Processing → Placed**. One rule
  set in `src/utils/stageTransitions.js`, mirrored by the DB trigger `enforce_stage_transition` (migration 004) and the
  MCP server, so it holds for the UI, WebMCP, Hermes and SQL alike.
* **Candidate profile** (`/candidates/:id`) – details, validated stage changes, document center, **CV drafts**,
  history, linked tasks and appointments, and **Build CV with AI** (queues a `cv_build` job for Hermes with live status).
* **CV drafts** – Hermes (Salmin) delivers finished CVs as PDFs in private storage, linked as the candidate's
  Resume/CV document; staff open them via signed URL and **approve / reject** in one click (reviewer stamped by the DB).
* **Leads** (`/leads`) – prospects found by Hermes (Ali) or added by staff; status chips, "Enrich with agent"
  (`lead_enrich` job with live status), and one-click **Convert to candidate**.
* **Document center** – per-candidate checklist (passport, CV, medical, good conduct, visa) with Missing / Expired /
  ≤30 days / ≤90 days / Valid indicators and editable expiry dates. Viewing always uses a fresh signed URL.
* **Activity log** – append-only `activity_log`, written by the service layer for browser changes and by DB triggers /
  the MCP server for Hermes changes.
* **Notifications** – bell feed + once-per-session toast: expiring documents, stale candidates (14 days), tasks due.
* **Recycle Bin** – candidates, jobs, tasks, appointments and documents are soft-deleted; admin restore / purge.
* **WhatsApp** – DB templates; "Send via agent" queues `whatsapp_send` for Hermes; wa.me link kept as manual fallback.
* **WebMCP tools** – `search_candidates`, `get_candidate_summary`, `get_reports_summary` (read) and `add_candidate`,
  `update_candidate_stage`, `create_task`, `book_appointment`, `enqueue_automation_job` (write, each behind an
  on-screen **Approve AI agent action?** dialog).
* **Polish** – lazy-loaded pages, skeleton loaders, error boundaries, empty states, mobile drawer, skip link.

## Roles & permissions (enforced in the database, not only the UI)

| Capability | Staff (`user` / `manager`) | Admin |
| --- | --- | --- |
| Create / edit candidates, jobs, tasks, appointments, documents, leads | ✅ | ✅ |
| Delete (moves to Recycle Bin) | ✅ | ✅ |
| Restore from Recycle Bin | ❌ (trigger `guard_recycle_bin_restore`) | ✅ |
| Permanent delete (rows + stored files, leads) | ❌ (RLS DELETE policies) | ✅ |
| Convert a lead to a candidate | ✅ (`convert_lead_to_candidate()`) | ✅ |
| Approve / reject CV drafts | ✅ (reviewer forced by trigger) | ✅ |
| Claim / complete automation jobs | ❌ (service_role only) | ❌ (Hermes only) |
| Change roles / page permissions | ❌ (001 `protect_profile_privileges`) | ✅ |
| Manage WhatsApp templates | ❌ (003 RLS) | ✅ |
| Settings and Recycle Bin pages | hidden + route-guarded | ✅ |

New invitees get the staff page set by default (latest: migration 005). Page visibility: `src/utils/permissions.js`.

## Revenue law: no money model (CRM-11)

Naim Investments operates under a strict revenue law. **Type A:** the employer pays; the candidate is never charged.
**Type B:** the candidate pays at most one month's salary, and only after being deployed, working and receiving the first salary.

Enforcement lives in the separate **NAIM SYSTEM compliance guard**, outside this repo. Therefore the CRM has
**no payment collection, invoicing, billing or money-movement feature, by design** (UI, MCP tools and WebMCP tools
alike). Salary fields describe the job offer only. Do not add a billing module.

## Demo data policy (CRM-9 / CRM-10)

* `src/services/demoData.js` (and `src/components/reports/reportsData.js`) is the official, organized **dev seed**.
* Demo data renders **only** in a dev build with no Supabase config (`npm run dev` without `.env`), under a permanent
  red **DEMO MODE — NOT PRODUCTION** banner. Leads, CV drafts, agent jobs and WebMCP tools need a real database.
* A **production build without Supabase config refuses to run** and shows a configuration error screen.
* The production database launches **clean**: never import demo rows into it (`supabase/verify_production.sql` checks).

## Environment

Frontend (`.env`, gitignored; on Netlify set as site environment variables):

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon / publishable key>
VITE_WEBMCP_ORIGIN_TRIAL_TOKEN=<optional, public WebMCP origin-trial token for the production origin>
```

MCP server (`mcp-server/.env`, on the VPS only): see `mcp-server/.env.example`.
`SUPABASE_SERVICE_ROLE_KEY` must **never** appear in a `VITE_*` variable, the browser, or git. The server refuses to
start with an anon/publishable key.

## Database setup (order matters)

Run in the Supabase SQL editor, in this order:

1. `supabase-schema.sql` (bootstrap)
2. `supabase/migrations/001_security.sql` (private bucket, `is_admin()` SECURITY DEFINER, no self-escalation)
3. `supabase/migrations/002_candidate_stages.sql` (canonical stage CHECK constraint)
4. `supabase/migrations/003_automation_jobs_whatsapp.sql` (Hermes job queue, WhatsApp templates)
5. `supabase/migrations/004_phase2.sql` (document expiry, soft delete, activity log, stage-transition trigger, admin-only restore/purge)
6. `supabase/migrations/005_hermes_leads_cv.sql` (atomic `claim_automation_jobs()`, `leads` + `convert_lead_to_candidate()`, CV draft review, Leads page for staff)
7. `supabase/production_accounts.sql` (after inviting the admin + staff users) and `supabase/verify_production.sql` (every row `ok = true`)

**Deploy this frontend only after 005 is applied**: the Leads page, CV drafts tab and MCP queue tools use it.
Auth: email/password on, **public sign-ups off**, users invited from Authentication → Users. Full procedure:
[docs/PRODUCTION-RUNBOOK.md](docs/PRODUCTION-RUNBOOK.md).

## Develop

```
npm ci
npm run dev          # demo mode if no .env
npm test             # node tests: document security, search sanitizer, stage vocabulary, stage transitions,
                     # document checklist, notifications, permissions, WebMCP tools, Hermes contract
npm run test:mcp     # python unit tests for the MCP helpers
npm run build
node scripts/anon-leak-test.mjs   # with SUPABASE_URL + SUPABASE_ANON_KEY: proves anon sees nothing
```

MCP server: `cd mcp-server && pip install -r requirements.txt && python server.py` (stdio transport).

## Deploy (Netlify)

Build `npm run build`, publish `dist` (already in `netlify.toml`, which also provides the SPA deep-link redirect
and security headers). Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (and the WebMCP token) in Netlify; never
commit them. WebMCP origin-trial registration and **token renewal**: [docs/WEBMCP.md](docs/WEBMCP.md#origin-trial-production-without-flags).

## Canonical candidate stages

`New, Source, Screening, Interview, Assessment, Shortlist, Offer, Contract Signing, Visa Processing, Onboarding,
Placed, Completed, Rejected, Withdrawn, Pending, Draft` (defined once in `src/utils/constants.js`, mirrored in the MCP
server and enforced by a DB CHECK constraint; `npm test` fails if they drift).
