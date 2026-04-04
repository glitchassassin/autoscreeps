# Milestone 1

## Goal

Build a reproducible experiment system and scorecard for early-game colony performance, then use it to land the first bot architecture changes for a stable opener.

Milestone 1 is intentionally limited to economy, recovery, and observability. Adversarial pressure is deferred to milestone 2.

## Scope

- In scope: reproducibility, run metadata, time-series metrics, bot telemetry, train vs holdout suites, opener architecture, recovery after deterministic disruptions.
- Out of scope: adversarial harassment, skirmish benchmarking, breach logic, tournament objective logic, late-game logistics.

## Success Criteria

- `100%` of milestone-one runs record reproducible case metadata: scenario, suite, case id, map identity, assigned rooms, and variant source snapshots.
- `100%` of milestone-one runs emit machine-readable time-series artifacts, not just end-of-run summaries.
- A training suite and a holdout suite both exist and are used for promotion decisions.
- The selected opener architecture reaches the tick budget in `100%` of clean runs to `5000` ticks without crash or deadlock.
- The selected opener architecture reaches the tick budget in at least `95%` of deterministic disruption runs to `5000` ticks.
- Relative to the current `bots/basic` baseline, the selected architecture improves at least `2` primary opener metrics on the training suite.
- The selected architecture shows no material holdout regression. The default gate is no worse than `5%` on any primary metric.

## Primary Metrics

- `T_RCL2`: first tick an owned controller reaches RCL 2.
- `T_RCL3`: first tick an owned controller reaches RCL 3.
- `spawnIdlePct`: percent of sampled ticks where a spawn is idle while the bot reports unmet spawn demand.
- `sourceUptimePct`: percent of sampled ticks where each owned source has an assigned active worker.
- `recoveryLatency`: ticks from a deterministic disruption event to restoration of minimum viable staffing.
- `completionRate5k`: fraction of runs that reach the tick budget without collapse.

## Secondary Metrics

- `energyHarvestedPer100Ticks`
- `energySpentOnSpawnPer100Ticks`
- `energyUpgradedPer100Ticks`
- `energyBuiltPer100Ticks`
- `creepDeaths`
- `firstExtensionTick`
- `firstContainerTick`
- `queueDepth`
- `modeTransitions`

## Instrumentation Principles

- Harness data is the source of truth for outcome metrics.
- Bot telemetry is the source of truth for internal decision state.
- Promotion decisions should use aggregated suite results, not one-off runs.
- The proxy test layer should be reproducible and intentionally free of adversarial pressure in this milestone.

## Harness Instrumentation

- Add deterministic case identity to each run: suite, case id, map id or explicit rooms, room-selection strategy, and variant snapshots.
- Replace random case selection with explicit fixed-map manifests or seedable map selection.
- Add periodic sampling during runs. Start with one sample every `25` ticks.
- Record per-sample world state for each variant: controller level, controller progress, creep count, spawn count, extension count, construction site count, owned room count, combined RCL, total owned energy, and room summary data needed for derived metrics.
- Add derived-metric computation from the sample stream so the runner can calculate `T_RCL2`, `T_RCL3`, completion, and structure timing automatically.
- Add suite-level aggregation and comparison so candidate runs can be judged on medians, p90s, completion rate, and regressions.
- Add support for deterministic disruption events for milestone-one recovery tests.

## Bot Instrumentation

- Add a structured telemetry snapshot written on a fixed cadence such as every `25` ticks.
- Record colony mode, role counts, body-part counts by role, spawn queue depth, unmet demand by role, and source assignments.
- Record cumulative counters for harvest, spawn, upgrade, build, repair, pickup, drop, and deaths.
- Record milestone ticks such as first spawn, `RCL2`, `RCL3`, first extension, first container, recovery start, and recovery end.
- Record a bounded event ring buffer for state changes such as entering recovery mode or detecting an unstaffed source.
- Version the telemetry schema so the harness can parse telemetry safely over time.

## Scenario Suite

- Clean opener training suite: `8` fixed mirrored maps, `2000` ticks.
- Clean opener long suite: the same `8` fixed mirrored maps, `5000` ticks.
- Deterministic disruption suite: `4` fixed cases with a scripted worker-loss event.
- Holdout suite: `4` unseen fixed maps, each run at `2000` and `5000` ticks.

## Experimentation Plan

### Phase 0

- Run the current `bots/basic` bot across the full milestone-one suite.
- Capture baseline distributions for the primary metrics.
- Lock the promotion thresholds using observed baseline data.

### Phase 1

- Introduce a thin `sense -> plan -> spawn -> act` colony loop.
- Keep behavior intentionally close to the current bot.
- Use this phase to prove the architecture refactor does not regress the baseline opener.

### Phase 2

- Test one architectural hypothesis at a time against the training suite.
- Validate every promising change against the holdout suite and the disruption suite.
- Keep only changes that improve the training suite without introducing material holdout regression.

## Milestone-One Hypotheses

- Hypothesis A: fixed role counts are the main reason for poor opener stability. Test a demand-based spawn queue.
- Hypothesis B: nearest-source worker behavior is the main reason for weak energy throughput. Test source assignment and a static miner plus hauler split.
- Hypothesis C: the current bot collapses too easily after early losses. Test explicit recovery mode and emergency spawn priorities.

## Promotion Rules

- A candidate must beat the current selected baseline on at least `2` primary metrics on the training suite.
- A candidate must not regress more than `5%` on any primary metric on the holdout suite.
- A candidate must preserve or improve `completionRate5k` on the disruption suite.
- A candidate must produce complete run artifacts and parseable telemetry for every evaluation run.

## Tasks

1. Define the milestone-one scorecard.
2. Add deterministic case identity and reproducible case selection to the harness.
3. Add periodic run sampling and time-series artifact capture.
4. Add derived-metric computation from sampled world state.
5. Add suite-level aggregation and comparison reporting.
6. Add deterministic disruption-event support for recovery tests.
7. Define and document the milestone-one training, long, disruption, and holdout suites.
8. Add structured bot telemetry with a stable schema version.
9. Benchmark the current `bots/basic` bot across the full suite and record the baseline report.
10. Refactor `bots/basic` into a thin `sense -> plan -> spawn -> act` colony loop without intentionally changing strategy.
11. Implement and evaluate a demand-based spawn queue.
12. Implement and evaluate source assignment and static mining logistics.
13. Implement and evaluate explicit recovery mode and emergency spawn priorities.
14. Freeze the selected milestone-one baseline for use in milestone 2.

## Deliverables

- A milestone-one scorecard and promotion gate.
- Reproducible milestone-one suites.
- Harness support for time-series metrics and suite aggregation.
- Bot telemetry with stable schema.
- A benchmark report for the current `bots/basic` bot.
- A selected milestone-one opener architecture that becomes the baseline for milestone 2.
