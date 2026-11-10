export type Route = "auto_apply" | "faculty_review" | "no_change"
export type ActionName = "approve" | "edit" | "reject" | "undo"

export type Edit = {
  field: "question" | "solution" | "answer" | "questionType"
  find: string
  replace: string
}

export type TeacherAction = {
  id: number
  report_id: string
  question_id: string
  action: ActionName
  edits: Edit[]
  reply: string
  note: string
  reviewer: string
  created_at: string
}

export type Report = {
  report_id: string
  question_id: string
  source: string
  reported_at: string
  comment: string
  student_claim: string
  claim_supported: "yes" | "partly" | "no" | "unclear"
  verdict: string
  repair: string | null
  evidence: string
  edits: Edit[]
  route: Route
  route_reason: string
  confidence: number
  reply: string
  reply_final: string
  reply_pending: string
  teacher_action: TeacherAction | null
}

export type QuestionVersion = {
  question_html: string
  solution_html: string
  answer: string | string[]
  questionType: string
}

export type Solver = { working: string; value: string; answer: string; status: string; note: string }

export type Vote = {
  outcome: string
  agreed_answer: string | null
  key: string | null
  solution_answer: string | null
  solver_answers: string[]
  confidence: number
  explanation: string
}

export type OtherDefect = { repair: string; evidence: string; edits: Edit[] }

export type Case = {
  questionId: string
  subject: string
  chapter: string
  questionType: string
  before: QuestionVersion
  after: QuestionVersion
  findings: { check: string; detail: string }[]
  solvers: Solver[]
  vote: Vote
  reports: Report[]
  other_defects: OtherDefect[]
  urgency: number
}

export type DecisionName = Exclude<ActionName, "undo">

export type ActionRequest = {
  report_id: string
  action: DecisionName
  reviewer: string
  edits?: Edit[]
  reply?: string
  note?: string
  save_anyway?: boolean
}

export type ActionResult = { saved: true; entry: TeacherAction } | { saved: false; warnings: string[] }

/** The server refused because the data changed meanwhile, for example a second tab already decided this report. */
export class ConflictError extends Error {}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const message = typeof body.detail === "string" ? body.detail : `The server answered ${response.status}.`
    throw response.status === 409 ? new ConflictError(message) : new Error(message)
  }
  return response.json()
}

function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
}

export function fetchCases(): Promise<Case[]> {
  return fetch("/api/cases").then((response) => readJson<Case[]>(response))
}

export type Health = { status: string; database: string }

export function fetchHealth(): Promise<Health> {
  return fetch("/api/health").then((response) => readJson<Health>(response))
}

export function fetchAuditLog(): Promise<TeacherAction[]> {
  return fetch("/api/audit").then((response) => readJson<TeacherAction[]>(response))
}

export async function saveAction(request: ActionRequest): Promise<ActionResult> {
  const response = await postJson("/api/actions", request)
  // A 409 with warnings means the edit has format problems. The teacher can still save it on purpose.
  if (response.status === 409) {
    const body = await response.clone().json().catch(() => ({}))
    if (Array.isArray(body.detail?.warnings)) return { saved: false, warnings: body.detail.warnings }
  }
  return { saved: true, entry: await readJson<TeacherAction>(response) }
}

export async function approveMany(reportIds: string[], reviewer: string): Promise<TeacherAction[]> {
  return readJson<TeacherAction[]>(await postJson("/api/actions/bulk", { report_ids: reportIds, reviewer }))
}

/** Undo decisions by their audit entry id. The server skips any that were already undone or replaced. */
export async function undoDecisions(entryIds: number[], reviewer: string): Promise<TeacherAction[]> {
  return readJson<TeacherAction[]>(await postJson("/api/actions/undo", { entry_ids: entryIds, reviewer }))
}
