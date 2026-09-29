import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { canAccessPage, STAFF_DEFAULT_PAGES, ADMIN_ONLY_PAGES } from '../src/utils/permissions.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const admin = { role: 'admin', page_permissions: ['dashboard'] }
const staff = { role: 'user', page_permissions: [...STAFF_DEFAULT_PAGES] }

test('admins open every page', () => {
  for (const page of ['settings', 'recycle-bin', 'candidates', 'pipeline', 'leads']) assert.equal(canAccessPage(admin, page), true)
})

test('staff never open admin-only pages, even if granted', () => {
  const sneaky = { role: 'user', page_permissions: ['settings', 'recycle-bin'] }
  for (const page of ADMIN_ONLY_PAGES) {
    assert.equal(canAccessPage(staff, page), false)
    assert.equal(canAccessPage(sneaky, page), false)
  }
})

test('staff open their granted pages; pipeline and leads are implied by candidates', () => {
  assert.equal(canAccessPage(staff, 'candidates'), true)
  assert.equal(canAccessPage(staff, 'leads'), true)
  assert.equal(canAccessPage({ role: 'user', page_permissions: ['candidates'] }, 'pipeline'), true)
  assert.equal(canAccessPage({ role: 'user', page_permissions: ['candidates'] }, 'leads'), true)
  assert.equal(canAccessPage({ role: 'user', page_permissions: ['dashboard'] }, 'jobs'), false)
  assert.equal(canAccessPage({ role: 'user', page_permissions: ['dashboard'] }, 'leads'), false)
})

test('a missing profile grants nothing but the dashboard', () => {
  assert.equal(canAccessPage(null, 'dashboard'), true)
  assert.equal(canAccessPage(null, 'candidates'), false)
})

test('latest migration staff default matches STAFF_DEFAULT_PAGES; 004 locks deletes to admins', async () => {
  const latest = await readFile(join(ROOT, 'supabase/migrations/005_hermes_leads_cv.sql'), 'utf8')
  const m = latest.match(/SET DEFAULT ARRAY\[([\s\S]*?)\]/)
  assert.ok(m)
  assert.deepEqual([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]), [...STAFF_DEFAULT_PAGES])
  const sql = await readFile(join(ROOT, 'supabase/migrations/004_phase2.sql'), 'utf8')
  assert.match(sql, /"Admins can delete candidates" ON public\.candidates FOR DELETE TO authenticated USING \(public\.is_admin\(\)\)/)
  assert.match(sql, /"Admins can delete documents" ON storage\.objects/)
  assert.match(sql, /Only an admin can restore items from the Recycle Bin/)
})
