import { useEffect, useMemo, useState } from "react"
import { ScrollText } from "lucide-react"

import { type Case, type Report, type TeacherAction, fetchAuditLog } from "@/api"
import { Pill, type Tone } from "@/components/Panel"
import { ACTION_LABELS, FIELD_LABELS, editKey, formatDateTime, queueForCase } from "@/lib/cases"
import type { Page } from "@/lib/navigation"

const ACTION_TONES: Record<TeacherAction["action"], Tone> = { approve: "good", edit: "info", reject: "bad", undo: "muted" }

function fieldNames(edits: TeacherAction["edits"]): string[] {
  return [...new Set(edits.map((edit) => FIELD_LABELS[edit.field]))]
}

/** What the teacher did, compared with what the engine proposed. An edit always saves the full fix, so only real differences count. */
function describeAction(entry: TeacherAction, report: Report | undefined): string {
  if (entry.action === "approve") return "Kept the engine's decision."
  if (entry.action === "reject") return "Turned down the engine's decision."
  if (entry.action === "undo") return entry.note || "Cancelled the previous decision."
  const proposed = report?.edits ?? []
  const proposedKeys = new Set(proposed.map(editKey))
  const savedKeys = new Set(entry.edits.map(editKey))
  const changed = fieldNames(entry.edits.filter((edit) => !proposedKeys.has(editKey(edit))))
  const dropped = fieldNames(proposed.filter((edit) => !savedKeys.has(editKey(edit)))).filter((field) => !changed.includes(field))
  const parts = [
    changed.length > 0 && `Changed: ${changed.join(", ")}.`,
    dropped.length > 0 && `Removed the suggested fix to: ${dropped.join(", ")}.`,
    report && entry.reply.trim() && entry.reply !== report.reply && "Rewrote the reply.",
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" ") : "Kept the suggested fix and reply."
}

type AuditLogPageProps = { cases: Case[]; refreshKey: number; onNavigate: (page: Page, questionId: string) => void }

export function AuditLogPage({ cases, refreshKey, onNavigate }: AuditLogPageProps) {
  const [entries, setEntries] = useState<TeacherAction[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const caseById = useMemo(() => new Map(cases.map((item) => [item.questionId, item])), [cases])
  const reportById = useMemo(() => new Map(cases.flatMap((item) => item.reports).map((report) => [report.report_id, report])), [cases])

  useEffect(() => {
    // Ignore an answer that arrives after a newer request started, so an old list never replaces a new one.
    let latest = true
    fetchAuditLog()
      .then((data) => {
        if (!latest) return
        setEntries(data)
        setError(null)
      })
      .catch((reason: Error) => latest && setError(reason.message))
    return () => {
      latest = false
    }
  }, [refreshKey])

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-medium md:text-2xl">Audit log</h1>
        <p className="text-muted-foreground">Every teacher action, newest first. Nothing is ever deleted: an undo is a new entry.</p>
      </header>
      {error && <p className="rounded-xl bg-bad/10 p-3 text-sm text-bad">Could not load the audit log: {error}</p>}
      {!entries && !error && <p className="text-muted-foreground">Loading the audit log…</p>}
      {entries?.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-10 text-muted-foreground"><ScrollText className="size-8" />No actions yet. They appear here as soon as you approve, edit or reject a report.</div>
      )}
      {entries && entries.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Who</th>
                <th className="px-4 py-3 font-medium">Report</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">What changed</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((entry) => {
                const item = caseById.get(entry.question_id)
                return (
                  <tr key={entry.id} className="align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums">{formatDateTime(entry.created_at)}</td>
                    <td className="px-4 py-3">{entry.reviewer}</td>
                    <td className="px-4 py-3">
                      {item ? (
                        <button type="button" className="flex flex-col items-start text-left hover:underline" onClick={() => onNavigate(queueForCase(item), item.questionId)}>
                          <span className="font-medium">{entry.report_id}</span>
                          <span className="text-[13px] text-muted-foreground">{item.subject} · {item.chapter}</span>
                        </button>
                      ) : entry.report_id}
                    </td>
                    <td className="px-4 py-3"><Pill tone={ACTION_TONES[entry.action]}>{ACTION_LABELS[entry.action]}</Pill></td>
                    <td className="px-4 py-3 text-muted-foreground">{describeAction(entry, reportById.get(entry.report_id))}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
