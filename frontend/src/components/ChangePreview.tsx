import { type Ref, type RefObject, useEffect, useMemo, useRef } from "react"

import type { Case, Edit } from "@/api"
import { AnswerCheck } from "@/components/AnswerCheck"
import { BeforeAfterValue } from "@/components/EditDiff"
import { correctOptionLetters, formatAnswer } from "@/lib/cases"
import { buildDiffHtml, sanitizeHtml, stripHtml } from "@/lib/html"
import { cn } from "@/lib/utils"

// The name ties the ranges below to the ::highlight(correct-option) style in index.css.
const CORRECT_OPTION_HIGHLIGHT = "correct-option"
const OPTION_MARKER = /\(\s*([A-D])\s*\)/g

export function MathHtml({ html, className, ref }: { html: string; className?: string; ref?: Ref<HTMLDivElement> }) {
  // MathML renders natively in the browser. sanitizeHtml removes scripts and event handlers first.
  const clean = useMemo(() => sanitizeHtml(html), [html])
  return <div ref={ref} className={cn("question-html", className)} dangerouslySetInnerHTML={{ __html: clean }} />
}

type OptionLabel = { letter: string; index: number }

/** The option labels: the last "(A)" and the "(B)", "(C)", "(D)" that follow it in order. An earlier marker,
 *  such as "Assertion (A)" or a column in a matching question, is part of the question text, not an option. */
function findOptionLabels(text: string): OptionLabel[] {
  const markers = [...text.matchAll(OPTION_MARKER)].map((match) => ({ letter: match[1], index: match.index }))
  const start = markers.map((marker) => marker.letter).lastIndexOf("A")
  if (start === -1) return []
  const labels = [markers[start]]
  for (const marker of markers.slice(start + 1)) {
    if (marker.letter.charCodeAt(0) === labels[labels.length - 1].letter.charCodeAt(0) + 1) labels.push(marker)
  }
  return labels
}

function canHighlightOptions(html: string, letters: string): boolean {
  return Boolean(letters) && "highlights" in CSS && findOptionLabels(stripHtml(html)).some((label) => letters.includes(label.letter))
}

function positionAt(nodes: Text[], starts: number[], offset: number): [Text, number] {
  let index = 0
  while (index + 1 < nodes.length && starts[index + 1] < offset) index++
  return [nodes[index], offset - starts[index]]
}

/** Colours the correct options green. The Highlight API marks text ranges without changing the stored HTML,
 *  so options split across many spans and line breaks still work. Browsers without it show no colour. */
function useCorrectOptionHighlight(container: RefObject<HTMLDivElement | null>, letters: string, html: string): void {
  useEffect(() => {
    const root = container.current
    if (!root || !letters || !("highlights" in CSS)) return
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    const starts: number[] = []
    let text = ""
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      starts.push(text.length)
      nodes.push(node as Text)
      text += node.textContent ?? ""
    }
    const labels = findOptionLabels(text)
    const ranges = labels.flatMap((marker, index) => {
      if (!letters.includes(marker.letter)) return []
      let end = index + 1 < labels.length ? labels[index + 1].index : text.length
      while (end > marker.index && /\s/.test(text[end - 1])) end--
      const range = document.createRange()
      range.setStart(...positionAt(nodes, starts, marker.index))
      range.setEnd(...positionAt(nodes, starts, end))
      return [range]
    })
    CSS.highlights.set(CORRECT_OPTION_HIGHLIGHT, new Highlight(...ranges))
    return () => {
      CSS.highlights.delete(CORRECT_OPTION_HIGHLIGHT)
    }
  }, [container, letters, html])
}

function QuestionText({ html, letters, className }: { html: string; letters: string; className?: string }) {
  const container = useRef<HTMLDivElement>(null)
  useCorrectOptionHighlight(container, letters, html)
  return <MathHtml ref={container} html={html} className={className} />
}

function BeforeAfterText({ label, before, after, letters = "" }: { label: string; before: string; after: string; letters?: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-sm font-medium text-muted-foreground">{label}</h4>
      <div className="grid gap-3 @xl:grid-cols-2">
        <div className="min-w-0 rounded-xl bg-muted p-3 ring-1 ring-bad/20">
          <p className="mb-1.5 text-xs font-medium text-bad">Before</p>
          <MathHtml html={before} />
        </div>
        <div className="min-w-0 rounded-xl bg-muted p-3 ring-1 ring-good/25">
          <p className="mb-1.5 text-xs font-medium text-good">After</p>
          <QuestionText html={after} letters={letters} />
        </div>
      </div>
    </section>
  )
}

function ValueRow({ label, value, change, note }: { label: string; value: string; change?: Edit; note?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-muted px-3 py-2.5 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      {change && change.replace !== value ? <BeforeAfterValue before={value} after={change.replace} /> : <span className="font-semibold">{value}</span>}
      {/* For example one stored string "A, B, D" becomes three separate letters. */}
      {change?.replace === value && <span className="text-xs text-muted-foreground">Same answer. The fix changes only how it is stored.</span>}
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  )
}

type ChangePreviewProps = { item: Case; edits: Edit[]; solutionOpen: boolean; onSolutionToggle: (open: boolean) => void }

/** The question, its key and its solution in reading order. Each proposed edit is marked where it applies. */
export function ChangePreview({ item, edits, solutionOpen, onSolutionToggle }: ChangePreviewProps) {
  const changes = (field: "question" | "solution") => edits.some((edit) => edit.field === field)
  const typeEdit = edits.find((edit) => edit.field === "questionType")
  const letters = correctOptionLetters(item, edits).join("")
  const shownQuestion = changes("question") ? buildDiffHtml(item.before.question_html, edits, "question", "after") : item.before.question_html

  return (
    <div className="@container flex flex-col gap-3">
      {changes("question") ? (
        <BeforeAfterText
          label="Question"
          before={buildDiffHtml(item.before.question_html, edits, "question", "before")}
          after={buildDiffHtml(item.before.question_html, edits, "question", "after")}
          letters={letters}
        />
      ) : (
        <QuestionText html={item.before.question_html} letters={letters} className="rounded-xl bg-muted p-4" />
      )}

      <ValueRow label="Answer key" value={formatAnswer(item.before.answer)} change={edits.find((edit) => edit.field === "answer")}
        note={canHighlightOptions(shownQuestion, letters) ? "The correct option is green in the question." : undefined} />
      {typeEdit && <ValueRow label="Question type" value={typeEdit.find} change={typeEdit} />}
      <AnswerCheck vote={item.vote} />

      {changes("solution") ? (
        <BeforeAfterText
          label="Solution"
          before={buildDiffHtml(item.before.solution_html, edits, "solution", "before")}
          after={buildDiffHtml(item.before.solution_html, edits, "solution", "after")}
        />
      ) : (
        <details className="rounded-xl bg-muted" open={solutionOpen} onToggle={(event) => onSolutionToggle(event.currentTarget.open)}>
          <summary className="px-3 py-2.5 text-sm font-medium text-muted-foreground">Stored solution <span className="font-normal">(press S)</span></summary>
          <MathHtml html={item.before.solution_html} className="border-t px-4 py-3" />
        </details>
      )}
    </div>
  )
}
