import { ArrowRight } from "lucide-react"

import type { Edit } from "@/api"
import { FIELD_LABELS } from "@/lib/cases"
import { stripHtml } from "@/lib/html"

/** "Before → After" with plain labels. No strike line: a struck-out letter such as C is hard to read. */
export function BeforeAfterValue({ before, after }: { before: string; after: string }) {
  if (!before) return <span><span className="mr-1.5 text-xs text-muted-foreground">Adds</span><span className="rounded bg-good/15 px-1.5 py-0.5 font-medium text-good">{after}</span></span>
  if (!after) return <span><span className="mr-1.5 text-xs text-muted-foreground">Removes</span><span className="rounded bg-bad/10 px-1.5 py-0.5 text-bad">{before}</span></span>
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="min-w-0 wrap-break-word">
        <span className="mr-1.5 text-xs text-muted-foreground">Before</span>
        <span className="rounded bg-bad/10 px-1.5 py-0.5 text-bad">{before}</span>
      </span>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-label="changes to" />
      <span className="min-w-0 wrap-break-word">
        <span className="mr-1.5 text-xs text-muted-foreground">After</span>
        <span className="rounded bg-good/15 px-1.5 py-0.5 font-medium text-good">{after}</span>
      </span>
    </span>
  )
}

/** One change as plain text: the field, the old text and the new text. */
export function EditDiff({ edit }: { edit: Edit }) {
  const isHtml = edit.field === "question" || edit.field === "solution"
  const before = isHtml ? stripHtml(edit.find) : edit.find
  const after = isHtml ? stripHtml(edit.replace) : edit.replace
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-muted px-3 py-2.5 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{FIELD_LABELS[edit.field]}</span>
      <BeforeAfterValue before={before} after={after} />
    </div>
  )
}
