import { useEffect, useState } from "react"
import { Check, MessageSquareQuote, Pencil, RotateCcw, TriangleAlert, X } from "lucide-react"

import type { ActionName, ActionResult, Edit, Report } from "@/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Textarea } from "@/components/ui/textarea"
import { FIELD_LABELS, REPAIR_LABELS, VERDICT_LABELS, formatDateTime, reportState, stripHtml } from "@/lib/cases"
import { cn } from "@/lib/utils"

export type SubmitAction = (report: Report, action: ActionName, extra?: { edits?: Edit[]; reply?: string; saveAnyway?: boolean }) => Promise<ActionResult | null>

const ROUTE_TEXT = {
  auto_apply: { label: "Auto-fixed", tone: "text-good bg-good/10" },
  faculty_review: { label: "Needs you", tone: "text-warn bg-warn/10" },
  no_change: { label: "No change", tone: "text-muted-foreground bg-muted" },
}

const BUTTON_LABELS = {
  needs_you: { approve: "Approve", reject: "Reject" },
  auto_fixed: { approve: "Keep fix", reject: "Undo fix" },
  no_change: { approve: "Agree", reject: "Disagree" },
}

function ConfidenceMeter({ value }: { value: number }) {
  const tone = value >= 0.85 ? "bg-good" : value >= 0.6 ? "bg-warn" : "bg-bad"
  return (
    <div className="flex items-center gap-2" title="How sure the engine is. Code computes this from the vote, not the AI.">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">{Math.round(value * 100)}%</span>
    </div>
  )
}

function EditSummary({ edit }: { edit: Edit }) {
  const before = edit.field === "answer" || edit.field === "questionType" ? edit.find : stripHtml(edit.find)
  const after = edit.field === "answer" || edit.field === "questionType" ? edit.replace : stripHtml(edit.replace)
  return (
    <div className="grid gap-1 rounded-md bg-muted/50 p-2 text-sm sm:grid-cols-[7rem_1fr]">
      <span className="text-xs text-muted-foreground">{FIELD_LABELS[edit.field]}</span>
      <span className="min-w-0 wrap-break-word">
        <del className="rounded bg-bad/10 px-1 text-bad">{before || "(nothing)"}</del>
        <span className="mx-1.5 text-muted-foreground">to</span>
        <ins className="rounded bg-good/15 px-1 text-good no-underline">{after || "(removed)"}</ins>
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

  useEffect(() => {
    if (!focused || state === "done" || editing) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey) return
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

  const route = ROUTE_TEXT[report.route]
  const labels = state === "done" ? null : BUTTON_LABELS[state]

  return (
    <article id={`report-${report.report_id}`} className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4", focused && "ring-2 ring-brand/40")}>
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{report.report_id}</span>
        <Badge variant="outline" className={cn("border-transparent", route.tone)}>{route.label}</Badge>
        <Badge variant="outline">{VERDICT_LABELS[report.verdict] ?? report.verdict}</Badge>
        {report.repair && <Badge variant="outline">{REPAIR_LABELS[report.repair] ?? report.repair}</Badge>}
        <span className="ml-auto"><ConfidenceMeter value={report.confidence} /></span>
      </header>

      <blockquote className="flex gap-2 rounded-lg bg-muted/40 p-3 text-sm">
        <MessageSquareQuote className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="wrap-break-word">{report.comment ? `"${report.comment}"` : <span className="italic text-muted-foreground">Empty comment</span>}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {report.source} · {formatDateTime(report.reported_at)} · Claim: {report.student_claim}
          </p>
        </div>
      </blockquote>

      <div className="flex flex-col gap-1 text-sm">
        <p><span className="font-medium">Why: </span>{report.evidence}</p>
        <p className="text-xs text-muted-foreground"><span className="font-medium">Route: </span>{report.route_reason}</p>
      </div>

      {report.edits.length > 0 && !editing && (
        <div className="flex flex-col gap-1.5">{report.edits.map((edit, index) => <EditSummary key={index} edit={edit} />)}</div>
      )}

      {editing ? (
        <div className="flex flex-col gap-2">
          {draftEdits.map((edit, index) => (
            <label key={index} className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={`edit-${report.report_id}-${index}`}>
              New {FIELD_LABELS[edit.field].toLowerCase()} text
              <Textarea
                id={`edit-${report.report_id}-${index}`}
                className="font-mono text-xs"
                value={edit.replace}
                onChange={(event) => setDraftEdits(draftEdits.map((item, position) => (position === index ? { ...item, replace: event.target.value } : item)))}
              />
            </label>
          ))}
          <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={`reply-${report.report_id}`}>
            Reply to the student
            <Textarea id={`reply-${report.report_id}`} value={draftReply} onChange={(event) => setDraftReply(event.target.value)} />
          </label>
        </div>
      ) : (
        <div className="rounded-lg border border-brand/20 bg-brand/4 p-3 text-sm">
          <p className="mb-1 text-[11px] font-semibold tracking-wide text-brand uppercase">Reply the student will see</p>
          <p>{report.teacher_action?.reply || report.reply}</p>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-warn"><TriangleAlert className="size-4" /> Please check before saving</p>
          <ul className="list-disc pl-5">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          <Button size="sm" variant="outline" className="w-fit" disabled={busy} onClick={() => submit("edit", { edits: draftEdits, reply: draftReply, saveAnyway: true })}>
            Save anyway
          </Button>
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2">
        {state === "done" && report.teacher_action && (
          <>
            <span className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground capitalize">{report.teacher_action.action}</span> by {report.teacher_action.reviewer} ·{" "}
              {formatDateTime(report.teacher_action.created_at)}
            </span>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => submit("undo")}><RotateCcw /> Undo</Button>
          </>
        )}
        {labels && !editing && (
          <>
            <Button size="sm" disabled={busy} onClick={() => submit("approve")}><Check /> {labels.approve} {focused && <Kbd>A</Kbd>}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}><Pencil /> Edit {focused && <Kbd>E</Kbd>}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => submit("reject")}><X /> {labels.reject} {focused && <Kbd>R</Kbd>}</Button>
          </>
        )}
        {editing && (
          <>
            <Button size="sm" disabled={busy} onClick={() => submit("edit", { edits: draftEdits, reply: draftReply })}>Save edit</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setWarnings([]) }}>Cancel</Button>
          </>
        )}
      </footer>
    </article>
  )
}
