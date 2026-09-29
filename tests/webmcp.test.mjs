// Phase 3.5 WebMCP: schemas, argument validation, confirmation rule, stage
// rules, and progressive registration (feature detection + abort on logout).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOOL_SPECS, WRITE_TOOLS, validateArgs, jobPayloadProblems, toNairobiDateTime } from '../src/webmcp/toolDefinitions.js'
import { buildHandlers } from '../src/webmcp/handlers.js'
import { registerWebMCPTools, getModelContext, installOriginTrialToken } from '../src/webmcp/registerTools.js'
import { CANDIDATE_STAGES } from '../src/utils/constants.js'
import { STAFF_DEFAULT_PAGES } from '../src/utils/permissions.js'

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const REQUIRED_TOOLS = ['search_candidates', 'get_candidate_summary', 'add_candidate', 'update_candidate_stage', 'create_task', 'book_appointment', 'get_reports_summary', 'enqueue_automation_job']

function fakeServices(overrides = {}) {
  const calls = []
  const candidate = { id: ID, name: 'Amina Hassan', stage: 'New', phone: '+254700000001' }
  const services = {
    searchCandidates: async (o) => { calls.push(['search', o]); return { data: [candidate], count: 1 } },
    getCandidate: async (id) => (id === ID ? candidate : null),
    addCandidate: async (r) => { calls.push(['addCandidate', r]); return { id: ID, ...r } },
    changeCandidateStage: async (id, to, from) => { calls.push(['stage', id, to, from]); return { ...candidate, stage: to } },
    getDocuments: async () => [{ document_type: 'Passport', expiry_date: '2020-01-01', created_at: '2024-01-01' }],
    getTasks: async () => [{ id: 't1', title: 'Call', status: 'Pending' }, { id: 't2', title: 'Old', status: 'Completed' }],
    getAppointments: async () => [{ id: 'a1', title: 'Interview', date: '2999-01-01', status: 'Scheduled' }],
    addTask: async (t) => { calls.push(['addTask', t]); return { id: 't9', ...t } },
    addAppointment: async (a) => { calls.push(['addAppointment', a]); return { id: 'a9', ...a } },
    getKPIs: async () => ({ demo: false, totals: { candidates: 3, active: 2 }, funnel: [{ stage: 'New', count: 3 }], byStage: [], byCountry: [], placementsThisMonth: { count: 1 }, expiring: { expired: 1, critical: 0, warning: 2 }, tasks: { dueToday: [1], overdue: [] } }),
    enqueueJob: async (type, payload) => { calls.push(['enqueue', type, payload]); return { id: 'j1', job_type: type, status: 'pending' } },
    expiryStatus: (d, today) => (d < today ? 'expired' : 'valid'),
    today: () => '2026-09-29',
    ...overrides,
  }
  return { services, calls }
}

test('all eight Master Prompt tools exist with strict object schemas', () => {
  assert.deepEqual(TOOL_SPECS.map((t) => t.name).sort(), [...REQUIRED_TOOLS].sort())
  for (const t of TOOL_SPECS) {
    assert.equal(t.inputSchema.type, 'object', t.name)
    assert.equal(t.inputSchema.additionalProperties, false, t.name)
    assert.ok(t.description.length > 20, t.name)
    assert.match(t.name, /^[a-z_]{3,64}$/)
  }
  assert.deepEqual([...WRITE_TOOLS].sort(), ['add_candidate', 'book_appointment', 'create_task', 'enqueue_automation_job', 'update_candidate_stage'])
  assert.deepEqual(TOOL_SPECS.find((t) => t.name === 'update_candidate_stage').inputSchema.properties.stage.enum, CANDIDATE_STAGES)
})

test('validateArgs rejects unknown keys, bad enums, bad ids and missing fields', () => {
  const stage = TOOL_SPECS.find((t) => t.name === 'update_candidate_stage').inputSchema
  assert.deepEqual(validateArgs(stage, { candidate_id: ID, stage: 'Offer' }), [])
  assert.ok(validateArgs(stage, { candidate_id: ID, stage: 'Promoted' }).some((p) => p.includes('one of')))
  assert.ok(validateArgs(stage, { candidate_id: 'nope', stage: 'Offer' }).some((p) => p.includes('format')))
  assert.ok(validateArgs(stage, { candidate_id: ID }).some((p) => p.includes('stage is required')))
  assert.ok(validateArgs(stage, { candidate_id: ID, stage: 'Offer', admin: true }).some((p) => p.includes('Unknown argument')))
  const search = TOOL_SPECS.find((t) => t.name === 'search_candidates').inputSchema
  assert.deepEqual(validateArgs(search, { query: '' }), [])
  assert.ok(validateArgs(search, { query: 'x', limit: 500 }).length)
})

test('job payload contract and Nairobi datetime parsing', () => {
  assert.deepEqual(jobPayloadProblems('cv_build', { candidate_id: ID }), [])
  assert.ok(jobPayloadProblems('cv_build', {}).length)
  assert.ok(jobPayloadProblems('whatsapp_send', { to: '2547' }).some((p) => p.includes('message')))
  assert.ok(jobPayloadProblems('rm_rf', {}).length)
  assert.deepEqual(toNairobiDateTime('2026-10-05T10:30'), { date: '2026-10-05', time: '10:30' })
  assert.deepEqual(toNairobiDateTime('2026-10-05T07:30:00Z'), { date: '2026-10-05', time: '10:30' })
  assert.equal(toNairobiDateTime('tomorrow'), null)
})

test('reads run silently; every write waits for the human confirmation', async () => {
  const { services, calls } = fakeServices()
  const asked = []
  const h = buildHandlers({ confirm: async (r) => { asked.push(r.tool); return false }, services })
  const found = await h.search_candidates({ query: 'amina' })
  assert.equal(found.ok, true)
  assert.equal(found.data.candidates[0].name, 'Amina Hassan')
  const summary = await h.get_candidate_summary({ candidate_id: ID })
  assert.equal(summary.data.document_checklist.find((d) => d.type === 'Passport').status, 'expired')
  assert.equal(summary.data.document_checklist.find((d) => d.type === 'Visa').status, 'missing')
  assert.equal(summary.data.open_tasks.length, 1)
  assert.equal((await h.get_reports_summary({})).data.placements_this_month, 1)
  assert.deepEqual(asked, [])

  const declined = [
    await h.add_candidate({ name: 'Juma Ali', phone: '+254711111111' }),
    await h.update_candidate_stage({ candidate_id: ID, stage: 'Interview' }),
    await h.create_task({ title: 'Collect passport', due_date: '2026-10-01' }),
    await h.book_appointment({ candidate_id: ID, datetime: '2026-10-05T10:30', purpose: 'Interview' }),
    await h.enqueue_automation_job({ job_type: 'cv_build', payload: { candidate_id: ID } }),
  ]
  for (const r of declined) assert.equal(r.error?.code, 'user_declined')
  assert.deepEqual(asked.sort(), [...WRITE_TOOLS].sort())
  assert.deepEqual(calls.filter(([k]) => k !== 'search'), [], 'nothing written without approval')
})

test('approved writes go through the service layer; illegal stage jumps never reach the dialog', async () => {
  const { services, calls } = fakeServices()
  let asked = 0
  const h = buildHandlers({ confirm: async () => { asked += 1; return true }, services })
  const jump = await h.update_candidate_stage({ candidate_id: ID, stage: CANDIDATE_STAGES[10] })
  assert.equal(jump.error.code, 'invalid_transition')
  assert.equal(asked, 0)
  const added = await h.add_candidate({ name: 'Juma Ali', phone: '+254711111111', country_interest: 'Kuwait' })
  assert.equal(added.ok, true)
  assert.deepEqual(calls.find(([k]) => k === 'addCandidate')[1], { name: 'Juma Ali', phone: '+254711111111', email: null, country_applying_to: 'Kuwait', stage: 'New' })
  const moved = await h.update_candidate_stage({ candidate_id: ID, stage: 'Interview' })
  assert.equal(moved.data.to, 'Interview')
  const appt = await h.book_appointment({ candidate_id: ID, datetime: '2026-10-05T07:30:00Z', purpose: 'Medical check' })
  assert.deepEqual([appt.data.appointment.date, appt.data.appointment.time], ['2026-10-05', '10:30'])
  assert.equal((await h.book_appointment({ candidate_id: ID, datetime: '2020-01-01T10:00', purpose: 'Late' })).error.code, 'invalid_input')
  assert.equal((await h.get_candidate_summary({ candidate_id: '1f8fad5b-d9cb-469f-a165-70867728950e' })).error.code, 'not_found')
  const rls = await buildHandlers({ confirm: async () => true, services: { ...services, addTask: async () => { throw Object.assign(new Error('denied'), { code: '42501' }) } } })
    .create_task({ title: 'x task', due_date: '2026-10-01' })
  assert.equal(rls.error.code, 'forbidden')
})

test('registration is feature-detected, permission-filtered and aborted on logout', async () => {
  assert.equal(getModelContext(), null)
  const noop = await registerWebMCPTools({ profile: { role: 'admin' }, confirm: async () => false, services: {} })
  assert.equal(typeof noop, 'function')

  const registered = new Map()
  globalThis.window = { isSecureContext: true }
  globalThis.window.top = globalThis.window
  globalThis.window.self = globalThis.window
  globalThis.document = {
    modelContext: {
      registerTool(tool, { signal }) {
        registered.set(tool.name, tool)
        signal.addEventListener('abort', () => registered.delete(tool.name))
      },
    },
  }
  try {
    const staff = { role: 'user', page_permissions: ['dashboard', 'candidates'] }
    const off = await registerWebMCPTools({ profile: staff, confirm: async () => false, services: fakeServices().services })
    assert.ok(registered.has('search_candidates'))
    assert.ok(!registered.has('create_task'), 'no Tasks permission -> no create_task tool')
    assert.ok(!registered.has('get_reports_summary'))
    assert.equal(registered.get('search_candidates').annotations.readOnlyHint, true)
    assert.equal(registered.get('add_candidate').annotations.readOnlyHint, false)
    off()
    assert.equal(registered.size, 0)

    const full = await registerWebMCPTools({ profile: { role: 'user', page_permissions: [...STAFF_DEFAULT_PAGES] }, confirm: async () => false, services: fakeServices().services })
    assert.deepEqual([...registered.keys()].sort(), [...REQUIRED_TOOLS].sort())
    full()

    globalThis.window.top = {}
    await registerWebMCPTools({ profile: { role: 'admin' }, confirm: async () => false, services: {} })
    assert.equal(registered.size, 0, 'never inside an iframe')
  } finally {
    delete globalThis.window
    delete globalThis.document
  }
})

test('origin-trial token helper is a no-op without a token', () => {
  assert.equal(installOriginTrialToken(''), false)
})
