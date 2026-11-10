import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ThemeProvider } from "next-themes"
import { toast } from "sonner"

import { type Case, ConflictError, type Report, type TeacherAction, approveMany, fetchCases, fetchHealth, saveAction, undoDecisions } from "@/api"
import { AppSidebar } from "@/components/AppSidebar"
import type { SubmitAction } from "@/components/ReportCard"
import { ShortcutsDialog } from "@/components/ShortcutsDialog"
import { SensoryUIProvider } from "@/components/ui/sensory-ui/config/provider"
import { usePlaySound } from "@/components/ui/sensory-ui/config/use-play-sound"
import { Topbar } from "@/components/Topbar"
import { SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useKeydown } from "@/hooks/use-keydown"
import { ACTION_LABELS, type SessionStats, caseIsFinished, casesInQueue, countOpenReports, countUnreported } from "@/lib/cases"
import { type Page, shouldIgnoreShortcut, useLocation, useReviewerName, useSoundOn } from "@/lib/navigation"
import { AuditLogPage } from "@/pages/AuditLogPage"
import { HomePage } from "@/pages/HomePage"
import { ReviewPage } from "@/pages/ReviewPage"
import { UnreportedPage } from "@/pages/UnreportedPage"

const SIDEBAR_SIZE = { "--sidebar-width": "18.125rem", "--sidebar-width-icon": "4.25rem" } as CSSProperties
const REVIEW_PAGES: Page[] = ["needs-you", "auto-fixed", "no-change"]

export type ConfirmAll = (reports: Report[]) => Promise<boolean>

function Console({ soundOn, onSoundChange }: { soundOn: boolean; onSoundChange: (on: boolean) => void }) {
  const [location, navigate] = useLocation()
  const [reviewer, setReviewer] = useReviewerName()
  const [cases, setCases] = useState<Case[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [auditVersion, setAuditVersion] = useState(0)
  const [database, setDatabase] = useState<string | null>("")
  const [profileOpen, setProfileOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [session, setSession] = useState<SessionStats>({ decisions: 0, startedAt: null })
  // The decisions saved last, so U can undo them from anywhere. Undo goes by entry id, so it never cancels a newer decision.
  const lastDecision = useRef<TeacherAction[]>([])
  // A short rising chime when a review is saved. Undo stays silent.
  const { play: playSuccess } = usePlaySound({ sound: "notification.success" })

  const loadCases = useCallback(() => {
    fetchCases()
      .then((data) => {
        setCases(data)
        setLoadError(null)
      })
      .catch((error: Error) => setLoadError(error.message))
  }, [])

  useEffect(() => {
    loadCases()
    fetchHealth().then((health) => setDatabase(health.database)).catch(() => setDatabase(null))
  }, [loadCases])

  useKeydown((event) => {
    if (event.key === "?" && !shouldIgnoreShortcut(event)) setShortcutsOpen(true)
  })

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

  // A conflict means another tab or teacher changed the data. Show the error and reload, so the screen is true again.
  const reportFailure = useCallback((error: unknown, what: string) => {
    toast.error(`Could not ${what}: ${(error as Error).message}`)
    if (error instanceof ConflictError) loadCases()
  }, [loadCases])

  const undo = useCallback(async (decisions: TeacherAction[]): Promise<TeacherAction[] | null> => {
    if (decisions.length === 0 || !hasReviewer()) return null
    try {
      const entries = await undoDecisions(decisions.map((decision) => decision.id), reviewer)
      applyDecisions(new Map(entries.map((entry) => [entry.report_id, null])), -entries.length)
      const undone = new Set(entries.map((entry) => entry.report_id))
      lastDecision.current = lastDecision.current.filter((decision) => !undone.has(decision.report_id))
      toast(entries.length === 1 ? `${entries[0].report_id}: undone. It is open again.` : `${entries.length} decisions undone.`)
      return entries
    } catch (error) {
      reportFailure(error, "undo")
      return null
    }
  }, [reviewer, hasReviewer, applyDecisions, reportFailure])

  const submit: SubmitAction = useCallback(async (report, action, extra) => {
    if (action === "undo") {
      const entries = report.teacher_action ? await undo([report.teacher_action]) : null
      return entries ? { saved: true, entry: entries[0] } : null
    }
    if (!hasReviewer()) return null
    try {
      const result = await saveAction({ report_id: report.report_id, action, reviewer, edits: extra?.edits, reply: extra?.reply, save_anyway: extra?.saveAnyway })
      if (!result.saved) return result
      const decision = result.entry
      applyDecisions(new Map([[report.report_id, decision]]), 1)
      lastDecision.current = [decision]
      playSuccess()
      toast.success(`${report.report_id}: ${ACTION_LABELS[action].toLowerCase()}`, { action: { label: "Undo", onClick: () => void undo([decision]) } })
      return result
    } catch (error) {
      reportFailure(error, "save")
      return null
    }
  }, [reviewer, hasReviewer, applyDecisions, undo, playSuccess, reportFailure])

  const confirmAll: ConfirmAll = useCallback(async (reports) => {
    if (reports.length === 0 || !hasReviewer()) return false
    try {
      const entries = await approveMany(reports.map((report) => report.report_id), reviewer)
      applyDecisions(new Map(entries.map((entry) => [entry.report_id, entry])), entries.length)
      lastDecision.current = entries
      playSuccess()
      toast.success(`${entries.length} reports confirmed`, { action: { label: "Undo all", onClick: () => void undo(entries) } })
      return true
    } catch (error) {
      reportFailure(error, "save")
      return false
    }
  }, [reviewer, hasReviewer, applyDecisions, undo, playSuccess, reportFailure])

  const { page, questionId } = location

  useKeydown((event) => {
    if (event.key.toLowerCase() !== "u" || event.repeat || shouldIgnoreShortcut(event)) return
    const last = lastDecision.current
    if (last.length === 0) {
      toast("Nothing to undo yet.")
      return
    }
    void undo(last)
    if (last.length === 1 && REVIEW_PAGES.includes(page)) navigate(page, last[0].question_id)
  })

  const counts = useMemo(() => ({
    // Questions still open in each queue, so the badges count down like an inbox.
    "needs-you": cases ? casesInQueue(cases, "needs-you").length : 0,
    "auto-fixed": cases ? casesInQueue(cases, "auto-fixed").filter((item) => !caseIsFinished(item, "auto-fixed")).length : 0,
    "no-change": cases ? casesInQueue(cases, "no-change").filter((item) => !caseIsFinished(item, "no-change")).length : 0,
    unreported: cases ? countUnreported(cases) : 0,
  }), [cases])
  const openReports = cases ? countOpenReports(cases) : 0

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
          onProfileOpenChange={setProfileOpen} onReviewerChange={setReviewer} onNavigate={navigate}
          soundOn={soundOn} onSoundChange={onSoundChange} />
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
  const [soundOn, setSoundOn] = useSoundOn()
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <SensoryUIProvider config={{ theme: "soft", enabled: soundOn }}>
        <TooltipProvider>
          <Console soundOn={soundOn} onSoundChange={setSoundOn} />
        </TooltipProvider>
      </SensoryUIProvider>
    </ThemeProvider>
  )
}
