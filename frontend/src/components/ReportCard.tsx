import { Fragment, useRef, useState } from "react"
import { Check, CheckCheck, CircleCheck, Inbox, MessageSquareQuote, Pencil, RotateCcw, Sparkles, TriangleAlert, Wrench, X } from "lucide-react"

import type { ActionName, ActionResult, Edit, QuestionVersion, Report } from "@/api"
import { EditDiff } from "@/components/EditDiff"
import { EditForm } from "@/components/EditForm"
import { IconChip, Pill, type Tone } from "@/components/Panel"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Textarea } from "@/components/ui/textarea"
import { ACTION_LABELS, LOW_CONFIDENCE, VERDICT_LABELS, editsInEffect, formatDateTime, repairLabel, reportState } from "@/lib/cases"
import { useKeydown } from "@/hooks/use-keydown"
import { shouldIgnoreShortcut } from "@/lib/navigation"
import { cn } from "@/lib/utils"

export type SubmitAction = (report: Report, action: ActionName, extra?: { edits?: Edit[]; reply?: string; saveAnyway?: boolean }) => Promise<ActionResult | null>

const ROUTE_STYLE: Record<Report["route"], { label: string; tone: Tone; icon: typeof Inbox; color: string }> = {
  auto_apply: { label: "Auto-fixed", tone: "good", icon: Wrench, color: "var(--tone-green)" },
  faculty_review: { label: "Needs you", tone: "warn", icon: Inbox, color: "var(--tone-red)" },
  no_change: { label: "No change", tone: "muted", icon: CheckCheck, color: "var(--tone-indigo)" },
}

const BUTTON_LABELS = {
  needs_you: { approve: "Approve", reject: "Reject" },
  auto_fixed: { approve: "Keep fix", reject: "Undo fix" },
  no_change: { approve: "Agree", reject: "Disagree" },
}

// Facts that explain the verdict but that a teacher rarely needs. They stay behind "More details".
const DETAIL_ROWS: { label: string; value: (report: Report) => string }[] = [
  { label: "Defect", value: (report) => repairName(report) ?? "None" },
  { label: "Route", value: (report) => report.route_reason },
  { label: "Claim", value: (report) => report.student_claim },
  { label: "Reported", value: (report) => `${formatDateTime(report.reported_at)}, from ${report.source}` },
]

const VERDICT_FINDINGS: Record<string, string> = {
  no_error: "It found that the question is correct.",
  display_issue: "It found that the content is complete, so the problem is on the student's screen.",
  app_issue: "It found an app problem, not a content error.",
  language_mode: "It found a language request, not a content error.",
  already_fixed: "It found that this is already fixed.",
  not_actionable: "It found nothing that it can act on.",
}

function repairName(report: Report): string | null {
  return report.repair ? repairLabel(report.repair, report.edits) : null
}

// The AI verdict in one line, so a tired teacher knows the result before reading the details.
function verdictHeadline(report: Report): string {
  const repair = repairName(report)
  if (report.route === "auto_apply") return `Fixed automatically: ${repair}.`
  if (report.route === "no_change") return `No change needed: ${VERDICT_LABELS[report.verdict] ?? report.verdict}.`
  if (report.edits.length > 0) return `${repair}: the AI suggests a fix.`
  return `${repair ?? VERDICT_LABELS[report.verdict] ?? report.verdict}: a teacher must fix this.`
}

/** What the AI did, in at most 50 words. The engine, not the AI, decides the route, so the last sentence says "the engine". */
function aiSummary(report: Report): string {
  const repair = repairName(report)
  const finding = report.verdict === "defect" ? `It found a real defect${repair ? ` (${repair.toLowerCase()})` : ""}.` : VERDICT_FINDINGS[report.verdict] ?? ""
  const outcome = {
    auto_apply: "Every safety check passed, so the engine applied the fix and wrote a reply.",
    faculty_review: report.edits.length > 0 ? "This kind of fix needs a teacher, so the engine only suggests it." : "This needs a teacher, so the engine changed nothing.",
    no_change: "The engine changed nothing and wrote a reply.",
  }[report.route]
  return `The AI read the comment and checked it against the question, the options, the key and the solution. ${finding} ${outcome}`
}

function actionHint(report: Report): string {
  if (report.route === "auto_apply") return "Keep the fix, or undo it."
  if (report.route === "no_change") return "Agree to send the reply, or disagree."
  if (report.edits.length > 0) return "Approve to apply the fix, or edit it first."
  return "Approve to confirm."
}

function ConfidenceMeter({ value }: { value: number }) {
  const tone = value >= 0.85 ? "bg-good" : value >= LOW_CONFIDENCE ? "bg-warn" : "bg-bad"
  return (
    <span className="flex items-center gap-2" title="How sure the engine is. Code computes it from the answer check and the safety checks.">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">Confidence {Math.round(value * 100)}%</span>
    </span>
  )
}

type ReportCardProps = { report: Report; current: QuestionVersion; focused: boolean; onSubmit: SubmitAction }

export function ReportCard({ report, current, focused, onSubmit }: ReportCardProps) {
  const state = reportState(report)
  const [editing, setEditing] = useState(false)
  const [draftEdits, setDraftEdits] = useState<Edit[]>(report.edits)
  const [draftReply, setDraftReply] = useState(report.reply)
  const [problems, setProblems] = useState<string[]>([])
  const [canSaveAnyway, setCanSaveAnyway] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showDecided, setShowDecided] = useState(false)
  // A ref, not state: two key presses in a row must not both start a save before React re-renders.
  const saving = useRef(false)

  const submit = async (action: ActionName, extra?: { edits?: Edit[]; reply?: string; saveAnyway?: boolean }) => {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    const result = await onSubmit(report, action, extra)
    saving.current = false
    setBusy(false)
    if (result && !result.saved) {
      setProblems(result.problems)
      setCanSaveAnyway(result.canSaveAnyway)
      return
    }
    if (result) {
      setEditing(false)
      setProblems([])
    }
  }

  // Problems belong to the text that was checked. Any change makes them stale, so "Save anyway" must not reuse them.
  const changeEdits = (edits: Edit[]) => {
    setDraftEdits(edits)
    setProblems([])
  }
  const changeReply = (reply: string) => {
    setDraftReply(reply)
    setProblems([])
  }

  // A whole-field change the teacher opened but did not change is not a change.
  const editsToSave = () => draftEdits.filter((edit) => edit.find !== edit.replace)
  const saveEdit = (saveAnyway = false) => {
    const edits = editsToSave()
    // Nothing changed is an approval, not an edit. The server refuses an empty edit for the same reason.
    if (edits.length === 0 && [report.reply.trim(), ""].includes(draftReply.trim())) return submit("approve")
    return submit("edit", { edits, reply: draftReply, saveAnyway })
  }

  const cancelEdit = () => {
    setEditing(false)
    setProblems([])
    setDraftEdits(report.edits)
    setDraftReply(report.reply)
  }

  useKeydown((event) => {
    if (event.repeat || shouldIgnoreShortcut(event)) return
    const key = event.key.toLowerCase()
    if (key === "a") void submit("approve")
    if (key === "r") void submit("reject")
    if (key === "e") {
      event.preventDefault()
      setEditing(true)
    }
  }, focused && state !== "done" && !editing)

  const route = ROUTE_STYLE[report.route]
  const labels = state === "done" ? null : BUTTON_LABELS[state]
  const decision = report.teacher_action
  const lowConfidence = report.confidence < LOW_CONFIDENCE
  const decidedLine = decision && (
    <span className="text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{ACTION_LABELS[decision.action]}</span> by {decision.reviewer} · {formatDateTime(decision.created_at)}
    </span>
  )
  const undoButton = <Button className="h-8 rounded-lg px-2.5" variant="ghost" disabled={busy} onClick={() => submit("undo")}><RotateCcw /> Undo</Button>

  // A decided report needs only one line. The teacher can open it again to read it.
  if (decision && !showDecided) {
    return (
      <article id={`report-${report.report_id}`} className="flex items-center gap-2.5 rounded-2xl border px-4 py-2">
        <CircleCheck className="size-4 shrink-0 text-live" />
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">{report.report_id}</span>
          {decidedLine}
        </div>
        <span className="ml-auto flex shrink-0 items-center">
          <Button className="h-8 rounded-lg px-2.5" variant="ghost" onClick={() => setShowDecided(true)}>Show</Button>
          {undoButton}
        </span>
      </article>
    )
  }

  return (
    <article id={`report-${report.report_id}`} className={cn("flex flex-col gap-3.5 rounded-2xl border p-4", focused && "ring-2 ring-brand/30")}>
      <header className="flex flex-wrap items-center gap-2">
        <IconChip icon={route.icon} color={route.color} />
        <span className="font-medium">{report.report_id}</span>
        <Pill tone={route.tone}>{route.label}</Pill>
      </header>

      <blockquote className="flex gap-2 rounded-xl bg-muted p-3 text-sm">
        <MessageSquareQuote className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 wrap-break-word">
          <span className="text-xs text-muted-foreground">The student wrote: </span>
          {report.comment ? `"${report.comment}"` : <span className="italic text-muted-foreground">nothing (empty comment)</span>}
        </p>
      </blockquote>

      <section className="flex flex-col gap-2 rounded-xl border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"><Sparkles className="size-3.5" /> AI verdict</h4>
          <ConfidenceMeter value={report.confidence} />
        </div>
        <p className="text-[15px] font-medium">{verdictHeadline(report)}</p>
        {lowConfidence && (
          <p className="flex items-center gap-1.5 rounded-lg bg-warn-bg px-2.5 py-1.5 text-[13px] font-medium text-warn">
            <TriangleAlert className="size-3.5 shrink-0" /> Low confidence. Read this one carefully.
          </p>
        )}
        <p className="max-w-[65ch] text-sm text-muted-foreground">{aiSummary(report)}</p>
        <p className="max-w-[65ch] text-sm"><span className="font-medium">Why: </span>{report.evidence}</p>
      </section>

      {!editing && editsInEffect(report).length > 0 && (
        <div className="flex flex-col gap-1.5">{editsInEffect(report).map((edit, index) => <EditDiff key={index} edit={edit} />)}</div>
      )}

      {editing ? (
        <div
          className="flex flex-col gap-3"
          onKeyDown={(event) => {
            if (event.key === "Escape") cancelEdit()
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void saveEdit()
          }}
        >
          <EditForm reportId={report.report_id} edits={draftEdits} current={current} onChange={changeEdits} />
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-muted-foreground" htmlFor={`reply-${report.report_id}`}>Reply to the student</label>
            <Textarea id={`reply-${report.report_id}`} autoFocus={draftEdits.length === 0} value={draftReply} onChange={(event) => changeReply(event.target.value)} />
          </div>
        </div>
      ) : (
        <div className="rounded-xl bg-period-bg p-3 text-sm">
          <p className="mb-1 text-xs font-medium text-period">{report.route === "faculty_review" ? "Reply to the student" : "Reply the student will see"}</p>
          <p className="max-w-[65ch]">{decision?.reply || report.reply}</p>
          {report.route === "faculty_review" && <p className="mt-1.5 text-xs text-muted-foreground">The student already has this reply.</p>}
        </div>
      )}

      {problems.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl bg-warn-bg p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-warn">
            <TriangleAlert className="size-4" /> {canSaveAnyway ? "Please check before saving" : "This edit cannot be saved yet"}
          </p>
          <ul className="list-disc pl-5">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
          {canSaveAnyway && (
            <Button className="h-9 w-fit rounded-lg px-3" variant="outline" disabled={busy} onClick={() => void saveEdit(true)}>
              Save anyway
            </Button>
          )}
        </div>
      )}

      {!editing && (
        <details className="text-[13px] text-muted-foreground">
          <summary className="w-fit font-medium">More details</summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            {DETAIL_ROWS.map(({ label, value }) => (
              <Fragment key={label}>
                <dt className="font-medium">{label}</dt>
                <dd className="min-w-0 wrap-break-word">{value(report)}</dd>
              </Fragment>
            ))}
          </dl>
        </details>
      )}

      {/* In the right panel, the buttons of the open report stay in view while the teacher reads it. */}
      <footer className={cn("flex flex-wrap items-center gap-2", focused && !decision && "xl:sticky xl:bottom-0 xl:-mx-4 xl:-mb-4 xl:rounded-b-2xl xl:border-t xl:bg-background xl:px-4 xl:py-3")}>
        {decision && (
          <>
            {decidedLine}
            <span className="ml-auto flex items-center">
              <Button className="h-8 rounded-lg px-2.5" variant="ghost" onClick={() => setShowDecided(false)}>Hide</Button>
              {undoButton}
            </span>
          </>
        )}
        {labels && !editing && (
          <>
            <p className="w-full text-xs text-muted-foreground">{actionHint(report)}</p>
            <Button className="h-9 rounded-lg px-3" disabled={busy} onClick={() => submit("approve")}><Check /> {labels.approve} {focused && <Kbd>A</Kbd>}</Button>
            <Button className="h-9 rounded-lg px-3" variant="outline" disabled={busy} onClick={() => setEditing(true)}><Pencil /> Edit {focused && <Kbd>E</Kbd>}</Button>
            <Button className="h-9 rounded-lg px-3" variant="outline" disabled={busy} onClick={() => submit("reject")}><X /> {labels.reject} {focused && <Kbd>R</Kbd>}</Button>
          </>
        )}
        {editing && (
          <>
            <Button className="h-9 rounded-lg px-3" disabled={busy} onClick={() => void saveEdit()}>Save edit <Kbd>Ctrl</Kbd><Kbd>Enter</Kbd></Button>
            <Button className="h-9 rounded-lg px-3" variant="ghost" disabled={busy} onClick={cancelEdit}>Cancel <Kbd>Esc</Kbd></Button>
          </>
        )}
      </footer>
    </article>
  )
}
