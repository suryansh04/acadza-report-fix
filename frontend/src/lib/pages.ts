import type { ComponentType } from "react"
import { CheckCheck, Inbox, ScrollText, SearchCheck, Wrench } from "lucide-react"

import { HomeIcon } from "@/components/icons"
import type { Page } from "@/lib/navigation"

export type IconComponent = ComponentType<{ className?: string }>

export const PAGE_META: Record<Page, { label: string; icon: IconComponent }> = {
  home: { label: "Dashboard", icon: HomeIcon },
  "needs-you": { label: "Needs you", icon: Inbox },
  "auto-fixed": { label: "Auto-fixed", icon: Wrench },
  "no-change": { label: "No change", icon: CheckCheck },
  unreported: { label: "Unreported", icon: SearchCheck },
  audit: { label: "Audit log", icon: ScrollText },
}

export const NAV_GROUPS: { label: string; pages: Page[] }[] = [
  { label: "Overview", pages: ["home"] },
  { label: "Review", pages: ["needs-you", "auto-fixed", "no-change", "unreported"] },
  { label: "Records", pages: ["audit"] },
]
