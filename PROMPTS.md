# Prompts

This file shows how I used AI to build this project.

It has 4 parts:

1. The prompts in my product
2. The prompts I gave my coding AI
3. Three times the AI was wrong
4. My design decisions

---

## 1. The prompts in my product

<!--
Format for each prompt:

### <Name>

**Job:** <what it does, one line>

**Prompt (version N):**

```text
<prompt, verbatim>
```

**Changes:**

- **v1:** <what I did>. **Problem:** <what went wrong>.
- **v2:** <what I changed>. **Result:** <what improved>.
-->

### Solver

**Job:** Solve the question with no hints. It does not see the key, the solution or the student comments.

**File:** [engine/prompts/solver.md](engine/prompts/solver.md). The user message has the subject, the question type, the question text and the options. The output is constrained by a JSON schema: `status`, `answer`, `value`, `working`, `note`.

**Prompt (version 1):**

```text
You are an experienced JEE and NEET teacher. Solve the question below on your own.

You see only the question and its options. You do not see the answer key, the stored solution, or any student comment. Do not guess what the expected answer is. Work it out.

Rules:
- Solve from first principles and check your arithmetic.
- If data needed to solve the question is missing, set "status" to "cannot_solve" and name the missing data in "note".
- If your result matches none of the options, set "status" to "no_option_matches" and give your result in "value".
- If more than one option is correct in a single-correct question, or none is, say so in "note".
- Answer format:
  - single-correct: one letter, for example "B"
  - multiple-correct: every correct letter, comma separated, for example "A, C, D"
  - integer: the number only, in the unit the question asks for, for example "8"
- "value": your final result with its unit, for example "50 V".
- "working": a short worked solution, at most 6 lines.
- "note": anything wrong or unclear in the question itself. Leave it empty if nothing is wrong.
```

**Changes:**

- **v1:** The first version. **Result:** On all 43 questions, Sonnet 5.5 and Opus 5.5 gave the same answer as my own expected answers. The run used 86 calls and cost $0.58.
  - Both solvers found the 4 wrong keys: R001–R003, R004, R005 and R020.
  - Both said "cannot solve" for the 2 questions with missing data (R006, R007).
  - Both said "no option matches" for the blank option (R011).
  - The two solvers disagreed on only one question, R034, where no option is correct. The tiebreak solver handles this case.
  - The `note` field also found defects that nobody reported, for example "ofleaf", "Von Helmont" and a unit inside a square root in R030's options.

---

## 2. The prompts I gave my coding AI

**Tool:** Claude Code.

1. **Prompt:** "Let us discuss the file structure for the backend and the frontend. Keep it simple, not complicated. Also install the Andrej Karpathy skills for this project."
   **Why:** AI tools tend to add too many files and abstractions. The Karpathy guidelines tell the AI to write the minimum code, make small changes, and state its assumptions.
   **Result:** The AI read the skill before it installed it, then added it to `.claude/skills/`. The file structure has one file for each job.

<!--
Format for each prompt:

1. **Prompt:** "<prompt, cleaned up for reading>"
   **Why:** <why I asked this, one line>
   **Result:** <what happened, one line>
-->

---

## 3. Three times the AI was wrong

### 1. It said Watermelon UI had no table or badge components

- **Error:** I asked about Watermelon UI. The AI read the site and said that it had no table or badge components and was only a catalog of animated parts. It recommended against it.
- **How I found it:** I opened the site myself. The Table and Badge pages were there, with many variants.
- **Fix:** I sent screenshots and told the AI to check again. We now use Watermelon UI first.
- **Lesson:** The AI's web tool read only the page shell, not the page content. It reported missing data as "the feature does not exist". Check claims about a website yourself.

### 2. Its vote step had gaps

- **Error:** The first vote rules compared the 4 answers as plain text. They had 4 gaps:
  1. A missing case: the key and the solution agree, but the solvers disagree with them.
  2. "3113" and "3112.99" counted as different answers.
  3. A solution from another question still counted as a vote.
  4. Two solvers that disagreed always sent the case to a teacher.
- **How I found it:** I asked "Are you sure this is the best step?" The AI checked again and found the gaps.
- **Fix:**
  - Normalize the answers before the compare.
  - Remove invalid votes.
  - Add a rule: two solvers never overrule the key and the solution together.
  - Add a third solver only when the first two disagree.
- **Lesson:** Ask the AI to check its own design again. The first answer is often not complete.

### 3. It wanted to change a verdict because of a harmless display detail

- **Error:** In R030, the options show `4 √(2 m)`, with the unit inside the square root. The AI wanted to change R030 from `no_error` to `defect` / `notation`. The student's claim (4√2) is wrong and has no connection to the display.
- **How I found it:** I pointed out that every student reads `4 √(2 m)` as 4√2 m. The AI agreed: the notation is technically wrong, but the meaning does not change.
- **Fix:**
  - R030 stays `no_error`.
  - Rule 15 is now more exact: a defect changes the verdict only if it is about what the student reported.
  - A display detail that does not change the meaning is not a defect.
- **Lesson:** "Technically wrong" is not the same as "harmful to a student". Judge a defect by its effect on the student.

<!--
Format for each case:

### <N>. <short title>

- **Error:** <what the AI did wrong>
- **How I found it:** <how I caught it>
- **Fix:** <what I changed>
- **Lesson:** <what I learned, one line>
-->

---

## 4. My design decisions

<!--
Format for each decision:

### <N>. <short title>

- **Problem:** <the problem>
- **Decision:** <what I chose>
- **Why:** <the reason>
- **Dropped:** <what I tried and did not use, and why>
-->

### 1. Code first, AI second

- **Problem:** Many checks are simple: a bad answer format, a blank option, raw `\frac` text, a date. AI can make errors on these.
- **Decision:** Code does all the simple checks. AI does only the work that needs understanding: solving, judging, writing replies.
- **Why:** Code is fast, free, and gives the same result each time.
- **Dropped:** One big prompt that does everything. It costs more, and its errors are hard to find.

### 2. A blind solver

- **Problem:** Many students claim a different answer. An AI that sees the claim tends to agree with it. An AI that sees the key tends to agree with the key.
- **Decision:** The solver sees only the question. It does not see the key or the comments.
- **Why:** Then its answer is a true second opinion.

### 3. One AI judge call per question

- **Problem:** Some questions have 2 or 3 reports.
- **Decision:** I group the reports by question. The judge gets all the reports for one question in one call.
- **Why:** Fewer calls, lower cost, and all reports on one question get the same verdict.

### 4. Code makes the final routing decision

- **Problem:** The AI can choose a label that is not in the taxonomy, or edit a field that the repair does not permit.
- **Decision:** Code guards check each AI result. Code, not the AI, decides `auto_apply`, `faculty_review` or `no_change`.
- **Why:** A wrong auto-edit hurts every student. A rule in code cannot be talked out of its decision.
- **Note:** These guards control the AI only. They do not block the teacher (see decision 10).

### 5. The student comment is data

- **Problem:** One report (R027) tries to give orders to the AI.
- **Decision:** The prompt puts each comment inside clear tags and says that it is data only.
- **Why:** The AI must never obey a student comment.

### 6. Stack

- **Decision:**
  - Engine: Python with the Claude API. It runs one time and saves the results.
  - Console: React (Vite) for the frontend and FastAPI for the backend.
  - Audit log: a free Supabase Postgres database.
- **Why:** The console shows saved results, so it works with no AI credits. A database keeps the audit log on all devices.
- **Dropped:**
  - Streamlit, because it gives less control over the design.
  - Browser storage for the audit log, because the log stays in one browser only.

### 7. UI components: Watermelon UI first, shadcn/ui second

- **Problem:** The console is 20% of the score. It must be easy to read for a tired teacher.
- **Decision:** Use Watermelon UI components first. Use shadcn/ui for the parts that Watermelon does not have. Watermelon uses shadcn as its base, so the two fit together.
- **Why:** The Watermelon table and badge components are clean and easy to read.

### 8. Dashboard design: based on the Watermelon "Bionis" dashboard

- **Problem:** The teacher must see the state of the work in seconds, then act in one click.
- **Decision:**
  - A sidebar layout, light theme by default, dark theme as an option.
  - A home page with one status line, a progress ring, stat cards and a "Do these first" list.
  - A review page: the queue on the left, the case detail on the right.
  - Color only for meaning: red for a defect, amber for review, green for fixed, grey for no change.
- **Why:** Bionis is calm and clean. It uses a white base and color only for status. Its parts (status line, score ring, metric cards, recommended actions) map directly to our needs.
- **Dropped:** A single page with charts only. It shows the data but does not help the teacher act.

### 9. A simple file structure

- **Problem:** AI tools tend to add too many files and layers.
- **Decision:**
  - `engine/`: 6 small files, one for each step. AI answers are saved in `engine/cache/`.
  - `backend/`: `main.py` (3 routes) and `db.py` (1 table, `audit_log`). FastAPI also serves the built frontend.
  - `frontend/`: 3 pages (Home, Review, Audit log) and 3 main components (question, diff, action bar).
- **Why:**
  - One deploy and one URL means fewer parts that can fail.
  - The cache stops us from paying again for the same AI call when we tune the prompts.
- **Dropped:**
  - Two deploys (Vercel + Render), because they need two URLs and CORS setup.
  - Frontend writing directly to the database, because there is then no place for checks.

### 10. The teacher can edit anything

- **Problem:** I first planned to run the AI scope guard on the teacher's edits too.
- **Decision:** The teacher can edit any field. The backend checks only the format: the answer format, an answer letter that exists, and complete HTML and math. A problem shows a warning with "Save anyway". It never blocks.
- **Why:** The teacher is the expert and makes the final decision. The scope rules exist to control the AI. A check still finds typing errors from a tired teacher, for example `A, B, D` typed as one value.
- **Dropped:** Blocking the teacher's edits with the AI scope guard.

### 11. The engine: 8 steps, plus a test against my own answers

- **Problem:** A wrong answer-key fix hurts every student. One AI solve can be wrong, and an AI is often too sure of itself.
- **Decision:**
  1. Clean (code)
  2. Check all 43 questions (code)
  3. Group reports by question (code)
  4. Solve 2 times, blind, with 2 different models (AI). If they disagree, a third, stronger model solves it.
  5. Judge: verdict, repair, edit, evidence, reply (AI)
  6. Vote: key vs solution vs solvers. Code first puts the answers in the same form (numbers with a small tolerance, multi-answer keys as sets) and removes invalid votes. Code calculates the confidence. A key changes only when 3 valid answers agree against it.
  7. Guard, test the edit on a copy, and route (code)
  8. Write `results.json` and `cases.json` (code)

  During the build, a script compares the engine output with my own expected verdicts for all 44 reports.
- **Why:**
  - Two solves and the stored solution give 3 votes against the key.
  - Code, not the AI, calculates the confidence.
  - Testing the edit confirms that it fixes the problem and breaks nothing.
  - My own answers show where the engine is wrong.
- **Dropped:**
  - One solve only, because one AI error could change a correct key.
  - The AI's own confidence score, because it is too high.
  - Solver 2 as a Python calculation, for now. I add it only if the test shows arithmetic errors.

### 12. A review of every engine step

- **Problem:** The first engine design had gaps. I asked the AI to review each step for the best fix.
- **Decision:** The main changes:
  1. **Clean:** Change MathML to simple text for the AI. If code cannot find 4 options, mark the question "not sure". Do not call it a defect.
  2. **Check:** Add checks for a key that is not an option, an empty solution, and "figure" in the text with no image. Each check gives a fact for the judge, not a verdict.
  3. **Group:** Questions with no report also become cases, for the bonus.
  4. **Solve:** Each solver gives its answer in a fixed format. A solver can say "no option matches".
  5. **Judge:** The API permits only taxonomy labels. The judge checks each student's claim first. It writes 2 replies ("fixed now" and "a teacher will check"), and code picks one after routing.
  6. **Vote:** The vote checks only the answer.
  7. **Guard:**
     - Each repair has its own rule in code.
     - A size limit on edits.
     - 2 risk levels.
     - All fixes for one question go on one copy.
     - Each route has a reason.
  8. **Write:** Code checks `results.json` before it saves the file. Code gives each case an urgency score and writes `cost.json`.

  In the test, the count of auto-fixes on reports with no defect must be 0.
- **Why:** The largest bug: the judge wrote "Fixed" in a reply before code decided if the fix would be used. A student could read "Fixed" for a fix that a teacher must still check.

### 13. The plain Anthropic SDK, not LangChain or LangGraph

- **Problem:** I had to choose how to call the AI.
- **Decision:** Use the plain `anthropic` Python SDK.
- **Why:**
  - The 8 steps always run in the same order, so normal Python functions are enough.
  - Only 2 steps call the AI.
  - The SDK already gives structured JSON output and the token use for the cost record.
  - The prompts stay exactly as written, so `PROMPTS.md` shows what the AI receives.
- **Dropped:**
  - LangChain, because it adds layers, dependencies and its own prompt templates.
  - LangGraph, because it is for agents that choose their own next step. Our pipeline has no loops. The human review happens in the console, after the run.

### 14. Models: Sonnet and Opus, no Haiku or Fable

- **Problem:** I had to choose models for good accuracy at a reasonable cost.
- **Decision:**
  - Solver 1: Sonnet 5.5.
  - Solver 2: Opus 5.5.
  - Tiebreak solver: Opus 5.5 with extended thinking. It runs only when Solvers 1 and 2 disagree.
  - Judge: Sonnet 5.5.
- **Why:**
  - Two different models make the two solves more independent.
  - The tiebreak runs on only a few questions, so the slow, careful mode costs little.
  - The judge mostly reads facts and writes labels, and Sonnet is strong enough for this.
- **Dropped:**
  - Fable 5.1, because it costs too much.
  - Haiku 5.5, because it is too weak for hard physics. One wrong solve can change a correct key.

### 15. A real defect counts, even if the student's claim is wrong

- **Problem:** In R040 the student wrote only "wrong". The key is correct, but option B has a spelling error ("Canolla"). In R004 the student claims 8225, which is wrong, but the key is also wrong.
- **Decision:**
  - The verdict is `defect` when the defect is about what the student reported, or when the comment is too vague to point anywhere. Examples: R004 (the key is wrong), R040 ("wrong").
  - If the student makes a specific claim that is wrong, and the defect has no connection to it, the verdict follows the claim (`no_error`). The defect goes to the bonus list and is fixed separately. Example: R030.
  - A display detail that does not change the meaning for a student is not a defect.
  - The reply tells the student all the facts.
- **Why:**
  - `no_error` means "checked and correct", so a question with a defect that the student reported is not `no_error`.
  - The README says that a short comment such as "wrong" can still point to a real defect.
  - Each verdict answers the student's report, and no real defect is lost.
- **Dropped:**
  - Judging only the student's claim, because it would leave real defects live.
  - "Any defect makes the verdict `defect`", because it gives unrelated verdicts (see "AI was wrong", case 3).
