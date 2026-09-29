// Phase 5: CV drafts for one candidate. Hermes (Salmin, CV Builder engine)
// writes finished CVs via the MCP save_cv_draft tool (PDF in the private
// bucket, linked as a Resume/CV document, status pending_review). Staff open
// the PDF through a signed URL and approve or reject in one click.
import { useCallback, useEffect, useState } from 'react'
import { CircleCheck, CircleX, FileText, ExternalLink, Bot, RefreshCw } from 'lucide-react'
import Button from '../ui/Button'
import { SkeletonText } from '../ui/Skeleton'
import { useToast } from '../../contexts/ToastContext'
import { isSupabaseConfigured } from '../../supabase/client'
import { getCVDrafts, reviewCVDraft, getCVDraftPdfUrl } from '../../services/cvDraftService'

const STATUS_STYLE = {
  draft: 'bg-slate-100 text-slate-700',
  pending_review: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
}
const STATUS_LABEL = { draft: 'Draft', pending_review: 'Awaiting review', approved: 'Approved', rejected: 'Rejected' }

function when(value) {
  return value ? new Date(value).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' }) : ''
}

export default function CvDraftsPanel({ candidateId, refreshKey = 0, onChanged }) {
  const toast = useToast()
  const [state, setState] = useState({ loading: true, drafts: [], error: null })
  const [busy, setBusy] = useState(null)
  const [notes, setNotes] = useState({})

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) { setState({ loading: false, drafts: [], error: null }); return }
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      setState({ loading: false, drafts: (await getCVDrafts({ candidateId })) || [], error: null })
    } catch (error) {
      setState({ loading: false, drafts: [], error })
    }
  }, [candidateId])

  useEffect(() => { load() }, [load, refreshKey])

  async function openPdf(draft) {
    setBusy(`open-${draft.id}`)
    try {
      window.open(await getCVDraftPdfUrl(draft), '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error(err?.message || 'Could not open the PDF')
    } finally {
      setBusy(null)
    }
  }

  async function review(draft, decision) {
    setBusy(`${decision}-${draft.id}`)
    try {
      const saved = await reviewCVDraft(draft, decision, notes[draft.id])
      setState((s) => ({ ...s, drafts: s.drafts.map((d) => (d.id === draft.id ? saved : d)) }))
      toast.success(decision === 'approved' ? 'CV approved' : 'CV rejected')
      onChanged?.()
    } catch (err) {
      toast.error(err?.message || 'Could not save the review')
    } finally {
      setBusy(null)
    }
  }

  if (!isSupabaseConfigured) return <p className="text-sm text-gray-500">CV drafts need a live Supabase connection.</p>
  if (state.loading) return <SkeletonText lines={4} />
  if (state.error) {
    return (
      <div role="alert" className="flex items-center gap-3 text-sm text-red-600">
        Couldn't load CV drafts. <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry</Button>
      </div>
    )
  }
  if (!state.drafts.length) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
        <Bot className="mx-auto mb-2 h-6 w-6 text-primary" aria-hidden="true" />
        No CV drafts yet. Use <strong>Build CV with AI</strong> above, or the CV Builder page.
      </div>
    )
  }

  return (
    <ul className="space-y-3">
      {state.drafts.map((d) => {
        const status = d.status || 'draft'
        const reviewable = status === 'pending_review' || status === 'draft'
        return (
          <li key={d.id} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium text-text-primary">
                  <FileText className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="break-words">{d.title}</span>
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {d.source === 'hermes' ? 'Built by Hermes (Salmin)' : 'Created in CV Builder'} • {when(d.created_at)}
                  {d.approved_at && ` • approved ${when(d.approved_at)}`}
                  {!d.approved_at && d.reviewed_at && ` • reviewed ${when(d.reviewed_at)}`}
                </p>
                {d.review_notes && <p className="mt-1 whitespace-pre-wrap text-xs text-text-secondary">Notes: {d.review_notes}</p>}
              </div>
              <span className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status] || STATUS_STYLE.draft}`}>{STATUS_LABEL[status] || status}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {d.pdf_path && (
                <Button variant="outline" size="sm" onClick={() => openPdf(d)} loading={busy === `open-${d.id}`}>
                  <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open PDF
                </Button>
              )}
              {reviewable && (
                <>
                  <label className="sr-only" htmlFor={`cv-notes-${d.id}`}>Review notes</label>
                  <input
                    id={`cv-notes-${d.id}`}
                    type="text"
                    placeholder="Review notes (optional)"
                    value={notes[d.id] || ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [d.id]: e.target.value }))}
                    className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                    maxLength={500}
                  />
                  <Button variant="success" size="sm" onClick={() => review(d, 'approved')} loading={busy === `approved-${d.id}`}>
                    <CircleCheck className="h-4 w-4" aria-hidden="true" /> Approve
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => review(d, 'rejected')} loading={busy === `rejected-${d.id}`}>
                    <CircleX className="h-4 w-4" aria-hidden="true" /> Reject
                  </Button>
                </>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
