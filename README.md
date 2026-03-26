# autoscreeps

This repository is for building and improving a Screeps bot on a local private server with strong instrumentation and observability. The goal is to support iterative, data-driven development by both humans and AI agents.

## Experimental Methodology

We expect to use two primary experiment styles:

- Compare two variants of the bot against each other under the same conditions and keep the more successful variant.
- Run a single variant to a defined tick limit and evaluate whether it succeeds according to one or more metrics.

## Observability

We intend to capture as much useful instrumentation as practical from each run so that behavior can be analyzed, failures can be understood, and improvements can be guided by evidence rather than guesswork.
