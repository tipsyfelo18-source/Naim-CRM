# NAIM CRM: Production readiness status

Started 2026-09-17. Resumed 2026-09-28 and 2026-09-29. This ledger records verified results, not promises. **Production readiness is NOT established yet.**

Legend: [ ] pending; [~] code written, verification or push pending; [x] done and tested; [!] blocked (reason); [✓] verified already-fixed (evidence).

## Verification caveat (read first)
Sessions edit the repo through the GitHub API and have no network for npm/pip. `npm run build`, a live Vite run and a live Supabase run have NOT been executed. Verified so far: esbuild compiles of the full `src/App.jsx` graph (0 errors), node tests, and py_compile.
Every [~] item still needs, on the owner's machine or CI: `npm ci && npm test && npm run build && npm run test:mcp`, migrations 001→005 applied, and a live smoke test.

## IMPORTANT: 2026-09-29 session hand-off
The Phase 3.5 and Phase 5 code (plus docs and the Phase 4/6 kits) was written and tested locally (16/16 node tests; esbuild graph 0 errors; LeadsPage, WebMCPBridge and CandidateProfilePage each emit their own chunk). The session ran out of steps before pushing the code, so **only this STATUS.md was committed**. The owner received the full file bundle (`naim-crm-phase35-6.zip`, repo-relative paths). NEXT ACTION: commit that bundle to main as-is, then run the verification above. Files in the bundle:
- supabase/migrations/005_hermes_leads_cv.sql; supabase/verify_production.sql; supabase/production_accounts.sql; scripts/anon-leak-test.mjs
- src/webmcp/{toolDefinitions.js,handlers.js,services.js,registerTools.js,WebMCPBridge.jsx}
- src/App.jsx, src/components/layout/Sidebar.jsx, src/utils/constants.js, src/utils/permissions.js
- src/services/{leadService.js,cvDraftService.js,automationService.js}
- src/pages/LeadsPage.jsx, src/pages/CandidateProfilePage.jsx, src/components/candidates/CvDraftsPanel.jsx
- tests/{webmcp,hermes-contract,permissions}.test.mjs
- docs/{WEBMCP.md,HERMES-INTEGRATION.md,PRODUCTION-RUNBOOK.md}, mcp-server/README.md, README.md, .env.example

## Master Prompt Instructions Ledger
Operating rules, Phase 1 (CRM-1..12) and Phase 2: unchanged from the 2026-09-28 ledger (commit history up to ee836b7). Summary: CRM-2/5/7/8/10/12 [x]; CRM-11 [✓]; CRM-4/6/9 [~]; CRM-1/3 [!] (live Supabase needed). All Phase 2 items are [~] (landed; live checks pending). MONEY LAW: still no payment/billing code; none added this session.

### Phase 3: FastMCP hardening (owner says locked)
- [x] Code landed in 15c3855: 27 tools with an {ok,data,error} envelope, validation, a stage-transition mirror, enqueue/complete/list_pending jobs, get_candidate_full, upsert_lead.
- [!] VERIFY-FIRST gap: the 15c3855 message claims migration 005, test_server_tools.py and mcp-server/README.md, but none of them existed. server.py calls rpc `claim_automation_jobs` and the tables `leads`/`cv_drafts` (new columns), which the DB lacked. Fix: migration 005 and mcp-server/README.md written this session (in the bundle); server.py not touched. test_server_tools.py is still absent.

### Phase 3.5: WebMCP
- [~] src/webmcp/registerTools.js: feature-detected (document.modelContext per the current spec, with a navigator.modelContext fallback for Chrome 146–149 previews); secure context and top-level frame only; registers after auth, unregisters on logout through AbortController (legacy unregisterTool as a fallback); tools filtered by the user's page permissions.
- [~] 8 tools with strict JSON Schemas, same service layer and RLS, {ok,data,error}: search_candidates, get_candidate_summary, get_reports_summary (read, silent); add_candidate, update_candidate_stage (illegal jumps refused before any dialog), create_task, book_appointment, enqueue_automation_job (write, "Approve AI agent action?" modal; a decline returns user_declined). Evidence: tests/webmcp.test.mjs.
- [x] Origin isolation preserved (no Origin-Agent-Cluster, no document.domain, default tools policy, no iframes).
- [~] Origin-trial token: installOriginTrialToken(VITE_WEBMCP_ORIGIN_TRIAL_TOKEN) injects the meta tag; renewal documented in README and docs/WEBMCP.md.
- [!] Trial registration and the Tool Inspector test on the production origin: waiting on the owner's Netlify deploy.
- [~] docs/WEBMCP.md.

### Phase 4: Supabase production
- [!] Waiting on the owner (production project URL/keys, asked once on 2026-09-28). Kit ready: apply migrations 001→005 in order; supabase/verify_production.sql (RLS on every table, private bucket, functions); scripts/anon-leak-test.mjs; supabase/production_accounts.sql (admin salminabdalla93@gmail.com, staff salminmoha09@gmail.com, after inviting them in Auth); disable public sign-ups; no dev seed in prod. Steps in docs/PRODUCTION-RUNBOOK.md.

### Phase 5: Hermes surfaces
- [x] automation_jobs (003), plus claimed_by and claim_automation_jobs (SKIP LOCKED, service_role only) in 005.
- [~] UI hooks: WhatsApp "Send via agent" (done earlier); "Build CV with AI" resumes an open job after reload and links to the drafts; Leads "Enrich" (lead_enrich) with 5 s polling. automationService validates the payload contract.
- [~] leads table (005: RLS, admin-only delete, status guard, idempotent convert_lead_to_candidate RPC) and the Leads page (filters, search, add, status, one-click convert). Sidebar entry and staff default page added.
- [~] cv_drafts integration: new columns and guard trigger (005); CvDraftsPanel with PDF by signed URL and approve/reject with notes.
- [~] docs/HERMES-INTEGRATION.md: per-agent contracts (Naim, Juma, Salmin, Jamal, Ali, Mohamed). Evidence: tests/hermes-contract.test.mjs (JS ↔ crm_helpers.py ↔ 005 ↔ docs).
- [x] No frontend LLM calls or AI keys.

### Phase 6: Netlify + QA
- [!] Deploy is owner-managed; production URL pending. Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and VITE_WEBMCP_ORIGIN_TRIAL_TOKEN in Netlify.
- [ ] 20-row QA table and Lighthouse targets in docs/PRODUCTION-RUNBOOK.md; record results here after the deploy.
- [~] README rewritten (features, roles, env, migration order 001→005, Hermes/WebMCP pointers); production URL pending.

### Definition of done
- [ ] Not met: code bundle to be committed, Supabase activation, deploy, QA.

## Running work log
- 2026-09-17: 9910219 ledger; b993fa0 CRM-1.
- 2026-09-28: fb4c97b, a265e9e, 513316c, b4fd865, 8471b0a, e419d3c (Phase 1); 5cb7557, cd4c332, c14e747, 9944afb, 7f18b06, df7fdc8, ee836b7 (Phase 2).
- (git7-glitch) 15c3855: Phase 3 server.py/crm_helpers.py (see gap above).
- 2026-09-29: Phase 3.5 + 5 code, docs and the Phase 4/6 kits built and tested locally; handed to the owner as a bundle; this ledger commit.
