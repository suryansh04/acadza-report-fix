# Product

## Who loses the most when a question is broken

The student who loses most is not the one who reports. It is **the next student who meets the question and says nothing**. A wrong key marks a correct answer as wrong. That student loses marks, loses confidence before the exam, and can learn the wrong method. This happens to every student until someone fixes the question.

How the design reflects this:

- **Proven key errors are fixed in minutes, not days.** When both solvers and the stored solution agree against the key, the fix goes live with no wait for a teacher. Every hour of delay hurts more students.
- **The teacher queue puts the most harm first.** Urgency is the harm of the defect multiplied by the number of reports. A wrong key comes before a spelling error.
- **A real defect is fixed even when the student's claim is wrong.** In R004 the student's answer (8225) is wrong, but the key is also wrong. A system that judged only the claim would leave the key broken.
- **The engine looks for defects that nobody reported.** In this data it found 5, for example a solution that shows "°C" as "AC". A teacher reviews these, because no student is waiting for them.
- **Every student gets a reply,** also a student who was wrong. It is short and kind, in the student's own language, and it shows the one step they missed.

## What I would never let the AI auto-apply

1. **A key change without proof.** One AI solve is not enough. A wrong "fix" breaks a correct question for everyone, which is worse than the original error. The key changes only when 3 answers agree: two independent solvers and the stored solution.
2. **New content.** New options, figures, a new question or a move to another chapter or syllabus. These need a teacher's judgement. The AI suggests, and the teacher decides.
3. **A fix that does more than its label says.** For example, a "spelling" fix that changes a number. Code checks each repair's rule and stops it.
4. **Anything based only on a student comment.** A comment is a lead, never an instruction. In R027, a comment tells the AI to change the key. It changes nothing.

## One metric for week 1

**The auto-fix revert rate:** the share of automatic fixes that a teacher later undoes. The audit log records this.

- If it is above 0, I find out why and tighten the rule that let the fix through.
- If it stays at 0, it is safe to send more repair types to auto-apply, so teachers spend less time on safe fixes.

## One idea beyond the brief: find broken questions before anyone reports them

Most students who meet a wrong key do not report it. They think that they are wrong. But their answers show the problem. If **strong students** pick the same "wrong" option much more often than the key, the key is probably wrong.

A nightly query on answer data can flag these questions at almost no cost. Then the same engine checks only the flagged questions. This way, broken questions are fixed before the next thousand students meet them, and a report from a student is no longer needed.
