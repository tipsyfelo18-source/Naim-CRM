// Phase 3.5: mounts once inside the auth + toast providers. Registers the
// WebMCP tools after sign-in, unregisters them on logout, and renders the
// human-visible confirmation dialog every write tool must pass.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, ShieldCheck } from 'lucide-react'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { isSupabaseConfigured } from '../supabase/client'
import { isWebMCPSupported, registerWebMCPTools } from './registerTools'
import { webmcpServices } from './services'

export default function WebMCPBridge() {
  const { user, userProfile } = useAuth()
  const toast = useToast()
  const [queue, setQueue] = useState([])
  const toastRef = useRef(toast)
  toastRef.current = toast

  const confirm = useCallback((request) => new Promise((resolve) => {
    setQueue((q) => [...q, { ...request, key: `${Date.now()}-${Math.random()}`, resolve }])
  }), [])

  const decide = useCallback((approved) => {
    setQueue((q) => {
      if (!q.length) return q
      q[0].resolve(approved)
      return q.slice(1)
    })
  }, [])

  const permissionsKey = `${userProfile?.id || ''}|${userProfile?.role || ''}|${(userProfile?.page_permissions || []).join(',')}`

  useEffect(() => {
    if (!isSupabaseConfigured || !user || !userProfile || !isWebMCPSupported()) return undefined
    let cancelled = false
    let unregister = null
    registerWebMCPTools({
      profile: userProfile,
      confirm,
      services: webmcpServices,
      onToolRun: (spec, result) => {
        if (spec.readOnly) return
        if (result?.ok) toastRef.current.success(`AI agent: ${spec.title} saved`)
        else if (result?.error?.code !== 'user_declined') toastRef.current.error(`AI agent: ${spec.title} failed: ${result?.error?.message || 'error'}`)
      },
    }).then((fn) => {
      if (cancelled) fn()
      else unregister = fn
    })
    return () => {
      cancelled = true
      if (unregister) unregister()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, permissionsKey, confirm])

  // Logout: nothing may stay pending on behalf of a signed-out user.
  useEffect(() => {
    if (user) return
    setQueue((q) => {
      q.forEach((r) => r.resolve(false))
      return []
    })
  }, [user])

  const current = queue[0]
  if (!current) return null

  return (
    <Modal isOpen onClose={() => decide(false)} title="Approve AI agent action?" size="md">
      <div className="space-y-4" data-webmcp-confirmation={current.tool}>
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <Bot className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>
            An AI agent in your browser asked to <strong>{current.title.toLowerCase()}</strong> using your account.
            Nothing is saved unless you approve.
          </p>
        </div>
        <p className="text-sm font-medium text-text-primary">{current.summary}</p>
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-sm">
          {(current.details || []).map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-text-secondary">{label}</dt>
              <dd className="break-words text-text-primary">{value}</dd>
            </div>
          ))}
        </dl>
        {queue.length > 1 && <p className="text-xs text-text-secondary">{queue.length - 1} more request(s) waiting.</p>}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => decide(false)} autoFocus>Decline</Button>
          <Button onClick={() => decide(true)}>
            <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Approve
          </Button>
        </div>
      </div>
    </Modal>
  )
}
