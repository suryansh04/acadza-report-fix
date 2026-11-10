import { ArrowRight } from "lucide-react"

import type { Case, Edit } from "@/api"
import { formatAnswer } from "@/lib/cases"
import { buildDiffHtml, sanitizeHtml } from "@/lib/html"
import { cn } from "@/lib/utils"

export function MathHtml({ html, className }: { html: string; className?: string }) {
  // MathML renders natively in the browser. sanitizeHtml removes scripts and event handlers first.
  return <div className={cn("question-html", className)} dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
}

function SideBySide({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-sm font-medium text-muted-foreground">{label}</h4>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="min-w-0 rounded-xl bg-muted p-3 ring-1 ring-bad/20">
          <p className="mb-1.5 text-xs font-medium text-bad">Before</p>
          <MathHtml html={before} />
        </div>
        <div className="min-w-0 rounded-xl bg-muted p-3 ring-1 ring-good/25">
          <p className="mb-1.5 text-xs font-medium text-good">After</p>
          <MathHtml html={after} />
        </div>
      </div>
    </section>
  )
}

function KeyChange({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted px-3 py-2.5">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="rounded-lg bg-bad/10 px-2.5 py-1 font-mono text-sm font-semibold text-bad" title="Before">{before}</span>
      <ArrowRight className="size-4 text-muted-foreground" />
      <span className="rounded-lg bg-good/15 px-2.5 py-1 font-mono text-sm font-semibold text-good" title="After">{after}</span>
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
        <MathHtml html={item.before.question_html} className="rounded-xl bg-muted p-4" />
      )}

      {keyEdit && <KeyChange label="Answer key" before={formatAnswer(item.before.answer)} after={keyEdit.replace} />}
      {typeEdit && <KeyChange label="Question type" before={typeEdit.find} after={typeEdit.replace} />}
      {!keyEdit && (
        <p className="flex items-center gap-3 rounded-xl bg-muted px-3 py-2.5 text-sm font-medium text-muted-foreground">
          Answer key <span className="font-mono font-semibold text-foreground">{formatAnswer(item.before.answer)}</span>
        </p>
      )}

      {changes("solution") ? (
        <SideBySide
          label="Solution"
          before={buildDiffHtml(item.before.solution_html, edits, "solution", "before")}
          after={buildDiffHtml(item.before.solution_html, edits, "solution", "after")}
        />
      ) : (
        <details className="rounded-xl bg-muted">
          <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium text-muted-foreground">Stored solution</summary>
          <MathHtml html={item.before.solution_html} className="border-t px-4 py-3" />
        </details>
      )}
    </div>
  )
}
