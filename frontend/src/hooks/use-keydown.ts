import { useEffect, useRef } from "react"

/** Calls the handler on every window keydown while enabled. It always uses the latest handler, so callers need no dependency list. */
export function useKeydown(handler: (event: KeyboardEvent) => void, enabled = true): void {
  const latest = useRef(handler)

  useEffect(() => {
    latest.current = handler
  })

  useEffect(() => {
    if (!enabled) return
    const listener = (event: KeyboardEvent) => latest.current(event)
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [enabled])
}
