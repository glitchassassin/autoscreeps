# Running Experiments

Use `tools/autoscreeps-cli` to run local Screeps experiments against the Docker-based private server.

## Before You Start

- Follow the stack prerequisites in `docs/ops/private-server.md`
- Install the CLI dependencies:

```sh
nvm use
cd tools/autoscreeps-cli
npm install
```

## Run The Sample Duel

This compares the committed `main` version of `bots/basic` against the current workspace version of the same package:

```sh
nvm use
cd tools/autoscreeps-cli
node src/cli.ts experiment run duel \
  --scenario ../../experiments/scenarios/duel-basic.yaml \
  --baseline-source git:main \
  --baseline-package bots/basic \
  --candidate-source workspace \
  --candidate-package bots/basic
```

The sample scenario imports `random_1x2`, assigns `E2N2` to `baseline`, and assigns `E3N2` to `candidate`.

## Inspect Results

- List recorded runs:

```sh
nvm use
cd tools/autoscreeps-cli
node src/cli.ts experiment list
```

- Show one recorded run:

```sh
nvm use
cd tools/autoscreeps-cli
node src/cli.ts experiment show <run-id>
```

Run history is written to `.autoscreeps/runs/` at the repository root.

## Change The Compared Bots

Each side of the duel has two inputs:

- `--*-source`: `workspace` or `git:<ref>`
- `--*-package`: repo-relative package path, such as `bots/basic`

That lets you compare:

- `git:main` vs `workspace`
- two different git refs
- two different bot package paths
