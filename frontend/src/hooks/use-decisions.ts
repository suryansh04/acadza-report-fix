import { type Dispatch, type SetStateAction, useCallback, useRef } from "react"
import { toast } from "sonner"

import { type Case, ConflictError, type DecisionName, type Report, type TeacherAction, approveMany, saveAction, undoDecisions } from "@/api"
import type { SubmitAction } from "@/components/ReportCard"
import { ACTION_LABELS } from "@/lib/cases"

export type ConfirmAll = (reports: Report[]) => Promise<boolean>

type DecisionsOptions = {
  reviewer: string
  setCases: Dispatch<SetStateAction<Case[] | null>>
  requireReviewer: () => boolean
  reloadCases: () => void
  onSaved: () => void
  onCountChange: (change: number) => void
  playSuccess: () => void
}

type DecisionChange = { reportId: string; decision: TeacherAction | null; onlyIfShowing?: Set<number> | "none" }

/**
 * Teacher decisions. Approve, reject and confirm-all show at once and save in the background, because a save to
 * Supabase takes a moment. A failed save rolls back and shows the error. An edit waits for the server, because the
 * server can answer with format warnings. A decision that is still saving has a negative draft id until the server
 * gives the real one.
 */
export function useDecisions({ reviewer, setCases, requireReviewer, reloadCases, onSaved, onCountChange, playSuccess }: DecisionsOptions) {
  const nextDraftId = useRef(-1)
  // Draft id -> the saved decision, or null if the save failed. Undo waits on this to get the real id.
  const pendingSaves = useRef(new Map<number, Promise<TeacherAction | null>>())
  const savedIds = useRef(new Map<number, number>())
  // The decisions made last, so U can undo them from anywhere.
  const lastDecision = useRef<TeacherAction[]>([])

  // onlyIfShowing protects newer changes: a late answer from the server never overwrites a decision made after it.
  const showDecisions = useCallback((changes: DecisionChange[]) => {
    const byReport = new Map(changes.map((change) => [change.reportId, change]))
    setCases((current) => current && current.map((item) => ({
      ...item,
      reports: item.reports.map((report) => {
        const change = byReport.get(report.report_id)
        if (!change) return report
        const showing = report.teacher_action?.id
        const allowed = change.onlyIfShowing === undefined
          || (change.onlyIfShowing === "none" ? showing === undefined : showing !== undefined && change.onlyIfShowing.has(showing))
        return allowed ? { ...report, teacher_action: change.decision } : report
      }),
    })))
  }, [setCases])

  const failed = useCallback((error: unknown, what: string) => {
    toast.error(`Could not ${what}: ${(error as Error).message}`)
    // A conflict means another tab or teacher changed the data. Reload, so the screen is true again.
    if (error instanceof ConflictError) reloadCases()
  }, [reloadCases])

  const draft = useCallback((report: Report, action: DecisionName): TeacherAction => ({
    id: nextDraftId.current--,
    report_id: report.report_id,
    question_id: report.question_id,
    action,
    edits: [],
    reply: "",
    note: "",
    reviewer,
    created_at: new Date().toISOString(),
  }), [reviewer])

  const realDecision = useCallback(async (decision: TeacherAction): Promise<TeacherAction | null> => (
    decision.id > 0 ? decision : (await pendingSaves.current.get(decision.id)) ?? null
  ), [])

  const undo = useCallback(async (decisions: TeacherAction[]) => {
    if (decisions.length === 0 || !requireReviewer()) return
    const ids = new Set(decisions.flatMap((decision) => [decision.id, savedIds.current.get(decision.id) ?? decision.id]))
    showDecisions(decisions.map((decision) => ({ reportId: decision.report_id, decision: null, onlyIfShowing: ids })))
    onCountChange(-decisions.length)
    lastDecision.current = lastDecision.current.filter((decision) => !ids.has(decision.id))
    toast(decisions.length === 1 ? `${decisions[0].report_id}: undone. It is open again.` : `${decisions.length} decisions undone.`)

    const saved = (await Promise.all(decisions.map(realDecision))).filter((decision): decision is TeacherAction => decision !== null)
    if (saved.length === 0) return
    try {
      await undoDecisions(saved.map((decision) => decision.id), reviewer)
      onSaved()
    } catch (error) {
      showDecisions(saved.map((decision) => ({ reportId: decision.report_id, decision, onlyIfShowing: "none" })))
      onCountChange(saved.length)
      failed(error, "undo")
    }
  }, [reviewer, requireReviewer, showDecisions, onCountChange, realDecision, onSaved, failed])

  const announce = useCallback((decisions: TeacherAction[], message: string, undoLabel: string) => {
    lastDecision.current = decisions
    playSuccess()
    toast.success(message, { action: { label: undoLabel, onClick: () => void undo(decisions) } })
  }, [playSuccess, undo])

  // Show drafts at once, then swap in the saved decisions. Drafts the server did not save roll back.
  const saveInBackground = useCallback((drafts: TeacherAction[], save: Promise<TeacherAction[]>) => {
    const byReport = save.then((entries) => new Map(entries.map((entry) => [entry.report_id, entry])))
    for (const decision of drafts) pendingSaves.current.set(decision.id, byReport.then((saved) => saved.get(decision.report_id) ?? null, () => null))
    byReport.then((saved) => {
      const missing = drafts.filter((decision) => !saved.has(decision.report_id))
      for (const decision of drafts) {
        const entry = saved.get(decision.report_id)
        if (entry) savedIds.current.set(decision.id, entry.id)
      }
      showDecisions(drafts.map((decision) => ({ reportId: decision.report_id, decision: saved.get(decision.report_id) ?? null, onlyIfShowing: new Set([decision.id]) })))
      onSaved()
      if (missing.length > 0) {
        onCountChange(-missing.length)
        toast.error(`${missing.length} report${missing.length > 1 ? "s were" : " was"} already decided elsewhere. The list is now up to date.`)
        reloadCases()
      }
    }, (error: unknown) => {
      showDecisions(drafts.map((decision) => ({ reportId: decision.report_id, decision: null, onlyIfShowing: new Set([decision.id]) })))
      onCountChange(-drafts.length)
      lastDecision.current = lastDecision.current.filter((decision) => !drafts.includes(decision))
      failed(error, "save")
    })
  }, [showDecisions, onSaved, onCountChange, reloadCases, failed])

  const submit: SubmitAction = useCallback(async (report, action, extra) => {
    if (action === "undo") {
      if (!report.teacher_action) return null
      void undo([report.teacher_action])
      return { saved: true, entry: report.teacher_action }
    }
    if (!requireReviewer()) return null
    const label = `${report.report_id}: ${ACTION_LABELS[action].toLowerCase()}`

    if (action === "edit") {
      try {
        const result = await saveAction({ report_id: report.report_id, action, reviewer, edits: extra?.edits, reply: extra?.reply, save_anyway: extra?.saveAnyway })
        if (!result.saved) return result
        showDecisions([{ reportId: report.report_id, decision: result.entry }])
        onCountChange(1)
        onSaved()
        announce([result.entry], label, "Undo")
        return result
      } catch (error) {
        failed(error, "save")
        return null
      }
    }

    const decision = draft(report, action)
    showDecisions([{ reportId: report.report_id, decision }])
    onCountChange(1)
    announce([decision], label, "Undo")
    saveInBackground([decision], saveAction({ report_id: report.report_id, action, reviewer }).then((result) => (result.saved ? [result.entry] : [])))
    return { saved: true, entry: decision }
  }, [reviewer, requireReviewer, undo, showDecisions, onCountChange, onSaved, announce, failed, draft, saveInBackground])

  const confirmAll: ConfirmAll = useCallback(async (reports) => {
    if (reports.length === 0 || !requireReviewer()) return false
    const drafts = reports.map((report) => draft(report, "approve"))
    showDecisions(drafts.map((decision) => ({ reportId: decision.report_id, decision })))
    onCountChange(drafts.length)
    announce(drafts, `${drafts.length} reports confirmed`, "Undo all")
    saveInBackground(drafts, approveMany(reports.map((report) => report.report_id), reviewer))
    return true
  }, [reviewer, requireReviewer, draft, showDecisions, onCountChange, announce, saveInBackground])

  const undoLast = useCallback((): TeacherAction[] => {
    const last = lastDecision.current
    if (last.length === 0) toast("Nothing to undo yet.")
    else void undo(last)
    return last
  }, [undo])

  return { submit, confirmAll, undoLast }
}
