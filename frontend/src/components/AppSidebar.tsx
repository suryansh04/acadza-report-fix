import { useTheme } from "next-themes"

import { QuestionIcon, SidebarCollapseIcon, ToggleIcon } from "@/components/icons"
import { Input } from "@/components/ui/input"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { type Page, showShortcuts } from "@/lib/navigation"
import { NAV_GROUPS, PAGE_META } from "@/lib/pages"
import { cn } from "@/lib/utils"

const MENU_BUTTON = cn(
  "h-12 gap-2.5 rounded-xl border border-transparent px-3 text-base tracking-tight text-muted-foreground transition-colors",
  "data-active:border-border data-active:bg-background data-active:font-medium data-active:text-sidebar-accent-foreground data-active:shadow-[1px_2px_12px_rgba(158,158,158,0.08)]",
  "dark:data-active:border-transparent dark:data-active:bg-sidebar-accent dark:data-active:shadow-[1px_2px_12px_rgba(0,0,0,0.25)]",
  "hover:bg-sidebar-accent [&_svg]:size-5!",
  "group-data-[collapsible=icon]:size-11! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:[&>span]:hidden",
)

export function ReportFixLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="var(--brand)" />
      <path d="M7.5 12.5l3 3 6-7" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CollapseControl() {
  const { state, toggleSidebar } = useSidebar()
  if (state === "expanded") {
    return (
      <button type="button" onClick={toggleSidebar} aria-label="Collapse sidebar" className="flex size-9.5 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent">
        <SidebarCollapseIcon className="-rotate-90" />
      </button>
    )
  }
  // Collapsed: the logo shows, and turns into the expand button on hover.
  return (
    <div className="relative size-11 shrink-0">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center transition-all ease-linear group-hover:scale-75 group-hover:opacity-0">
        <ReportFixLogo className="size-6" />
      </div>
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label="Expand sidebar"
        className="absolute inset-0 flex scale-75 items-center justify-center rounded-lg opacity-0 transition-all ease-linear group-hover:scale-100 group-hover:opacity-100 hover:bg-sidebar-accent"
      >
        <SidebarCollapseIcon className="rotate-90" />
      </button>
    </div>
  )
}

function ReviewerCard({ reviewer, onReviewerChange }: { reviewer: string; onReviewerChange: (name: string) => void }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-[linear-gradient(347deg,var(--promo-from)_47.58%,var(--promo-to)_306.43%)] p-4 group-data-[collapsible=icon]:hidden">
      <span className="w-fit rounded-xl bg-primary px-2.5 py-1.5 text-xs font-medium tracking-tight text-primary-foreground">Reviewer</span>
      <div className="flex flex-col gap-1.5">
        <p className="font-semibold tracking-tight">{reviewer.trim() ? reviewer : "Add your name"}</p>
        <p className="text-sm tracking-tight text-muted-foreground">The audit log shows who approved each fix.</p>
      </div>
      <Input
        aria-label="Your name"
        value={reviewer}
        placeholder="e.g. Dr. Sharma"
        onChange={(event) => onReviewerChange(event.target.value)}
        className="h-11 rounded-xl bg-background px-3 dark:bg-background"
      />
    </div>
  )
}

type AppSidebarProps = {
  page: Page
  counts: Partial<Record<Page, number>>
  reviewer: string
  onReviewerChange: (name: string) => void
  onNavigate: (page: Page) => void
}

export function AppSidebar({ page, counts, reviewer, onReviewerChange, onNavigate }: AppSidebarProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const { state, isMobile, setOpenMobile } = useSidebar()
  const isDark = resolvedTheme === "dark"

  const open = (target: Page) => {
    onNavigate(target)
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="icon" className="h-full border-none">
      <SidebarHeader className={cn("h-16 flex-row items-center border-b border-sidebar-border md:h-20", state === "collapsed" ? "justify-start px-3" : "justify-between gap-4 px-4")}>
        {state === "expanded" && (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ReportFixLogo className="size-6 shrink-0" />
            <span className="truncate text-xl font-semibold tracking-tight">Report Fix</span>
          </div>
        )}
        <CollapseControl />
      </SidebarHeader>

      <SidebarContent className="gap-4 overflow-x-hidden px-3 py-4">
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label} className="gap-2 p-0">
            <SidebarGroupLabel className="h-auto px-3 py-1 text-base font-normal tracking-tight text-muted-foreground">{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-2">
                {group.pages.map((target) => {
                  const { label, icon: Icon } = PAGE_META[target]
                  const count = counts[target]
                  return (
                    <SidebarMenuItem key={target}>
                      <SidebarMenuButton isActive={page === target} tooltip={label} className={MENU_BUTTON} onClick={() => open(target)}>
                        <Icon />
                        <span>{label}</span>
                        {count !== undefined && (
                          <span className="ml-auto rounded bg-background px-2 py-1 text-sm text-muted-foreground tabular-nums drop-shadow-[0_0.0125rem_0.125rem_rgba(0,0,0,0.05)]">{count}</span>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="gap-6 border-t border-sidebar-border px-3 py-3">
        <ReviewerCard reviewer={reviewer} onReviewerChange={onReviewerChange} />
        <SidebarMenu className="gap-2">
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Shortcuts" className={MENU_BUTTON} onClick={showShortcuts}>
              <QuestionIcon />
              <span>Shortcuts</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={isDark ? "Light Mode" : "Dark Mode"} className={MENU_BUTTON} onClick={() => setTheme(isDark ? "light" : "dark")}>
              <ToggleIcon pressed={isDark} />
              <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
