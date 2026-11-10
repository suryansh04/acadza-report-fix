import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type ReviewerNameFormProps = {
  name: string
  onSave: (name: string) => void
  autoFocus?: boolean
}

export function ReviewerNameForm({ name, onSave, autoFocus = false }: ReviewerNameFormProps) {
  const [draft, setDraft] = useState(name)
  const cleaned = draft.trim()

  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (cleaned) onSave(cleaned)
      }}
    >
      <Input
        aria-label="Your name"
        value={draft}
        autoFocus={autoFocus}
        placeholder="e.g. Dr. Sharma"
        onChange={(event) => setDraft(event.target.value)}
        className="h-10 rounded-xl bg-background px-3 dark:bg-background"
      />
      <Button type="submit" className="h-10 rounded-xl px-4" disabled={!cleaned || cleaned === name}>Save</Button>
    </form>
  )
}
