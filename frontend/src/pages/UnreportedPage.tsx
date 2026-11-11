import { ArrowRight, SearchCheck } from "lucide-react"

import type { Case } from "@/api"
import { MathHtml } from "@/components/ChangePreview"
import { EditDiff } from "@/components/EditDiff"
import { Panel, Pill } from "@/components/Panel"
import { Button } from "@/components/ui/button"
import { queueForCase, repairLabel } from "@/lib/cases"
import type { Page } from "@/lib/navigation"

export function UnreportedPage({ cases, onNavigate }: { cases: Case[]; onNavigate: (page: Page, questionId: string) => void }) {
  const withDefects = cases.filter((item) => item.other_defects.length > 0)
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-medium md:text-2xl">Unreported defects</h1>
        <p className="max-w-[65ch] text-muted-foreground">The engine found these while it checked other reports. No student reported them, so the engine does not change them. Each one shows the fix it suggests.</p>
      </header>
      {withDefects.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-10 text-muted-foreground"><SearchCheck className="size-8" />No unreported defects found.</div>
      )}
      {withDefects.map((item) => (
        <Panel key={item.questionId} icon={SearchCheck} color="var(--tone-cyan)" title={`${item.subject} · ${item.chapter}`} badge={<Pill tone="muted" className="font-mono">{item.questionId}</Pill>}>
          {/* The question and what is wrong with it sit side by side, like on the review pages. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <MathHtml html={item.before.question_html} className="h-fit rounded-xl bg-muted p-4 text-sm" />
            <div className="flex flex-col gap-3">
              {item.other_defects.map((defect, index) => (
                <div key={index} className="flex flex-col gap-2 text-sm">
                  <p className="max-w-[65ch]"><span className="font-medium text-warn">{repairLabel(defect.repair, defect.edits)}: </span>{defect.evidence}</p>
                  {defect.edits.map((edit, editIndex) => <EditDiff key={editIndex} edit={edit} />)}
                </div>
              ))}
              <Button variant="outline" className="h-9 w-fit rounded-lg px-3" onClick={() => onNavigate(queueForCase(item), item.questionId)}>
                Open question <ArrowRight />
              </Button>
            </div>
          </div>
        </Panel>
      ))}
    </div>
  )
}
