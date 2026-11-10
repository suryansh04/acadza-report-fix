import { useEffect, useState } from "react"
import { Check, CheckCheck, Inbox, MessageSquareQuote, Pencil, RotateCcw, TriangleAlert, Wrench, X } from "lucide-react"

import type { ActionName, ActionResult, Edit, Report } from "@/api"
import { MathHtml } from "@/components/ChangePreview"
import { IconChip, Pill, type Tone } from "@/components/Panel"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Textarea } from "@/components/ui/textarea"
import { ACTION_LABELS, FIELD_LABELS, REPAIR_LABELS, VERDICT_LABELS, formatDateTime, reportState, stripHtml } from "@/lib/cases"
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

// One plain sentence on top of each report, so a tired teacher knows what "Approve" will do before reading the details.
function suggestionFor(report: Report): string {
  const repair = report.repair ? REPAIR_LABELS[report.repair] ?? report.repair : null
  if (report.route === "auto_apply") return `Fixed automatically: ${repair}. Keep the fix, or undo it.`
  if (report.route === "no_change") return `No change needed: ${VERDICT_LABELS[report.verdict] ?? report.verdict}. Agree to send the reply.`
  if (report.edits.length > 0) return `Suggested fix: ${repair}. Approve to apply it, or edit it first.`
  return `A teacher must fix this${repair ? ` (${repair})` : ""}. Approve to confirm and send the reply.`
}

function ConfidenceMeter({ value }: { value: number }) {
  const tone = value >= 0.85 ? "bg-good" : value >= 0.6 ? "bg-warn" : "bg-bad"
  return (
    <div className="flex items-center gap-2" title="How sure the engine is. Code computes this from the vote, not the AI.">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">Confidence {Math.round(value * 100)}%</span>
    </div>
  )
}

function EditSummary({ edit }: { edit: Edit }) {
  const before = edit.field === "answer" || edit.field === "questionType" ? edit.find : stripHtml(edit.find)
  const after = edit.field === "answer" || edit.field === "questionType" ? edit.replace : stripHtml(edit.replace)
  return (
    <div className="grid gap-1 rounded-xl bg-muted px-3 py-2.5 text-sm sm:grid-cols-[7rem_1fr]">
      <span className="text-xs text-muted-foreground">{FIELD_LABELS[edit.field]}</span>
      <span className="min-w-0 wrap-break-word">
        <del className="rounded bg-background px-1 text-bad">{before || "(nothing)"}</del>
        <span className="mx-1.5 text-muted-foreground" aria-label="changed to">→</span>
        <ins className="rounded bg-background px-1 font-medium text-good no-underline">{after || "(removed)"}</ins>
      </span>
    </div>
  )
}

export function ReportCard({ report, focused, onSubmit }: { report: Report; focused: boolean; onSubmit: SubmitAction }) {
  const state = reportState(report)
  const [editing, setEditing] = useState(false)
  const [draftEdits, setDraftEdits] = useState<Edit[]>(report.edits)
  const [draftReply, setDraftReply] = useState(report.reply)
  const [warnings, setWarnings] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const submit = async (action: ActionName, extra?: { edits?: Edit[]; reply?: string; saveAnyway?: boolean }) => {
    setBusy(true)
    const result = await onSubmit(report, action, extra)
    setBusy(false)
    if (result && !result.saved) {
      setWarnings(result.warnings)
      return
    }
    if (result) {
      setEditing(false)
      setWarnings([])
    }
  }

  const saveEdit = () => submit("edit", { edits: draftEdits, reply: draftReply })

  const cancelEdit = () => {
    setEditing(false)
    setWarnings([])
    setDraftEdits(report.edits)
    setDraftReply(report.reply)
  }

  useEffect(() => {
    if (!focused || state === "done" || editing) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcut(event)) return
      const key = event.key.toLowerCase()
      if (key === "a") void submit("approve")
      if (key === "r") void submit("reject")
      if (key === "e") {
        event.preventDefault()
        setEditing(true)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  const route = ROUTE_STYLE[report.route]
  const labels = state === "done" ? null : BUTTON_LABELS[state]

  return (
    <article id={`report-${report.report_id}`} className={cn("flex flex-col gap-4 rounded-2xl border p-4", focused && "ring-2 ring-brand/30")}>
      <header className="flex flex-wrap items-center gap-2">
        <IconChip icon={route.icon} color={route.color} />
        <span className="font-medium">{report.report_id}</span>
        <Pill tone={route.tone}>{route.label}</Pill>
        <Pill>{VERDICT_LABELS[report.verdict] ?? report.verdict}</Pill>
        {report.repair && <Pill tone="muted">{REPAIR_LABELS[report.repair] ?? report.repair}</Pill>}
        <span className="ml-auto"><ConfidenceMeter value={report.confidence} /></span>
      </header>

      {state !== "done" && <p className="text-[15px] font-medium">{suggestionFor(report)}</p>}

      <blockquote className="flex gap-2 rounded-xl bg-muted p-3 text-sm">
        <MessageSquareQuote className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="wrap-break-word">{report.comment ? `"${report.comment}"` : <span className="italic text-muted-foreground">Empty comment</span>}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {report.source} · {formatDateTime(report.reported_at)} · Claim: {report.student_claim}
          </p>
        </div>
      </blockquote>

      <div className="flex max-w-[65ch] flex-col gap-1.5 text-sm">
        <p><span className="font-medium">Why: </span>{report.evidence}</p>
        <p className="text-[13px] text-muted-foreground"><span className="font-medium">Route: </span>{report.route_reason}</p>
      </div>

      {report.edits.length > 0 && !editing && (
        <div className="flex flex-col gap-1.5">{report.edits.map((edit, index) => <EditSummary key={index} edit={edit} />)}</div>
      )}

      {editing ? (
        <div
          className="flex flex-col gap-3"
          onKeyDown={(event) => {
            if (event.key === "Escape") cancelEdit()
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void saveEdit()
          }}
        >
          {draftEdits.map((edit, index) => (
            <div key={index} className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-muted-foreground" htmlFor={`edit-${report.report_id}-${index}`}>
                New {FIELD_LABELS[edit.field].toLowerCase()} text
              </label>
              <Textarea
                id={`edit-${report.report_id}-${index}`}
                autoFocus={index === 0}
                className="font-mono text-xs"
                value={edit.replace}
                onChange={(event) => setDraftEdits(draftEdits.map((item, position) => (position === index ? { ...item, replace: event.target.value } : item)))}
              />
              {(edit.field === "question" || edit.field === "solution") && edit.replace && (
                <div className="rounded-xl bg-muted px-3 py-2">
                  <p className="mb-1 text-xs text-muted-foreground">Preview</p>
                  <MathHtml html={edit.replace} className="text-sm" />
                </div>
              )}
            </div>
          ))}
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-muted-foreground" htmlFor={`reply-${report.report_id}`}>Reply to the student</label>
            <Textarea id={`reply-${report.report_id}`} autoFocus={draftEdits.length === 0} value={draftReply} onChange={(event) => setDraftReply(event.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground"><Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> to save · <Kbd>Esc</Kbd> to cancel</p>
        </div>
      ) : (
        <div className="rounded-xl bg-period-bg p-3 text-sm">
          <p className="mb-1 text-xs font-medium text-period">Reply the student will see</p>
          <p className="max-w-[65ch]">{report.teacher_action?.reply || report.reply}</p>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl bg-warn-bg p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-warn"><TriangleAlert className="size-4" /> Please check before saving</p>
          <ul className="list-disc pl-5">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          <Button className="h-9 w-fit rounded-lg px-3" variant="outline" disabled={busy} onClick={() => submit("edit", { edits: draftEdits, reply: draftReply, saveAnyway: true })}>
            Save anyway
          </Button>
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2">
        {state === "done" && report.teacher_action && (
          <>
            <span className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{ACTION_LABELS[report.teacher_action.action]}</span> by {report.teacher_action.reviewer} ·{" "}
              {formatDateTime(report.teacher_action.created_at)}
            </span>
            <Button className="h-9 rounded-lg px-3" variant="ghost" disabled={busy} onClick={() => submit("undo")}><RotateCcw /> Undo</Button>
          </>
        )}
        {labels && !editing && (
          <>
            <Button className="h-9 rounded-lg px-3" disabled={busy} onClick={() => submit("approve")}><Check /> {labels.approve} {focused && <Kbd>A</Kbd>}</Button>
            <Button className="h-9 rounded-lg px-3" variant="outline" disabled={busy} onClick={() => setEditing(true)}><Pencil /> Edit {focused && <Kbd>E</Kbd>}</Button>
            <Button className="h-9 rounded-lg px-3" variant="outline" disabled={busy} onClick={() => submit("reject")}><X /> {labels.reject} {focused && <Kbd>R</Kbd>}</Button>
          </>
        )}
        {editing && (
          <>
            <Button className="h-9 rounded-lg px-3" disabled={busy} onClick={() => void saveEdit()}>Save edit</Button>
            <Button className="h-9 rounded-lg px-3" variant="ghost" disabled={busy} onClick={cancelEdit}>Cancel</Button>
          </>
        )}
      </footer>
    </article>
  )
}
