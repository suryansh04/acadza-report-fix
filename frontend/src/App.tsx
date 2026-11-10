import { useCallback, useEffect, useMemo, useState } from "react"
import { ThemeProvider } from "next-themes"
import { toast } from "sonner"

import { type Case, fetchCases, saveAction } from "@/api"
import { AppSidebar } from "@/components/AppSidebar"
import type { SubmitAction } from "@/components/ReportCard"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { casesInQueue } from "@/lib/cases"
import { type Page, useLocation, useReviewerName } from "@/lib/navigation"
import { AuditLogPage } from "@/pages/AuditLogPage"
import { HomePage } from "@/pages/HomePage"
import { ReviewPage } from "@/pages/ReviewPage"
import { UnreportedPage } from "@/pages/UnreportedPage"

const PAGE_TITLES: Record<Page, string> = {
  home: "Home",
  "needs-you": "Needs you",
  "auto-fixed": "Auto-fixed",
  "no-change": "No change",
  unreported: "Unreported",
  audit: "Audit log",
}

const SHORTCUTS = "J / K: next or previous question · A: approve · E: edit · R: reject"

function Console() {
  const [location, navigate] = useLocation()
  const [reviewer, setReviewer] = useReviewerName()
  const [cases, setCases] = useState<Case[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [auditVersion, setAuditVersion] = useState(0)

  const loadCases = useCallback(() => {
    fetchCases().then((data) => { setCases(data); setLoadError(null) }).catch((error: Error) => setLoadError(error.message))
  }, [])

  useEffect(loadCases, [loadCases])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "?" && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) toast(SHORTCUTS)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const submit: SubmitAction = useCallback(async (report, action, extra) => {
    if (!reviewer.trim()) {
      toast.error("Add your name in the sidebar first, so the audit log shows who acted.")
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

  const { page, questionId } = location
  const renderPage = () => {
    if (loadError) return <p className="m-6 rounded-lg border border-bad/40 bg-bad/10 p-4 text-sm text-bad">Could not load the cases: {loadError}. Check that the backend is running.</p>
    if (!cases) return <p className="m-6 text-muted-foreground">Loading cases…</p>
    if (page === "home") return <HomePage cases={cases} reviewer={reviewer} onNavigate={(target, id) => navigate(target, id)} />
    if (page === "unreported") return <UnreportedPage cases={cases} />
    if (page === "audit") return <AuditLogPage refreshKey={auditVersion} />
    return <ReviewPage cases={cases} queue={page} selectedId={questionId} onSelect={(id) => navigate(page, id)} onSubmit={submit} />
  }

  return (
    <SidebarProvider className="h-svh">
      <AppSidebar page={page} counts={counts} reviewer={reviewer} onReviewerChange={setReviewer} onNavigate={(target) => navigate(target)} />
      <SidebarInset className="flex min-h-0 flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <h1 className="text-sm font-medium">{PAGE_TITLES[page]}</h1>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{renderPage()}</main>
      </SidebarInset>
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
