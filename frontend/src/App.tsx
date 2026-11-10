import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react"
import { ThemeProvider } from "next-themes"
import { toast } from "sonner"

import { type Case, fetchCases, fetchHealth, saveAction } from "@/api"
import { AppSidebar } from "@/components/AppSidebar"
import type { SubmitAction } from "@/components/ReportCard"
import { Topbar } from "@/components/Topbar"
import { SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { casesInQueue, reportState } from "@/lib/cases"
import { type Page, showShortcuts, useLocation, useReviewerName } from "@/lib/navigation"
import { AuditLogPage } from "@/pages/AuditLogPage"
import { HomePage } from "@/pages/HomePage"
import { ReviewPage } from "@/pages/ReviewPage"
import { UnreportedPage } from "@/pages/UnreportedPage"

const SIDEBAR_SIZE = { "--sidebar-width": "18.125rem", "--sidebar-width-icon": "4.25rem" } as CSSProperties
const REVIEW_PAGES: Page[] = ["needs-you", "auto-fixed", "no-change"]

function Console() {
  const [location, navigate] = useLocation()
  const [reviewer, setReviewer] = useReviewerName()
  const [cases, setCases] = useState<Case[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [auditVersion, setAuditVersion] = useState(0)
  const [database, setDatabase] = useState<string | null>("")

  const loadCases = useCallback(() => {
    fetchCases().then((data) => { setCases(data); setLoadError(null) }).catch((error: Error) => setLoadError(error.message))
  }, [])

  useEffect(loadCases, [loadCases])

  useEffect(() => {
    fetchHealth().then((health) => setDatabase(health.database)).catch(() => setDatabase(null))
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "?" && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) showShortcuts()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const submit: SubmitAction = useCallback(async (report, action, extra) => {
    if (!reviewer.trim()) {
      toast.error("Add your name in the Reviewer card in the sidebar first, so the audit log shows who acted.")
      return null
    }
    try {
      const result = await saveAction({ report_id: report.report_id, action, reviewer, edits: extra?.edits, reply: extra?.reply, save_anyway: extra?.saveAnyway })
      if (result.saved) {
        loadCases()
        setAuditVersion((version) => version + 1)
        if (action !== "undo") {
          toast.success(`${report.report_id}: ${action === "approve" ? "approved" : action === "edit" ? "edit saved" : "rejected"}`, {
            action: { label: "Undo", onClick: () => void submit(report, "undo") },
          })
        }
      }
      return result
    } catch (error) {
      toast.error(`Could not save: ${(error as Error).message}`)
      return null
    }
  }, [reviewer, loadCases])

  const counts = useMemo(() => ({
    "needs-you": cases ? casesInQueue(cases, "needs-you").length : 0,
    "auto-fixed": cases ? casesInQueue(cases, "auto-fixed").length : 0,
    "no-change": cases ? casesInQueue(cases, "no-change").length : 0,
    unreported: cases ? cases.reduce((total, item) => total + item.other_defects.length, 0) : 0,
  }), [cases])
  const openReports = cases ? cases.flatMap((item) => item.reports).filter((report) => reportState(report) === "needs_you").length : 0

  const { page, questionId } = location
  const renderPage = () => {
    if (loadError) return <p className="rounded-xl bg-bad/10 p-4 text-sm text-bad">Could not load the cases: {loadError}. Check that the backend is running.</p>
    if (!cases) return <p className="text-muted-foreground">Loading cases…</p>
    if (page === "home") return <HomePage cases={cases} reviewer={reviewer} onNavigate={(target, id) => navigate(target, id)} />
    if (page === "unreported") return <UnreportedPage cases={cases} />
    if (page === "audit") return <AuditLogPage refreshKey={auditVersion} />
    return <ReviewPage cases={cases} queue={page} selectedId={questionId} onSelect={(id) => navigate(page, id)} onSubmit={submit} />
  }

  return (
    <SidebarProvider defaultOpen className="h-svh overflow-hidden" style={SIDEBAR_SIZE}>
      <AppSidebar page={page} counts={counts} reviewer={reviewer} onReviewerChange={setReviewer} onNavigate={(target) => navigate(target)} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar page={page} cases={cases ?? []} openReports={openReports} reviewer={reviewer} database={database} onNavigate={navigate} />
        {REVIEW_PAGES.includes(page) && cases ? (
          <div className="min-h-0 flex-1">{renderPage()}</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-10">{renderPage()}</div>
        )}
      </main>
      <Toaster position="bottom-right" />
    </SidebarProvider>
  )
}

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <TooltipProvider>
        <Console />
      </TooltipProvider>
    </ThemeProvider>
  )
}
