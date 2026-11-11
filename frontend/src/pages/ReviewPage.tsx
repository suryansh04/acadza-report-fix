import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, Check, CircleCheck, FileText, Inbox, LoaderCircle, MessagesSquare, PanelLeftClose, PanelLeftOpen, SearchCheck, TriangleAlert, Users } from "lucide-react"

import type { Case, Edit } from "@/api"
import { AllCaughtUp } from "@/components/AllCaughtUp"
import { ChangePreview } from "@/components/ChangePreview"
import { Pill } from "@/components/Panel"
import { ReportCard, type SubmitAction } from "@/components/ReportCard"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { usePlaySound } from "@/components/ui/sensory-ui/config/use-play-sound"
import type { ConfirmAll } from "@/hooks/use-decisions"
import { useKeydown } from "@/hooks/use-keydown"
import {
  LOW_CONFIDENCE,
  REPAIR_LABELS,
  type QueueName,
  type QueueSort,
  type SessionStats,
  QUESTION_TYPE_LABELS,
  caseIsFinished,
  casesInQueue,
  editKey,
  editsInEffect,
  estimateReviewMinutes,
  lowestConfidence,
  queueReports,
  reportState,
  studentsReported,
} from "@/lib/cases"
import { stripHtml } from "@/lib/html"
import { type Page, shouldIgnoreShortcut, useQueueSort } from "@/lib/navigation"
import { cn } from "@/lib/utils"

// Long enough to see the "done" check, short enough not to wait for it.
const ADVANCE_DELAY_MS = 900
// Quieter than the success chime: a teacher hears it on every J and K.
const MOVE_SOUND_VOLUME = 0.5
const SCROLL_AREAS = ["review-page", "case-detail", "case-question", "case-reports"]
const PANEL = "rounded-2xl border bg-background"

const QUEUE_TEXT: Record<QueueName, { title: string; empty: string; bulk: (count: number) => string }> = {
  "needs-you": { title: "Needs you", empty: "Nothing needs you right now.", bulk: () => "" },
  "auto-fixed": { title: "Auto-fixed", empty: "No fixes were applied automatically.", bulk: (count) => `Keep all ${count} fixes` },
  "no-change": { title: "No change", empty: "No reports closed without a change.", bulk: (count) => `Agree with all ${count}` },
}

const SORT_LABELS: Record<QueueSort, { label: string; title: string }> = {
  reports: { label: "Most reported", title: "The question that most students reported comes first." },
  urgency: { label: "Most urgent", title: "Urgency is how much the defect can harm students, times the number of reports." },
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

function SortSwitch({ sort, onChange }: { sort: QueueSort; onChange: (sort: QueueSort) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-0.5 text-xs" role="radiogroup" aria-label="Sort the queue">
      {(Object.keys(SORT_LABELS) as QueueSort[]).map((option) => (
        <button key={option} type="button" role="radio" aria-checked={sort === option} title={SORT_LABELS[option].title} onClick={() => onChange(option)}
          className={cn("rounded-md px-2 py-1 text-muted-foreground transition-colors", sort === option && "bg-background font-medium text-foreground shadow-xs")}>
          {SORT_LABELS[option].label}
        </button>
      ))}
    </div>
  )
}

type QueueHeaderProps = { cases: Case[]; queue: QueueName; count: number; sort: QueueSort; onSortChange: (sort: QueueSort) => void; onBulk: () => Promise<void>; onCollapse: () => void }

function QueueHeader({ cases, queue, count, sort, onSortChange, onBulk, onCollapse }: QueueHeaderProps) {
  const reports = queueReports(cases, queue)
  const decided = reports.filter((report) => report.teacher_action).length
  const open = reports.length - decided
  const share = reports.length === 0 ? 1 : decided / reports.length

  return (
    <div className="flex flex-col gap-3 border-b px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium whitespace-nowrap">{QUEUE_TEXT[queue].title} <Pill tone="muted" className="px-2 py-0.5">{count}</Pill></h2>
        <Button variant="ghost" size="icon" className="hidden size-8 rounded-lg lg:flex" aria-label="Hide the queue" title="Hide the queue" onClick={onCollapse}>
          <PanelLeftClose />
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={decided} aria-valuemax={reports.length} aria-label="Reports decided">
          <div className="h-full rounded-full bg-live transition-[width] duration-500 ease-out" style={{ width: `${share * 100}%` }} />
        </div>
        <p className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{decided} of {reports.length} reports decided{open > 0 && queue === "needs-you" && ` · about ${estimateReviewMinutes(open)} min left`}</span>
          <span className="flex shrink-0 items-center gap-1"><Kbd>J</Kbd><Kbd>K</Kbd></span>
        </p>
      </div>
      <SortSwitch sort={sort} onChange={onSortChange} />
      {queue !== "needs-you" && open > 0 && <BulkConfirm key={open} label={QUEUE_TEXT[queue].bulk(open)} onConfirm={onBulk} />}
    </div>
  )
}

// Scrolls only the queue list. A smooth scrollIntoView also scrolls the boxes around the list, and Chromium then
// cancels the scroll up on K.
function scrollRowIntoQueueView(row: HTMLElement) {
  const list = row.parentElement
  if (!list) return
  const rowBox = row.getBoundingClientRect()
  const listBox = list.getBoundingClientRect()
  const gap = Number.parseFloat(getComputedStyle(list).paddingTop)
  const offset = rowBox.top < listBox.top ? rowBox.top - listBox.top - gap
    : rowBox.bottom > listBox.bottom ? rowBox.bottom - listBox.bottom + gap : 0
  if (offset === 0) return
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  list.scrollBy({ top: offset, behavior: reduceMotion ? "auto" : "smooth" })
}

function QueueRow({ item, queue, selected, onClick }: { item: Case; queue: QueueName; selected: boolean; onClick: () => void }) {
  const repairs = [...new Set(item.reports.map((report) => report.repair).filter(Boolean))] as string[]
  const pending = item.reports.filter((report) => reportState(report) === "needs_you").length
  const finished = caseIsFinished(item, queue)
  const lowConfidence = !finished && lowestConfidence(item) < LOW_CONFIDENCE
  const rowRef = useRef<HTMLButtonElement>(null)

  // J, K and auto-advance can select a row outside the visible part of the queue.
  useEffect(() => {
    if (selected && rowRef.current) scrollRowIntoQueueView(rowRef.current)
  }, [selected])

  return (
    <button
      ref={rowRef}
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={cn("group flex w-full flex-col gap-1.5 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted/60", selected && "bg-muted hover:bg-muted")}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="truncate">{item.subject} · {item.chapter}</span>
        <span className={cn("ml-auto flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 tabular-nums", item.reports.length > 1 && "bg-warn-bg font-medium text-warn")}
          title={studentsReported(item.reports.length)}>
          <Users className="size-3" /> {item.reports.length}
        </span>
      </div>
      <p className={cn("line-clamp-2 text-sm", finished && "text-muted-foreground")}>{stripHtml(item.before.question_html)}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {repairs.map((repair) => <Pill key={repair} tone="muted" className="px-2 py-0.5 text-[11px] group-aria-current:bg-background">{REPAIR_LABELS[repair] ?? repair}</Pill>)}
        {lowConfidence && <Pill tone="warn" className="px-2 py-0.5 text-[11px]"><TriangleAlert className="size-3" /> Low confidence</Pill>}
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          {finished ? <><Check className="size-3.5 text-live" /> Checked</> : pending > 0 && `${pending} open`}
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

// The question sits in the middle and the reports in a panel on the right, like the sources, chat and studio panels of
// NotebookLM. The teacher reads both without scrolling between them. Below 1280 px the report panel moves under the question.
function CaseDetail({ item, queue, advancing, onSubmit, onNext }: CaseDetailProps) {
  const focusedId = (item.reports.find((report) => reportState(report) !== "done") ?? item.reports[0])?.report_id
  const [solutionOpen, setSolutionOpen] = useState(false)

  useKeydown((event) => {
    if (event.key.toLowerCase() === "s" && !event.repeat && !shouldIgnoreShortcut(event)) setSolutionOpen((open) => !open)
  })

  return (
    <>
      <section id="case-question" className={cn(PANEL, "flex min-w-0 flex-col gap-4 p-4 animate-in fade-in duration-300 motion-reduce:animate-none md:p-5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto")}>
        <header className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 text-lg font-medium">{item.subject} · {item.chapter}</h1>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <Pill tone={item.reports.length > 1 ? "warn" : "muted"}><Users className="size-3.5" /> {studentsReported(item.reports.length)}</Pill>
            <Pill tone="muted" className="font-mono">{item.questionId}</Pill>
          </span>
        </header>
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-medium"><FileText className="size-4.5 text-muted-foreground" /> Question</h2>
          <Pill>{QUESTION_TYPE_LABELS[item.questionType] ?? item.questionType}</Pill>
        </div>
        <ChangePreview item={item} edits={editsForPreview(item)} solutionOpen={solutionOpen} onSolutionToggle={setSolutionOpen} />
        {item.other_defects.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="flex items-center gap-2 font-medium"><SearchCheck className="size-4.5 text-muted-foreground" /> Also found <Pill tone="muted">No student reported this</Pill></h2>
            {item.other_defects.map((defect, index) => (
              <div key={index} className="flex flex-col gap-1 rounded-xl bg-muted px-3 py-2.5 text-sm">
                <p className="font-medium">{REPAIR_LABELS[defect.repair] ?? defect.repair}</p>
                <p className="text-muted-foreground">{defect.evidence}</p>
              </div>
            ))}
          </section>
        )}
      </section>
      <aside id="case-reports" className={cn(PANEL, "flex min-w-0 shrink-0 flex-col gap-3 p-3 animate-in fade-in slide-in-from-right-4 duration-300 motion-reduce:animate-none xl:min-h-0 xl:w-[27rem] xl:overflow-y-auto 2xl:w-[31rem]")}>
        <h2 className="flex items-center gap-2 px-1 pt-1 font-medium">
          <MessagesSquare className="size-4.5 text-muted-foreground" /> {item.reports.length > 1 ? `${item.reports.length} student reports` : "Student report"}
        </h2>
        {caseIsFinished(item, queue) && <CaseDone advancing={advancing} onNext={onNext} />}
        {item.reports.map((report) => <ReportCard key={report.report_id} report={report} current={item.before} focused={report.report_id === focusedId} onSubmit={onSubmit} />)}
      </aside>
    </>
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
  const [sort, setSort] = useQueueSort()
  const list = useMemo(() => casesInQueue(cases, queue, sort), [cases, queue, sort])
  const selected = list.find((item) => item.questionId === selectedId) ?? cases.find((item) => item.questionId === selectedId) ?? list[0]
  const index = list.findIndex((item) => item.questionId === selected?.questionId)
  // The question the teacher just decided on. It moves on by itself once that question is finished.
  const [decidedId, setDecidedId] = useState<string | null>(null)
  const [caughtUp, setCaughtUp] = useState(false)
  const [queueHidden, setQueueHidden] = useState(false)
  const finished = selected ? caseIsFinished(selected, queue) : false
  const advancing = finished && decidedId === selected?.questionId
  const { play: playForward } = usePlaySound({ sound: "navigation.forward", volume: MOVE_SOUND_VOLUME })
  const { play: playBackward } = usePlaySound({ sound: "navigation.backward", volume: MOVE_SOUND_VOLUME })

  const select = useCallback((questionId: string) => {
    setCaughtUp(false)
    onSelect(questionId)
    for (const id of SCROLL_AREAS) document.getElementById(id)?.scrollTo({ top: 0 })
  }, [onSelect])

  // Returns false when there is nowhere to go, so no move sound plays.
  const move = useCallback((step: number): boolean => {
    if (list.length === 0) return false
    // A finished question leaves "Needs you" (index -1), so "next" starts again at the top.
    const target = index === -1 ? (step > 0 ? 0 : list.length - 1) : Math.min(Math.max(index + step, 0), list.length - 1)
    if (target === index) return false
    select(list[target].questionId)
    return true
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
    if (event.repeat || shouldIgnoreShortcut(event)) return
    const step = { j: 1, k: -1 }[event.key.toLowerCase()]
    if (!step || !move(step)) return
    if (step > 0) playForward()
    else playBackward()
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
    <div id="review-page" className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto bg-muted/40 p-3 lg:flex-row lg:overflow-hidden">
      {/* Hiding the queue applies only to the wide layout. In a narrow window the queue always shows above the question. */}
      {queueHidden && (
        <aside className={cn(PANEL, "hidden w-12 shrink-0 flex-col items-center gap-2 py-3 lg:flex")}>
          <Button variant="ghost" size="icon" className="size-8 rounded-lg" aria-label="Show the queue" title="Show the queue" onClick={() => setQueueHidden(false)}>
            <PanelLeftOpen />
          </Button>
          <Pill tone="muted" className="px-1.5 py-0.5">{list.length}</Pill>
        </aside>
      )}
      <aside className={cn(PANEL, "flex max-h-96 shrink-0 flex-col overflow-hidden animate-in fade-in slide-in-from-left-2 duration-300 motion-reduce:animate-none lg:max-h-none lg:w-80", queueHidden && "lg:hidden")}>
        <QueueHeader cases={cases} queue={queue} count={list.length} sort={sort} onSortChange={setSort} onBulk={confirmAll} onCollapse={() => setQueueHidden(true)} />
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
          {list.map((item) => <QueueRow key={item.questionId} item={item} queue={queue} selected={!showCaughtUp && item.questionId === selected?.questionId} onClick={() => select(item.questionId)} />)}
          {list.length === 0 && <p className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground"><Inbox className="size-6" />{QUEUE_TEXT[queue].empty}</p>}
        </div>
      </aside>
      <div id="case-detail" className="flex min-w-0 flex-1 flex-col gap-3 lg:min-h-0 lg:overflow-y-auto xl:flex-row xl:overflow-hidden">
        {showCaughtUp ? (
          <div className={cn(PANEL, "flex-1 p-4 md:p-6")}><AllCaughtUp queue={queue} session={session} onNavigate={onNavigate} /></div>
        ) : selected ? (
          <CaseDetail key={selected.questionId} item={selected} queue={queue} advancing={advancing} onSubmit={submitAndAdvance} onNext={list.length > 0 ? goToNextOpen : null} />
        ) : (
          <div className={cn(PANEL, "flex flex-1 flex-col items-center justify-center gap-2 border-dashed p-10 text-center text-muted-foreground")}>
            <Inbox className="size-8" />
            <p>{QUEUE_TEXT[queue].empty}</p>
          </div>
        )}
      </div>
    </div>
  )
}
