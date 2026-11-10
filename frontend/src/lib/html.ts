import DOMPurify from "dompurify"

import type { Edit } from "@/api"

/** The text of an HTML snippet. DOMParser builds an inert document: no script runs and no image loads. */
export function stripHtml(html: string): string {
  const text = new DOMParser().parseFromString(html, "text/html").body.textContent ?? ""
  return text.replace(/\s+/g, " ").trim()
}

/** Question HTML comes from stored data, and fix HTML from the AI or a teacher. Clean both before they reach the page. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true } })
}

function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n/g, "\n")
}

// Wrapping text inside MathML in <del>/<ins> breaks the formula, so those edits show without a highlight.
function canHighlight(text: string): boolean {
  return !/<\/?m[a-z]/.test(text)
}

/** Rendered "before" or "after" HTML for one field, with the changed text marked. */
export function buildDiffHtml(raw: string, edits: Edit[], field: "question" | "solution", side: "before" | "after"): string {
  let html = normalizeLineBreaks(raw)
  for (const edit of edits.filter((item) => item.field === field)) {
    const find = normalizeLineBreaks(edit.find)
    if (!find || !html.includes(find)) continue
    const marked = side === "before"
      ? (canHighlight(find) ? `<del class="diff-del">${find}</del>` : find)
      : (canHighlight(edit.replace) ? `<ins class="diff-ins">${edit.replace}</ins>` : edit.replace)
    html = html.replace(find, () => marked)
  }
  return html
}
