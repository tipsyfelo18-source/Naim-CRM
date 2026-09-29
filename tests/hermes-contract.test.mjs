// Phase 5: the Hermes contract must not drift between the browser, the MCP
// server, the database and docs/HERMES-INTEGRATION.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { AUTOMATION_JOB_TYPES, JOB_PAYLOAD_REQUIRED, LEAD_STATUSES, CV_DRAFT_STATUSES, PAGE_ACCESS_OPTIONS } from '../src/utils/constants.js'
import { STAFF_DEFAULT_PAGES } from '../src/utils/permissions.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (p) => readFile(join(ROOT, p), 'utf8')
const quoted = (s) => [...s.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])

test('job types, payload contract, lead and CV statuses match mcp-server/crm_helpers.py', async () => {
  const py = await read('mcp-server/crm_helpers.py')
  assert.deepEqual(quoted(py.match(/AUTOMATION_JOB_TYPES = \(([^)]*)\)/)[1]), AUTOMATION_JOB_TYPES)
  assert.deepEqual(quoted(py.match(/LEAD_STATUSES = \(([^)]*)\)/)[1]), LEAD_STATUSES)
  assert.deepEqual(quoted(py.match(/CV_DRAFT_STATUSES = \(([^)]*)\)/)[1]), CV_DRAFT_STATUSES)
  const block = py.match(/JOB_PAYLOAD_REQUIRED = \{([\s\S]*?)\n\}/)[1]
  for (const type of AUTOMATION_JOB_TYPES) {
    const line = block.split('\n').find((l) => l.includes(`"${type}"`))
    assert.ok(line, type)
    assert.deepEqual(quoted(line.split(':').slice(1).join(':')), JOB_PAYLOAD_REQUIRED[type], type)
  }
})

test('migration 005 CHECK constraints, claim RPC grant and staff default pages', async () => {
  const sql = await read('supabase/migrations/005_hermes_leads_cv.sql')
  assert.deepEqual(quoted(sql.match(/CHECK \(status IN \(([^)]*)\)\);\n\nCREATE UNIQUE INDEX/)[1]), LEAD_STATUSES)
  assert.deepEqual(quoted(sql.match(/cv_drafts_status_check\n\s+CHECK \(status IN \(([^)]*)\)\)/)[1]), CV_DRAFT_STATUSES)
  assert.match(sql, /FOR UPDATE SKIP LOCKED/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.claim_automation_jobs\(TEXT, TEXT\[\], INT\) FROM anon, authenticated;/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.claim_automation_jobs\(TEXT, TEXT\[\], INT\) TO service_role;/)
  assert.match(sql, /ALTER TABLE public\.leads ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /"admin delete leads" ON public\.leads FOR DELETE TO authenticated USING \(public\.is_admin\(\)\)/)
  const m = sql.match(/SET DEFAULT ARRAY\[([\s\S]*?)\]/)
  assert.deepEqual(quoted(m[1]), [...STAFF_DEFAULT_PAGES])
  for (const page of STAFF_DEFAULT_PAGES) assert.ok(PAGE_ACCESS_OPTIONS.includes(page), page)
})

test('the MCP server only calls RPCs/tables that migrations create', async () => {
  const server = await read('mcp-server/server.py')
  const sql = [await read('supabase-schema.sql'), ...await Promise.all(['001_security', '002_candidate_stages', '003_automation_jobs_whatsapp', '004_phase2', '005_hermes_leads_cv'].map((f) => read(`supabase/migrations/${f}.sql`)))].join('\n')
  for (const [, rpc] of server.matchAll(/\.rpc\("([a-z_]+)"/g)) assert.match(sql, new RegExp(`FUNCTION public\\.${rpc}\\(`), rpc)
  for (const [, table] of server.matchAll(/\.table\("([a-z_]+)"\)/g)) assert.match(sql, new RegExp(`TABLE (IF NOT EXISTS )?(public\\.)?${table}\\b`), table)
})

test('docs/HERMES-INTEGRATION.md documents every job type and every agent surface', async () => {
  const doc = await read('docs/HERMES-INTEGRATION.md')
  for (const type of AUTOMATION_JOB_TYPES) assert.ok(doc.includes(`\`${type}\``), type)
  for (const agent of ['Naim', 'Juma', 'Salmin', 'Jamal', 'Ali', 'Mohamed']) assert.ok(doc.includes(agent), agent)
  const server = await read('mcp-server/server.py')
  const readme = await read('mcp-server/README.md')
  for (const [, tool] of server.matchAll(/@tool\ndef ([a-z_]+)\(/g)) assert.ok(readme.includes(`\`${tool}\``), `mcp-server/README.md misses ${tool}`)
})
