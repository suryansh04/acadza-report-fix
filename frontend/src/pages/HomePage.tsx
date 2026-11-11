import { ArrowRight, CheckCheck, CircleCheck, Inbox, ListOrdered, OctagonAlert, Scale, SearchCheck, Sparkles, TriangleAlert, Wrench } from "lucide-react"

import type { Case } from "@/api"
import { TrendUpIcon } from "@/components/icons"
import { IconChip, Panel, Pill } from "@/components/Panel"
import { Button } from "@/components/ui/button"
import { VERDICT_LABELS, casesInQueue, countOpenReports, countUnreported, countWrongKeysFixed, estimateReviewMinutes, greetingForNow, repairLabel, reportState } from "@/lib/cases"
import { stripHtml } from "@/lib/html"
import type { Page } from "@/lib/navigation"
import type { IconComponent } from "@/lib/pages"
import { cn } from "@/lib/utils"

function ScoreRing({ value, label }: { value: number; label: string }) {
  const radius = 43
  const circumference = 2 * Math.PI * radius
  return (
    <div className="relative size-28.5 shrink-0" role="img" aria-label={`${value}% ${label}`}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r="47.5" fill="none" stroke="var(--brand)" strokeOpacity="0.05" strokeWidth="5" />
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--brand)" strokeOpacity="0.1" strokeWidth="4" />
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--brand)" strokeWidth="4" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)} className="transition-[stroke-dashoffset] duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs leading-[1.4] text-muted-foreground">{label}</span>
        <span className="text-[1.75rem] leading-[1.4] font-medium tabular-nums">{value}%</span>
      </div>
    </div>
  )
}

type MetricCardProps = { label: string; value: number; unit: string; icon: IconComponent; color: string; emphasis: string; note: string; good: boolean; onClick: () => void }

function MetricCard({ label, value, unit, icon, color, emphasis, note, good, onClick }: MetricCardProps) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-37.5 min-w-0 flex-col justify-between rounded-2xl border p-4 text-left transition-colors hover:border-foreground/15">
      <span className="flex min-w-0 items-center gap-2">
        <IconChip icon={icon} color={color} />
        <span className="truncate text-sm font-medium tracking-tight">{label}</span>
      </span>
      <span className="flex flex-col gap-3">
        <span className="leading-none"><span className="text-[1.75rem] font-medium tabular-nums">{value}</span> {unit}</span>
        <span className="flex items-center gap-2 text-xs">
          <TrendUpIcon className={good ? "text-trend" : "rotate-180 text-destructive"} />
          <span><span className="font-medium">{emphasis}</span> <span className="text-muted-foreground">{note}</span></span>
        </span>
      </span>
    </button>
  )
}

function InsightRow({ icon: Icon, tone, title, text }: { icon: IconComponent; tone: string; title: string; text: string }) {
  return (
    <div className="flex flex-1 items-center gap-3 rounded-xl bg-muted px-3 py-2">
      <Icon className={cn("size-5 shrink-0", tone)} />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-[13px] text-muted-foreground">{text}</p>
      </div>
    </div>
  )
}

function plural(count: number, word: string, pluralWord = `${word}s`): string {
  return `${count} ${count === 1 ? word : pluralWord}`
}

export function HomePage({ cases, reviewer, onNavigate }: { cases: Case[]; reviewer: string; onNavigate: (page: Page, questionId?: string) => void }) {
  const reports = cases.flatMap((item) => item.reports)
  const needsYou = casesInQueue(cases, "needs-you")
  const teacherReports = reports.filter((report) => report.route === "faculty_review")
  const teacherDone = teacherReports.filter((report) => report.teacher_action).length
  const openReports = countOpenReports(cases)
  const autoFixed = reports.filter((report) => report.route === "auto_apply").length
  const keysFixed = countWrongKeysFixed(cases)
  const studentWrong = reports.filter((report) => report.verdict === "no_error").length
  const unreported = countUnreported(cases)
  const progress = teacherReports.length === 0 ? 100 : Math.round((teacherDone / teacherReports.length) * 100)
  const firstName = reviewer.trim().split(/\s+/)[0]

  const verdictCounts = Object.entries(
    reports.reduce<Record<string, number>>((counts, report) => ({ ...counts, [report.verdict]: (counts[report.verdict] ?? 0) + 1 }), {}),
  ).sort((a, b) => b[1] - a[1])

  return (
    <div className="flex flex-col gap-8">
      <h1 className="min-w-0 truncate text-xl font-medium md:text-2xl">{greetingForNow()}{firstName ? ` ${firstName}` : ""}</h1>

      <section className="flex items-center gap-6">
        <div className="flex min-h-28.5 flex-col justify-between gap-4">
          <h2 className="text-lg font-medium">Review progress</h2>
          <div className="flex flex-col gap-2">
            <Pill tone={openReports > 0 ? "warn" : "good"} className="px-3 text-sm">
              {openReports > 0 ? `${plural(openReports, "report")} need you` : "All caught up"}
            </Pill>
            <p className="max-w-md text-sm leading-[1.4] text-muted-foreground">
              The engine checked {plural(reports.length, "student report")}.{" "}
              <span className="font-medium text-foreground">{plural(keysFixed, "wrong answer key")}</span>{" "}
              {keysFixed === 1 ? "was" : "were"} fixed automatically after three independent answers agreed.
            </p>
          </div>
          {openReports > 0 ? (
            <Button className="h-11 w-fit gap-2 rounded-xl px-4 text-sm" onClick={() => onNavigate("needs-you")}>
              Start reviewing <span className="font-normal opacity-70">· about {estimateReviewMinutes(openReports)} min</span> <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button variant="outline" className="h-11 w-fit gap-2 rounded-xl px-4 text-sm" onClick={() => onNavigate("auto-fixed")}>
              Check the auto-fixes <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
        <div className="flex flex-1 items-center justify-center">
          <ScoreRing value={progress} label="Reviewed" />
        </div>
      </section>

      <section className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Key numbers</h2>
          <p className="text-sm text-muted-foreground">Questions in each queue. Click a card to open it.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Needs you" value={needsYou.length} unit="questions" icon={Inbox} color="var(--tone-red)"
            emphasis={String(openReports)} note="reports still open" good={openReports === 0} onClick={() => onNavigate("needs-you")} />
          <MetricCard label="Auto-fixed" value={casesInQueue(cases, "auto-fixed").length} unit="questions" icon={Wrench} color="var(--tone-green)"
            emphasis={String(autoFixed)} note="fixes live, each can be undone" good onClick={() => onNavigate("auto-fixed")} />
          <MetricCard label="No change" value={casesInQueue(cases, "no-change").length} unit="questions" icon={CheckCheck} color="var(--tone-indigo)"
            emphasis={String(studentWrong)} note="students were wrong" good onClick={() => onNavigate("no-change")} />
          <MetricCard label="Unreported" value={unreported} unit="defects" icon={SearchCheck} color="var(--tone-cyan)"
            emphasis="Found" note="while checking other reports" good={unreported === 0} onClick={() => onNavigate("unreported")} />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel icon={Sparkles} color="var(--tone-indigo)" title="Engine summary" badge={<Pill tone="plain" className="py-2">This run</Pill>} tinted className="min-h-85.5">
          <div className="flex flex-1 flex-col gap-2">
            <InsightRow icon={CircleCheck} tone="text-good" title={`${plural(autoFixed, "fix", "fixes")} applied`} text="Only safe fixes, and keys that three independent answers agree on." />
            <InsightRow icon={TriangleAlert} tone="text-warn" title={`${plural(teacherReports.length, "report")} sent to you`} text="Changes to content, and cases where the engine is not sure." />
            <InsightRow icon={OctagonAlert} tone="text-bad" title={`${plural(unreported, "defect")} nobody reported`} text="Nothing changes until a teacher decides." />
          </div>
        </Panel>

        <Panel icon={Scale} color="var(--tone-red)" title="Verdicts" badge={<Pill tone="plain" className="py-2">{plural(reports.length, "report")}</Pill>} tinted className="min-h-85.5">
          <div className="flex flex-1 flex-col justify-between rounded-xl bg-background p-3">
            {verdictCounts.map(([verdict, count]) => (
              <div key={verdict} className="flex items-center justify-between gap-3 py-1.5">
                <p className="text-muted-foreground">{VERDICT_LABELS[verdict] ?? verdict}</p>
                <p className={cn("shrink-0 font-semibold tabular-nums", verdict === "defect" && "text-warn", verdict === "no_error" && "text-good")}>{count}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel icon={ListOrdered} color="var(--tone-teal)" title="Do these first" tinted className="min-h-85.5">
          <div className="flex flex-1 flex-col gap-2">
            {needsYou.length === 0 && <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">Nothing is waiting for you.</p>}
            {needsYou.slice(0, 4).map((item) => {
              const open = item.reports.find((report) => reportState(report) === "needs_you")
              return (
                <button key={item.questionId} type="button" onClick={() => onNavigate("needs-you", item.questionId)}
                  className="flex flex-col gap-1.5 rounded-xl bg-muted px-3 py-2 text-left transition-colors hover:bg-accent">
                  <p className="text-sm font-medium">{open?.repair ? repairLabel(open.repair, open.edits) : "Check"} · {item.subject}</p>
                  <p className="line-clamp-1 text-[13px] text-muted-foreground">{stripHtml(item.before.question_html)}</p>
                </button>
              )
            })}
          </div>
        </Panel>
      </section>
    </div>
  )
}
