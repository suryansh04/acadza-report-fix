import type { CSSProperties, ReactNode } from "react"

import type { IconComponent } from "@/lib/pages"
import { cn } from "@/lib/utils"

export type Tone = "info" | "plain" | "good" | "warn" | "bad" | "muted"

const PILL_TONES: Record<Tone, string> = {
  info: "bg-period-bg text-period",
  plain: "bg-background text-period",
  good: "bg-live/10 text-live",
  warn: "bg-warn-bg text-warn",
  bad: "bg-bad/10 text-bad",
  muted: "bg-muted text-muted-foreground",
}

export function Pill({ tone = "info", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex w-fit shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-medium tracking-tight", PILL_TONES[tone], className)}>
      {children}
    </span>
  )
}

export function IconChip({ icon: Icon, color, className }: { icon: IconComponent; color: string; className?: string }) {
  return (
    <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md text-white", className)} style={{ backgroundColor: color }}>
      <Icon className="size-4" />
    </span>
  )
}

type PanelProps = {
  icon: IconComponent
  color: string
  title: ReactNode
  badge?: ReactNode
  tinted?: boolean
  className?: string
  children: ReactNode
}

export function Panel({ icon, color, title, badge, tinted = false, className, children }: PanelProps) {
  const tint: CSSProperties | undefined = tinted
    ? { backgroundImage: `linear-gradient(180deg, color-mix(in srgb, ${color} 8%, transparent) 0%, transparent 42%)` }
    : undefined
  return (
    <article className={cn("flex min-w-0 flex-col gap-4 rounded-2xl border p-4", className)} style={tint}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <IconChip icon={icon} color={color} />
          <h3 className="font-medium">{title}</h3>
        </div>
        {badge}
      </header>
      {children}
    </article>
  )
}
