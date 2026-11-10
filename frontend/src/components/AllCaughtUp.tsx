import { ArrowRight, PartyPopper } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { QueueName, SessionStats } from "@/lib/cases"
import type { Page } from "@/lib/navigation"

const NEXT_STEP: Record<QueueName, { label: string; page: Page }> = {
  "needs-you": { label: "Check the auto-fixes", page: "auto-fixed" },
  "auto-fixed": { label: "Check the no-change queue", page: "no-change" },
  "no-change": { label: "See unreported defects", page: "unreported" },
}

function describeSession({ decisions, startedAt }: SessionStats): string {
  if (decisions === 0 || startedAt === null) return "Every report in this queue has a decision."
  const minutes = Math.round((Date.now() - startedAt) / 60_000)
  const time = minutes < 1 ? "under a minute" : `${minutes} min`
  return `You made ${decisions} decision${decisions === 1 ? "" : "s"} in ${time}. Each one is in the audit log.`
}

type AllCaughtUpProps = { queue: QueueName; session: SessionStats; onNavigate: (page: Page) => void }

export function AllCaughtUp({ queue, session, onNavigate }: AllCaughtUpProps) {
  const next = NEXT_STEP[queue]
  return (
    <div className="flex h-full min-h-80 flex-col items-center justify-center gap-5 rounded-2xl border bg-[radial-gradient(circle_at_50%_30%,var(--period-bg),transparent_60%)] p-10 text-center animate-in fade-in zoom-in-95 duration-500 motion-reduce:animate-none">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-live/10 text-live">
        <PartyPopper className="size-8" />
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-medium">All caught up</h2>
        <p className="max-w-sm text-muted-foreground">{describeSession(session)}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button className="h-10 rounded-xl px-4" onClick={() => onNavigate(next.page)}>{next.label} <ArrowRight /></Button>
        <Button variant="outline" className="h-10 rounded-xl px-4" onClick={() => onNavigate("home")}>Dashboard</Button>
      </div>
    </div>
  )
}
