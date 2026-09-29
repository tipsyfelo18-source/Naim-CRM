// Phase 3.5: WebMCP (browser-side MCP) registration. Progressive enhancement:
// in a browser without WebMCP this does nothing and the app is unchanged.
//
// Security model (docs/WEBMCP.md):
//   * registered only after sign-in, for pages the user may open; aborted on logout
//   * tools call the same service layer as the UI (anon key + user session -> RLS)
//   * every write tool waits for a human click in an in-app confirmation dialog
//   * never registered inside an iframe; origin isolation untouched
import { TOOL_SPECS } from './toolDefinitions.js'
import { buildHandlers } from './handlers.js'
import { canAccessPage } from '../utils/permissions.js'

/** Current spec: document.modelContext. Chrome 146-149 previews: navigator.modelContext. */
export function getModelContext() {
  const candidates = []
  if (typeof document !== 'undefined') candidates.push(document.modelContext)
  if (typeof navigator !== 'undefined') candidates.push(navigator.modelContext)
  return candidates.find((mc) => mc && typeof mc.registerTool === 'function') || null
}

function isTopLevelSecureDocument() {
  if (typeof window === 'undefined') return false
  if (!window.isSecureContext) return false
  try {
    return window.top === window.self
  } catch {
    return false // cross-origin parent: never expose tools
  }
}

export function isWebMCPSupported() {
  return Boolean(getModelContext()) && isTopLevelSecureDocument()
}

/**
 * Register the CRM tools. Returns an unregister function (safe to call twice).
 * @param {{profile: object, confirm: Function, services: object, onToolRun?: Function}} options
 */
export async function registerWebMCPTools({ profile, confirm, services, onToolRun }) {
  const modelContext = getModelContext()
  if (!modelContext || !isTopLevelSecureDocument() || !profile) return () => {}

  const controller = new AbortController()
  const handlers = buildHandlers({ confirm, services })
  const registered = []

  for (const spec of TOOL_SPECS) {
    if (!canAccessPage(profile, spec.page)) continue
    const tool = {
      name: spec.name,
      title: spec.title,
      description: spec.description,
      inputSchema: spec.inputSchema,
      annotations: { readOnlyHint: spec.readOnly, untrustedContentHint: spec.readOnly },
      async execute(args) {
        const result = await handlers[spec.name](args || {})
        try { onToolRun?.(spec, result) } catch { /* UI feedback only */ }
        return result
      },
    }
    if (controller.signal.aborted) break
    try {
      await modelContext.registerTool(tool, { signal: controller.signal })
      registered.push(spec.name)
    } catch (err) {
      console.warn(`WebMCP: could not register ${spec.name}:`, err?.message || err)
    }
  }

  let done = false
  return function unregister() {
    if (done) return
    done = true
    controller.abort()
    // Older previews had no AbortSignal support, only unregisterTool(name).
    if (typeof modelContext.unregisterTool === 'function') {
      for (const name of registered) {
        try { modelContext.unregisterTool(name) } catch { /* already gone */ }
      }
    }
  }
}

/**
 * WebMCP origin trial (Chrome 149+). The token is PUBLIC (bound to the
 * production origin), so it may live in a VITE_ variable; see README for
 * renewal. It must be in the document before WebMCP feature detection.
 */
export function installOriginTrialToken(token) {
  if (typeof document === 'undefined' || !token) return false
  const existing = [...document.querySelectorAll('meta[http-equiv="origin-trial"]')].some((m) => m.content === token)
  if (existing) return true
  const meta = document.createElement('meta')
  meta.httpEquiv = 'origin-trial'
  meta.content = token
  document.head.appendChild(meta)
  return true
}
