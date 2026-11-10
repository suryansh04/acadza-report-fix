import { ArrowRight, CheckCheck, Inbox, SearchCheck, Wrench } from "lucide-react"

import type { Case } from "@/api"
import { Badge } from "@/components/ui/badge"
import { StatusIndicator } from "@/components/ui/status-indicator"
import { REPAIR_LABELS, casesInQueue, greetingForNow, reportState, stripHtml } from "@/lib/cases"
import type { Page } from "@/lib/navigation"

function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const share = total === 0 ? 1 : done / total
  return (
    <div className="relative size-28 shrink-0" role="img" aria-label={`${done} of ${total} teacher reviews done`}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--muted)" strokeWidth="9" />
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--brand)" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - share)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums">{Math.round(share * 100)}%</span>
        <span className="text-[11px] text-muted-foreground">reviewed</span>
      </div>
    </div>
  )
}

function StatCard({ label, value, hint, icon: Icon, onClick }: { label: string; value: number; hint: string; icon: typeof Inbox; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-foreground/20">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{label}</span>
        <Icon className="size-4" />
      </div>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">{hint} <ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" /></span>
    </button>
  )
}

export function HomePage({ cases, reviewer, onNavigate }: { cases: Case[]; reviewer: string; onNavigate: (page: Page, questionId?: string) => void }) {
  const reports = cases.flatMap((item) => item.reports)
  const needsYou = casesInQueue(cases, "needs-you")
  const teacherReports = reports.filter((report) => report.route === "faculty_review")
  const teacherDone = teacherReports.filter((report) => report.teacher_action).length
  const autoFixed = reports.filter((report) => report.route === "auto_apply")
  const keysFixed = new Set(cases.filter((item) => item.reports.some((report) => report.route === "auto_apply" && report.repair === "answer_key")).map((item) => item.questionId)).size
  const unreported = cases.reduce((total, item) => total + item.other_defects.length, 0)
  const openReports = reports.filter((report) => reportState(report) === "needs_you").length

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 p-4 md:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-balance">{greetingForNow()}{reviewer ? `, ${reviewer}` : ""}</h1>
        <p className="text-muted-foreground">Here is where the question bank stands.</p>
      </header>

      <section className="flex flex-col items-start gap-6 rounded-2xl border bg-card p-6 sm:flex-row sm:items-center">
        <ProgressRing done={teacherDone} total={teacherReports.length} />
        <div className="flex flex-col gap-2">
          <StatusIndicator state={openReports > 0 ? "fixing" : "active"} size="sm" label={openReports > 0 ? `${openReports} report${openReports > 1 ? "s" : ""} need you` : "All caught up"} />
          <p className="max-w-xl text-pretty">
            <span className="font-semibold">{keysFixed} wrong answer key{keysFixed === 1 ? " was" : "s were"} fixed automatically</span>
            {" "}after three independent answers agreed. {autoFixed.length} fixes are live in total, and every one can be undone.
          </p>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Needs you" value={needsYou.length} hint="questions to review" icon={Inbox} onClick={() => onNavigate("needs-you")} />
        <StatCard label="Auto-fixed" value={casesInQueue(cases, "auto-fixed").length} hint="questions fixed, check or undo" icon={Wrench} onClick={() => onNavigate("auto-fixed")} />
        <StatCard label="No change" value={casesInQueue(cases, "no-change").length} hint="questions where the student was wrong" icon={CheckCheck} onClick={() => onNavigate("no-change")} />
        <StatCard label="Unreported" value={unreported} hint="defects nobody reported" icon={SearchCheck} onClick={() => onNavigate("unreported")} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Do these first</h2>
          <span className="text-xs text-muted-foreground">Most harm to students first</span>
        </div>
        {needsYou.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">Nothing is waiting for you.</p>
        ) : (
          <ol className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
            {needsYou.slice(0, 5).map((item, position) => {
              const repair = item.reports.find((report) => reportState(report) === "needs_you")?.repair
              return (
                <li key={item.questionId}>
                  <button type="button" onClick={() => onNavigate("needs-you", item.questionId)} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-muted/60">
                    <span className="w-5 font-mono text-sm text-muted-foreground tabular-nums">{position + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-sm">{stripHtml(item.before.question_html)}</span>
                      <span className="text-xs text-muted-foreground">{item.subject} · {item.chapter} · {item.reports.length} report{item.reports.length > 1 ? "s" : ""}</span>
                    </span>
                    {repair && <Badge variant="outline">{REPAIR_LABELS[repair] ?? repair}</Badge>}
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}
