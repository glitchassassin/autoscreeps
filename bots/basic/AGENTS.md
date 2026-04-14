## Concise Style Guide

- Prefer plain data over object wrappers.
- Prefer free functions over instance methods.
- Keep module boundaries pure: `input -> output`, with no hidden side effects.
- Allow local mutable builders inside hot loops.
- Avoid immutable copying in per-tick inner loops.
- Avoid per-tick `new` wrappers for creeps, rooms, sources, or tasks.
- Avoid per-instance closures on hot-path objects.
- Use ids and plain snapshots in planner data, not live `Game` objects.
- Keep passes explicit: observe, derive, plan, execute, report.
- Recompute cheap tick-local data instead of abstracting it heavily.
- Measure before optimizing style-level details.
