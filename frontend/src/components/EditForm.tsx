import { Plus, X } from "lucide-react"

import type { Edit, QuestionVersion } from "@/api"
import { MathHtml } from "@/components/ChangePreview"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FIELD_LABELS, QUESTION_TYPE_LABELS, formatAnswer } from "@/lib/cases"

const FIELDS: Edit["field"][] = ["question", "solution", "answer", "questionType"]

function currentValue(current: QuestionVersion, field: Edit["field"]): string {
  if (field === "question") return current.question_html
  if (field === "solution") return current.solution_html
  if (field === "answer") return formatAnswer(current.answer)
  return current.questionType
}

type FieldEditorProps = { id: string; edit: Edit; current: QuestionVersion; autoFocus: boolean; onChange: (edit: Edit) => void }

function FieldEditor({ id, edit, current, autoFocus, onChange }: FieldEditorProps) {
  if (edit.field === "answer") {
    return (
      <>
        <Input id={id} autoFocus={autoFocus} value={edit.replace} onChange={(event) => onChange({ ...edit, replace: event.target.value })} className="font-mono" />
        <p className="text-xs text-muted-foreground">Now: <span className="font-mono">{edit.find || "-"}</span>. For more than one answer, write them with commas, for example "A, C".</p>
      </>
    )
  }
  if (edit.field === "questionType") {
    return (
      <select
        id={id}
        autoFocus={autoFocus}
        value={edit.replace}
        onChange={(event) => onChange({ ...edit, replace: event.target.value })}
        className="h-9 w-fit rounded-lg border border-input bg-transparent px-2.5 text-sm"
      >
        {Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    )
  }
  // A whole-field change (added by the teacher) needs only the new text. A partial one (from the engine) shows both parts.
  const wholeField = edit.find === currentValue(current, edit.field)
  return (
    <>
      {!wholeField && (
        <>
          <p className="text-xs text-muted-foreground">Replace this text:</p>
          <Textarea aria-label="Text to replace" value={edit.find} onChange={(event) => onChange({ ...edit, find: event.target.value })} className="font-mono text-xs" />
          <p className="text-xs text-muted-foreground">With:</p>
        </>
      )}
      <Textarea id={id} autoFocus={autoFocus} value={edit.replace} onChange={(event) => onChange({ ...edit, replace: event.target.value })} className="min-h-24 font-mono text-xs" />
      {edit.replace && (
        <div className="rounded-xl bg-muted px-3 py-2">
          <p className="mb-1 text-xs text-muted-foreground">Preview</p>
          <MathHtml html={edit.replace} className="text-sm" />
        </div>
      )}
    </>
  )
}

type EditFormProps = { reportId: string; edits: Edit[]; current: QuestionVersion; onChange: (edits: Edit[]) => void }

/** The teacher can change any field: the engine's suggested edits, or a new change to the question, solution, key or type. */
export function EditForm({ reportId, edits, current, onChange }: EditFormProps) {
  const missingFields = FIELDS.filter((field) => !edits.some((edit) => edit.field === field))
  const addField = (field: Edit["field"]) => {
    const value = currentValue(current, field)
    onChange([...edits, { field, find: value, replace: value }])
  }

  return (
    <div className="flex flex-col gap-3">
      {edits.map((edit, index) => {
        const id = `edit-${reportId}-${index}`
        return (
          <div key={`${edit.field}-${index}`} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[13px] font-medium text-muted-foreground" htmlFor={id}>
                {edit.field === "question" || edit.field === "solution"
                  ? `${edit.find === currentValue(current, edit.field) ? "Full" : "New"} ${FIELD_LABELS[edit.field].toLowerCase()} text`
                  : `New ${FIELD_LABELS[edit.field].toLowerCase()}`}
              </label>
              <Button variant="ghost" className="h-7 rounded-md px-2 text-xs text-muted-foreground" onClick={() => onChange(edits.filter((_, position) => position !== index))}>
                <X className="size-3.5" /> Remove
              </Button>
            </div>
            <FieldEditor id={id} edit={edit} current={current} autoFocus={index === 0}
              onChange={(changed) => onChange(edits.map((item, position) => (position === index ? changed : item)))} />
          </div>
        )
      })}
      {missingFields.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] text-muted-foreground">Change another field:</span>
          {missingFields.map((field) => (
            <Button key={field} variant="outline" className="h-7 rounded-md px-2 text-xs" onClick={() => addField(field)}>
              <Plus className="size-3.5" /> {FIELD_LABELS[field]}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
