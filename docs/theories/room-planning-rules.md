# Room Planning Rules

## Policies

- `normal`: SHOULD prioritize a defensible economic center with good surrounding build area.
- `temple`: SHOULD prioritize pre-`RCL8` upgrading throughput by pulling the hub toward the controller.

## Hub

The hub is a `3x3` cluster around a central stationary manager creep. This is the economic center of the room.

In `temple` mode, the hub expands to a `3x4` cluster and includes an additional stationary lab creep. This deprioritizes the full `RCL8` lab layout, since temple rooms will rarely hit `RCL8`, and focuses on boosting upgraders.

- In a normal room, the hub SHOULD be positioned defensively.
- In a temple room, the hub SHOULD be positioned to maximize pre-`RCL8` upgrading throughput.

### Buildings

- `storage` at `[0,0]`.
- `link` at `[1,0]`.
- `terminal` at `[2,0]`.
- `factory` at `[0,1]`.
- `power spawn` at `[0,2]`.
- `spawn` at `[1,2]`.
- `lab` at `[2,2]` in `temple` mode only.
- `lab` at `[3,2]` in `temple` mode only.
- `lab` at `[3,1]` in `temple` mode only.

### Layout

- `manager` creep at `[1,1]`.
- `lab` creep at `[2,1]` in `temple` mode only.

### Location

Hub candidates are scored primarily by the hub center, plus the induced arrangement of hub structures around that center.

#### Hard Constraints

- Hub centers MUST NOT be within range `4` of the controller.
- Hub centers MUST NOT be within range `4` of any source.
- In `temple` mode, the hub center MUST be in range `5` of the controller.
- In `temple` mode, `storage` MUST be adjacent to at least one controller range `3` tile.
- In `temple` mode, `terminal` MUST be adjacent to at least one controller range `3` tile.
- In `temple` mode, `storage` MUST have a path to at least one room exit tile.
- In `temple` mode, `terminal` MUST have a path to at least one room exit tile.
- For those temple path checks, the planner MUST treat the `manager` tile as blocked, occupied hub structure tiles as blocked, and empty hub tiles as walkable.

#### Scoring

If `temple`:

- `upgrading tiles` MUST be defined as walkable tiles within controller range `3`.
- The scorer SHOULD maximize the number of upgrading tiles in range `2` of the hub center.
- The scorer SHOULD maximize the size of the largest contiguous upgrading region connected to those range `2` upgrading tiles.

Otherwise:

- The scorer SHOULD maximize path distance from the hub center to the nearest exit tile.
- The scorer SHOULD maximize terrain distance transform at the hub center.
- The scorer SHOULD minimize the min-cut size required to defend a provisional `10x10` bounding box centered on the hub.

## Fastfiller

The fastfiller pods are minimal extension stamps with a shared container and spawn, operated by two stationary filler creeps.

### Stamp

- The planner MUST use `2` identical fastfiller pods.
- The fastfiller pod consists of two `3x3` squares, where the center is empty and reserved for the filler, and the sides are extensions.
- The squares MUST have exactly one overlapping corner.
- The overlapping extension is replaced with a container.
- The container MUST have a path to `storage`.
- One of the extensions adjacent to the container MUST be replaced with a `spawn`.
- At `RCL8`, one of the extensions adjacent to the container MUST be replaced with a `link`.

### Placement

- The scorer SHOULD minimize the distance to `storage`.
- The scorer SHOULD minimize the detour from source path.
  - Detour from source MUST be computed by `dStorage(tile) + dSource(tile) - dStorageToSource`.

## Labs

- The planner MUST use a standard `4x4` lab stamp.
- The lab stamp entrance MUST be the top-left tile.
- The lab stamp MUST reserve a road diagonal from the entrance corner to the opposite corner.
- The other two corners MUST be empty.
- Every other lab stamp tile MUST contain a lab:

```text
RLL.
LRLL
LLRL
.LLR
```

### Placement

- The scorer SHOULD minimize the combined distance from the entrance to `terminal` and `storage`.

## Stamps

Stamps MUST be selected sequentially so each placement accounts for pathing around previously planned structures.

### Search

- The planner MUST compute the top `K` hub candidates.
- For each hub candidate, the planner MUST recompute path-distance maps and compute the top `K` first fastfiller pod candidates.
- For each `hub + pod1` candidate, the planner MUST recompute path-distance maps and compute the top `K` second fastfiller pod candidates.
- For each `hub + pod1 + pod2` candidate, the planner MUST recompute path-distance maps and compute the top `K` lab stamp candidates in `normal` rooms only.
- All stamp candidates MUST fit without overlapping previously placed stamps.
- The planner MUST score complete layouts and keep the best arrangement.

## Road Planning

Primary roads MUST be planned after the hub, fastfiller pods, and lab stamp have been placed. Each subsequent road MUST account for previously planned roads in the pathfinding cost matrix, promoting reuse.

Roads other than `storage -> controller` SHOULD prefer to avoid controller range `3` by applying a high pathfinding cost to those tiles. The `storage -> controller` road MAY enter controller range `3`.

### Paths

- The planner MUST plan paths for `storage -> pod1 container` and then `storage -> pod2 container`. The planner MUST then reverse the order (`pod2` first) and plan again. The planner MUST keep the plan with the fewest unique road tiles.
- In `normal` rooms, the planner MUST plan paths for `terminal -> lab entrance` and `storage -> lab entrance`. The planner MUST then reverse the order and keep the plan with the fewest unique road tiles.
- The planner MUST plan a path for `terminal -> mineral`, targeting any tile in range `1` of the mineral.
- The planner MUST plan paths for `storage -> source1` and `storage -> source2`, targeting any tile in range `1` of the source. The planner MUST then reverse the order (`source2` first) and plan again. The planner MUST keep the plan with the fewest unique road tiles.
- The planner MUST plan `storage -> controller`, targeting any tile in range `3` of the controller.

## Sources and Sinks

Source and sink structures MUST be planned immediately after primary roads and before pre-mincut extra-structure reservation or rampart planning.

### Sources

- The last tile of the planned road from `storage` to each source MUST have a container.
- The last tile of the planned road from `storage` to the source MUST have an adjacent link that MUST NOT be on the planned road. The first link MUST be built at `RCL5`, and the second MUST be built at `RCL6`.

### Controller

If `temple`, no additional structures are needed.

Otherwise:

- Below `RCL7`, the last tile of the planned road from `storage` to the controller MUST have a container.
- At `RCL7`, the last tile of the planned road from `storage` to the controller MUST have an adjacent non-road link tile at range `4` from the controller, and the container MUST be removed.

### Minerals

- At `RCL7`, the last tile of the planned road from `terminal` to the mineral MUST have a container.
- An extractor MUST be built on the mineral itself.

## Pre-Mincut Extra Structures

The planner MUST reserve generic extra-structure slots before rampart min-cut planning. These slots MUST include room for both spare extensions and towers, and MUST be included in the defended interior so the min-cut does not cut off valid build space.

### Slots

Extra-structure slots SHOULD be populated along roads close to `storage` for easy access to refillers and builders.

- The planner MUST reserve the remaining RCL8 extensions not already supplied by fastfiller pods.
- The planner MUST reserve up to six additional slots for towers.
- The planner SHOULD grow a bounded number of extra access road tiles before placing slots when those roads reduce the selected slots' total planned-road path distance from `storage`.
- Extra access roads MUST be connected to the planned road network and MUST avoid reserved source, controller, edge, and stamp areas.
- The planner MUST prioritize road-adjacent tiles in two groups: roads from `storage` to the two fastfiller pods, then all other planned roads.
- Within each road group, the planner MUST rank candidates by path distance from `storage` over the planned road network instead of filling one road path at a time.
- Slot candidates MUST be empty buildable tiles adjacent to the planned road network and outside reserved source, controller, edge, and stamp areas.
- Slot candidates MUST avoid already planned source/sink structure tiles.

## Ramparts

- The planner MUST use a weighted min-cut algorithm to separate room exits from the defended interior.
- Mandatory road tiles MAY carry the rampart cut line because roads and ramparts can share a tile.
- The controller MUST be protected by forcing its walkable range `1` access tiles onto the defended side; those controller-access tiles MAY carry the rampart cut line.
- Mandatory non-road structures MUST remain on the defended side of the cut.

### Must Defend

- Hub.
- Fastfiller pods.
- Lab stamp in `normal` rooms.
- Controller access tiles at range `1`.
- In `temple` rooms, the hub and upgrader working area.
- Primary interior roads connecting the hub, fastfiller pods, and lab stamp, including both `terminal -> labs` and `storage -> labs`.
- Pre-mincut access roads.
- Pre-mincut extra-structure slots.

### Optional Regions

- `source1` region.
- `source2` region.
- `controller` region.
- A source region MUST include the source-adjacent container, link, and road endpoint.
- The controller region MUST include the planned `storage -> controller` road path.

### Objective

- The solver MUST minimize total rampart tiles.
- The solver MUST minimize defender travel distance to the rampart line.
- The solver MUST minimize penalties for leaving optional regions outside.

### Weights

- Core protection MUST be mandatory and MUST NOT be weighted.
- Each rampart tile MUST have base cost `1`.
- Each rampart tile MUST get a small additional cost based on path distance from the hub.
- `source1`, `source2`, and `controller` MUST be weighted as optional benefits.

### Post-Processing

- The planner MUST add roads under ramparts.
- The planner MUST add roads from the interior to each connected rampart group.
- The planner MUST add extra ramparts to structures (other than roads) outside the ramparts.
- The planner MUST add extra ramparts to structures inside the ramparts but within range `2` of the outermost ring of ramparts.

## Towers

- The planner MUST place towers after rampart min-cut planning so tower choices can be scored against the actual rampart line.
- Candidate tiles MUST be defended pre-mincut extra-structure slots adjacent to the planned road network, including pre-mincut access roads.
- Candidate tiles MUST avoid ramparts, roads, stamps, source reserve zones, controller reserve zones, room-edge reserve zones, and already assigned tower slots.
- Tower placement MUST score each candidate by its tower damage coverage over every planned rampart tile using Screeps range falloff.
- Tower placement SHOULD greedily add towers one at a time, each time maximizing the weakest covered rampart tile before considering total coverage.
- Tower placement SHOULD prefer higher total coverage, wider tower spread, and shorter hub path distance when weakest-rampart coverage is tied.

## Extensions

- The planner MUST assign spare extensions after tower placement.
- Extensions MUST fill the remaining pre-mincut extra-structure slots in the slot planner's ranked order.

## Remaining Structures

### Placement

- The planner MUST repeat the process to select a spot for the `nuker`.
- The planner MUST repeat the process to select a spot for the `observer`.
