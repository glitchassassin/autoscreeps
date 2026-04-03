# autoscreeps-cli

Standalone TypeScript CLI for running local Screeps experiments against the private server stack in this repository.

## Commands

- `autoscreeps experiment run duel`
- `autoscreeps experiment list`
- `autoscreeps experiment show <run-id>`

## Example

```sh
npm run dev -- experiment run duel \
  --scenario ../../experiments/scenarios/duel-basic.yaml \
  --baseline-source git:main \
  --baseline-package bots/basic \
  --candidate-source workspace \
  --candidate-package bots/basic
```

Run history is written under `.autoscreeps/runs/` at the repository root.
