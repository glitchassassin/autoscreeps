# autoscreeps-cli

Standalone TypeScript CLI for running local Screeps experiments against the private server stack in this repository.

Use Node 24 for this package. The repository root includes `.nvmrc`, so `nvm use` will select the expected runtime.

## Commands

- `autoscreeps experiment run duel`
- `autoscreeps experiment run suite`
- `autoscreeps experiment watch [run-id]`
- `autoscreeps experiment list`
- `autoscreeps experiment show <run-id>`

## Example

```sh
nvm use
node src/cli.ts experiment run duel \
  --scenario ../../experiments/scenarios/duel-basic.yaml \
  --baseline-source git:main \
  --baseline-package bots/basic \
  --candidate-source workspace \
  --candidate-package bots/basic
```

Run history is written under `.autoscreeps/runs/` at the repository root.

## Suite Manifests

`autoscreeps experiment run suite` executes a YAML manifest containing a fixed set of experiment cases. Each case points at a base scenario and may override deterministic details such as `mapGenerator.sourceMapId` and `run.maxTicks`.

Example:

```sh
nvm use
node src/cli.ts experiment run suite \
  --manifest ../../experiments/suites/milestone-1-smoke.yaml \
  --baseline-source workspace \
  --baseline-package bots/basic \
  --candidate-source workspace \
  --candidate-package bots/basic
```

`autoscreeps experiment watch` follows the newest run automatically and switches to a newer run when one starts.

`autoscreeps experiment watch <run-id>` pins the watcher to a specific run.
