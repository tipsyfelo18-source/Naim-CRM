// The service layer the WebMCP tools call: exactly what the UI uses, so the
// browser agent acts with the signed-in user's session and RLS permissions.
// No elevated keys, no model keys.
import { getCandidates, getCandidateById, addCandidate, changeCandidateStage } from '../services/candidateService'
import { getDocuments } from '../services/documentService'
import { getTasks, addTask } from '../services/taskService'
import { getAppointments, addAppointment } from '../services/appointmentService'
import { getDashboardKPIs } from '../services/kpiService'
import { enqueueAutomationJob } from '../services/automationService'
import { expiryStatus } from '../utils/documentChecklist'
import { nairobiDate } from '../utils/dateUtils'

export const webmcpServices = {
  searchCandidates: (opts) => getCandidates({ ...opts, page: 1 }),
  getCandidate: (id) => getCandidateById(id),
  addCandidate: (record) => addCandidate(record),
  changeCandidateStage: (id, to, from) => changeCandidateStage(id, to, from),
  getDocuments: (candidateId) => getDocuments({ candidateId }),
  getTasks: async (candidateId) => (await getTasks({ candidateId, pageSize: 50 })).data || [],
  getAppointments: async (candidateId) => (await getAppointments({ candidateId, pageSize: 50 })).data || [],
  addTask: (task) => addTask(task),
  addAppointment: (appointment) => addAppointment(appointment),
  getKPIs: () => getDashboardKPIs(),
  enqueueJob: (jobType, payload) => enqueueAutomationJob(jobType, payload),
  expiryStatus: (expiry, today) => expiryStatus(expiry, today)?.status || 'unknown',
  today: () => nairobiDate(new Date()),
}
