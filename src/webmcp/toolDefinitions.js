// Phase 3.5 WebMCP: the browser-side tool contract. Pure module (no Supabase,
// no DOM) so it is unit-tested by tests/webmcp.test.mjs and documented in
// docs/WEBMCP.md. registerTools.js binds each spec to the CRM service layer.
import { CANDIDATE_STAGES, COUNTRIES, AUTOMATION_JOB_TYPES, JOB_PAYLOAD_REQUIRED, TASK_PRIORITIES } from '../utils/constants.js'

const UUID = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
const DATE = '^\\d{4}-\\d{2}-\\d{2}$'
// Local wall-clock time in Africa/Nairobi (EAT, UTC+3), or an ISO timestamp with an offset.
const DATETIME = '^\\d{4}-\\d{2}-\\d{2}[T ]([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d(\\.\\d+)?)?(Z|[+-]\\d{2}:?\\d{2})?$'
const PHONE = '^\\+?[0-9 ()-]{7,20}$'

/**
 * Every tool: name, title, description, inputSchema (strict JSON Schema),
 * readOnly (reads run silently; writes ALWAYS require a visible confirmation),
 * page (the CRM page permission the signed-in user needs for the tool to be
 * registered at all).
 */
export const TOOL_SPECS = Object.freeze([
  {
    name: 'search_candidates',
    title: 'Search candidates',
    description: 'Search Naim CRM candidates by name, email, phone or passport number. Optional canonical stage and destination country filters. Returns at most `limit` brief records.',
    readOnly: true,
    page: 'candidates',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', maxLength: 100, description: 'Free-text search. Use "" to list the most recent candidates.' },
        stage: { type: 'string', enum: [...CANDIDATE_STAGES], description: 'Canonical pipeline stage.' },
        country: { type: 'string', maxLength: 80, description: `Destination country, e.g. ${COUNTRIES.slice(0, 4).join(', ')}.` },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_candidate_summary',
    title: 'Candidate summary',
    description: 'One candidate: contact details, stage, legal next stages, document checklist status, open tasks and upcoming appointments.',
    readOnly: true,
    page: 'candidates',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { candidate_id: { type: 'string', pattern: UUID, description: 'Candidate UUID (from search_candidates).' } },
      required: ['candidate_id'],
    },
  },
  {
    name: 'get_reports_summary',
    title: 'Live KPI summary',
    description: 'Live report KPIs: candidates by stage (pipeline funnel), destinations, placements this month, expired/expiring documents, tasks due today and overdue.',
    readOnly: true,
    page: 'reports',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'add_candidate',
    title: 'Add candidate',
    description: 'Create a new candidate in stage New. The signed-in user must approve it in an on-screen confirmation dialog before anything is saved.',
    readOnly: false,
    page: 'candidates',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 200 },
        phone: { type: 'string', pattern: PHONE, description: 'Mobile number, e.g. +254712345678.' },
        email: { type: 'string', format: 'email', maxLength: 200 },
        country_interest: { type: 'string', maxLength: 80, description: 'Destination country the candidate wants to work in.' },
      },
      required: ['name', 'phone'],
    },
  },
  {
    name: 'update_candidate_stage',
    title: 'Move candidate stage',
    description: 'Move a candidate to another canonical stage. Checkpoints Interview > Offer > Visa Processing > Placed cannot be skipped. Requires on-screen confirmation.',
    readOnly: false,
    page: 'candidates',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        candidate_id: { type: 'string', pattern: UUID },
        stage: { type: 'string', enum: [...CANDIDATE_STAGES] },
      },
      required: ['candidate_id', 'stage'],
    },
  },
  {
    name: 'create_task',
    title: 'Create task',
    description: 'Create a staff task, optionally linked to a candidate. Requires on-screen confirmation.',
    readOnly: false,
    page: 'tasks',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', minLength: 2, maxLength: 200 },
        due_date: { type: 'string', pattern: DATE, description: 'YYYY-MM-DD (Africa/Nairobi).' },
        candidate_id: { type: 'string', pattern: UUID },
        priority: { type: 'string', enum: [...TASK_PRIORITIES], default: 'Medium' },
        description: { type: 'string', maxLength: 2000 },
      },
      required: ['title', 'due_date'],
    },
  },
  {
    name: 'book_appointment',
    title: 'Book appointment',
    description: 'Book an appointment for a candidate. `datetime` is Africa/Nairobi local time (YYYY-MM-DDTHH:MM) unless it carries an offset. Requires on-screen confirmation.',
    readOnly: false,
    page: 'appointments',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        candidate_id: { type: 'string', pattern: UUID },
        datetime: { type: 'string', pattern: DATETIME },
        purpose: { type: 'string', minLength: 2, maxLength: 200, description: 'Shown as the appointment title, e.g. "Interview with Al-Sabah Group".' },
        type: { type: 'string', maxLength: 60, default: 'Interview' },
      },
      required: ['candidate_id', 'datetime', 'purpose'],
    },
  },
  {
    name: 'enqueue_automation_job',
    title: 'Hand work to Hermes',
    description: `Queue a job for the Hermes automation agents (see docs/HERMES-INTEGRATION.md). job_type: ${AUTOMATION_JOB_TYPES.join(' | ')}. Requires on-screen confirmation.`,
    readOnly: false,
    page: 'candidates',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        job_type: { type: 'string', enum: [...AUTOMATION_JOB_TYPES] },
        payload: { type: 'object', description: 'Job payload. Required keys: cv_build {candidate_id}, lead_enrich {lead_id}, whatsapp_send {to, message}, doc_ocr {document_id}, followup_sweep {}.' },
      },
      required: ['job_type', 'payload'],
    },
  },
])

export const WRITE_TOOLS = Object.freeze(TOOL_SPECS.filter((t) => !t.readOnly).map((t) => t.name))

function typeOf(value) {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  if (Number.isInteger(value)) return 'integer'
  return typeof value
}

/**
 * Minimal strict JSON Schema check for the subset used above. Returns a list
 * of human-readable problems ([] when valid). Browsers do NOT validate tool
 * arguments against inputSchema, so every tool runs this first.
 */
export function validateArgs(schema, args) {
  const problems = []
  const input = args === undefined ? {} : args
  if (typeOf(input) !== 'object') return ['Arguments must be a JSON object']
  const props = schema.properties || {}
  for (const key of schema.required || []) {
    if (input[key] === undefined || input[key] === null || (typeof input[key] === 'string' && !input[key].trim() && key !== 'query')) {
      problems.push(`${key} is required`)
    }
  }
  for (const [key, value] of Object.entries(input)) {
    const rule = props[key]
    if (!rule) {
      if (schema.additionalProperties === false) problems.push(`Unknown argument: ${key}`)
      continue
    }
    if (value === undefined || value === null) continue
    const actual = typeOf(value)
    const typeOk = rule.type === actual || (rule.type === 'number' && actual === 'integer')
    if (!typeOk) { problems.push(`${key} must be ${rule.type === 'integer' ? 'an integer' : `a ${rule.type}`}`); continue }
    if (rule.enum && !rule.enum.includes(value)) problems.push(`${key} must be one of: ${rule.enum.join(', ')}`)
    if (typeof value === 'string') {
      if (rule.minLength && value.trim().length < rule.minLength) problems.push(`${key} is too short`)
      if (rule.maxLength && value.length > rule.maxLength) problems.push(`${key} is too long (max ${rule.maxLength})`)
      if (rule.pattern && !new RegExp(rule.pattern).test(value)) problems.push(`${key} has an invalid format`)
      if (rule.format === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) problems.push(`${key} must be an email address`)
    }
    if (typeof value === 'number') {
      if (rule.minimum !== undefined && value < rule.minimum) problems.push(`${key} must be >= ${rule.minimum}`)
      if (rule.maximum !== undefined && value > rule.maximum) problems.push(`${key} must be <= ${rule.maximum}`)
    }
  }
  return problems
}

/** Payload keys a job type needs (mirror of crm_helpers.validate_job_payload). */
export function jobPayloadProblems(jobType, payload) {
  if (!AUTOMATION_JOB_TYPES.includes(jobType)) return [`Unknown job_type ${jobType}`]
  if (typeOf(payload) !== 'object') return ['payload must be an object']
  const problems = (JOB_PAYLOAD_REQUIRED[jobType] || [])
    .filter((key) => payload[key] === undefined || payload[key] === null || payload[key] === '')
    .map((key) => `${jobType} payload is missing ${key}`)
  for (const key of ['candidate_id', 'lead_id', 'document_id']) {
    if (payload[key] && !new RegExp(UUID).test(String(payload[key]))) problems.push(`payload.${key} must be a UUID`)
  }
  if (JSON.stringify(payload).length > 50000) problems.push('payload is too large (max 50 KB)')
  return problems
}

/**
 * Split an agent-supplied datetime into the appointments table's local
 * (Africa/Nairobi) date + HH:MM. Offsets are converted; bare values are
 * taken as Nairobi wall-clock time. Returns null when unparseable.
 */
export function toNairobiDateTime(value) {
  const text = String(value || '').trim()
  if (!new RegExp(DATETIME).test(text)) return null
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(text)
  if (!hasOffset) {
    const [date, time] = text.replace(' ', 'T').split('T')
    return { date, time: time.slice(0, 5) }
  }
  const parsed = new Date(text.replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return null
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(parsed).map((p) => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

export function ok(data) { return { ok: true, data, error: null } }
export function fail(message, code = 'invalid_input') { return { ok: false, data: null, error: { code, message: String(message) } } }
