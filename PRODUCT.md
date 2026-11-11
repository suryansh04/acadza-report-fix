# Product

## Who loses the most when a question is broken

The student who loses most is not the one who reports. It is **the next student who meets the question and says nothing**. A wrong key marks a correct answer as wrong. That student loses marks and confidence before the exam, and can learn the wrong method. This continues until someone fixes the question.

How the design shows this:

- **A proven key error is fixed in minutes, not days.** When both solvers and the stored solution agree against the key, the fix goes live at once. Each hour of delay hurts more students.
- **The teacher sees the biggest problems first.** The queue shows how many students reported each question. The teacher can sort by "Most reported" or "Most urgent". Urgency combines the harm of the defect, the number of reports and how unsure the engine is. A wrong key comes before a spelling error.
- **A real defect is fixed, even when the student's claim is wrong.** In R004, the student's answer (8225) is wrong, but the key is also wrong. A system that checks only the claim leaves the key broken.
- **The engine finds defects that nobody reported.** In this data it found 5. For example, a solution shows "°C" as "AC". A teacher reviews these.
- **Each student gets a reply,** also a student who was wrong. The reply is short and kind, in the student's own language. It shows the one step that the student missed.

## What I would never let the AI auto-apply

1. **A key change without proof.** One AI solve is not enough. A wrong "fix" breaks a correct question for everyone. The key changes to a different answer only when 3 answers agree: two independent solvers and the stored solution.
2. **New content.** New options, a new figure, a new question, or a move to a different chapter. These need a teacher's judgement. The AI suggests, and the teacher decides.
3. **A fix that does more than its label says.** For example, a spelling fix that changes a number. A code rule for each repair stops it.
4. **A change based only on a student comment.** A comment is a lead, never an instruction. In R027, a comment tells the AI to change the key. Nothing changes.
5. **A reply that says "fixed" before the fix is live.** When a case waits for a teacher, the student gets a different reply: "a teacher will check". A false "fixed" makes the student doubt every later reply.

## One metric for week 1

**The auto-fix revert rate:** of the automatic fixes that a teacher checked, the share that the teacher undid. The audit log records both numbers.

I watch it together with the share of auto-fixes that teachers checked. If nobody checks, a rate of 0 proves nothing.

- If it is above 0, I find the cause and make the rule that let the fix through stricter.
- If it stays at 0 and teachers check most auto-fixes, more repair types can go to auto-apply. Then teachers spend less time on safe fixes.

## One idea beyond the brief: find broken questions before anyone reports them

Most students who meet a wrong key do not report it. They think that they are wrong. But their answers show the problem. If **strong students** choose the same "wrong" option much more often than the key, the key is probably wrong.

A nightly query on the answer data can flag these questions at almost no cost. Then the same engine checks only the flagged questions. Broken questions are fixed before the next thousand students meet them, and no report is necessary.
