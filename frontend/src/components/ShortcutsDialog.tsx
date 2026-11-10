import { X } from "lucide-react"

import { Kbd } from "@/components/ui/kbd"
import { useKeydown } from "@/hooks/use-keydown"

const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ["J"], action: "Next question" },
  { keys: ["K"], action: "Previous question" },
  { keys: ["A"], action: "Approve, keep the fix, or agree" },
  { keys: ["E"], action: "Edit the fix or the reply" },
  { keys: ["R"], action: "Reject, undo the fix, or disagree" },
  { keys: ["U"], action: "Undo your last decision" },
  { keys: ["Ctrl", "Enter"], action: "Save an edit" },
  { keys: ["Esc"], action: "Cancel an edit or close a menu" },
  { keys: ["Ctrl", "K"], action: "Search questions" },
  { keys: ["?"], action: "Show this list" },
]

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useKeydown((event) => {
    if (event.key === "Escape" || event.key === "?") onClose()
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-in fade-in" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="flex w-full max-w-md flex-col gap-4 rounded-2xl border bg-popover p-5 shadow-xl animate-in zoom-in-95 motion-reduce:animate-none"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-lg font-medium">Keyboard shortcuts</h2>
          <button type="button" aria-label="Close" autoFocus onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
            <X className="size-4" />
          </button>
        </header>
        <p className="text-sm text-muted-foreground">Review a whole queue without the mouse: read, press A, and the next question opens.</p>
        <ul className="flex flex-col divide-y rounded-xl bg-muted px-3">
          {SHORTCUTS.map(({ keys, action }) => (
            <li key={action} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>{action}</span>
              <span className="flex gap-1">{keys.map((key) => <Kbd key={key}>{key}</Kbd>)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
