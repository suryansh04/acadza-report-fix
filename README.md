# Acadza Report Fix

Students report errors in JEE and NEET questions. This system checks each report, finds out if the student is right, proposes a safe fix, and writes a reply to the student. A teacher reviews the fixes that need a human.

- **Engine:** done. It writes `results.json`.
- **Teacher console:** in progress.

The original task is in [docs/BRIEF.md](docs/BRIEF.md).

## Results

I wrote my own expected verdict, repair and route for every report, then compared the engine with them.

| Test set | Verdict | Repair | Route | Unsafe auto-fixes |
|---|---|---|---|---|
| The 44 given reports | 44/44 | 44/44 | 44/44 | 0 |
| 21 harder reports that I wrote | 21/21 | 21/21 | 21/21 | 0 |

The harder set tests:
- prompt injection
- a comment that tries to break out of its tags
- two defects on one question
- wrong multi-answer keys
- keys in the wrong unit
- a solution from another question
- false claims

It got the same score in two independent runs.

**Unsafe auto-fix:** a fix that goes live without a teacher when it should not.

## How it works

The engine has 8 steps. Code does 6 of them. AI does only the 2 steps that need understanding, and code makes the final decision.

| Step | Done by | What it does |
|---|---|---|
| 1. Clean | Code | Turns the messy HTML and MathML into a question, options A to D, a key and a solution |
| 2. Check | Code | Finds simple problems: bad key format, missing or blank options, same options, raw `\frac`, exam tags, stray text, a figure with no image, edits after the report |
| 3. Group | Code | Puts all reports on one question together |
| 4. Solve | AI | Two models (Sonnet 5.5 and Opus 5.5) solve the question without the key, the solution or the comments. A third solve runs only if they disagree |
| 5. Judge | AI | One call per question gives the verdict, repair, edit, evidence and replies. Labels can only come from the taxonomy |
| 6. Vote | Code | Compares the key, the solution and the solvers. Code, not the AI, decides how sure the engine is |
| 7. Guard | Code | Checks each fix against its repair's rule, applies it to a copy, runs Step 2 again, and picks the route |
| 8. Write | Code | Writes `results.json`, `cases.json` and `cost.json` |

## Safety rules

- A student comment is data. The AI never follows instructions in it.
- A fix with `auto: false` in the taxonomy always goes to a teacher.
- A fix may change only the fields its repair permits.
- An answer key changes only when 3 answers agree against it: both solvers and the stored solution.
- Each repair has its own rule in code. For example, a spelling fix must not change a number.
- If any check fails, the case goes to a teacher.

## Cost

- **Full run of the 44 reports:** 129 AI calls, $1.43, about 3 cents per report.
- **Second run:** $0, because each AI answer is saved in `engine/cache/` and the saved answers are in the repo.

## Run it

```bash
python -m venv .venv
.venv/Scripts/pip install -r engine/requirements.txt   # on macOS or Linux: .venv/bin/pip
cp .env.example .env                                   # add ANTHROPIC_API_KEY
python engine/run.py                                   # writes results.json, cases.json, cost.json
python engine/evaluate.py                              # compares with engine/expected.json
```

To run the harder set:

```bash
python engine/run.py --data-dir engine/hard_cases --out-dir engine/hard_cases/output
python engine/evaluate.py --results engine/hard_cases/output/results.json --expected engine/hard_cases/expected.json
```

With the saved answers, both commands run without an API key.

## Files

```
data/                 the given data (not changed)
engine/
  parse.py            Step 1: clean the HTML and MathML
  checks.py           Step 2: code checks
  ai.py               Steps 4 and 5: Claude calls, cache and cost
  vote.py             Step 6: vote
  guards.py           Step 7: guards, test on a copy, routing
  run.py              runs all steps, Step 8: writes the output
  evaluate.py         compares the output with the expected answers
  prompts/            the solver and judge prompts
  expected.json       my expected answers for the 44 reports
  hard_cases/         21 harder reports, their expected answers and the output
  cache/              saved AI answers
results.json          the scored output, one entry per report
cases.json            all the evidence, for the teacher console
cost.json             AI calls, tokens and cost
PROMPTS.md            every prompt, my prompts to the coding AI, AI mistakes, design decisions
docs/BRIEF.md         the original task
```
