import type { ActionName, Case, Edit, Report } from "@/api"

export type ReportState = "needs_you" | "auto_fixed" | "no_change" | "done"
export type QueueName = "needs-you" | "auto-fixed" | "no-change"
export type SessionStats = { decisions: number; startedAt: number | null }

export const VERDICT_LABELS: Record<string, string> = {
  defect: "Real defect",
  no_error: "Student is wrong",
  display_issue: "Display issue",
  app_issue: "App issue",
  language_mode: "Language request",
  already_fixed: "Already fixed",
  not_actionable: "Not actionable",
}

export const REPAIR_LABELS: Record<string, string> = {
  spelling: "Spelling",
  noise: "Stray text",
  exam_reference: "Exam tag",
  markup_leak: "Raw code showing",
  answer_form: "Answer form",
  notation: "Lost symbol",
  stem_data: "Missing value",
  option_repair: "Option missing",
  solution_fix: "Solution wrong",
  solution_missing: "Solution missing",
  answer_key: "Answer key wrong",
  type_mismatch: "Wrong question type",
  identical_options: "Same options",
  diagram: "Figure missing",
  wrong_question: "Wrong solution",
  unsound: "No valid answer",
  wrong_chapter: "Wrong chapter",
  syllabus: "Syllabus",
}

function answerTokens(answer: string): string[] {
  return answer.toUpperCase().match(/\b[A-D]\b|-?\d+(\.\d+)?/g) ?? []
}

// An "answer_key" fix can keep the same answer and only repair how the key is stored, for example "['A, B, D']".
function fixesOnlyKeyFormat(edits: Edit[]): boolean {
  const keyEdit = edits.find((edit) => edit.field === "answer")
  return keyEdit !== undefined && answerTokens(keyEdit.find).join() === answerTokens(keyEdit.replace).join()
}

export function repairLabel(repair: string, edits: Edit[] = []): string {
  if (repair === "answer_key" && fixesOnlyKeyFormat(edits)) return "Answer key format"
  return REPAIR_LABELS[repair] ?? repair
}

/** Questions where an automatic fix gave a different answer, not only a new key format. */
export function countWrongKeysFixed(cases: Case[]): number {
  return cases.filter((item) => item.reports.some((report) =>
    report.route === "auto_apply" && report.repair === "answer_key" && !fixesOnlyKeyFormat(report.edits))).length
}

export const QUESTION_TYPE_LABELS: Record<string, string> = { scq: "Single correct", mcq: "Multiple correct", integerQuestion: "Integer" }

export const ACTION_LABELS: Record<ActionName, string> = { approve: "Approved", edit: "Edited", reject: "Rejected", undo: "Undone" }

export const FIELD_LABELS: Record<Edit["field"], string> = {
  question: "Question",
  solution: "Solution",
  answer: "Answer key",
  questionType: "Question type",
}

export function reportState(report: Report): ReportState {
  if (report.teacher_action) return "done"
  if (report.route === "faculty_review") return "needs_you"
  if (report.route === "auto_apply") return "auto_fixed"
  return "no_change"
}

export function caseIsInQueue(item: Case, queue: QueueName): boolean {
  if (queue === "needs-you") return item.reports.some((report) => reportState(report) === "needs_you")
  if (queue === "auto-fixed") return item.reports.some((report) => report.route === "auto_apply")
  // Questions with no student report exist only for unreported defects, so they are not in any review queue.
  return item.reports.length > 0 && item.reports.every((report) => report.route === "no_change")
}

// The route a queue is about. Bulk actions and progress use only these reports, so "Keep all fixes"
// can never approve a report on the same question that still waits for a teacher.
const QUEUE_ROUTE: Record<QueueName, Report["route"]> = { "needs-you": "faculty_review", "auto-fixed": "auto_apply", "no-change": "no_change" }

export function caseIsFinished(item: Case, queue: QueueName): boolean {
  return item.reports.filter((report) => report.route === QUEUE_ROUTE[queue]).every((report) => report.teacher_action)
}

export function queueReports(cases: Case[], queue: QueueName): Report[] {
  // Finished questions leave "Needs you", so its progress counts every question.
  const source = queue === "needs-you" ? cases : casesInQueue(cases, queue)
  return source.flatMap((item) => item.reports).filter((report) => report.route === QUEUE_ROUTE[queue])
}

export function estimateReviewMinutes(reportCount: number): number {
  // About 30 seconds per report with the keyboard flow.
  return Math.max(1, Math.ceil(reportCount / 2))
}

export function editKey(edit: Edit): string {
  return `${edit.field}|${edit.find}|${edit.replace}`
}

/** The edits live now: the teacher's own edit, none after a reject, otherwise the engine's. */
export function editsInEffect(report: Report): Edit[] {
  const decision = report.teacher_action
  if (decision?.action === "edit") return decision.edits
  if (decision?.action === "reject") return []
  return report.edits
}

export function countOpenReports(cases: Case[]): number {
  return cases.flatMap((item) => item.reports).filter((report) => reportState(report) === "needs_you").length
}

export function countUnreported(cases: Case[]): number {
  return cases.reduce((total, item) => total + item.other_defects.length, 0)
}

export function queueForCase(item: Case): QueueName {
  if (caseIsInQueue(item, "needs-you")) return "needs-you"
  return item.reports.some((report) => report.route === "auto_apply") ? "auto-fixed" : "no-change"
}

export type QueueSort = "reports" | "urgency"

/** "reports": the question most students reported comes first. "urgency": harm times reports. Each breaks the other's ties. */
export function casesInQueue(cases: Case[], queue: QueueName, sort: QueueSort = "urgency"): Case[] {
  const byReports = (a: Case, b: Case) => b.reports.length - a.reports.length
  const byUrgency = (a: Case, b: Case) => b.urgency - a.urgency
  const [first, second] = sort === "reports" ? [byReports, byUrgency] : [byUrgency, byReports]
  return cases.filter((item) => caseIsInQueue(item, queue)).sort((a, b) => first(a, b) || second(a, b))
}

/** The lowest confidence among the reports of a question. A low value means the teacher should read it carefully. */
export function lowestConfidence(item: Case): number {
  return Math.min(...item.reports.map((report) => report.confidence))
}

export const LOW_CONFIDENCE = 0.7

export function studentsReported(count: number): string {
  return `${count} student${count === 1 ? "" : "s"} reported`
}

/** The option letters of the key that is live now: the teacher's or the engine's new key, otherwise the stored one. */
// Repairs that say the stored key may not be the correct answer.
const KEY_IN_DOUBT_REPAIRS = new Set(["answer_key", "unsound"])

/** True when the engine doubts the stored key and no edit gives a new key. Then no option may look correct. */
export function keyIsInDoubt(item: Case, edits: Edit[]): boolean {
  if (edits.some((edit) => edit.field === "answer")) return false
  return [...item.reports, ...item.other_defects].some((defect) => KEY_IN_DOUBT_REPAIRS.has(defect.repair ?? ""))
}

export function correctOptionLetters(item: Case, edits: Edit[]): string[] {
  if (item.questionType === "integerQuestion" || keyIsInDoubt(item, edits)) return []
  const keyEdit = edits.find((edit) => edit.field === "answer")
  const key = keyEdit ? keyEdit.replace : formatAnswer(item.before.answer)
  return key.toUpperCase().match(/\b[A-D]\b/g) ?? []
}

export function formatAnswer(answer: string | string[] | null | undefined): string {
  if (Array.isArray(answer)) return answer.join(", ")
  return answer ?? "-"
}

export function greetingForNow(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}
