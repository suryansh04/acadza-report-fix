import type { Case } from "@/api"
import { cn } from "@/lib/utils"

const OUTCOME_TEXT: Record<string, string> = {
  all_agree: "Everyone agrees",
  key_wrong: "The key is the odd one out",
  solution_wrong: "The solution is the odd one out",
  key_confirmed: "Solvers confirm the key",
  question_unsolvable: "Cannot be answered as written",
  key_unconfirmed: "Key not confirmed",
  key_and_solution_vs_solvers: "Key and solution disagree with the solvers",
  solvers_disagree: "Solvers disagree",
}

function displayAnswer(raw: string | null): string {
  if (!raw) return "-"
  const [status, answer] = raw.includes(":") ? raw.split(/:(.*)/s) : [raw, ""]
  if (status === "solved") return answer || "-"
  return { cannot_solve: "Can't solve", no_option_matches: "No option fits", multiple_correct: "2+ correct" }[status] ?? status
}

/** The four independent answers side by side. The odd one out is usually the error. */
export function VotePanel({ item }: { item: Case }) {
  const { vote } = item
  const agreed = vote.agreed_answer
  const cells = [
    { label: "Key", value: vote.key ?? "-" },
    { label: "Solution", value: vote.solution_answer ?? "-" },
    ...vote.solver_answers.map((answer, index) => ({ label: `Solver ${index + 1}`, value: displayAnswer(answer) })),
  ]

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Independent answers</h3>
        <span className="text-xs text-muted-foreground">{OUTCOME_TEXT[vote.outcome] ?? vote.outcome}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cells.map((cell) => {
          const odd = agreed !== null && cell.value !== "-" && cell.value !== agreed
          return (
            <div
              key={cell.label}
              className={cn("rounded-lg border px-3 py-2 text-center", odd ? "border-bad/40 bg-bad/[0.06]" : agreed && cell.value === agreed && "border-good/40 bg-good/[0.06]")}
            >
              <p className="text-[11px] text-muted-foreground">{cell.label}</p>
              <p className={cn("font-mono text-base font-semibold tabular-nums", odd && "text-bad")}>{cell.value}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
