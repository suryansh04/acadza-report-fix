import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ThemeProvider } from "next-themes"
import { toast } from "sonner"

import { type Case, type Report, type TeacherAction, fetchCases, fetchHealth, saveAction, saveBulkAction } from "@/api"
import { AppSidebar } from "@/components/AppSidebar"
import type { SubmitAction } from "@/components/ReportCard"
import { ShortcutsDialog } from "@/components/ShortcutsDialog"
import { Topbar } from "@/components/Topbar"
import { SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ACTION_LABELS, type SessionStats, caseIsFinished, casesInQueue, reportState } from "@/lib/cases"
import { type Page, shouldIgnoreShortcut, useLocation, useReviewerName } from "@/lib/navigation"
import { AuditLogPage } from "@/pages/AuditLogPage"
import { HomePage } from "@/pages/HomePage"
import { ReviewPage } from "@/pages/ReviewPage"
import { UnreportedPage } from "@/pages/UnreportedPage"

const SIDEBAR_SIZE = { "--sidebar-width": "18.125rem", "--sidebar-width-icon": "4.25rem" } as CSSProperties
const REVIEW_PAGES: Page[] = ["needs-you", "auto-fixed", "no-change"]

export type ConfirmAll = (reports: Report[]) => Promise<boolean>

function Console() {
  const [location, navigate] = useLocation()
  const [reviewer, setReviewer] = useReviewerName()
  const [cases, setCases] = useState<Case[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [auditVersion, setAuditVersion] = useState(0)
  const [database, setDatabase] = useState<string | null>("")
  const [profileOpen, setProfileOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [session, setSession] = useState<SessionStats>({ decisions: 0, startedAt: null })
  // The reports of the last decision, so U can undo it from anywhere.
  const lastDecision = useRef<Report[] | null>(null)

  useEffect(() => {
    fetchCases().then(setCases).catch((error: Error) => setLoadError(error.message))
    fetchHealth().then((health) => setDatabase(health.database)).catch(() => setDatabase(null))
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "?" && !shouldIgnoreShortcut(event)) setShortcutsOpen(true)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  // The server answer is the new state of each report, so the screen updates without reloading every case.
  const applyDecisions = useCallback((decisions: Map<string, TeacherAction | null>, change: number) => {
    setCases((current) => current && current.map((item) => ({
      ...item,
      reports: item.reports.map((report) => (decisions.has(report.report_id) ? { ...report, teacher_action: decisions.get(report.report_id) ?? null } : report)),
    })))
    setAuditVersion((version) => version + 1)
    setSession((current) => ({ decisions: Math.max(0, current.decisions + change), startedAt: current.startedAt ?? Date.now() }))
  }, [])

  const hasReviewer = useCallback(() => {
    if (reviewer.trim()) return true
    setProfileOpen(true)
    toast.error("Add your name first, so the audit log shows who acted.")
    return false
  }, [reviewer])

  const undo = useCallback(async (reports: Report[]): Promise<TeacherAction[] | null> => {
    if (!hasReviewer()) return null
    try {
      const entries = await saveBulkAction(reports.map((report) => report.report_id), "undo", reviewer)
      applyDecisions(new Map(entries.map((entry) => [entry.report_id, null])), -entries.length)
      lastDecision.current = null
      toast(entries.length === 1 ? `${entries[0].report_id}: undone. It is open again.` : `${entries.length} decisions undone.`)
      return entries
    } catch (error) {
      toast.error(`Could not undo: ${(error as Error).message}`)
      return null
    }
  }, [reviewer, hasReviewer, applyDecisions])

  const submit: SubmitAction = useCallback(async (report, action, extra) => {
    if (action === "undo") {
      const entries = await undo([report])
      return entries ? { saved: true, entry: entries[0] } : null
    }
    if (!hasReviewer()) return null
    try {
      const result = await saveAction({ report_id: report.report_id, action, reviewer, edits: extra?.edits, reply: extra?.reply, save_anyway: extra?.saveAnyway })
      if (!result.saved) return result
      applyDecisions(new Map([[report.report_id, result.entry]]), 1)
      lastDecision.current = [report]
      toast.success(`${report.report_id}: ${ACTION_LABELS[action].toLowerCase()}`, { action: { label: "Undo", onClick: () => void undo([report]) } })
      return result
    } catch (error) {
      toast.error(`Could not save: ${(error as Error).message}`)
      return null
    }
  }, [reviewer, hasReviewer, applyDecisions, undo])

  const confirmAll: ConfirmAll = useCallback(async (reports) => {
    if (reports.length === 0 || !hasReviewer()) return false
    try {
      const entries = await saveBulkAction(reports.map((report) => report.report_id), "approve", reviewer)
      applyDecisions(new Map(entries.map((entry) => [entry.report_id, entry])), entries.length)
      lastDecision.current = reports
      toast.success(`${entries.length} reports confirmed`, { action: { label: "Undo all", onClick: () => void undo(reports) } })
      return true
    } catch (error) {
      toast.error(`Could not save: ${(error as Error).message}`)
      return false
    }
  }, [reviewer, hasReviewer, applyDecisions, undo])

  const { page, questionId } = location

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "u" || shouldIgnoreShortcut(event)) return
      const last = lastDecision.current
      if (!last) {
        toast("Nothing to undo yet.")
        return
      }
      void undo(last)
      if (last.length === 1 && REVIEW_PAGES.includes(page)) navigate(page, last[0].question_id)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [undo, page, navigate])

  const counts = useMemo(() => ({
    // Questions still open in each queue, so the badges count down like an inbox.
    "needs-you": cases ? casesInQueue(cases, "needs-you").length : 0,
    "auto-fixed": cases ? casesInQueue(cases, "auto-fixed").filter((item) => !caseIsFinished(item, "auto-fixed")).length : 0,
    "no-change": cases ? casesInQueue(cases, "no-change").filter((item) => !caseIsFinished(item, "no-change")).length : 0,
    unreported: cases ? cases.reduce((total, item) => total + item.other_defects.length, 0) : 0,
  }), [cases])
  const openReports = cases ? cases.flatMap((item) => item.reports).filter((report) => reportState(report) === "needs_you").length : 0

  const renderPage = () => {
    if (loadError) return <p className="rounded-xl bg-bad/10 p-4 text-sm text-bad">Could not load the cases: {loadError}. Check that the backend is running.</p>
    if (!cases) return <p className="text-muted-foreground">Loading cases…</p>
    if (page === "home") return <HomePage cases={cases} reviewer={reviewer} onNavigate={navigate} />
    if (page === "unreported") return <UnreportedPage cases={cases} onNavigate={navigate} />
    if (page === "audit") return <AuditLogPage cases={cases} refreshKey={auditVersion} onNavigate={navigate} />
    return (
      <ReviewPage key={page} cases={cases} queue={page} selectedId={questionId} session={session}
        onSelect={(id, replace) => navigate(page, id, replace)} onNavigate={navigate} onSubmit={submit} onConfirmAll={confirmAll} />
    )
  }

  return (
    <SidebarProvider defaultOpen className="h-svh overflow-hidden" style={SIDEBAR_SIZE}>
      <AppSidebar page={page} counts={counts} reviewer={reviewer} onReviewerChange={setReviewer} onNavigate={navigate} onShowShortcuts={() => setShortcutsOpen(true)} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar page={page} cases={cases ?? []} openReports={openReports} reviewer={reviewer} database={database} profileOpen={profileOpen}
          onProfileOpenChange={setProfileOpen} onReviewerChange={setReviewer} onNavigate={navigate} />
        {REVIEW_PAGES.includes(page) && cases ? (
          <div className="min-h-0 flex-1">{renderPage()}</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-10">{renderPage()}</div>
        )}
      </main>
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
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
