import { useEffect, useState } from "react"
import { ScrollText } from "lucide-react"

import { type TeacherAction, fetchAuditLog } from "@/api"
import { Badge } from "@/components/ui/badge"
import { FIELD_LABELS, formatDateTime } from "@/lib/cases"

const ACTION_TONE: Record<string, string> = {
  approve: "text-good bg-good/10",
  edit: "text-brand bg-brand/10",
  reject: "text-bad bg-bad/10",
  undo: "text-muted-foreground bg-muted",
}

export function AuditLogPage({ refreshKey }: { refreshKey: number }) {
  const [entries, setEntries] = useState<TeacherAction[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAuditLog().then(setEntries).catch((reason: Error) => setError(reason.message))
  }, [refreshKey])

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 md:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-muted-foreground">Every teacher action, newest first. Nothing is ever deleted: an undo is a new entry.</p>
      </header>
      {error && <p className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">Could not load the audit log: {error}</p>}
      {entries?.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-muted-foreground"><ScrollText className="size-8" />No actions yet. They appear here as soon as you approve, edit or reject a case.</div>
      )}
      {entries && entries.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr><th className="px-4 py-2 font-medium">When</th><th className="px-4 py-2 font-medium">Who</th><th className="px-4 py-2 font-medium">Report</th><th className="px-4 py-2 font-medium">Action</th><th className="px-4 py-2 font-medium">Details</th></tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((entry) => (
                <tr key={entry.id} className="align-top">
                  <td className="px-4 py-2 whitespace-nowrap tabular-nums text-muted-foreground">{formatDateTime(entry.created_at)}</td>
                  <td className="px-4 py-2">{entry.reviewer}</td>
                  <td className="px-4 py-2 font-mono">{entry.report_id}</td>
                  <td className="px-4 py-2"><Badge variant="outline" className={`border-transparent capitalize ${ACTION_TONE[entry.action] ?? ""}`}>{entry.action}</Badge></td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {entry.edits.map((edit) => FIELD_LABELS[edit.field]).join(", ") || "-"}
                    {entry.reply && <span className="block text-xs">Reply edited</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
