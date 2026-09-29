// Phase 2 role & permissions: which pages a profile may open. The UI uses this
// to hide navigation and guard routes; the DATABASE enforces the matching
// capabilities (RLS + triggers, migrations 001/003/004/005), so hiding a button
// is never the only protection.
export const ADMIN_ONLY_PAGES = Object.freeze(['settings', 'recycle-bin'])

// What the latest migration (005) grants new staff invitees by default.
export const STAFF_DEFAULT_PAGES = Object.freeze([
  'dashboard', 'candidates', 'pipeline', 'leads', 'cv-builder', 'documents', 'associates', 'receptionist-view',
  'tasks', 'appointments', 'jobs', 'job-generator', 'reports', 'whatsapp',
])

// A page that is implied by another permission (older profiles predate it).
const IMPLIED_BY = Object.freeze({ pipeline: 'candidates', leads: 'candidates' })

export function isAdminProfile(profile) {
  return profile?.role === 'admin'
}

export function canAccessPage(profile, page) {
  if (!page) return true
  if (isAdminProfile(profile)) return true
  if (!profile) return page === 'dashboard'
  if (ADMIN_ONLY_PAGES.includes(page)) return false
  if (page === 'dashboard') return true
  const granted = Array.isArray(profile.page_permissions) ? profile.page_permissions : []
  return granted.includes(page) || (IMPLIED_BY[page] ? granted.includes(IMPLIED_BY[page]) : false)
}
