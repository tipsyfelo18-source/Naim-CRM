// Phase 2: one page per candidate: details, validated stage changes, the
// document center (checklist + signed URLs), activity history, linked tasks
// and appointments, and the Hermes "Build CV with AI" hook (Phase 5) whose
// finished CVs land in the CV drafts tab for one-click approval.
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Mail, Phone, Globe, Briefcase, Bot, FileText, FileCheck, History, ClipboardList, User, AlertTriangle } from 'lucide-react'
import Layout from '../components/layout/Layout'
import Button from '../components/ui/Button'
import { SkeletonText, SkeletonCards } from '../components/ui/Skeleton'
import StatusDropdown from '../components/candidates/StatusDropdown'
import DocumentCenter from '../components/candidates/DocumentCenter'
import ActivityTimeline from '../components/candidates/ActivityTimeline'
import CvDraftsPanel from '../components/candidates/CvDraftsPanel'
import { useToast } from '../contexts/ToastContext'
import { isSupabaseConfigured } from '../supabase/client'
import { getCandidateById, changeCandidateStage } from '../services/candidateService'
import { getTasks } from '../services/taskService'
import { getAppointments } from '../services/appointmentService'
import { enqueueAutomationJob, getAutomationJobs, listAutomationJobs, isJobOpen } from '../services/automationService'
import { logActivity } from '../services/activityService'
import { demoCandidatesList } from '../services/demoData'
import { normalizeStage } from '../utils/constants'
import { transitionError } from '../utils/stageTransitions'

const TABS = [
  { key: 'overview', label: 'Overview', icon: User },
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'cv', label: 'CV drafts', icon: FileCheck },
  { key: 'activity', label: 'History', icon: History },
  { key: 'work', label: 'Tasks & appointments', icon: ClipboardList },
]

const DETAIL_FIELDS = [
  ['passport_number', 'Passport number'],
  ['nationality', 'Nationality'],
  ['date_of_birth', 'Date of birth'],
  ['age', 'Age'],
  ['gender', 'Gender'],
  ['religion', 'Religion'],
  ['civil_status', 'Civil status'],
  ['number_of_kids', 'Children'],
  ['education_level', 'Education'],
  ['work_company', 'Previous employer'],
  ['work_city', 'Work city'],
  ['city', 'City'],
  ['country', 'Country'],
  ['height', 'Height'],
  ['weight', 'Weight'],
  ['next_of_kin_name', 'Next of kin'],
  ['emergency_contact', 'Emergency contact'],
  ['salary', 'Expected salary'],
]

function Field({ label, value }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-text-primary">{String(value)}</dd>
    </div>
  )
}

function WorkTab({ candidateId }) {
  const [state, setState] = useState({ loading: true, tasks: [], appointments: [], error: null })

  useEffect(() => {
    let active = true
    if (!isSupabaseConfigured) { setState({ loading: false, tasks: [], appointments: [], error: null }); return undefined }
    Promise.all([getTasks({ candidateId, pageSize: 50 }), getAppointments({ candidateId, pageSize: 50 })])
      .then(([t, a]) => active && setState({ loading: false, tasks: t.data || [], appointments: a.data || [], error: null }))
      .catch((error) => active && setState({ loading: false, tasks: [], appointments: [], error }))
    return () => { active = false }
  }, [candidateId])

  if (state.loading) return <SkeletonText lines={5} />
  if (state.error) return <p role="alert" className="text-sm text-red-600">Couldn't load tasks and appointments.</p>

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section>
        <h3 className="mb-2 text-sm font-bold text-primary">Tasks ({state.tasks.length})</h3>
        {state.tasks.length === 0 ? <p className="text-sm text-gray-500">No tasks linked to this candidate.</p> : (
          <ul className="space-y-2">
            {state.tasks.map((t) => (
              <li key={t.id} className="rounded-lg border border-gray-100 bg-white p-3 text-sm shadow-sm">
                <p className="font-medium text-text-primary">{t.title}</p>
                <p className="text-xs text-gray-500">{[t.status, t.priority && `${t.priority} priority`, t.due_date && `Due ${t.due_date}`].filter(Boolean).join(' • ')}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-bold text-primary">Appointments ({state.appointments.length})</h3>
        {state.appointments.length === 0 ? <p className="text-sm text-gray-500">No appointments for this candidate.</p> : (
          <ul className="space-y-2">
            {state.appointments.map((a) => (
              <li key={a.id} className="rounded-lg border border-gray-100 bg-white p-3 text-sm shadow-sm">
                <p className="font-medium text-text-primary">{a.title}</p>
                <p className="text-xs text-gray-500">{[a.type, [a.date, a.time].filter(Boolean).join(' '), a.status].filter(Boolean).join(' • ')}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default function CandidateProfilePage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const toast = useToast()
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'overview'
  const [candidate, setCandidate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [historyKey, setHistoryKey] = useState(0)
  const [cvJob, setCvJob] = useState(null)
  const [cvBusy, setCvBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (!isSupabaseConfigured) {
        const found = demoCandidatesList.find((c) => c.id === id)
        if (!found) throw new Error('not-found')
        setCandidate(found)
      } else {
        setCandidate(await getCandidateById(id))
      }
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  // Resume showing an open cv_build job after a reload.
  useEffect(() => {
    if (!isSupabaseConfigured || !id) return undefined
    let active = true
    listAutomationJobs({ jobType: 'cv_build', limit: 50 })
      .then((jobs) => {
        const latest = jobs.find((j) => j.payload?.candidate_id === id)
        if (active && latest && isJobOpen(latest)) setCvJob(latest)
      })
      .catch(() => {})
    return () => { active = false }
  }, [id])

  // Poll the Hermes cv_build job until it finishes.
  useEffect(() => {
    if (!cvJob || !isJobOpen(cvJob)) return undefined
    const timer = window.setInterval(async () => {
      try {
        const [fresh] = await getAutomationJobs([cvJob.id])
        if (fresh) {
          setCvJob(fresh)
          if (!isJobOpen(fresh)) setHistoryKey((k) => k + 1)
        }
      } catch { /* keep polling */ }
    }, 5000)
    return () => window.clearInterval(timer)
  }, [cvJob])

  async function handleStage(next) {
    const from = normalizeStage(candidate.stage) || 'New'
    if (next === from) return
    const problem = transitionError(from, next)
    if (problem) { toast.error(problem); return }
    const previous = candidate
    setCandidate({ ...candidate, stage: next })
    if (!isSupabaseConfigured) { toast.info('Demo mode: stage change not saved'); return }
    try {
      const saved = await changeCandidateStage(candidate.id, next, from)
      setCandidate(saved)
      setHistoryKey((k) => k + 1)
      toast.success(`Stage changed to ${next}`)
    } catch (err) {
      setCandidate(previous)
      toast.error(err?.message || 'Stage change failed')
    }
  }

  async function buildCv() {
    setCvBusy(true)
    try {
      const job = await enqueueAutomationJob('cv_build', { candidate_id: candidate.id, candidate_name: candidate.name })
      setCvJob(job)
      logActivity({ entityType: 'automation_job', entityId: job.id, candidateId: candidate.id, action: 'automation_job_enqueued', summary: 'Asked Hermes (Salmin) to build a CV' })
      setHistoryKey((k) => k + 1)
      toast.success('CV build queued for the Hermes agent')
    } catch (err) {
      toast.error(err?.message || 'Could not queue the CV build')
    } finally {
      setCvBusy(false)
    }
  }

  function selectTab(key) {
    const next = new URLSearchParams(params)
    if (key === 'overview') next.delete('tab')
    else next.set('tab', key)
    setParams(next, { replace: true })
  }

  if (loading) {
    return (
      <Layout title="Candidate">
        <div className="space-y-6"><SkeletonCards count={4} /><div className="rounded-2xl bg-white p-6 shadow-sm"><SkeletonText lines={6} /></div></div>
      </Layout>
    )
  }

  if (error || !candidate) {
    return (
      <Layout title="Candidate">
        <div className="mx-auto max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-500" aria-hidden="true" />
          <h2 className="text-lg font-bold text-primary">Candidate not found</h2>
          <p className="mt-1 text-sm text-text-secondary">It may have been deleted, or the link is wrong.</p>
          <div className="mt-5 flex justify-center gap-3">
            <Button variant="outline" onClick={load}>Retry</Button>
            <Link to="/candidates" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover">All candidates</Link>
          </div>
        </div>
      </Layout>
    )
  }

  const role = candidate.job_title || candidate.work_position || candidate.position
  const cvLabel = cvJob
    ? { pending: 'CV queued for Hermes…', claimed: 'Hermes is building the CV…', done: 'CV ready for review', failed: `CV build failed${cvJob.result?.error ? `: ${cvJob.result.error}` : ''}. You can retry.` }[cvJob.status]
    : null

  return (
    <Layout title="Candidate">
      <div className="space-y-5 animate-fade-in">
        <Link to="/candidates" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Candidates
        </Link>

        {candidate.deleted_at && (
          <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">This candidate is in the Recycle Bin. An admin can restore them.</div>
        )}

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h2 className="break-words text-xl font-bold text-text-primary">{candidate.name}</h2>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-secondary">
                {role && <span className="inline-flex items-center gap-1"><Briefcase className="h-4 w-4" aria-hidden="true" />{role}</span>}
                {candidate.country_applying_to && <span className="inline-flex items-center gap-1"><Globe className="h-4 w-4" aria-hidden="true" />{candidate.country_applying_to}</span>}
                {candidate.phone && <a href={`tel:${candidate.phone}`} className="inline-flex items-center gap-1 hover:text-primary"><Phone className="h-4 w-4" aria-hidden="true" />{candidate.phone}</a>}
                {candidate.email && <a href={`mailto:${candidate.email}`} className="inline-flex items-center gap-1 break-all hover:text-primary"><Mail className="h-4 w-4" aria-hidden="true" />{candidate.email}</a>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-gray-400">Stage</span>
              <StatusDropdown value={candidate.stage} onChange={handleStage} />
              <Button variant="outline" size="sm" onClick={buildCv} loading={cvBusy} disabled={!isSupabaseConfigured || (cvJob && isJobOpen(cvJob))} title={isSupabaseConfigured ? 'Queue a cv_build job for the Hermes agent' : 'Needs Supabase'}>
                <Bot className="h-4 w-4" aria-hidden="true" /> Build CV with AI
              </Button>
            </div>
          </div>
          {cvLabel && (
            <p role="status" className={`mt-3 text-xs ${cvJob?.status === 'failed' ? 'text-red-600' : 'text-primary'}`}>
              {cvLabel}
              {cvJob?.status === 'done' && tab !== 'cv' && (
                <button type="button" onClick={() => selectTab('cv')} className="ml-2 font-medium underline">Open CV drafts</button>
              )}
            </p>
          )}
        </section>

        <div role="tablist" aria-label="Candidate sections" className="flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-sm">
          {TABS.map((t) => {
            const Icon = t.icon
            const active = t.key === tab
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectTab(t.key)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? 'bg-primary text-white' : 'text-text-secondary hover:bg-cream-warm hover:text-primary'}`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" /> {t.label}
              </button>
            )
          })}
        </div>

        <section role="tabpanel" className="rounded-2xl bg-white p-5 shadow-sm">
          {tab === 'overview' && (
            <div className="space-y-5">
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {DETAIL_FIELDS.map(([key, label]) => <Field key={key} label={label} value={candidate[key]} />)}
                <Field label="Added" value={candidate.created_at && new Date(candidate.created_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' })} />
                <Field label="Last updated" value={candidate.updated_at && new Date(candidate.updated_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' })} />
              </dl>
              {candidate.notes && (
                <div>
                  <h3 className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Notes</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">{candidate.notes}</p>
                </div>
              )}
              <p className="text-xs text-gray-400">Edit full details from the <Link to={`/candidates?q=${encodeURIComponent(candidate.name || '')}`} className="text-primary underline">Candidates list</Link>.</p>
            </div>
          )}
          {tab === 'documents' && <DocumentCenter candidateId={candidate.id} onChanged={() => setHistoryKey((k) => k + 1)} />}
          {tab === 'cv' && <CvDraftsPanel candidateId={candidate.id} refreshKey={historyKey} onChanged={() => setHistoryKey((k) => k + 1)} />}
          {tab === 'activity' && <ActivityTimeline candidateId={candidate.id} refreshKey={historyKey} />}
          {tab === 'work' && <WorkTab candidateId={candidate.id} />}
        </section>
      </div>
    </Layout>
  )
}
