import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowRight, Check, CircleCheck, FileText, Inbox, LoaderCircle, MessagesSquare, SearchCheck } from "lucide-react"

import type { Case, Edit } from "@/api"
import { AllCaughtUp } from "@/components/AllCaughtUp"
import { ChangePreview } from "@/components/ChangePreview"
import { Panel, Pill } from "@/components/Panel"
import { ReportCard, type SubmitAction } from "@/components/ReportCard"
import { VotePanel } from "@/components/VotePanel"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import type { ConfirmAll } from "@/hooks/use-decisions"
import { useKeydown } from "@/hooks/use-keydown"
import {
  REPAIR_LABELS,
  type QueueName,
  type SessionStats,
  QUESTION_TYPE_LABELS,
  caseIsFinished,
  casesInQueue,
  editKey,
  editsInEffect,
  estimateReviewMinutes,
  queueReports,
  reportState,
} from "@/lib/cases"
import { stripHtml } from "@/lib/html"
import { type Page, shouldIgnoreShortcut } from "@/lib/navigation"
import { cn } from "@/lib/utils"

// Long enough to see the "done" check, short enough not to wait for it.
const ADVANCE_DELAY_MS = 900

const QUEUE_TEXT: Record<QueueName, { title: string; empty: string; bulk: (count: number) => string }> = {
  "needs-you": { title: "Needs you", empty: "Nothing needs you right now.", bulk: () => "" },
  "auto-fixed": { title: "Auto-fixed", empty: "No fixes were applied automatically.", bulk: (count) => `Keep all ${count} fixes` },
  "no-change": { title: "No change", empty: "No reports closed without a change.", bulk: (count) => `Agree with all ${count}` },
}

// Several reports on one question often carry the same fix. Show each live change once.
function editsForPreview(item: Case): Edit[] {
  return [...new Map(item.reports.flatMap(editsInEffect).map((edit) => [editKey(edit), edit])).values()]
}

function BulkConfirm({ label, onConfirm }: { label: string; onConfirm: () => Promise<void> }) {
  const [state, setState] = useState<"idle" | "confirm" | "saving">("idle")
  if (state === "idle") {
    return <Button variant="outline" className="h-8 w-full rounded-lg text-[13px]" onClick={() => setState("confirm")}><Check /> {label}</Button>
  }
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted p-1.5 text-[13px] animate-in fade-in">
      <span className="flex-1 pl-1.5">Sure? You can undo it.</span>
      <Button className="h-7 rounded-md px-2.5" disabled={state === "saving"} onClick={async () => { setState("saving"); await onConfirm(); setState("idle") }}>
        {state === "saving" ? <LoaderCircle className="animate-spin" /> : "Yes"}
      </Button>
      <Button variant="ghost" className="h-7 rounded-md px-2.5" disabled={state === "saving"} onClick={() => setState("idle")}>Cancel</Button>
    </div>
  )
}

type QueueHeaderProps = { cases: Case[]; queue: QueueName; count: number; onBulk: () => Promise<void> }

function QueueHeader({ cases, queue, count, onBulk }: QueueHeaderProps) {
  const reports = queueReports(cases, queue)
  const decided = reports.filter((report) => report.teacher_action).length
  const open = reports.length - decided
  const share = reports.length === 0 ? 1 : decided / reports.length

  return (
    <div className="flex flex-col gap-3 border-b px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">{QUEUE_TEXT[queue].title} <Pill tone="muted" className="px-2 py-0.5">{count}</Pill></h2>
        <span className="hidden items-center gap-1 text-xs text-muted-foreground md:flex"><Kbd>J</Kbd><Kbd>K</Kbd> to move</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={decided} aria-valuemax={reports.length} aria-label="Reports decided">
          <div className="h-full rounded-full bg-live transition-[width] duration-500 ease-out" style={{ width: `${share * 100}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          {decided} of {reports.length} reports decided{open > 0 && queue === "needs-you" && ` · about ${estimateReviewMinutes(open)} min left`}
        </p>
      </div>
      {queue !== "needs-you" && open > 0 && <BulkConfirm key={open} label={QUEUE_TEXT[queue].bulk(open)} onConfirm={onBulk} />}
    </div>
  )
}

function QueueRow({ item, queue, selected, onClick }: { item: Case; queue: QueueName; selected: boolean; onClick: () => void }) {
  const repairs = [...new Set(item.reports.map((report) => report.repair).filter(Boolean))] as string[]
  const pending = item.reports.filter((report) => reportState(report) === "needs_you").length
  const finished = caseIsFinished(item, queue)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={cn("group flex w-full flex-col gap-1.5 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted/60", selected && "bg-muted hover:bg-muted")}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="truncate">{item.subject} · {item.chapter}</span>
        {queue === "needs-you" && (
          <span className="ml-auto shrink-0 tabular-nums" title="Urgency: how much the defect can harm students, times the number of reports. Highest first.">Urgency {Math.round(item.urgency)}</span>
        )}
      </div>
      <p className={cn("line-clamp-2 text-sm", finished && "text-muted-foreground")}>{stripHtml(item.before.question_html)}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {repairs.map((repair) => <Pill key={repair} tone="muted" className="px-2 py-0.5 text-[11px] group-aria-current:bg-background">{REPAIR_LABELS[repair] ?? repair}</Pill>)}
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          {finished ? <><Check className="size-3.5 text-live" /> Checked</> : <>{item.reports.length} report{item.reports.length > 1 ? "s" : ""}{pending > 0 && ` · ${pending} open`}</>}
        </span>
      </div>
    </button>
  )
}

function CaseDone({ advancing, onNext }: { advancing: boolean; onNext: (() => void) | null }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-live/10 px-4 py-3 text-sm animate-in fade-in slide-in-from-top-1 motion-reduce:animate-none">
      <CircleCheck className="size-5 shrink-0 text-live animate-in zoom-in-50 duration-300" />
      <p className="font-medium">{advancing ? "Done. Opening the next question…" : "Done. Every report on this question has a decision."}</p>
      {!advancing && onNext && <Button className="ml-auto h-9 rounded-lg px-3" onClick={onNext}>Next question <ArrowRight /> <Kbd>J</Kbd></Button>}
    </div>
  )
}

type CaseDetailProps = { item: Case; queue: QueueName; advancing: boolean; onSubmit: SubmitAction; onNext: (() => void) | null }

function CaseDetail({ item, queue, advancing, onSubmit, onNext }: CaseDetailProps) {
  const focusedId = (item.reports.find((report) => reportState(report) !== "done") ?? item.reports[0])?.report_id
  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 text-xl font-medium">{item.subject} · {item.chapter}</h1>
        <Pill tone="muted" className="ml-auto font-mono">{item.questionId}</Pill>
      </header>
      {caseIsFinished(item, queue) && <CaseDone advancing={advancing} onNext={onNext} />}
      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <MessagesSquare className="size-5" /> {item.reports.length > 1 ? `${item.reports.length} student reports` : "Student report"}
        </h2>
        {item.reports.map((report) => <ReportCard key={report.report_id} report={report} current={item.before} focused={report.report_id === focusedId} onSubmit={onSubmit} />)}
      </section>
      <Panel icon={FileText} color="var(--tone-indigo)" title="Question" badge={<Pill>{QUESTION_TYPE_LABELS[item.questionType] ?? item.questionType}</Pill>}>
        <ChangePreview item={item} edits={editsForPreview(item)} />
      </Panel>
      <VotePanel item={item} />
      {item.other_defects.length > 0 && (
        <Panel icon={SearchCheck} color="var(--tone-cyan)" title="Also found" badge={<Pill tone="muted">No student reported this</Pill>}>
          {item.other_defects.map((defect, index) => (
            <div key={index} className="flex flex-col gap-1.5 rounded-xl bg-muted px-3 py-2.5 text-sm">
              <p className="font-medium">{REPAIR_LABELS[defect.repair] ?? defect.repair}</p>
              <p className="text-muted-foreground">{defect.evidence}</p>
            </div>
          ))}
        </Panel>
      )}
    </div>
  )
}

type ReviewPageProps = {
  cases: Case[]
  queue: QueueName
  selectedId: string | null
  session: SessionStats
  onSelect: (questionId: string, replace?: boolean) => void
  onNavigate: (page: Page) => void
  onSubmit: SubmitAction
  onConfirmAll: ConfirmAll
}

export function ReviewPage({ cases, queue, selectedId, session, onSelect, onNavigate, onSubmit, onConfirmAll }: ReviewPageProps) {
  const list = useMemo(() => casesInQueue(cases, queue), [cases, queue])
  const selected = list.find((item) => item.questionId === selectedId) ?? cases.find((item) => item.questionId === selectedId) ?? list[0]
  const index = list.findIndex((item) => item.questionId === selected?.questionId)
  // The question the teacher just decided on. It moves on by itself once that question is finished.
  const [decidedId, setDecidedId] = useState<string | null>(null)
  const [caughtUp, setCaughtUp] = useState(false)
  const finished = selected ? caseIsFinished(selected, queue) : false
  const advancing = finished && decidedId === selected?.questionId

  const select = useCallback((questionId: string) => {
    setCaughtUp(false)
    onSelect(questionId)
    document.getElementById("case-detail")?.scrollTo({ top: 0 })
  }, [onSelect])

  const move = useCallback((step: number) => {
    if (list.length === 0) return
    // A finished question leaves "Needs you" (index -1), so "next" starts again at the top.
    const target = index === -1 ? (step > 0 ? 0 : list.length - 1) : Math.min(Math.max(index + step, 0), list.length - 1)
    select(list[target].questionId)
  }, [list, index, select])

  const goToNextOpen = useCallback(() => {
    setDecidedId(null)
    const start = index + 1
    const next = [...list.slice(start), ...list.slice(0, start)].find((item) => item.questionId !== selected?.questionId && !caseIsFinished(item, queue))
    if (next) select(next.questionId)
    else setCaughtUp(true)
  }, [list, index, selected, queue, select])

  // Keep the open question in the URL, so it stays on screen while it finishes instead of jumping away at once.
  useEffect(() => {
    if (!selectedId && list[0]) onSelect(list[0].questionId, true)
  }, [selectedId, list, onSelect])

  useEffect(() => {
    if (!advancing) return
    const timer = setTimeout(goToNextOpen, ADVANCE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [advancing, goToNextOpen])

  useKeydown((event) => {
    if (shouldIgnoreShortcut(event)) return
    const step = { j: 1, k: -1 }[event.key.toLowerCase()]
    if (step) move(step)
  })

  const submitAndAdvance: SubmitAction = useCallback(async (report, action, extra) => {
    const result = await onSubmit(report, action, extra)
    if (result?.saved && action !== "undo") setDecidedId(report.question_id)
    return result
  }, [onSubmit])

  const confirmAll = async () => {
    const open = queueReports(cases, queue).filter((report) => !report.teacher_action)
    if (await onConfirmAll(open)) setCaughtUp(true)
  }

  const showCaughtUp = caughtUp || (queue === "needs-you" && list.length === 0)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 md:flex-row md:gap-6 md:overflow-hidden md:p-6">
      <aside className="flex max-h-80 shrink-0 flex-col overflow-hidden rounded-2xl border md:max-h-none md:w-80">
        <QueueHeader cases={cases} queue={queue} count={list.length} onBulk={confirmAll} />
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
          {list.map((item) => <QueueRow key={item.questionId} item={item} queue={queue} selected={!showCaughtUp && item.questionId === selected?.questionId} onClick={() => select(item.questionId)} />)}
          {list.length === 0 && <p className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground"><Inbox className="size-6" />{QUEUE_TEXT[queue].empty}</p>}
        </div>
      </aside>
      <div id="case-detail" className="min-w-0 flex-1 md:min-h-0 md:overflow-y-auto md:pr-2">
        {showCaughtUp ? (
          <AllCaughtUp queue={queue} session={session} onNavigate={onNavigate} />
        ) : selected ? (
          <CaseDetail key={selected.questionId} item={selected} queue={queue} advancing={advancing} onSubmit={submitAndAdvance} onNext={list.length > 0 ? goToNextOpen : null} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-10 text-center text-muted-foreground">
            <Inbox className="size-8" />
            <p>{QUEUE_TEXT[queue].empty}</p>
          </div>
        )}
      </div>
    </div>
  )
}
