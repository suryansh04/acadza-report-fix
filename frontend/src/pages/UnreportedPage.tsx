import { SearchCheck } from "lucide-react"

import type { Case } from "@/api"
import { MathHtml } from "@/components/ChangePreview"
import { Panel, Pill } from "@/components/Panel"
import { FIELD_LABELS, REPAIR_LABELS, stripHtml } from "@/lib/cases"

export function UnreportedPage({ cases }: { cases: Case[] }) {
  const withDefects = cases.filter((item) => item.other_defects.length > 0)
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-medium md:text-2xl">Unreported defects</h1>
        <p className="text-muted-foreground">The engine found these while it checked other reports. No student reported them, so nothing is changed until you decide.</p>
      </header>
      {withDefects.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-10 text-muted-foreground"><SearchCheck className="size-8" />No unreported defects found.</div>
      )}
      {withDefects.map((item) => (
        <Panel key={item.questionId} icon={SearchCheck} color="var(--tone-cyan)" title={`${item.subject} · ${item.chapter}`} badge={<Pill tone="muted" className="font-mono">{item.questionId}</Pill>}>
          <MathHtml html={item.before.question_html} className="rounded-xl bg-muted p-4 text-sm" />
          {item.other_defects.map((defect, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-xl border p-3 text-sm">
              <p><Pill tone="warn" className="mr-2">{REPAIR_LABELS[defect.repair] ?? defect.repair}</Pill>{defect.evidence}</p>
              {defect.edits.map((edit, editIndex) => (
                <p key={editIndex} className="wrap-break-word">
                  <span className="text-xs text-muted-foreground">{FIELD_LABELS[edit.field]}: </span>
                  <del className="rounded bg-bad/10 px-1 text-bad">{stripHtml(edit.find)}</del>
                  <span className="mx-1.5 text-muted-foreground">to</span>
                  <ins className="rounded bg-good/15 px-1 text-good no-underline">{stripHtml(edit.replace) || "(removed)"}</ins>
                </p>
              ))}
            </div>
          ))}
        </Panel>
      ))}
    </div>
  )
}
