import type { Edit } from "@/api"
import { FIELD_LABELS } from "@/lib/cases"
import { stripHtml } from "@/lib/html"

/** One change as plain text: the field, the old text and the new text. */
export function EditDiff({ edit }: { edit: Edit }) {
  const isHtml = edit.field === "question" || edit.field === "solution"
  const before = isHtml ? stripHtml(edit.find) : edit.find
  const after = isHtml ? stripHtml(edit.replace) : edit.replace
  return (
    <div className="grid gap-1 rounded-xl bg-muted px-3 py-2.5 text-sm sm:grid-cols-[7rem_1fr]">
      <span className="text-xs text-muted-foreground">{FIELD_LABELS[edit.field]}</span>
      <span className="min-w-0 wrap-break-word">
        <del className="rounded bg-background px-1 text-bad">{before || "(nothing)"}</del>
        <span className="mx-1.5 text-muted-foreground" aria-label="changed to">→</span>
        <ins className="rounded bg-background px-1 font-medium text-good no-underline">{after || "(removed)"}</ins>
      </span>
    </div>
  )
}
