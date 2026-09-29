import { supabase } from '../supabase/client'
import { getSignedUrl } from './documentService'
import { logActivity } from './activityService'

const TABLE = 'cv_drafts'

export async function getCVDrafts({ candidateId, status } = {}) {
  let query = supabase.from(TABLE).select('*')
  if (candidateId) query = query.eq('candidate_id', candidateId)
  if (status) query = query.eq('status', status)
  const { data, error } = await query.order('updated_at', { ascending: false })
  if (error) throw error
  return data
}

export async function getCVDraftById(id) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).single()
  if (error) throw error
  return data
}

export async function addCVDraft(draft) {
  const { data, error } = await supabase.from(TABLE).insert(draft).select().single()
  if (error) throw error
  return data
}

export async function updateCVDraft(id, updates) {
  const { data, error } = await supabase.from(TABLE).update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteCVDraft(id) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id)
  if (error) throw error
}

/**
 * Phase 5: staff review of a Hermes-built CV. reviewed_by / approved_by and
 * the timestamps are forced by the DB trigger (migration 005).
 */
export async function reviewCVDraft(draft, decision, notes = '') {
  if (!['approved', 'rejected'].includes(decision)) throw new Error('Decision must be approved or rejected')
  const data = await updateCVDraft(draft.id, { status: decision, review_notes: notes?.trim() || null })
  if (draft.candidate_id) {
    logActivity({
      entityType: 'document', entityId: draft.document_id || null, candidateId: draft.candidate_id,
      action: decision === 'approved' ? 'cv_draft_approved' : 'cv_draft_rejected',
      summary: `CV draft "${draft.title}" ${decision}`, changes: { cv_draft_id: draft.id },
    })
  }
  return data
}

/** Short-lived signed URL for the draft's PDF (private bucket). */
export async function getCVDraftPdfUrl(draft) {
  if (!draft?.pdf_path) throw new Error('This draft has no PDF attached')
  return getSignedUrl(draft.pdf_path, 600)
}
