import { CheckCheck, ClipboardList, Home, Inbox, Moon, ScrollText, SearchCheck, Sun, Wrench } from "lucide-react"
import { useTheme } from "next-themes"

import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import type { Page } from "@/lib/navigation"

type NavItem = { page: Page; label: string; icon: typeof Home; count?: number }

type AppSidebarProps = {
  page: Page
  counts: Record<"needs-you" | "auto-fixed" | "no-change" | "unreported", number>
  reviewer: string
  onReviewerChange: (name: string) => void
  onNavigate: (page: Page) => void
}

export function AppSidebar({ page, counts, reviewer, onReviewerChange, onNavigate }: AppSidebarProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const reviewItems: NavItem[] = [
    { page: "needs-you", label: "Needs you", icon: Inbox, count: counts["needs-you"] },
    { page: "auto-fixed", label: "Auto-fixed", icon: Wrench, count: counts["auto-fixed"] },
    { page: "no-change", label: "No change", icon: CheckCheck, count: counts["no-change"] },
    { page: "unreported", label: "Unreported", icon: SearchCheck, count: counts.unreported },
  ]

  const renderItem = (item: NavItem) => (
    <SidebarMenuItem key={item.page}>
      <SidebarMenuButton isActive={page === item.page} tooltip={item.label} onClick={() => onNavigate(item.page)}>
        <item.icon />
        <span>{item.label}</span>
      </SidebarMenuButton>
      {item.count !== undefined && <SidebarMenuBadge className="tabular-nums">{item.count}</SidebarMenuBadge>}
    </SidebarMenuItem>
  )

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ClipboardList className="size-4" />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-semibold">Report Fix</p>
            <p className="truncate text-xs text-muted-foreground">Acadza question review</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>{renderItem({ page: "home", label: "Home", icon: Home })}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Review</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{reviewItems.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Records</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItem({ page: "audit", label: "Audit log", icon: ScrollText })}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-3 group-data-[collapsible=icon]:hidden">
        <label className="flex flex-col gap-1.5 px-2 text-xs text-muted-foreground" htmlFor="reviewer-name">
          Your name (for the audit log)
          <Input id="reviewer-name" value={reviewer} placeholder="e.g. Dr. Sharma" onChange={(event) => onReviewerChange(event.target.value)} />
        </label>
        <div className="flex items-center justify-between px-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">Shortcuts <Kbd>?</Kbd></span>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-sidebar-accent"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            {resolvedTheme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            {resolvedTheme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
