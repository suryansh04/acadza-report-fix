import { ArrowRight, SearchCheck } from "lucide-react"

import type { Case } from "@/api"
import { MathHtml } from "@/components/ChangePreview"
import { Panel, Pill } from "@/components/Panel"
import { Button } from "@/components/ui/button"
import { FIELD_LABELS, REPAIR_LABELS, queueForCase, stripHtml } from "@/lib/cases"
import type { Page } from "@/lib/navigation"

export function UnreportedPage({ cases, onNavigate }: { cases: Case[]; onNavigate: (page: Page, questionId: string) => void }) {
  const withDefects = cases.filter((item) => item.other_defects.length > 0)
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-medium md:text-2xl">Unreported defects</h1>
        <p className="max-w-[65ch] text-muted-foreground">The engine found these while it checked other reports. No student reported them, so the engine does not change them. Each one shows the fix it suggests.</p>
      </header>
      {withDefects.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-10 text-muted-foreground"><SearchCheck className="size-8" />No unreported defects found.</div>
      )}
      {withDefects.map((item) => (
        <Panel key={item.questionId} icon={SearchCheck} color="var(--tone-cyan)" title={`${item.subject} · ${item.chapter}`} badge={<Pill tone="muted" className="font-mono">{item.questionId}</Pill>}>
          <MathHtml html={item.before.question_html} className="rounded-xl bg-muted p-4 text-sm" />
          {item.other_defects.map((defect, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-xl bg-warn-bg p-3 text-sm">
              <p className="max-w-[65ch]"><span className="font-medium text-warn">{REPAIR_LABELS[defect.repair] ?? defect.repair}: </span>{defect.evidence}</p>
              {defect.edits.map((edit, editIndex) => (
                <p key={editIndex} className="wrap-break-word">
                  <span className="text-[13px] text-muted-foreground">Suggested fix in the {FIELD_LABELS[edit.field].toLowerCase()}: </span>
                  <del className="rounded bg-background px-1 text-bad">{stripHtml(edit.find)}</del>
                  <span className="mx-1.5 text-muted-foreground">to</span>
                  <ins className="rounded bg-background px-1 font-medium text-good no-underline">{stripHtml(edit.replace) || "(removed)"}</ins>
                </p>
              ))}
            </div>
          ))}
          <Button variant="outline" className="h-9 w-fit rounded-lg px-3" onClick={() => onNavigate(queueForCase(item), item.questionId)}>
            Open question <ArrowRight />
          </Button>
        </Panel>
      ))}
    </div>
  )
}
