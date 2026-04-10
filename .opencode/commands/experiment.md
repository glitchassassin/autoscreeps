---
description: Implement, run, review, and log an experiment
agent: build
---

Implement and run $ARGUMENTS.

Before implementing anything, read the most recent related entries under `docs/experiments/` and classify the next experiment as one of:

- `structural/promotion`: expected to materially improve the primary metrics on the main suite
- `diagnostic/ablation`: intended to falsify one causal hypothesis on a focused suite or sub-suite

Do not run a micro-tweak by default.

Reject the proposed experiment and redesign it unless you can state all of the following before writing code:

- the dominant current bottleneck, backed by observed metrics rather than guesswork
- the relevant Screeps hard constraints or theoretical ceiling
- why the proposed lever is first-order against that bottleneck rather than a second-order tweak
- the minimum meaningful effect you expect on the primary metrics or causal metrics
- what branch of ideas this experiment will rule out if it fails

If the proposed change is mainly a threshold tweak, priority reorder, reserve or hysteresis adjustment, or small body-shape tweak, only run it when at least one of the following is true:

- the current branch is already close to passing the suite and the bottleneck is narrowly localized
- the run is a focused diagnostic ablation rather than a promotion attempt

If the last two related experiments stayed in the same performance regime or produced only near-null deltas, escalate the step size.
Prefer changes that alter architecture, role composition, source-to-bank logistics, spawn-bank policy, or another first-order resource-flow decision over another local tweak.

Use the full milestone suite for promotion experiments.
Use a focused suite or sub-suite for diagnostic ablations when only a subset of maps expresses the bottleneck.
When using a focused suite, explain why those cases are the right positive and negative controls.

Before running, consult the `screeps-world-expert` subagent about the planned experiment.
Do not share implementation details with that subagent. Share only the experiment goal, current metrics, theoretical headroom, proposed lever, and expected effect size.
If the expert judges the lever too small, second-order, or poorly matched to the bottleneck, redesign before implementing.

After the experiment runs, consult the `screeps-world-expert` subagent about the results and see what ideas it has.
Do not share your current implementation with that subagent. Share only the experiment goal, setup, observed behavior, metrics, and results.

If the experiment failed, consider if you have enough metrics to determine exactly what went wrong without guessing. If not, what metrics would answer this question? Add them and re-run the experiment.

If the result is a near-null treatment, a same-regime outcome, or a numerical pass that never realized the intended treatment, record it that way explicitly.
Do not describe such a result as a meaningful success, and do not chain another small tweak from it unless the run answered a sharp causal question.

Based on the results and feedback from the expert, determine the next planned experiment.
Prefer the next experiment that most cleanly distinguishes between remaining branches of explanation, not the smallest possible modification.

Record the completed experiment results and the next planned experiment in the appropriate log under `docs/experiments/`, following the existing structure and naming conventions. If there is no more specific destination, use `docs/experiments/milestone-1-log.md`.
For each entry, explicitly capture the experiment type, dominant bottleneck, relevant theoretical headroom, and what the result ruled out.

After recording the experiment results, commit the relevant changes, including the implementation, supporting updates, and experiment log entry.
