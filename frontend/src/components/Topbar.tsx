import { useEffect, useMemo, useRef, useState } from "react"
import { UserRound, Volume2, VolumeX } from "lucide-react"

import type { Case } from "@/api"
import { BellIcon, SearchIcon } from "@/components/icons"
import { ReviewerNameForm } from "@/components/ReviewerNameForm"
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
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join("")
}

type ProfileMenuProps = {
  reviewer: string
  database: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onReviewerChange: (name: string) => void
}

function ProfileMenu({ reviewer, database, open, onOpenChange, onReviewerChange }: ProfileMenuProps) {
  const databaseText = database === null ? "Server offline" : ({ "": "Connecting…", supabase: "Saved to Supabase" }[database] ?? "Saved locally")
  const databaseTone = database === null ? "text-bad" : "text-live"

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onOpenChange])

  return (
    <div className="relative">
      <button type="button" aria-expanded={open} aria-label="Your reviewer profile" onClick={() => onOpenChange(!open)} className="flex items-center gap-2 rounded-lg text-left">
        <span className="flex size-11 items-center justify-center rounded-lg bg-period-bg text-base font-medium text-period">
          {reviewer ? initialsOf(reviewer) : <UserRound className="size-5" />}
        </span>
        <span className="hidden flex-col items-start gap-1 md:flex">
          <span className={reviewer ? "text-base leading-none font-medium" : "text-base leading-none font-medium text-period"}>{reviewer || "Add your name"}</span>
          <span className="flex items-center gap-1.5 text-sm leading-none text-muted-foreground">
            Teacher
            <span aria-hidden className="block size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
            <span className={databaseTone}>{databaseText}</span>
          </span>
        </span>
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close" tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={() => onOpenChange(false)} />
          <div className="absolute top-full right-0 z-50 mt-2 flex w-80 flex-col gap-3 rounded-xl border bg-popover p-3 shadow-lg">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Your name</p>
              <p className="text-[13px] text-muted-foreground">The audit log saves it with each approve, edit and reject.</p>
            </div>
            <ReviewerNameForm name={reviewer} autoFocus onSave={(name) => { onReviewerChange(name); onOpenChange(false) }} />
          </div>
        </>
      )}
    </div>
  )
}

type TopbarProps = Omit<ProfileMenuProps, "open" | "onOpenChange"> & {
  page: Page
  cases: Case[]
  openReports: number
  profileOpen: boolean
  onProfileOpenChange: (open: boolean) => void
  soundOn: boolean
  onSoundChange: (on: boolean) => void
  onNavigate: (page: Page, questionId?: string) => void
}

export function Topbar({ page, cases, openReports, profileOpen, onProfileOpenChange, soundOn, onSoundChange, onNavigate, ...profile }: TopbarProps) {
  const { label, icon: PageIcon } = PAGE_META[page]

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
          className="size-11 rounded-lg text-muted-foreground"
          aria-pressed={soundOn}
          aria-label={soundOn ? "Turn off the success sound" : "Turn on the success sound"}
          title={soundOn ? "Sound on: a chime plays when you save a review" : "Sound off"}
          onClick={() => onSoundChange(!soundOn)}
        >
          {soundOn ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
        </Button>
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
        <ProfileMenu {...profile} open={profileOpen} onOpenChange={onProfileOpenChange} />
      </div>
    </header>
  )
}
