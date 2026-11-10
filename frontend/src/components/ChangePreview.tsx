import { ArrowRight } from "lucide-react"

import type { Case, Edit } from "@/api"
import { buildDiffHtml, formatAnswer } from "@/lib/cases"
import { cn } from "@/lib/utils"

export function MathHtml({ html, className }: { html: string; className?: string }) {
  // The HTML is Acadza's own question content. MathML inside it renders natively in the browser.
  return <div className={cn("question-html", className)} dangerouslySetInnerHTML={{ __html: html }} />
}

function SideBySide({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-bad/30 bg-bad/[0.03] p-3">
          <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-bad uppercase">Before</p>
          <MathHtml html={before} />
        </div>
        <div className="min-w-0 rounded-lg border border-good/30 bg-good/[0.04] p-3">
          <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-good uppercase">After</p>
          <MathHtml html={after} />
        </div>
      </div>
    </section>
  )
}

function KeyChange({ before, after }: { before: string; after: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Answer key</span>
      <span className="rounded-md bg-bad/10 px-2.5 py-1 font-mono text-sm text-bad line-through">{before}</span>
      <ArrowRight className="size-4 text-muted-foreground" />
      <span className="rounded-md bg-good/15 px-2.5 py-1 font-mono text-sm font-semibold text-good">{after}</span>
    </div>
  )
}

/** The question as it is now, and as it would be with the proposed edits, with the changed text marked. */
export function ChangePreview({ item, edits }: { item: Case; edits: Edit[] }) {
  const changes = (field: "question" | "solution") => edits.some((edit) => edit.field === field)
  const keyEdit = edits.find((edit) => edit.field === "answer")
  const typeEdit = edits.find((edit) => edit.field === "questionType")

  return (
    <div className="flex flex-col gap-4">
      {changes("question") ? (
        <SideBySide
          label="Question"
          before={buildDiffHtml(item.before.question_html, edits, "question", "before")}
          after={buildDiffHtml(item.before.question_html, edits, "question", "after")}
        />
      ) : (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Question</h3>
          <MathHtml html={item.before.question_html} className="rounded-lg border p-3" />
        </section>
      )}

      {keyEdit && <KeyChange before={formatAnswer(item.before.answer)} after={keyEdit.replace} />}
      {typeEdit && <KeyChange before={typeEdit.find} after={typeEdit.replace} />}
      {!keyEdit && (
        <p className="text-sm text-muted-foreground">
          Answer key: <span className="font-mono font-semibold text-foreground">{formatAnswer(item.before.answer)}</span>
        </p>
      )}

      {changes("solution") ? (
        <SideBySide
          label="Solution"
          before={buildDiffHtml(item.before.solution_html, edits, "solution", "before")}
          after={buildDiffHtml(item.before.solution_html, edits, "solution", "after")}
        />
      ) : (
        <details className="group rounded-lg border">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Stored solution</summary>
          <MathHtml html={item.before.solution_html} className="border-t p-3" />
        </details>
      )}
    </div>
  )
}
