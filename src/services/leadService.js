// Phase 5 leads: Hermes (Ali, Researcher) fills this table through the MCP
// upsert_lead tool; staff review, enrich (lead_enrich job) and convert a lead
// to a candidate in one click (convert_lead_to_candidate(), migration 005).
import { supabase, isSupabaseConfigured } from '../supabase/client'
import { ilikeAny } from '../utils/sanitizeSearch'
import { LEAD_STATUSES } from '../utils/constants'
import { enqueueAutomationJob, listAutomationJobs } from './automationService'
import { logActivity } from './activityService'

const TABLE = 'leads'
const EDITABLE = ['name', 'phone', 'email', 'source', 'country_interest', 'job_interest', 'status', 'notes']

function pick(record) {
  const out = {}
  for (const key of EDITABLE) if (record[key] !== undefined) out[key] = typeof record[key] === 'string' ? record[key].trim() || null : record[key]
  return out
}

export async function getLeads({ search, status, page = 1, pageSize = 25 } = {}) {
  if (!isSupabaseConfigured) return { data: [], count: 0, page, pageSize }
  let query = supabase.from(TABLE).select('*', { count: 'exact' }).is('deleted_at', null)
  const searchFilter = ilikeAny(['name', 'phone', 'email', 'country_interest', 'job_interest'], search)
  if (searchFilter) query = query.or(searchFilter)
  if (status) query = query.eq('status', status)
  const from = (page - 1) * pageSize
  const { data, count, error } = await query.order('created_at', { ascending: false }).range(from, from + pageSize - 1)
  if (error) throw error
  return { data: data || [], count: count || 0, page, pageSize }
}

export async function getLeadCounts() {
  if (!isSupabaseConfigured) return {}
  const counts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]))
  const results = await Promise.all(LEAD_STATUSES.map((s) => supabase.from(TABLE).select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('status', s)))
  results.forEach(({ count, error }, i) => { if (!error) counts[LEAD_STATUSES[i]] = count || 0 })
  return counts
}

export async function addLead(lead) {
  const record = pick(lead)
  if (!record.name) throw new Error('Name is required')
  if (!record.phone && !record.email) throw new Error('Give a phone number or an email')
  if (record.status === 'converted') delete record.status
  const { data, error } = await supabase.from(TABLE).insert({ source: 'manual', ...record }).select().single()
  if (error) throw error
  logActivity({ entityType: 'lead', entityId: data.id, action: 'lead_created', summary: `Lead ${data.name} added` })
  return data
}

export async function updateLead(id, updates) {
  const patch = pick(updates)
  if (patch.status === 'converted') throw new Error('Use "Convert to candidate" to convert a lead')
  const { data, error } = await supabase.from(TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  if (patch.status) logActivity({ entityType: 'lead', entityId: id, action: 'lead_updated', summary: `Lead ${data.name} set to ${patch.status}` })
  return data
}

/** One click: creates the candidate (stage New) and links it. Returns the candidate id. */
export async function convertLead(id) {
  const { data, error } = await supabase.rpc('convert_lead_to_candidate', { p_lead_id: id })
  if (error) throw error
  return data
}

/** Ask Hermes (Ali) to research/enrich this lead. */
export async function requestLeadEnrichment(lead) {
  const job = await enqueueAutomationJob('lead_enrich', {
    lead_id: lead.id, name: lead.name, phone: lead.phone || null, email: lead.email || null,
    country_interest: lead.country_interest || null, job_interest: lead.job_interest || null,
  })
  logActivity({ entityType: 'lead', entityId: lead.id, action: 'automation_job_enqueued', summary: `Asked Hermes (Ali) to enrich lead ${lead.name}`, changes: { automation_job_id: job.id } })
  return job
}

/** Latest lead_enrich job per lead id. */
export async function getLeadEnrichmentJobs() {
  const jobs = await listAutomationJobs({ jobType: 'lead_enrich', limit: 200 })
  const byLead = {}
  for (const job of jobs) {
    const leadId = job.payload?.lead_id
    if (leadId && !byLead[leadId]) byLead[leadId] = job
  }
  return byLead
}
