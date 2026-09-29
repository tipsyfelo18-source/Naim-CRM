// Browser side of the Hermes job queue (automation_jobs). The CRM only
// ENQUEUES and READS jobs; Hermes claims/completes them via the MCP server
// with service_role. No AI keys or model calls ever live in the frontend.
import { supabase, isSupabaseConfigured } from '../supabase/client'
import { AUTOMATION_JOB_TYPES, JOB_PAYLOAD_REQUIRED } from '../utils/constants'

const TABLE = 'automation_jobs'

export function isJobOpen(job) {
  return job?.status === 'pending' || job?.status === 'claimed'
}

export async function enqueueAutomationJob(jobType, payload = {}) {
  if (!AUTOMATION_JOB_TYPES.includes(jobType)) {
    throw new Error(`Unknown automation job type: ${jobType}`)
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Job payload must be an object')
  }
  // Same minimum contract the MCP server enforces (docs/HERMES-INTEGRATION.md).
  const missing = (JOB_PAYLOAD_REQUIRED[jobType] || []).filter((key) => payload[key] === undefined || payload[key] === null || payload[key] === '')
  if (missing.length) throw new Error(`${jobType} job is missing: ${missing.join(', ')}`)
  if (!isSupabaseConfigured) {
    throw new Error('Demo mode: agent jobs need a live Supabase connection')
  }
  // requested_by and status are forced server-side by a trigger.
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ job_type: jobType, payload })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function listAutomationJobs({ jobType, limit = 20 } = {}) {
  if (!isSupabaseConfigured) return []
  let query = supabase.from(TABLE).select('*').order('created_at', { ascending: false }).limit(limit)
  if (jobType) query = query.eq('job_type', jobType)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function getAutomationJobs(ids) {
  if (!isSupabaseConfigured || !ids?.length) return []
  const { data, error } = await supabase.from(TABLE).select('*').in('id', ids)
  if (error) throw error
  return data || []
}
