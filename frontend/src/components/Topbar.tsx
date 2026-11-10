import { useEffect, useMemo, useRef, useState } from "react"

import type { Case } from "@/api"
import { BellIcon, SearchIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { queueForCase, stripHtml } from "@/lib/cases"
import type { Page } from "@/lib/navigation"
import { PAGE_META } from "@/lib/pages"

const MAX_RESULTS = 6

function CaseSearch({ cases, onOpen }: { cases: Case[]; onOpen: (item: Case) => void }) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const index = useMemo(
    () => cases.map((item) => ({ item, text: `${item.questionId} ${item.subject} ${item.chapter} ${stripHtml(item.before.question_html)}`.toLowerCase() })),
    [cases],
  )
  const needle = query.trim().toLowerCase()
  const matches = needle ? index.filter((entry) => entry.text.includes(needle)).slice(0, MAX_RESULTS).map((entry) => entry.item) : []

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const choose = (item: Case) => {
    onOpen(item)
    setQuery("")
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div className="relative hidden md:block">
      <label className="flex h-11 w-70 items-center gap-2 rounded-lg bg-secondary px-3 text-muted-foreground">
        <SearchIcon />
        <input
          ref={inputRef}
          value={query}
          aria-label="Search questions"
          placeholder="search questions, chapters, IDs..."
          className="h-full min-w-0 flex-1 bg-transparent text-sm tracking-tight text-foreground outline-none placeholder:text-muted-foreground"
          onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") event.currentTarget.blur()
            if (event.key === "Enter" && matches[0]) choose(matches[0])
          }}
        />
      </label>
      {open && needle && (
        <div className="absolute top-full right-0 z-50 mt-2 flex w-96 flex-col rounded-xl border bg-popover p-1.5 shadow-lg">
          {matches.length === 0 && <p className="px-2.5 py-2 text-sm text-muted-foreground">No question matches "{query.trim()}".</p>}
          {matches.map((item) => (
            <button
              key={item.questionId}
              type="button"
              // mousedown, not click: the input blur would close the list before the click lands.
              onMouseDown={(event) => { event.preventDefault(); choose(item) }}
              className="flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted"
            >
              <span className="text-xs text-muted-foreground">{item.subject} · {item.chapter}</span>
              <span className="line-clamp-1 text-sm">{stripHtml(item.before.question_html)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function initialsOf(name: string): string {
  const letters = name.trim().split(/\s+/).filter(Boolean).map((word) => word[0]?.toUpperCase())
  return letters.slice(0, 2).join("") || "?"
}

type TopbarProps = {
  page: Page
  cases: Case[]
  openReports: number
  reviewer: string
  database: string | null
  onNavigate: (page: Page, questionId?: string) => void
}

export function Topbar({ page, cases, openReports, reviewer, database, onNavigate }: TopbarProps) {
  const { label, icon: PageIcon } = PAGE_META[page]
  const databaseText = database === null ? "Server offline" : ({ "": "Connecting…", supabase: "Saved to Supabase" }[database] ?? "Saved locally")

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4 md:h-20 md:pr-8 md:pl-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <SidebarTrigger className="size-11 shrink-0 md:hidden [&_svg]:size-5!" />
        <PageIcon className="hidden size-5 shrink-0 md:block" />
        <p className="truncate text-lg font-medium">{label}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <CaseSearch cases={cases} onOpen={(item) => onNavigate(queueForCase(item), item.questionId)} />
        <Button
          type="button"
          variant="outline"
          className="relative size-11 rounded-lg"
          aria-label={`${openReports} reports need you`}
          title={`${openReports} reports need you`}
          onClick={() => onNavigate("needs-you")}
        >
          <BellIcon className="size-6!" />
          {openReports > 0 && (
            <svg aria-hidden viewBox="0 0 10 10" className="pointer-events-none absolute top-2 right-2 size-2.5 overflow-visible">
              <circle cx="5" cy="5" r="5" className="fill-background" />
              <circle cx="5" cy="5" r="2.75" fill="none" className="stroke-destructive" strokeWidth="2" />
            </svg>
          )}
        </Button>
        <div className="flex items-center gap-2">
          <span className="flex size-11 items-center justify-center rounded-lg bg-period-bg text-base font-medium text-period">{initialsOf(reviewer)}</span>
          <div className="hidden flex-col items-start gap-1 md:flex">
            <span className="text-base leading-none font-medium">{reviewer.trim() || "Reviewer"}</span>
            <span className="flex items-center gap-1.5 text-sm leading-none text-muted-foreground">
              Teacher
              <span aria-hidden className="block size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
              <span className={database === null ? "text-bad" : "text-live"}>{databaseText}</span>
            </span>
          </div>
        </div>
      </div>
    </header>
  )
}
