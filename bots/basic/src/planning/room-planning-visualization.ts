import { installPlannerPathFinder } from "./pathfinder.ts";
import { planRamparts, validateRampartPlan, type RampartPlan } from "./rampart-plan.ts";
import { planRoads, validateRoadPlan, type RoadPlan } from "./road-plan.ts";
import type { CompleteRoomPlan, RoomPlanningPolicy, RoomPlanningRoomData } from "./room-plan.ts";
import { planRoomStructures, validateRoomStructurePlan, type RoomStructurePlan } from "./structure-plan.ts";
import {
  createStampPlacementDebug,
  planRoomStamps,
  validateStampPlan,
  type RoomStampAnchor,
  type RoomStampPlan,
  type StampCandidateSummary,
  type StampPlacement
} from "./stamp-placement.ts";

const roomSize = 50;

export type RoomPlanningVisualization = {
  roomName: string;
  policy: RoomPlanningPolicy;
  plan: CompleteRoomPlan;
  steps: RoomPlanningVisualizationStep[];
  validations: string[];
};

export type RoomPlanningVisualizationStepStatus = "complete" | "skipped" | "error";

export type RoomPlanningVisualizationStep = {
  id: string;
  title: string;
  status: RoomPlanningVisualizationStepStatus;
  summary: string;
  metrics: RoomPlanningMetric[];
  candidates: RoomPlanningCandidate[];
  layers: RoomPlanningLayer[];
};

export type RoomPlanningMetric = {
  label: string;
  value: string | number;
  tone?: "good" | "warn" | "bad" | "neutral";
};

export type RoomPlanningCandidate = {
  id: string;
  label: string;
  rank: number;
  selected: boolean;
  anchor: RoomStampAnchor;
  score: number[];
  metrics: RoomPlanningMetric[];
  tiles: number[];
};

export type RoomPlanningLayerKind =
  | "stamp"
  | "candidate"
  | "path"
  | "road"
  | "structure"
  | "rampart"
  | "region"
  | "heatmap";

export type RoomPlanningLayer = {
  id: string;
  title: string;
  kind: RoomPlanningLayerKind;
  tiles: number[];
  visibleByDefault: boolean;
  tone?: "selected" | "candidate" | "road" | "structure" | "rampart" | "outside" | "defended" | "heat" | "warning";
  values?: Record<number, number>;
};

type StampDebugByPhase = ReturnType<typeof createStampPlacementDebug>["phases"][number] | undefined;

export function createRoomPlanningVisualization(
  room: RoomPlanningRoomData,
  policy: RoomPlanningPolicy,
  options: { topK?: number } = {}
): RoomPlanningVisualization {
  installPlannerPathFinder({ [room.roomName]: room.terrain });

  const stampPlan = planRoomStamps(room, policy, options);
  const roadPlan = planRoads(room, stampPlan);
  const rampartPlan = planRamparts(room, stampPlan, roadPlan);
  const structurePlan = planRoomStructures(room, stampPlan, roadPlan, rampartPlan);
  const plan: CompleteRoomPlan = {
    roomName: room.roomName,
    policy,
    stampPlan,
    roadPlan,
    rampartPlan,
    structurePlan
  };
  const validations = [
    ...validateStampPlan(room, stampPlan),
    ...validateRoadPlan(room, stampPlan, roadPlan),
    ...validateRampartPlan(room, stampPlan, roadPlan, rampartPlan),
    ...validateRoomStructurePlan(room, stampPlan, roadPlan, rampartPlan, structurePlan)
  ];
  const stampDebug = createStampPlacementDebug(room, policy, stampPlan, options);
  const phases = stampDebug.phases;

  return {
    roomName: room.roomName,
    policy,
    plan,
    steps: [
      createHubStep(stampPlan, phases[0]),
      createFastfillerStep("fastfiller-a", "Fastfiller pod A", stampPlan.stamps.fastfillers[0], phases[1], stampPlan),
      createFastfillerStep("fastfiller-b", "Fastfiller pod B", stampPlan.stamps.fastfillers[1], phases[2], stampPlan),
      createLabsStep(stampPlan, phases[3]),
      createRoadStep(roadPlan, stampPlan),
      createSourceSinkStep(room, stampPlan, roadPlan, rampartPlan, structurePlan),
      createSpareExtensionStep(stampPlan, roadPlan, rampartPlan, structurePlan),
      createRampartStep(stampPlan, roadPlan, rampartPlan, structurePlan),
      createTowerStep(stampPlan, roadPlan, rampartPlan, structurePlan),
      createRemainingStructureStep(stampPlan, roadPlan, rampartPlan, structurePlan)
    ],
    validations
  };
}

function createHubStep(stampPlan: RoomStampPlan, phase: StampDebugByPhase): RoomPlanningVisualizationStep {
  const hub = stampPlan.stamps.hub;
  const score = hub.score;
  const isTemple = stampPlan.policy === "temple";

  return {
    id: "hub",
    title: "Hub candidates",
    status: "complete",
    summary: isTemple
      ? `Selected the hub that keeps storage and terminal close to controller range 3 while preserving exit access. ${templeHubScoreExplanation()}`
      : `Selected the most defensible economic center from the top hub candidates. ${normalHubScoreExplanation()}`,
    metrics: isTemple
      ? [
        metric("objective", "maximize upgrade tiles, then connected upgrade region", "good"),
        metric("tie-break", "northmost, then westmost"),
        metric("raw tuple", formatScore(score)),
        metric("upgrading tiles within range 2", score[0] ?? 0, "good"),
        metric("connected upgrading region", score[1] ?? 0, "good"),
        metric("anchor", formatCoord(hub.anchor))
      ]
      : [
        metric("objective", "maximize exit distance and clearance, then minimize provisional cut", "good"),
        metric("tie-break", "northmost, then westmost"),
        metric("raw tuple", formatScore(score)),
        metric("exit path distance", score[0] ?? 0, "good"),
        metric("terrain clearance", score[1] ?? 0, "good"),
        metric("provisional min-cut size", Math.abs(score[2] ?? 0), "neutral"),
        metric("anchor", formatCoord(hub.anchor))
      ],
    candidates: createStampCandidates(
      phase,
      hub,
      isTemple ? createTempleHubMetrics : createNormalHubMetrics,
      isTemple ? "upgrade tiles, connected region" : "exit distance, clearance, cut size"
    ),
    layers: [
      candidateLayer("hub-candidates", "Top hub candidates", phase),
      stampLayer("hub-committed", layerTitleHub(), hub, true)
    ]
  };
}

function createFastfillerStep(
  id: "fastfiller-a" | "fastfiller-b",
  title: string,
  pod: StampPlacement,
  phase: StampDebugByPhase,
  stampPlan: RoomStampPlan
): RoomPlanningVisualizationStep {
  return {
    id,
    title,
    status: "complete",
    summary: `Selected the pod that stays close to storage while minimizing detour from source logistics. ${fastfillerScoreExplanation()}`,
    metrics: [
      metric("objective", "minimize storage distance, then source detour", "good"),
      metric("tie-break", "northmost, then westmost"),
      metric("raw tuple", formatScore(pod.score)),
      metric("storage distance", Math.abs(pod.score[0] ?? 0), "good"),
      metric("best source detour", Math.abs(pod.score[1] ?? 0), "good"),
      metric("container", formatCoord(pod.anchors.container ?? pod.anchor))
    ],
    candidates: createStampCandidates(phase, pod, createFastfillerMetrics, "storage distance, source detour"),
    layers: [
      ...createCommittedStampLayers(stampPlan, {
        fastfillerCount: id === "fastfiller-b" ? 1 : 0,
        labs: false
      }),
      candidateLayer(`${id}-candidates`, "Top fastfiller candidates", phase),
      stampLayer(`${id}-committed`, title, pod, true)
    ]
  };
}

function createLabsStep(stampPlan: RoomStampPlan, phase: StampDebugByPhase): RoomPlanningVisualizationStep {
  const labs = stampPlan.stamps.labs;
  if (stampPlan.policy === "temple" || labs === null) {
    return {
      id: "labs",
      title: "Labs",
      status: "skipped",
      summary: "Temple policy uses hub-adjacent boost labs and skips the normal RCL8 lab stamp.",
      metrics: [metric("policy", stampPlan.policy), metric("normal lab stamp", "skipped", "warn")],
      candidates: [],
      layers: createCommittedStampLayers(stampPlan, { fastfillerCount: 2, labs: false })
    };
  }

  return {
    id: "labs",
    title: "Labs",
    status: "complete",
    summary: `Selected the standard 4x4 lab stamp with the shortest combined storage and terminal access. ${labScoreExplanation()}`,
    metrics: [
      metric("objective", "minimize total access, then terminal and storage access", "good"),
      metric("tie-break", "northmost, then westmost"),
      metric("raw tuple", formatScore(labs.score)),
      metric("total access distance", Math.abs(labs.score[0] ?? 0), "good"),
      metric("terminal distance", Math.abs(labs.score[1] ?? 0), "good"),
      metric("storage distance", Math.abs(labs.score[2] ?? 0), "good"),
      metric("entrance", formatCoord(labs.anchors.entrance ?? labs.anchor))
    ],
    candidates: createStampCandidates(phase, labs, createLabMetrics, "total, terminal, storage access"),
    layers: [
      ...createCommittedStampLayers(stampPlan, { fastfillerCount: 2, labs: false }),
      candidateLayer("lab-candidates", "Top lab candidates", phase),
      stampLayer("labs-committed", layerTitleLabs(), labs, true)
    ]
  };
}

function createRoadStep(roadPlan: RoadPlan, stampPlan: RoomStampPlan): RoomPlanningVisualizationStep {
  const pathTileCount = roadPlan.paths.reduce((total, path) => total + path.roadTiles.length, 0);
  const totalCost = roadPlan.paths.reduce((total, path) => total + path.cost, 0);
  const totalOps = roadPlan.paths.reduce((total, path) => total + path.ops, 0);

  return {
    id: "roads",
    title: "Roads",
    status: "complete",
    summary: "Planned primary roads sequentially so later paths can reuse already selected road tiles.",
    metrics: [
      metric("unique road tiles", roadPlan.roadTiles.length, "good"),
      metric("road reuse saved", Math.max(0, pathTileCount - roadPlan.roadTiles.length), "good"),
      metric("pathfinder cost", totalCost),
      metric("pathfinder ops", totalOps)
    ],
    candidates: [],
    layers: [
      ...createCommittedStampLayers(stampPlan),
      ...createRoadPathLayers(roadPlan)
    ]
  };
}

function createSourceSinkStep(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  rampartPlan: RampartPlan,
  structurePlan: RoomStructurePlan
): RoomPlanningVisualizationStep {
  void room;
  void rampartPlan;
  const placements = getSourceSinkPlacements(structurePlan);

  return {
    id: "sources-sinks",
    title: "Sources and sinks",
    status: "complete",
    summary: "Resolved source, mineral, and controller logistics from road endpoints and adjacent buildable link tiles.",
    metrics: [
      metric("source containers", placements.filter((placement) => placement.label.includes("source") && placement.type === "container").length, "good"),
      metric("source links", placements.filter((placement) => placement.label.includes("source") && placement.type === "link").length, "good"),
      metric("controller logistics", placements.filter((placement) => placement.label.includes("controller")).length),
      metric("mineral logistics", placements.filter((placement) => placement.label.includes("mineral")).length)
    ],
    candidates: [],
    layers: [
      ...createCommittedStampLayers(stampPlan),
      ...createRoadPathLayers(roadPlan),
      createSourceSinkStructureLayer(placements)
    ]
  };
}

function createSpareExtensionStep(
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  rampartPlan: RampartPlan,
  structurePlan: RoomStructurePlan
): RoomPlanningVisualizationStep {
  const preRampart = rampartPlan.preRampartStructures;

  return {
    id: "spare-extensions",
    title: "Spare extensions",
    status: "complete",
    summary: "Reserved remaining RCL8 build slots near the planned road network before min-cut planning.",
    metrics: [
      metric("reserved extensions", rampartPlan.extensions.length, "good"),
      metric("reserved towers", preRampart.towerCount),
      metric("access road tiles", preRampart.accessRoadTiles.length, "good"),
      metric("reserved structure tiles", preRampart.structureTiles.length)
    ],
    candidates: [],
    layers: [
      ...createCommittedStampLayers(stampPlan),
      ...createRoadPathLayers(roadPlan),
      createSourceSinkStructureLayer(getSourceSinkPlacements(structurePlan)),
      ...createPreRampartStructureLayers(rampartPlan)
    ]
  };
}

function createRampartStep(
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  rampartPlan: RampartPlan,
  structurePlan: RoomStructurePlan
): RoomPlanningVisualizationStep {
  return {
    id: "ramparts",
    title: "Rampart min-cut",
    status: "complete",
    summary: "Solved a weighted min-cut that separates exits from mandatory defended tiles while evaluating optional regions.",
    metrics: [
      metric("rampart tiles", rampartPlan.score.rampartCount, "good"),
      metric("base cut cost", rampartPlan.score.rampartBaseCost),
      metric("hub distance cost", rampartPlan.score.rampartDistanceCost),
      metric("optional penalty", rampartPlan.score.optionalPenalty, rampartPlan.score.optionalPenalty === 0 ? "good" : "warn"),
      metric("total cost", rampartPlan.score.totalCost)
    ],
    candidates: rampartPlan.optionalRegions.map((region, index) => ({
      id: region.key,
      label: region.key,
      rank: index + 1,
      selected: region.protected,
      anchor: fromIndex(region.tiles[0] ?? 0),
      score: [region.protected ? 1 : 0, -region.penalty, region.tiles.length],
      metrics: [
        metric("protected", region.protected ? "yes" : "no", region.protected ? "good" : "warn"),
        metric("tiles", region.tiles.length),
        metric("penalty", region.penalty)
      ],
      tiles: region.tiles
    })),
    layers: [
      ...createCommittedStampLayers(stampPlan),
      ...createRoadPathLayers(roadPlan),
      createSourceSinkStructureLayer(getSourceSinkPlacements(structurePlan)),
      ...createPreRampartStructureLayers(rampartPlan),
      {
        id: "defended-region",
        title: "Defended interior",
        kind: "region",
        tiles: rampartPlan.defendedTiles,
        visibleByDefault: false,
        tone: "defended"
      },
      {
        id: "outside-region",
        title: "Outside from exits",
        kind: "region",
        tiles: rampartPlan.outsideTiles,
        visibleByDefault: false,
        tone: "outside"
      },
      ...rampartPlan.optionalRegions.map((region) => ({
        id: `optional-${region.key}`,
        title: layerTitleOptionalRegion(region.key),
        kind: "region" as const,
        tiles: region.tiles,
        visibleByDefault: true,
        tone: region.protected ? "defended" as const : "warning" as const
      })),
      ...createRampartCommittedLayers(rampartPlan)
    ]
  };
}

function createTowerStep(
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  rampartPlan: RampartPlan,
  structurePlan: RoomStructurePlan
): RoomPlanningVisualizationStep {
  const weakest = rampartPlan.towers.length === 0 ? 0 : Math.min(...rampartPlan.towers.map((tower) => tower.minDamage));
  const average = rampartPlan.towers.length === 0
    ? 0
    : Math.round(rampartPlan.towers.reduce((total, tower) => total + tower.averageDamage, 0) / rampartPlan.towers.length);
  const coverage = createTowerCoverageValues(rampartPlan);

  return {
    id: "towers",
    title: "Towers",
    status: "complete",
    summary: "Placed towers greedily against the actual rampart line, maximizing weakest covered rampart damage first.",
    metrics: [
      metric("towers", rampartPlan.towers.length, "good"),
      metric("weakest rampart damage", weakest, "good"),
      metric("average tower coverage", average),
      metric("covered ramparts", Object.keys(coverage).length)
    ],
    candidates: rampartPlan.towers.map((tower, index) => ({
      id: `tower-${index + 1}`,
      label: `tower ${index + 1}`,
      rank: index + 1,
      selected: true,
      anchor: { x: tower.x, y: tower.y },
      score: [tower.minDamage, tower.averageDamage, -tower.tile],
      metrics: [
        metric("min damage", tower.minDamage, "good"),
        metric("avg damage", tower.averageDamage),
        metric("coord", formatCoord(tower))
      ],
      tiles: [tower.tile]
    })),
    layers: [
      ...createCommittedStampLayers(stampPlan),
      ...createRoadPathLayers(roadPlan),
      createSourceSinkStructureLayer(getSourceSinkPlacements(structurePlan)),
      ...createPreRampartStructureLayers(rampartPlan),
      ...createRampartCommittedLayers(rampartPlan),
      {
        id: "tower-coverage",
        title: "Tower coverage heatmap",
        kind: "heatmap",
        tiles: rampartPlan.rampartTiles,
        visibleByDefault: true,
        tone: "heat",
        values: coverage
      },
      {
        id: "towers",
        title: "Towers",
        kind: "structure",
        tiles: rampartPlan.towerTiles,
        visibleByDefault: true,
        tone: "structure"
      }
    ]
  };
}

function createRemainingStructureStep(
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  rampartPlan: RampartPlan,
  structurePlan: RoomStructurePlan
): RoomPlanningVisualizationStep {
  const tiles = [
    ...(rampartPlan.nukerTile === null ? [] : [rampartPlan.nukerTile]),
    ...(rampartPlan.observerTile === null ? [] : [rampartPlan.observerTile])
  ];

  return {
    id: "remaining-structures",
    title: "Remaining structures",
    status: "complete",
    summary: "Placed remaining unique RCL8 structures on defended road-adjacent buildable tiles.",
    metrics: [
      metric("nuker", rampartPlan.nuker ? formatCoord(rampartPlan.nuker) : "none", rampartPlan.nuker ? "good" : "warn"),
      metric("observer", rampartPlan.observer ? formatCoord(rampartPlan.observer) : "none", rampartPlan.observer ? "good" : "warn"),
      metric("final structures", structurePlan.structures.length, "good")
    ],
    candidates: [
      ...(rampartPlan.nuker ? [extraStructureCandidate("nuker", rampartPlan.nuker)] : []),
      ...(rampartPlan.observer ? [extraStructureCandidate("observer", rampartPlan.observer)] : [])
    ],
    layers: [
      ...createCommittedStampLayers(stampPlan),
      ...createRoadPathLayers(roadPlan),
      createSourceSinkStructureLayer(getSourceSinkPlacements(structurePlan)),
      ...createPreRampartStructureLayers(rampartPlan),
      ...createRampartCommittedLayers(rampartPlan),
      {
        id: "towers",
        title: "Towers",
        kind: "structure",
        tiles: rampartPlan.towerTiles,
        visibleByDefault: true,
        tone: "structure"
      },
      {
        id: "final-structures",
        title: "Final structures",
        kind: "structure",
        tiles: structurePlan.structureTiles,
        visibleByDefault: false,
        tone: "structure"
      },
      {
        id: "remaining-structures",
        title: "Nuker and observer",
        kind: "structure",
        tiles,
        visibleByDefault: true,
        tone: "structure"
      }
    ]
  };
}

function createCommittedStampLayers(
  stampPlan: RoomStampPlan,
  options: { fastfillerCount?: 0 | 1 | 2; labs?: boolean } = {}
): RoomPlanningLayer[] {
  const fastfillerCount = options.fastfillerCount ?? 2;
  const includeLabs = options.labs ?? true;
  return [
    stampLayer("hub-committed", layerTitleHub(), stampPlan.stamps.hub, true),
    ...stampPlan.stamps.fastfillers.slice(0, fastfillerCount).map((pod, index) => (
      stampLayer(
        index === 0 ? "fastfiller-a-committed" : "fastfiller-b-committed",
        layerTitleFastfiller(index),
        pod,
        true
      )
    )),
    ...(includeLabs && stampPlan.stamps.labs ? [stampLayer("labs-committed", layerTitleLabs(), stampPlan.stamps.labs, true)] : [])
  ];
}

function createRoadPathLayers(roadPlan: RoadPlan): RoomPlanningLayer[] {
  return roadPlan.paths.map((path) => ({
    id: `road-${path.kind}`,
    title: layerTitleRoadPath(path.kind),
    kind: "path",
    tiles: path.roadTiles,
    visibleByDefault: true,
    tone: "road"
  }));
}

function getSourceSinkPlacements(structurePlan: RoomStructurePlan): RoomStructurePlan["structures"] {
  return structurePlan.structures.filter((placement) => (
    placement.label.startsWith("source")
    || placement.label.startsWith("controller")
    || placement.label.startsWith("mineral")
  ));
}

function createSourceSinkStructureLayer(placements: RoomStructurePlan["structures"]): RoomPlanningLayer {
  return {
    id: "source-sink-structures",
    title: "Source and sink structures",
    kind: "structure",
    tiles: placements.map((placement) => placement.tile),
    visibleByDefault: true,
    tone: "structure"
  };
}

function createPreRampartStructureLayers(rampartPlan: RampartPlan): RoomPlanningLayer[] {
  return [
    {
      id: "pre-rampart-access-roads",
      title: "Pre-rampart access roads",
      kind: "road",
      tiles: rampartPlan.preRampartStructures.accessRoadTiles,
      visibleByDefault: true,
      tone: "road"
    },
    {
      id: "pre-rampart-structures",
      title: "Reserved extension slots",
      kind: "structure",
      tiles: rampartPlan.extensionTiles,
      visibleByDefault: true,
      tone: "structure"
    }
  ];
}

function createRampartCommittedLayers(rampartPlan: RampartPlan): RoomPlanningLayer[] {
  return [
    {
      id: "post-rampart-roads",
      title: "Post-rampart roads",
      kind: "road",
      tiles: rampartPlan.postRampartRoadTiles,
      visibleByDefault: true,
      tone: "road"
    },
    {
      id: "cut-ramparts",
      title: "Min-cut ramparts",
      kind: "rampart",
      tiles: rampartPlan.cutRampartTiles,
      visibleByDefault: true,
      tone: "rampart"
    },
    {
      id: "extra-ramparts",
      title: "Post-processed ramparts",
      kind: "rampart",
      tiles: rampartPlan.extraRampartTiles,
      visibleByDefault: true,
      tone: "warning"
    }
  ];
}

function createStampCandidates(
  phase: StampDebugByPhase,
  selected: StampPlacement,
  createMetrics: (candidate: StampCandidateSummary) => RoomPlanningMetric[],
  objectiveLabel: string
): RoomPlanningCandidate[] {
  const selectedKey = stampKey(selected);
  return (phase?.candidates ?? []).map((candidate) => ({
    id: candidate.key,
    label: candidate.label,
    rank: candidate.rank,
    selected: candidate.key === selectedKey,
    anchor: candidate.anchor,
    score: candidate.score,
    metrics: [
      metric("objective", objectiveLabel, candidate.key === selectedKey ? "good" : "neutral"),
      ...createMetrics(candidate),
      metric("tie-break", formatTieBreak(candidate.anchor)),
      metric("raw tuple", formatScore(candidate.score))
    ],
    tiles: candidate.blockedTiles
  }));
}

function createNormalHubMetrics(candidate: StampCandidateSummary): RoomPlanningMetric[] {
  return [
    metric("exit distance", candidate.score[0] ?? 0),
    metric("terrain clearance", candidate.score[1] ?? 0),
    metric("provisional cut", Math.abs(candidate.score[2] ?? 0)),
    metric("anchor", formatCoord(candidate.anchor))
  ];
}

function normalHubScoreExplanation(): string {
  return "Candidate objectives are compared left to right; anchor coordinates are only deterministic tie-breakers.";
}

function templeHubScoreExplanation(): string {
  return "Candidate objectives are compared left to right; anchor coordinates are only deterministic tie-breakers.";
}

function fastfillerScoreExplanation(): string {
  return "Distance objectives are shown as positive costs; internally they are negated so smaller costs sort first. Anchor coordinates are only deterministic tie-breakers.";
}

function labScoreExplanation(): string {
  return "Distance objectives are shown as positive costs; internally they are negated so smaller costs sort first. Anchor coordinates are only deterministic tie-breakers.";
}

function formatScore(score: number[]): string {
  return `[${score.map((value) => value.toLocaleString("en-US")).join(", ")}]`;
}

function formatTieBreak(anchor: RoomStampAnchor): string {
  return `north y=${anchor.y}, then west x=${anchor.x}`;
}

function layerTitleHub(): string {
  return "Hub";
}

function layerTitleFastfiller(index: number): string {
  return `Fastfiller pod ${index === 0 ? "A" : "B"}`;
}

function layerTitleLabs(): string {
  return "Labs";
}

function layerTitleRoadPath(kind: RoadPlan["paths"][number]["kind"]): string {
  switch (kind) {
    case "storage-to-pod1":
      return "Road: Storage -> Fastfiller pod A";
    case "storage-to-pod2":
      return "Road: Storage -> Fastfiller pod B";
    case "storage-to-labs":
      return "Road: Storage -> Labs";
    case "terminal-to-labs":
      return "Road: Terminal -> Labs";
    case "terminal-to-mineral":
      return "Road: Terminal -> Mineral";
    case "storage-to-source1":
      return "Road: Storage -> Source 1";
    case "storage-to-source2":
      return "Road: Storage -> Source 2";
    case "storage-to-controller":
      return "Road: Storage -> Controller";
  }
}

function layerTitleOptionalRegion(key: RampartPlan["optionalRegions"][number]["key"]): string {
  switch (key) {
    case "source1":
      return "Optional region: Source 1";
    case "source2":
      return "Optional region: Source 2";
    case "controller":
      return "Optional region: Controller";
  }
}

function createTempleHubMetrics(candidate: StampCandidateSummary): RoomPlanningMetric[] {
  return [
    metric("range 2 upgrading tiles", candidate.score[0] ?? 0),
    metric("connected upgrading tiles", candidate.score[1] ?? 0),
    metric("anchor", formatCoord(candidate.anchor))
  ];
}

function createFastfillerMetrics(candidate: StampCandidateSummary): RoomPlanningMetric[] {
  return [
    metric("storage distance", Math.abs(candidate.score[0] ?? 0)),
    metric("best source detour", Math.abs(candidate.score[1] ?? 0)),
    metric("anchor", formatCoord(candidate.anchor))
  ];
}

function createLabMetrics(candidate: StampCandidateSummary): RoomPlanningMetric[] {
  return [
    metric("total distance", Math.abs(candidate.score[0] ?? 0)),
    metric("terminal distance", Math.abs(candidate.score[1] ?? 0)),
    metric("storage distance", Math.abs(candidate.score[2] ?? 0)),
    metric("anchor", formatCoord(candidate.anchor))
  ];
}

function extraStructureCandidate(label: "nuker" | "observer", placement: { x: number; y: number; tile: number; score: number[] }): RoomPlanningCandidate {
  return {
    id: label,
    label,
    rank: label === "nuker" ? 1 : 2,
    selected: true,
    anchor: { x: placement.x, y: placement.y },
    score: placement.score,
    metrics: [
      metric("coord", formatCoord(placement)),
      metric("score", placement.score.join(", "))
    ],
    tiles: [placement.tile]
  };
}

function candidateLayer(id: string, title: string, phase: StampDebugByPhase): RoomPlanningLayer {
  return {
    id,
    title,
    kind: "candidate",
    tiles: uniqueTiles((phase?.candidates ?? []).flatMap((candidate) => candidate.blockedTiles)),
    visibleByDefault: true,
    tone: "candidate"
  };
}

function stampLayer(id: string, title: string, stamp: StampPlacement, visibleByDefault: boolean): RoomPlanningLayer {
  return {
    id,
    title,
    kind: "stamp",
    tiles: stamp.blockedTiles,
    visibleByDefault,
    tone: "selected"
  };
}

function metric(label: string, value: string | number, tone: RoomPlanningMetric["tone"] = "neutral"): RoomPlanningMetric {
  return { label, value, tone };
}

function stampKey(stamp: StampPlacement): string {
  return `${stamp.kind}:${stamp.rotation}:${stamp.anchor.x.toString().padStart(2, "0")}:${stamp.anchor.y.toString().padStart(2, "0")}`;
}

function createTowerCoverageValues(rampartPlan: RampartPlan): Record<number, number> {
  const values: Record<number, number> = {};
  for (const tile of rampartPlan.rampartTiles) {
    const coord = fromIndex(tile);
    values[tile] = rampartPlan.towers.reduce((total, tower) => total + towerDamage(range(tower, coord)), 0);
  }
  return values;
}

function towerDamage(distance: number): number {
  if (distance <= 5) {
    return 600;
  }
  if (distance >= 20) {
    return 150;
  }
  return Math.round(600 - (450 * (distance - 5)) / 15);
}

function range(left: RoomStampAnchor, right: RoomStampAnchor): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

function formatCoord(coord: RoomStampAnchor): string {
  return `${coord.x},${coord.y}`;
}

function uniqueTiles(tiles: number[]): number[] {
  return [...new Set(tiles)].sort((left, right) => left - right);
}

function fromIndex(index: number): RoomStampAnchor {
  return {
    x: index % roomSize,
    y: Math.floor(index / roomSize)
  };
}
