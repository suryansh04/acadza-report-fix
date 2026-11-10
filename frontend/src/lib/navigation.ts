import { useCallback, useEffect, useState } from "react"

export type Page = "home" | "needs-you" | "auto-fixed" | "no-change" | "unreported" | "audit"

const PAGES: Page[] = ["home", "needs-you", "auto-fixed", "no-change", "unreported", "audit"]
const REVIEWER_KEY = "report-fix-reviewer"

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

export function useReviewerName(): [string, (name: string) => void] {
  const [name, setName] = useState(() => {
    try {
      return window.localStorage.getItem(REVIEWER_KEY) ?? ""
    } catch {
      return ""
    }
  })

  const saveName = useCallback((value: string) => {
    setName(value)
    try {
      window.localStorage.setItem(REVIEWER_KEY, value)
    } catch {
      // Storage can be blocked (private mode). The name still works for this session.
    }
  }, [])

  return [name, saveName]
}

/** True when a single-letter shortcut must not fire: the teacher is typing, a dialog is open, or a modifier is held. */
export function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || Boolean(target?.isContentEditable)
  return typing || event.metaKey || event.ctrlKey || event.altKey || document.querySelector("[aria-modal='true']") !== null
}
