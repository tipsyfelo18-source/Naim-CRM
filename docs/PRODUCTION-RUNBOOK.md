# Go-live runbook (Phase 4 Supabase + Phase 6 Netlify/QA)

Everything the code can do is in the repo. These steps need the owner's accounts (Supabase project, Netlify site,
Chrome origin-trial console), so they are run by the owner and the results recorded in `STATUS.md`.

## 0. Before you start

```bash
git clone <repo-url>
cd Naim-CRM
npm ci
npm test
npm run build
npm run test:mcp
```
All four must succeed before deploying.

---

## 1. Supabase production project (Phase 4)

1. Create a **clean, production Supabase project** (e.g. `naim-crm-prod`). Do not use the dev project.
2. In the Supabase SQL editor, apply migrations **in strict numerical order**:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_rls_policies.sql`
   - `supabase/migrations/003_storage_and_helpers.sql`
   - `supabase/migrations/004_missing_rls_and_security.sql`
   - `supabase/migrations/005_hermes_leads_cv.sql`
   *Do not run `seed.sql` in production.*
3. Verify the setup with `supabase/verify_production.sql`. Expected output:
   - Every application table reports `rls_enabled = true`.
   - The `documents` storage bucket exists and reports `public = false`.
   - `claim_automation_jobs` and `convert_lead_to_candidate` are present.
4. Run the anon-leak check from your machine:
   ```bash
   VITE_SUPABASE_URL=https://<your-project>.supabase.co \
   VITE_SUPABASE_ANON_KEY=<your-anon-key> \
   node scripts/anon-leak-test.mjs
   ```
   Must print: `All anon checks passed. No rows leaked.`
5. Invite the two production users in **Authentication -> Users**:
   - `salminabdalla93@gmail.com` (Admin)
   - `salminmoha09@gmail.com` (Staff)
6. Run `supabase/production_accounts.sql` in the SQL editor to bind their roles and default pages.
7. In **Authentication -> Providers -> Email**, disable:
   - "Enable Signups" (only admins invite users).
   - Verify email confirmations are enabled.

---

## 2. WebMCP Chrome Origin Trial registration (Phase 3.5)

WebMCP is available as a Chrome Origin Trial for Chrome 146+. To enable it on the production domain:

1. Visit [Chrome Origin Trials](https://developer.chrome.com/origintrials/#/view_trials).
2. Look for **Model Context Protocol in the Browser** (or *WebMCP* / *Document Model Context*).
3. Sign in with a Google account.
4. Click **Register**. Provide:
   - Web origin: `https://<your-site>.netlify.app` (or custom domain).
   - Check the box to include subdomains if using staging.
5. Copy the generated token string.
6. Store the token as `VITE_WEBMCP_ORIGIN_TRIAL_TOKEN` in Netlify build environment variables.
7. Check the expiration date. Add a calendar reminder 14 days before expiry to renew the token.

*Note for local development:* WebMCP works on `localhost` without an origin trial token by enabling `chrome://flags/#enable-experimental-web-platform-features`.

---

## 3. Netlify deployment (Phase 6)

1. Connect the GitHub repo to Netlify.
2. Build settings:
   - Base directory: `/` (root)
   - Build command: `npm run build`
   - Publish directory: `dist`
3. Environment variables (Site configuration -> Environment variables):
   - `VITE_SUPABASE_URL`: `https://<your-project>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: `<anon-key>`
   - `VITE_WEBMCP_ORIGIN_TRIAL_TOKEN`: `<origin-trial-token>`
4. Trigger deploy. Confirm `dist/_redirects` is deployed (`/* /index.html 200`).

---

## 4. Production QA checklist (20-row manual verification)

Sign in as Admin (`salminabdalla93@gmail.com`) first, then test Staff (`salminmoha09@gmail.com`) in an incognito window.

| # | Check | Expected Result | Admin | Staff |
|---|---|---|:---:|:---:|
| 1 | Direct navigation to `/candidates` | Loads candidate list, stage badges render correctly | [ ] | [ ] |
| 2 | Stage progression | Move candidate Applied -> Screened -> Submitted -> Client Review -> Approved -> Placed | [ ] | [ ] |
| 3 | Illegal stage jump | Dropdown prevents skipping stages or moving backwards without override | [ ] | [ ] |
| 4 | Add Candidate | Form validates phone, email format; candidate appears in list | [ ] | [ ] |
| 5 | Document upload | Upload PDF, confirms in private storage, signed URL opens preview | [ ] | [ ] |
| 6 | Document delete | Staff cannot delete documents; Admin can | [ ] | N/A |
| 7 | Leads page | Loads prospect list, filter by status works | [ ] | [ ] |
| 8 | Lead conversion | Click "Convert to Candidate" creates candidate, archives lead | [ ] | [ ] |
| 9 | CV Drafts review | View drafted CV in profile tab, approve/reject buttons record status | [ ] | [ ] |
| 10 | Task creation | Create task linked to candidate, due date persists | [ ] | [ ] |
| 11 | Appointment booking | Book interview, appointment shows on dashboard and candidate timeline | [ ] | [ ] |
| 12 | Reports page | Summary metrics load; Staff sees restricted metrics per permissions | [ ] | [ ] |
| 13 | Audit log | System actions (stage change, conversion) write activity log | [ ] | [ ] |
| 14 | WhatsApp log | Messages render in conversation view, outbound click opens `wa.me` | [ ] | [ ] |
| 15 | Staff page restriction | Staff navigating to `/settings` or `/audit-log` is redirected to default page | N/A | [ ] |
| 16 | WebMCP registration | In Chrome 146+ DevTools: `document.modelContext.getTools()` returns 8 tools | [ ] | [ ] |
| 17 | WebMCP write approval | Triggering `add_candidate` via agent shows UI approval modal; declining cancels write | [ ] | [ ] |
| 18 | Automation job queue | Enqueue test job via UI; shows in `automation_jobs` table | [ ] | [ ] |
| 19 | Anon data isolation | Unauthenticated curl to `/rest/v1/candidates` returns 0 rows | [ ] | [ ] |
| 20 | SPA routing | Hard reload on `/candidates/some-id` does not 404 on Netlify | [ ] | [ ] |

Record pass/fail in `STATUS.md`.
