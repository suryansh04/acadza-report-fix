import type { Case, Edit, Report } from "@/api"

export type ReportState = "needs_you" | "auto_fixed" | "no_change" | "done"
export type QueueName = "needs-you" | "auto-fixed" | "no-change"

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
  return item.reports.every((report) => report.route === "no_change")
}

export function queueForCase(item: Case): QueueName {
  if (caseIsInQueue(item, "needs-you")) return "needs-you"
  return item.reports.some((report) => report.route === "auto_apply") ? "auto-fixed" : "no-change"
}

export function casesInQueue(cases: Case[], queue: QueueName): Case[] {
  return cases.filter((item) => caseIsInQueue(item, queue)).sort((a, b) => b.urgency - a.urgency)
}

export function stripHtml(html: string): string {
  const element = document.createElement("div")
  element.innerHTML = html
  return (element.textContent ?? "").replace(/\s+/g, " ").trim()
}

export function formatAnswer(answer: string | string[] | null | undefined): string {
  if (Array.isArray(answer)) return answer.join(", ")
  return answer ?? "-"
}

function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n/g, "\n")
}

// Wrapping text inside MathML in <del>/<ins> breaks the formula, so those edits show without a highlight.
function canHighlight(text: string): boolean {
  return !/<\/?m[a-z]/.test(text)
}

/** Rendered "before" or "after" HTML for one field, with the changed text marked. */
export function buildDiffHtml(raw: string, edits: Edit[], field: "question" | "solution", side: "before" | "after"): string {
  let html = normalizeLineBreaks(raw)
  for (const edit of edits.filter((item) => item.field === field)) {
    const find = normalizeLineBreaks(edit.find)
    if (!find || !html.includes(find)) continue
    const marked = side === "before"
      ? (canHighlight(find) ? `<del class="diff-del">${find}</del>` : find)
      : (canHighlight(edit.replace) ? `<ins class="diff-ins">${edit.replace}</ins>` : edit.replace)
    html = html.replace(find, () => marked)
  }
  return html
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
