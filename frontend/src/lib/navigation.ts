import { useCallback, useEffect, useState } from "react"

import type { QueueSort } from "@/lib/cases"

export type Page = "home" | "needs-you" | "auto-fixed" | "no-change" | "unreported" | "audit"

const PAGES: Page[] = ["home", "needs-you", "auto-fixed", "no-change", "unreported", "audit"]
const REVIEWER_KEY = "report-fix-reviewer"
const SOUND_KEY = "report-fix-sound"
const QUEUE_SORT_KEY = "report-fix-queue-sort"

export type Location = { page: Page; questionId: string | null }

function readLocation(): Location {
  const [page, questionId] = window.location.hash.replace(/^#\/?/, "").split("/")
  return { page: PAGES.includes(page as Page) ? (page as Page) : "home", questionId: questionId || null }
}

/** The page and the open question live in the URL hash, so a teacher can bookmark or share a case. */
export type Navigate = (page: Page, questionId?: string | null, replace?: boolean) => void

export function useLocation(): [Location, Navigate] {
  const [location, setLocation] = useState(readLocation)

  useEffect(() => {
    const onHashChange = () => setLocation(readLocation())
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  const navigate: Navigate = useCallback((page, questionId = null, replace = false) => {
    const hash = questionId ? `#/${page}/${questionId}` : `#/${page}`
    if (!replace) {
      window.location.hash = hash
      return
    }
    // replaceState does not fire "hashchange", so update the state here.
    window.history.replaceState(null, "", hash)
    setLocation(readLocation())
  }, [])

  return [location, navigate]
}

/** A value kept in localStorage for this browser. Storage can be blocked (private mode); then it lasts for this session only. */
function useStoredText(key: string, fallback: string): [string, (value: string) => void] {
  const [value, setValue] = useState(() => {
    try {
      return window.localStorage.getItem(key) ?? fallback
    } catch {
      return fallback
    }
  })

  const saveValue = useCallback((next: string) => {
    setValue(next)
    try {
      window.localStorage.setItem(key, next)
    } catch {
      // Blocked storage: keep the value in memory only.
    }
  }, [key])

  return [value, saveValue]
}

export function useReviewerName(): [string, (name: string) => void] {
  return useStoredText(REVIEWER_KEY, "")
}

export function useSoundOn(): [boolean, (on: boolean) => void] {
  const [stored, setStored] = useStoredText(SOUND_KEY, "on")
  const setSoundOn = useCallback((on: boolean) => setStored(on ? "on" : "off"), [setStored])
  return [stored !== "off", setSoundOn]
}

export function useQueueSort(): [QueueSort, (sort: QueueSort) => void] {
  const [stored, setStored] = useStoredText(QUEUE_SORT_KEY, "reports")
  return [stored === "urgency" ? "urgency" : "reports", setStored]
}

/** True when a single-letter shortcut must not fire: the teacher is typing, a dialog is open, or a modifier is held. */
export function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || Boolean(target?.isContentEditable)
  return typing || event.metaKey || event.ctrlKey || event.altKey || document.querySelector("[aria-modal='true']") !== null
}
