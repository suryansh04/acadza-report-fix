import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

export type Page = "home" | "needs-you" | "auto-fixed" | "no-change" | "unreported" | "audit"

const PAGES: Page[] = ["home", "needs-you", "auto-fixed", "no-change", "unreported", "audit"]
const REVIEWER_KEY = "report-fix-reviewer"
const SHORTCUTS = "J / K: next or previous question · A: approve · E: edit · R: reject · Ctrl K: search"

export type Location = { page: Page; questionId: string | null }

function readLocation(): Location {
  const [page, questionId] = window.location.hash.replace(/^#\/?/, "").split("/")
  return { page: PAGES.includes(page as Page) ? (page as Page) : "home", questionId: questionId || null }
}

/** The page and the open question live in the URL hash, so a teacher can bookmark or share a case. */
export function useLocation(): [Location, (page: Page, questionId?: string | null) => void] {
  const [location, setLocation] = useState(readLocation)

  useEffect(() => {
    const onHashChange = () => setLocation(readLocation())
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  const navigate = useCallback((page: Page, questionId: string | null = null) => {
    window.location.hash = questionId ? `/${page}/${questionId}` : `/${page}`
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

export function showShortcuts(): void {
  toast(SHORTCUTS)
}
