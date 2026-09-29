// Phase 3.5 WebMCP: tool implementations. Services are injected so this module
// stays pure and node-testable (tests/webmcp.test.mjs); in the app they are the
// SAME service-layer functions the UI uses (src/webmcp/services.js), running
// with the anon key + the user's own session, so RLS applies automatically.
import { normalizeStage } from '../utils/constants.js'
import { transitionError, allowedTargets } from '../utils/stageTransitions.js'
import { TOOL_SPECS, validateArgs, jobPayloadProblems, toNairobiDateTime, ok, fail } from './toolDefinitions.js'

const CHECKLIST = ['Passport', 'Resume/CV', 'Medical Certificate', 'Good Conduct Certificate', 'Visa']
const SPEC = Object.fromEntries(TOOL_SPECS.map((s) => [s.name, s]))

function brief(c) {
  return {
    id: c.id,
    name: c.name,
    stage: normalizeStage(c.stage) || 'New',
    phone: c.phone || null,
    email: c.email || null,
    country_applying_to: c.country_applying_to || null,
    job_title: c.job_title || c.work_position || null,
    updated_at: c.updated_at || null,
  }
}

function errorEnvelope(err) {
  const code = String(err?.code || '')
  if (code === '42501') return fail(err.message || 'Not allowed for your account', 'forbidden')
  if (code === 'PGRST116') return fail('Record not found', 'not_found')
  if (code === '23514') return fail(err.message || 'Rejected by a database rule', 'constraint_violation')
  return fail(err?.message || 'Unexpected error', 'internal_error')
}

const DECLINED = () => fail('The signed-in user declined this action in the confirmation dialog.', 'user_declined')

/**
 * @param {object} deps
 * @param {(request: {tool: string, title: string, summary: string, details: [string, string][]}) => Promise<boolean>} deps.confirm
 *        MUST show a human-visible dialog and resolve true only on an explicit click.
 * @param {object} deps.services  see src/webmcp/services.js
 */
export function buildHandlers({ confirm, services }) {
  async function findCandidate(id) {
    try {
      const c = await services.getCandidate(id)
      return c && !c.deleted_at ? c : null
    } catch (err) {
      if (String(err?.code) === 'PGRST116') return null
      throw err
    }
  }

  const impl = {
    async search_candidates({ query = '', stage, country, limit = 10 }) {
      const { data, count } = await services.searchCandidates({ search: query, stage, country, pageSize: limit })
      return ok({ total: count ?? (data || []).length, candidates: (data || []).map(brief) })
    },

    async get_candidate_summary({ candidate_id }) {
      const c = await findCandidate(candidate_id)
      if (!c) return fail(`Candidate ${candidate_id} not found`, 'not_found')
      const today = services.today()
      const [documents, tasks, appointments] = await Promise.all([
        services.getDocuments(c.id), services.getTasks(c.id), services.getAppointments(c.id),
      ])
      const checklist = CHECKLIST.map((type) => {
        const latest = (documents || []).filter((d) => d.document_type === type)
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
        if (!latest) return { type, status: 'missing' }
        return { type, status: latest.expiry_date ? services.expiryStatus(latest.expiry_date, today) : 'no_expiry_set', expiry_date: latest.expiry_date || null }
      })
      return ok({
        candidate: { ...brief(c), nationality: c.nationality || null, passport_number: c.passport_number || null, notes: c.notes || null },
        allowed_next_stages: allowedTargets(c.stage),
        document_checklist: checklist,
        open_tasks: (tasks || []).filter((t) => t.status !== 'Completed').map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date })),
        upcoming_appointments: (appointments || []).filter((a) => a.date >= today && ['Scheduled', 'Rescheduled'].includes(a.status))
          .map((a) => ({ id: a.id, title: a.title, type: a.type, date: a.date, time: a.time, status: a.status })),
        timezone: 'Africa/Nairobi',
      })
    },

    async get_reports_summary() {
      const k = await services.getKPIs()
      return ok({
        demo: Boolean(k.demo),
        generated_at: k.generatedAt,
        today: k.today,
        total_candidates: k.totals?.candidates ?? 0,
        active_candidates: k.totals?.active ?? 0,
        pipeline_funnel: Object.fromEntries((k.funnel || []).map((f) => [f.stage, f.count])),
        by_stage: Object.fromEntries((k.byStage || []).map((f) => [f.stage, f.count])),
        top_destinations: (k.byCountry || []).slice(0, 10),
        placements_this_month: k.placementsThisMonth?.count ?? 0,
        documents_expired: k.expiring?.expired ?? 0,
        documents_expiring_30d: k.expiring?.critical ?? 0,
        documents_expiring_90d: k.expiring?.warning ?? 0,
        tasks_due_today: k.tasks?.dueToday?.length ?? 0,
        tasks_overdue: k.tasks?.overdue?.length ?? 0,
        timezone: 'Africa/Nairobi',
      })
    },

    async add_candidate({ name, phone, email, country_interest }) {
      const record = {
        name: name.trim(), phone: phone.trim(), email: email?.trim() || null,
        country_applying_to: country_interest?.trim() || null, stage: 'New',
      }
      const approved = await confirm({
        tool: 'add_candidate', title: 'Add a new candidate',
        summary: `Create candidate "${record.name}" in stage New.`,
        details: [['Name', record.name], ['Phone', record.phone], ['Email', record.email || '(none)'], ['Destination', record.country_applying_to || '(none)']],
      })
      if (!approved) return DECLINED()
      return ok({ candidate: brief(await services.addCandidate(record)) })
    },

    async update_candidate_stage({ candidate_id, stage }) {
      const c = await findCandidate(candidate_id)
      if (!c) return fail(`Candidate ${candidate_id} not found`, 'not_found')
      const from = normalizeStage(c.stage) || 'New'
      if (from === stage) return ok({ candidate: brief(c), changed: false })
      const problem = transitionError(from, stage)
      if (problem) return fail(`${problem}. Allowed from ${from}: ${allowedTargets(from).join(', ')}`, 'invalid_transition')
      const approved = await confirm({
        tool: 'update_candidate_stage', title: 'Move candidate to another stage',
        summary: `Move ${c.name} from ${from} to ${stage}.`,
        details: [['Candidate', c.name], ['From', from], ['To', stage]],
      })
      if (!approved) return DECLINED()
      const saved = await services.changeCandidateStage(c.id, stage, from)
      return ok({ candidate: brief(saved), changed: true, from, to: stage })
    },

    async create_task({ title, due_date, candidate_id, priority = 'Medium', description }) {
      let candidate = null
      if (candidate_id) {
        candidate = await findCandidate(candidate_id)
        if (!candidate) return fail(`Candidate ${candidate_id} not found`, 'not_found')
      }
      const approved = await confirm({
        tool: 'create_task', title: 'Create a task',
        summary: `Create task "${title.trim()}" due ${due_date}.`,
        details: [['Title', title.trim()], ['Due', due_date], ['Priority', priority], ['Candidate', candidate?.name || '(none)']],
      })
      if (!approved) return DECLINED()
      const task = await services.addTask({
        title: title.trim(), description: description?.trim() || null, due_date, priority,
        status: 'Pending', candidate_id: candidate?.id || null,
      })
      return ok({ task: { id: task.id, title: task.title, due_date: task.due_date, priority: task.priority, status: task.status, candidate_id: task.candidate_id || null } })
    },

    async book_appointment({ candidate_id, datetime, purpose, type = 'Interview' }) {
      const when = toNairobiDateTime(datetime)
      if (!when) return fail('datetime must look like 2026-10-05T10:30 (Africa/Nairobi) or carry an offset', 'invalid_input')
      if (when.date < services.today()) return fail(`${when.date} is in the past (Africa/Nairobi)`, 'invalid_input')
      const c = await findCandidate(candidate_id)
      if (!c) return fail(`Candidate ${candidate_id} not found`, 'not_found')
      const approved = await confirm({
        tool: 'book_appointment', title: 'Book an appointment',
        summary: `${type} for ${c.name} on ${when.date} at ${when.time} (Nairobi time).`,
        details: [['Candidate', c.name], ['Purpose', purpose.trim()], ['Type', type], ['Date', when.date], ['Time (EAT)', when.time]],
      })
      if (!approved) return DECLINED()
      const a = await services.addAppointment({ title: purpose.trim(), candidate_id: c.id, date: when.date, time: when.time, type, status: 'Scheduled' })
      return ok({ appointment: { id: a.id, title: a.title, date: a.date, time: a.time, type: a.type, status: a.status, candidate_id: c.id }, timezone: 'Africa/Nairobi' })
    },

    async enqueue_automation_job({ job_type, payload }) {
      const problems = jobPayloadProblems(job_type, payload)
      if (problems.length) return fail(problems.join('; '), 'invalid_input')
      let candidate = null
      if (payload.candidate_id) {
        candidate = await findCandidate(payload.candidate_id)
        if (!candidate) return fail(`Candidate ${payload.candidate_id} not found`, 'not_found')
      }
      const approved = await confirm({
        tool: 'enqueue_automation_job', title: 'Hand work to the Hermes agents',
        summary: `Queue a ${job_type} job${candidate ? ` for ${candidate.name}` : ''}.`,
        details: [['Job type', job_type], ...(candidate ? [['Candidate', candidate.name]] : []), ['Payload', JSON.stringify(payload).slice(0, 300)]],
      })
      if (!approved) return DECLINED()
      const job = await services.enqueueJob(job_type, payload)
      return ok({ job: { id: job.id, job_type: job.job_type, status: job.status, created_at: job.created_at } })
    },
  }

  return Object.fromEntries(Object.entries(impl).map(([name, fn]) => [name, async (args) => {
    const problems = validateArgs(SPEC[name].inputSchema, args)
    if (problems.length) return fail(problems.join('; '), 'invalid_input')
    try {
      return await fn(args || {})
    } catch (err) {
      return errorEnvelope(err)
    }
  }]))
}
