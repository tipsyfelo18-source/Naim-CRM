// Phase 5: Leads. Hermes (Ali, Researcher) fills this list through the MCP
// upsert_lead tool; staff add leads by hand, ask Hermes to enrich one
// (lead_enrich job, live status), and convert a lead to a candidate in one click.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, Bot, UserCheck, Phone, Mail, Globe, Briefcase, RefreshCw, Target } from 'lucide-react'
import Layout from '../components/layout/Layout'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import { SkeletonText } from '../components/ui/Skeleton'
import { useToast } from '../contexts/ToastContext'
import { isSupabaseConfigured } from '../supabase/client'
import { COUNTRIES, LEAD_STATUSES, LEAD_STATUS_LABELS } from '../utils/constants'
import { isJobOpen } from '../services/automationService'
import { getLeads, getLeadCounts, addLead, updateLead, convertLead, requestLeadEnrichment, getLeadEnrichmentJobs } from '../services/leadService'

const PAGE_SIZE = 25
const STATUS_STYLE = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-purple-100 text-purple-700',
  qualified: 'bg-teal-100 text-teal-700',
  converted: 'bg-green-100 text-green-800',
  disqualified: 'bg-gray-100 text-gray-600',
}
const JOB_LABEL = { pending: 'Enrichment queued', claimed: 'Hermes is researching…', done: 'Enriched', failed: 'Enrichment failed' }
const EMPTY_FORM = { name: '', phone: '', email: '', country_interest: '', job_interest: '', notes: '' }
const EDITABLE_STATUSES = LEAD_STATUSES.filter((s) => s !== 'converted')

const inputClass = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none'

function AddLeadModal({ open, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) setForm(EMPTY_FORM) }, [open])
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const lead = await addLead(form)
      toast.success(`Lead ${lead.name} added`)
      onSaved(lead)
      onClose()
    } catch (err) {
      toast.error(err?.message || 'Could not add the lead')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={open} onClose={onClose} title="Add lead">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="lead-name" className="mb-1 block text-xs font-medium text-text-secondary">Name *</label>
          <input id="lead-name" required maxLength={200} value={form.name} onChange={set('name')} className={inputClass} autoFocus />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="lead-phone" className="mb-1 block text-xs font-medium text-text-secondary">Phone</label>
            <input id="lead-phone" type="tel" value={form.phone} onChange={set('phone')} className={inputClass} placeholder="+2547…" />
          </div>
          <div>
            <label htmlFor="lead-email" className="mb-1 block text-xs font-medium text-text-secondary">Email</label>
            <input id="lead-email" type="email" value={form.email} onChange={set('email')} className={inputClass} />
          </div>
          <div>
            <label htmlFor="lead-country" className="mb-1 block text-xs font-medium text-text-secondary">Destination interest</label>
            <select id="lead-country" value={form.country_interest} onChange={set('country_interest')} className={inputClass}>
              <option value="">(not known)</option>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="lead-job" className="mb-1 block text-xs font-medium text-text-secondary">Job interest</label>
            <input id="lead-job" maxLength={120} value={form.job_interest} onChange={set('job_interest')} className={inputClass} placeholder="e.g. Housemaid, Driver" />
          </div>
        </div>
        <div>
          <label htmlFor="lead-notes" className="mb-1 block text-xs font-medium text-text-secondary">Notes</label>
          <textarea id="lead-notes" rows={3} value={form.notes} onChange={set('notes')} className={inputClass} />
        </div>
        <p className="text-xs text-text-secondary">Give at least a phone number or an email.</p>
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Add lead</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function LeadsPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [state, setState] = useState({ loading: true, rows: [], count: 0, error: null })
  const [counts, setCounts] = useState({})
  const [jobs, setJobs] = useState({})
  const [busy, setBusy] = useState(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => { setQuery(search); setPage(1) }, 300)
    return () => window.clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) { setState({ loading: false, rows: [], count: 0, error: null }); return }
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const [res, c, j] = await Promise.all([
        getLeads({ search: query, status, page, pageSize: PAGE_SIZE }),
        getLeadCounts(),
        getLeadEnrichmentJobs().catch(() => ({})),
      ])
      setState({ loading: false, rows: res.data, count: res.count, error: null })
      setCounts(c)
      setJobs(j)
    } catch (error) {
      setState({ loading: false, rows: [], count: 0, error })
    }
  }, [query, status, page])

  useEffect(() => { load() }, [load])

  const anyOpenJob = useMemo(() => Object.values(jobs).some(isJobOpen), [jobs])
  useEffect(() => {
    if (!anyOpenJob) return undefined
    const timer = window.setInterval(async () => {
      try {
        const fresh = await getLeadEnrichmentJobs()
        const finished = Object.entries(fresh).some(([id, job]) => jobs[id] && isJobOpen(jobs[id]) && !isJobOpen(job))
        setJobs(fresh)
        if (finished) load()
      } catch { /* keep polling */ }
    }, 5000)
    return () => window.clearInterval(timer)
  }, [anyOpenJob, jobs, load])

  async function enrich(lead) {
    setBusy(`enrich-${lead.id}`)
    try {
      const job = await requestLeadEnrichment(lead)
      setJobs((j) => ({ ...j, [lead.id]: job }))
      toast.success('Enrichment queued for the Hermes agent')
    } catch (err) {
      toast.error(err?.message || 'Could not queue enrichment')
    } finally {
      setBusy(null)
    }
  }

  async function convert(lead) {
    setBusy(`convert-${lead.id}`)
    try {
      const candidateId = await convertLead(lead.id)
      toast.success(`${lead.name} is now a candidate`)
      navigate(`/candidates/${candidateId}`)
    } catch (err) {
      toast.error(err?.message || 'Could not convert the lead')
      setBusy(null)
    }
  }

  async function changeStatus(lead, next) {
    const previous = state.rows
    setState((s) => ({ ...s, rows: s.rows.map((r) => (r.id === lead.id ? { ...r, status: next } : r)) }))
    try {
      await updateLead(lead.id, { status: next })
      getLeadCounts().then(setCounts).catch(() => {})
    } catch (err) {
      setState((s) => ({ ...s, rows: previous }))
      toast.error(err?.message || 'Could not update the lead')
    }
  }

  const pages = Math.max(1, Math.ceil(state.count / PAGE_SIZE))

  return (
    <Layout title="Leads">
      <div className="space-y-5 animate-fade-in">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-primary">Leads</h2>
            <p className="text-sm text-text-secondary">Prospects found by the Hermes Researcher (Ali) or added by staff. Convert a lead to start their candidate file.</p>
          </div>
          <Button onClick={() => setAdding(true)} disabled={!isSupabaseConfigured}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add lead
          </Button>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          <button type="button" onClick={() => { setStatus(''); setPage(1) }} aria-pressed={!status}
            className={`rounded-full px-3 py-1 text-xs font-medium ${!status ? 'bg-primary text-white' : 'bg-white text-text-secondary shadow-sm hover:text-primary'}`}>
            All
          </button>
          {LEAD_STATUSES.map((s) => (
            <button key={s} type="button" onClick={() => { setStatus(s); setPage(1) }} aria-pressed={status === s}
              className={`rounded-full px-3 py-1 text-xs font-medium ${status === s ? 'bg-primary text-white' : 'bg-white text-text-secondary shadow-sm hover:text-primary'}`}>
              {LEAD_STATUS_LABELS[s]}{counts[s] !== undefined ? ` (${counts[s]})` : ''}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <label htmlFor="lead-search" className="sr-only">Search leads</label>
          <input id="lead-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, email, destination, job…"
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm shadow-sm focus:border-primary focus:outline-none" />
        </div>

        {!isSupabaseConfigured ? (
          <div className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
            <Target className="mx-auto mb-2 h-7 w-7 text-primary" aria-hidden="true" />
            Leads live in Supabase only; there is no demo lead data.
          </div>
        ) : state.loading ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm"><SkeletonText lines={6} /></div>
        ) : state.error ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl bg-white p-6 text-sm text-red-600 shadow-sm">
            Couldn't load leads. Has migration 005 been applied?
            <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry</Button>
          </div>
        ) : state.rows.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
            <Target className="mx-auto mb-2 h-7 w-7 text-primary" aria-hidden="true" />
            {query || status ? 'No leads match these filters.' : 'No leads yet. Hermes adds them as it finds prospects, or add one yourself.'}
          </div>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {state.rows.map((lead) => {
              const job = jobs[lead.id]
              const converted = lead.status === 'converted'
              return (
                <li key={lead.id} className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-semibold text-text-primary">{lead.name}</p>
                      <p className="text-xs text-gray-500">Source: {lead.source || 'manual'} • added {new Date(lead.created_at).toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium' })}</p>
                    </div>
                    {converted ? (
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE.converted}`}>Converted</span>
                    ) : (
                      <>
                        <label htmlFor={`lead-status-${lead.id}`} className="sr-only">Status of {lead.name}</label>
                        <select id={`lead-status-${lead.id}`} value={lead.status} onChange={(e) => changeStatus(lead, e.target.value)}
                          className={`shrink-0 rounded-full border-0 px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[lead.status] || ''}`}>
                          {EDITABLE_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>)}
                        </select>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-secondary">
                    {lead.phone && <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1 hover:text-primary"><Phone className="h-4 w-4" aria-hidden="true" />{lead.phone}</a>}
                    {lead.email && <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1 break-all hover:text-primary"><Mail className="h-4 w-4" aria-hidden="true" />{lead.email}</a>}
                    {lead.country_interest && <span className="inline-flex items-center gap-1"><Globe className="h-4 w-4" aria-hidden="true" />{lead.country_interest}</span>}
                    {lead.job_interest && <span className="inline-flex items-center gap-1"><Briefcase className="h-4 w-4" aria-hidden="true" />{lead.job_interest}</span>}
                  </div>
                  {lead.notes && <p className="line-clamp-3 whitespace-pre-wrap text-xs text-text-secondary">{lead.notes}</p>}
                  {lead.enrichment && Object.keys(lead.enrichment).length > 0 && (
                    <details className="text-xs text-text-secondary">
                      <summary className="cursor-pointer text-primary">Hermes research ({Object.keys(lead.enrichment).length} fields)</summary>
                      <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
                        {Object.entries(lead.enrichment).slice(0, 20).map(([k, v]) => (
                          <div key={k} className="contents"><dt className="font-medium">{k}</dt><dd className="break-words">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></div>
                        ))}
                      </dl>
                    </details>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                    {converted ? (
                      lead.converted_candidate_id && (
                        <Link to={`/candidates/${lead.converted_candidate_id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                          <UserCheck className="h-4 w-4" aria-hidden="true" /> Open candidate
                        </Link>
                      )
                    ) : (
                      <>
                        <Button size="sm" onClick={() => convert(lead)} loading={busy === `convert-${lead.id}`} disabled={lead.status === 'disqualified'}
                          title={lead.status === 'disqualified' ? 'Set the lead back to Qualified first' : 'Create a candidate from this lead'}>
                          <UserCheck className="h-4 w-4" aria-hidden="true" /> Convert to candidate
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => enrich(lead)} loading={busy === `enrich-${lead.id}`} disabled={job && isJobOpen(job)}>
                          <Bot className="h-4 w-4" aria-hidden="true" /> Enrich with agent
                        </Button>
                      </>
                    )}
                    {job && <span role="status" className={`text-xs ${job.status === 'failed' ? 'text-red-600' : 'text-primary'}`}>{JOB_LABEL[job.status] || job.status}{job.status === 'failed' && job.result?.error ? `: ${job.result.error}` : ''}</span>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {pages > 1 && (
          <nav className="flex items-center justify-center gap-3 text-sm" aria-label="Leads pages">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="text-text-secondary">Page {page} of {pages}</span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </nav>
        )}
      </div>
      <AddLeadModal open={adding} onClose={() => setAdding(false)} onSaved={() => load()} />
    </Layout>
  )
}
