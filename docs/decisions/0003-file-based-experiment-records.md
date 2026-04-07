# ADR 0003: File-Based Experiment Records

- Status: Accepted
- Date: 2026-04-03

## Context

The experiment runner needs to preserve enough information about each run for later inspection, comparison, and replay.

At the same time, the Screeps world itself is intentionally disposable. Full resets use `docker compose down -v`, which removes the local MongoDB, Redis, and Screeps server data.

We also need reproducible provenance for workspace-based experiments that may include uncommitted changes.

## Decision

We will store experiment records as files in the repository workspace instead of treating the Screeps server databases as the source of truth.

Recorded experiment suites will live under `.autoscreeps/suites/`.

Each suite directory will contain structured files such as:

- `suite.json` for suite metadata, progress, and case summaries
- `events.jsonl` for suite-level execution events
- `cases/<case-run-id>/run.json` for per-case run metadata and status
- `cases/<case-run-id>/variants.json` for resolved variant inputs and build metadata
- `cases/<case-run-id>/metrics.json` for captured case results
- `cases/<case-run-id>/events.jsonl` for per-case execution events

Standalone duel invocations will be recorded as one-case suites so history inspection can remain suite-first.

Variant provenance will be recorded as source state, not just build output:

- `git:<ref>` variants store the resolved commit SHA
- `workspace` variants store the current `HEAD` SHA plus a binary patch generated from a temporary git index, so tracked edits, deletions, and newly added files are captured without modifying the real index

We will store bundle hashes for verification, but the bundle itself is not the primary archival artifact.

## Why

- File-based records survive full server resets.
- The results are easy for humans and agents to inspect directly from the repository.
- Workspace experiments remain reproducible even when they are based on uncommitted changes.
- This keeps experiment history separate from disposable game-state storage.
- It avoids introducing another service or database just to keep run metadata.

## Consequences

### Positive

- Experiment history is durable across `docker compose down -v` resets.
- Replaying or auditing a run does not require access to the old Screeps database state.
- The run format is transparent and simple to browse with normal filesystem tools.
- Source provenance is explicit for both committed and dirty-workspace variants.

### Negative

- Suite history now consumes local disk space in the repository workspace.
- Reconstructing a workspace-based run requires applying a stored patch before rebuilding.
- The files are only as reproducible as the captured source state and the build environment.

## Alternatives Considered

### Store experiment history in the Screeps server databases

Rejected because full environment resets intentionally destroy those databases.

### Store only built bundles as run artifacts

Rejected because bundles alone do not preserve the exact source state that produced them, especially for dirty-workspace runs.

### Introduce a separate experiment metadata service or database

Rejected for now because a filesystem-backed format is sufficient, simpler to automate, and easier to inspect.
