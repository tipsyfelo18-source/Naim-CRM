#!/usr/bin/env node
// Phase 4: prove that the anon (public) key leaks nothing without a login.
// Usage (owner machine, Node 18+):
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon key> node scripts/anon-leak-test.mjs
// Optional: DOC_PATH=<an existing documents.file_path> also checks the private bucket.
const url = process.env.SUPABASE_URL?.replace(/\/$/, '')
const key = process.env.SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY (the anon key, never service_role).')
  process.exit(2)
}
const TABLES = ['users_profiles', 'candidates', 'jobs', 'appointments', 'tasks', 'documents', 'cv_drafts',
  'automation_jobs', 'whatsapp_templates', 'activity_log', 'leads']
const headers = { apikey: key, Authorization: `Bearer ${key}` }
let failures = 0

for (const table of TABLES) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers })
  const body = await res.text()
  const leaked = res.ok && body.trim() !== '[]'
  if (leaked) failures += 1
  console.log(`${leaked ? 'LEAK' : 'ok  '} read   ${table.padEnd(20)} HTTP ${res.status} ${leaked ? body.slice(0, 80) : ''}`)
}

for (const table of ['candidates', 'automation_jobs', 'leads']) {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(table === 'automation_jobs' ? { job_type: 'followup_sweep', payload: {} } : { name: 'anon-leak-test' }),
  })
  const leaked = res.ok
  if (leaked) failures += 1
  console.log(`${leaked ? 'LEAK' : 'ok  '} insert ${table.padEnd(20)} HTTP ${res.status}`)
}

for (const fn of ['claim_automation_jobs', 'convert_lead_to_candidate']) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(fn === 'claim_automation_jobs' ? { p_worker: 'anon' } : { p_lead_id: '00000000-0000-0000-0000-000000000000' }),
  })
  const leaked = res.ok
  if (leaked) failures += 1
  console.log(`${leaked ? 'LEAK' : 'ok  '} rpc    ${fn.padEnd(20)} HTTP ${res.status}`)
}

const list = await fetch(`${url}/storage/v1/object/list/documents`, {
  method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: '', limit: 1 }),
})
const listBody = await list.text()
const listLeaked = list.ok && listBody.trim() !== '[]'
if (listLeaked) failures += 1
console.log(`${listLeaked ? 'LEAK' : 'ok  '} storage list documents  HTTP ${list.status}`)

if (process.env.DOC_PATH) {
  const pub = await fetch(`${url}/storage/v1/object/public/documents/${process.env.DOC_PATH}`)
  if (pub.ok) failures += 1
  console.log(`${pub.ok ? 'LEAK' : 'ok  '} public URL of a stored document HTTP ${pub.status}`)
}

console.log(failures ? `\n${failures} LEAK(S) FOUND. Do not go live.` : '\nNo leaks: the anon key sees nothing without a login.')
process.exit(failures ? 1 : 0)
