import { useEffect, useMemo } from "react"
import { Inbox } from "lucide-react"

import type { Case, Edit } from "@/api"
import { ChangePreview } from "@/components/ChangePreview"
import { ReportCard, type SubmitAction } from "@/components/ReportCard"
import { VotePanel } from "@/components/VotePanel"
import { Badge } from "@/components/ui/badge"
import { Kbd } from "@/components/ui/kbd"
import { REPAIR_LABELS, type QueueName, casesInQueue, reportState, stripHtml } from "@/lib/cases"
import { cn } from "@/lib/utils"

const QUEUE_TITLES: Record<QueueName, { title: string; empty: string }> = {
  "needs-you": { title: "Needs you", empty: "Nothing needs you right now. Every report is handled." },
  "auto-fixed": { title: "Auto-fixed", empty: "No fixes were applied automatically." },
  "no-change": { title: "No change", empty: "No reports closed without a change." },
}

function uniqueEdits(item: Case): Edit[] {
  const seen = new Map<string, Edit>()
  for (const report of item.reports) for (const edit of report.edits) seen.set(`${edit.field}|${edit.find}|${edit.replace}`, edit)
  return [...seen.values()]
}

function QueueRow({ item, selected, onClick }: { item: Case; selected: boolean; onClick: () => void }) {
  const repairs = [...new Set(item.reports.map((report) => report.repair).filter(Boolean))] as string[]
  const pending = item.reports.filter((report) => reportState(report) === "needs_you").length
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex w-full flex-col gap-1.5 border-b px-4 py-3 text-left transition-colors hover:bg-muted/60", selected && "bg-muted")}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="truncate">{item.subject} · {item.chapter}</span>
        <span className="ml-auto shrink-0 font-mono tabular-nums" title="Urgency: harm of the defect times the number of reports">{Math.round(item.urgency)}</span>
      </div>
      <p className="line-clamp-2 text-sm">{stripHtml(item.before.question_html)}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {repairs.map((repair) => <Badge key={repair} variant="outline" className="text-[11px]">{REPAIR_LABELS[repair] ?? repair}</Badge>)}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {item.reports.length} report{item.reports.length > 1 ? "s" : ""}{pending > 0 && ` · ${pending} open`}
        </span>
      </div>
    </button>
  )
}

function CaseDetail({ item, onSubmit }: { item: Case; onSubmit: SubmitAction }) {
  const focusedId = (item.reports.find((report) => reportState(report) !== "done") ?? item.reports[0])?.report_id
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{item.subject}</span>·<span>{item.chapter}</span>·
        <span>{{ scq: "Single correct", mcq: "Multiple correct", integerQuestion: "Integer" }[item.questionType] ?? item.questionType}</span>
        <span className="ml-auto font-mono text-xs">{item.questionId}</span>
      </header>
      <ChangePreview item={item} edits={uniqueEdits(item)} />
      <VotePanel item={item} />
      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Student reports</h3>
        {item.reports.map((report) => <ReportCard key={report.report_id} report={report} focused={report.report_id === focusedId} onSubmit={onSubmit} />)}
      </section>
      {item.other_defects.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border border-dashed p-4">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Also found (no student reported this)</h3>
          {item.other_defects.map((defect, index) => (
            <p key={index} className="text-sm"><Badge variant="outline" className="mr-2">{REPAIR_LABELS[defect.repair] ?? defect.repair}</Badge>{defect.evidence}</p>
          ))}
        </section>
      )}
    </div>
  )
}

type ReviewPageProps = {
  cases: Case[]
  queue: QueueName
  selectedId: string | null
  onSelect: (questionId: string) => void
  onSubmit: SubmitAction
}

export function ReviewPage({ cases, queue, selectedId, onSelect, onSubmit }: ReviewPageProps) {
  const list = useMemo(() => casesInQueue(cases, queue), [cases, queue])
  const selected = list.find((item) => item.questionId === selectedId) ?? cases.find((item) => item.questionId === selectedId) ?? list[0]
  const index = list.findIndex((item) => item.questionId === selected?.questionId)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey) return
      const step = { j: 1, k: -1 }[event.key.toLowerCase()]
      if (!step || list.length === 0) return
      const next = list[Math.min(Math.max(index + step, 0), list.length - 1)]
      onSelect(next.questionId)
      document.getElementById("case-detail")?.scrollTo({ top: 0 })
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [list, index, onSelect])

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="flex max-h-72 shrink-0 flex-col border-b md:max-h-none md:w-80 md:border-r md:border-b-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">{QUEUE_TITLES[queue].title}</h2>
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><Kbd>J</Kbd><Kbd>K</Kbd> to move</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.map((item) => <QueueRow key={item.questionId} item={item} selected={item.questionId === selected?.questionId} onClick={() => onSelect(item.questionId)} />)}
        </div>
      </aside>
      <div id="case-detail" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {selected ? (
          <CaseDetail key={selected.questionId} item={selected} onSubmit={onSubmit} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center text-muted-foreground">
            <Inbox className="size-8" />
            <p>{QUEUE_TITLES[queue].empty}</p>
          </div>
        )}
      </div>
    </div>
  )
}
