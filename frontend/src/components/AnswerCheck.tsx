import type { Vote } from "@/api"
import { cn } from "@/lib/utils"

const OUTCOME_TEXT: Record<string, (answer: string) => string> = {
  all_agree: (answer) => `All of them give ${answer}, so the key is correct.`,
  key_wrong: (answer) => `The solution and the solvers give ${answer}. Only the key is different.`,
  solution_wrong: (answer) => `The key and the solvers give ${answer}. Only the stored solution is different.`,
  key_confirmed: () => "The solvers give the same answer as the key.",
  question_unsolvable: () => "The solvers could not get a valid answer from the question as written.",
  key_unconfirmed: () => "The solvers could not confirm the key.",
  key_and_solution_vs_solvers: () => "The solvers agree with each other, but not with the key and the solution.",
  solvers_disagree: () => "The solvers gave different answers, so this check proves nothing.",
}

const SOLVER_STATUS_TEXT: Record<string, string> = { cannot_solve: "Cannot solve", no_option_matches: "No option fits", multiple_correct: "2+ correct" }

function displayAnswer(raw: string | null): string {
  if (!raw) return "-"
  const [status, answer] = raw.includes(":") ? raw.split(/:(.*)/s) : [raw, ""]
  if (status === "solved") return answer || "-"
  return SOLVER_STATUS_TEXT[status] ?? status
}

/** The key, the stored solution and the blind solvers side by side. The odd one out is usually the error. */
export function AnswerCheck({ vote }: { vote: Vote }) {
  const agreed = vote.agreed_answer
  const cells = [
    { label: "Key", value: vote.key ?? "-" },
    { label: "Solution", value: vote.solution_answer ?? "-" },
    ...vote.solver_answers.map((answer, index) => ({ label: `Solver ${index + 1}`, value: displayAnswer(answer) })),
  ]
  const result = OUTCOME_TEXT[vote.outcome]?.(agreed ?? "-") ?? vote.explanation

  return (
    <section className="flex flex-col gap-2 rounded-xl bg-muted px-3 py-2.5">
      <h4 className="text-sm font-medium">Answer check by the AI</h4>
      <p className="text-sm text-muted-foreground">
        {vote.solver_answers.length} AI solvers worked out this question on their own, without the key or the stored solution.
        Then the engine compared their answers with the key and with the final answer of the solution. <span className="text-foreground">{result}</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {cells.map((cell) => {
          const odd = agreed !== null && cell.value !== "-" && cell.value !== agreed
          return (
            <span key={cell.label} className={cn("rounded-lg bg-background px-2.5 py-1 text-xs text-muted-foreground", odd && "bg-bad/10 text-bad")}>
              {cell.label} <span className={cn("ml-1 text-sm font-semibold tabular-nums", !odd && "text-foreground")}>{cell.value}</span>
            </span>
          )
        })}
      </div>
    </section>
  )
}
