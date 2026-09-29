# WebMCP: the Naim CRM browser port

**What it is.** [WebMCP](https://developer.chrome.com/docs/ai/webmcp) is a proposed web standard (W3C Web Machine
Learning Community Group, Google + Microsoft) that lets a page expose structured tools to AI agents running in the
browser. Instead of scraping the DOM or guessing button clicks, browser agents discover a machine-readable tool
manifest and invoke functions with validated inputs.

Naim CRM implements the browser side of MCP in `src/webmcp/`.

---

## Architecture & Security Boundary

```
+-------------------------------------------------------------+
| Browser Context (User Session)                              |
|                                                             |
|  +------------------------+      +-----------------------+  |
|  | Chrome / Agent Runtime | <--> | document.modelContext |  |
|  +------------------------+      +-----------------------+  |
|                                              |              |
|                                     registerTools.js        |
|                                              |              |
|                     +------------------------+              |
|                     v                                       |
|               handlers.js                                   |
|                     |                                       |
|        +------------+------------+                          |
|        | (read tool)             | (write tool)             |
|        v                         v                          |
|  direct service call       Approval Modal                   |
|  (search, get_summary)     (WebMCPBridge.jsx)               |
|        |                         |                          |
|        |                   Approved?                        |
|        |                   /        \                       |
|        |                 Yes         No                     |
|        |                 /            \                     |
|        v                v              v                    |
|   service layer (RLS)              return {                 |
|        |                             ok: false,             |
|        v                             error: "user_declined" |
|   Supabase Postgres                }                        |
+-------------------------------------------------------------+
```

### Key invariants:
1. **No invisible writes:** Every mutating tool (`add_candidate`, `update_candidate_stage`, `create_task`, `book_appointment`, `enqueue_automation_job`) MUST present the on-screen approval modal before taking action. If the user clicks "Decline", the tool returns `{ ok: false, error: 'user_declined' }` without touching the database.
2. **Same user permissions:** Tools execute inside the active browser session under the logged-in user's Supabase JWT. Staff accounts cannot execute Admin actions via WebMCP.
3. **Stage guard enforcement:** Stage jump rules (`src/utils/stageTransitions.js`) are evaluated before the approval dialog is even shown. An illegal jump fails immediately with `{ ok: false, error: '...' }`.
4. **Lifecycle management:** Tools are registered only when the user is logged in. On logout, `AbortController.abort()` unregisters all tools to prevent leaking tools to logged-out sessions.

---

## Implemented WebMCP Tools

| Tool | Type | Approval Required | Description |
|---|:---:|:---:|---|
| `search_candidates` | Read | No | Search candidates by name, email, phone, job, or stage |
| `get_candidate_summary` | Read | No | Retrieve structured summary of a candidate profile |
| `get_reports_summary` | Read | No | Fetch pipeline metrics and stage counts |
| `add_candidate` | Write | **Yes** | Add a new candidate to the pipeline |
| `update_candidate_stage` | Write | **Yes** | Transition candidate to next legal stage |
| `create_task` | Write | **Yes** | Create a task linked to candidate |
| `book_appointment` | Write | **Yes** | Book interview or client meeting |
| `enqueue_automation_job` | Write | **Yes** | Enqueue a Hermes automation job |

---

## Enabling WebMCP in Chrome

WebMCP is currently in Origin Trial (Chrome 146+).

### For Local Development:
1. Launch Chrome 146+.
2. Open `chrome://flags/#enable-experimental-web-platform-features`.
3. Set to **Enabled** and restart Chrome.
4. Verify by opening DevTools Console on `http://localhost:5173`:
   ```javascript
   typeof document.modelContext !== 'undefined'
   ```
   Should return `true`.

### For Production:
The token registered at Chrome Origin Trials is injected as a `<meta>` tag on page load if `VITE_WEBMCP_ORIGIN_TRIAL_TOKEN` is defined in Netlify environment variables.
