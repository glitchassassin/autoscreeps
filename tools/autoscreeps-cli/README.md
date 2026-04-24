# autoscreeps-cli

Standalone TypeScript CLI for running local Screeps experiments against the private server stack in this repository.

Use Node 24 for this package. The repository root includes `.nvmrc`, so `nvm use` will select the expected runtime.

## Commands

- `autoscreeps experiment run duel`
- `autoscreeps experiment run suite`
- `autoscreeps experiment watch [suite-id]`
- `autoscreeps experiment list`
- `autoscreeps experiment show <suite-id>`

## Example

```sh
nvm use
node src/cli.ts experiment run duel \
  --scenario ../../e2e/scenarios/duel-basic.yaml \
  --baseline-source git:main \
  --baseline-package bots/basic \
  --candidate-source workspace \
  --candidate-package bots/basic
```

All recorded history is written under `.autoscreeps/suites/` at the repository root.

`autoscreeps experiment run duel` is persisted as a one-case suite so `list`, `show`, and `watch` all operate on the same suite-first history model.

## Suite Manifests

`autoscreeps experiment run suite` executes a YAML manifest containing a fixed set of experiment cases. Each case points at a base scenario and may override deterministic details such as `mapGenerator.sourceMapId` and `run.maxTicks`.

Example:

```sh
nvm use
node src/cli.ts experiment run suite \
  --manifest ../../e2e/suites/smoke.yaml \
  --baseline-source workspace \
  --baseline-package bots/basic \
  --candidate-source workspace \
  --candidate-package bots/basic
```

`autoscreeps experiment watch` follows the newest suite automatically and switches to a newer suite when one starts.

`autoscreeps experiment watch <suite-id>` pins the watcher to a specific suite.

## Room Images

Sampled runs write deterministic room PNGs under each case directory:

```text
.autoscreeps/suites/<suite-id>/cases/<run-id>/room-images/<role>/<game-time>-<room>.png
```

Each image uses the server terrain palette as the base layer and overlays room objects. `RoomVisual` data is not rendered.
