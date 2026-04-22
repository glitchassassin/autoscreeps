import { createDijkstraMap, dijkstraUnreachable, type DijkstraMap } from "./dijkstra-map.ts";
import { createTerrainDistanceTransform } from "./distance-transform.ts";
import type { RoomPlanningObject, RoomPlanningPolicy, RoomPlanningRoomData } from "./room-plan.ts";

const roomSize = 50;
const roomArea = roomSize * roomSize;
const terrainMaskWall = 1;
const defaultTopK = 3;
const fallbackTopKs = [3, 5, 8] as const;
const exactCandidateWindowMultiplier = 24;
const controllerStampReserveRange = 3;
const sourceStampReserveRange = 2;
const edgeStampReserveRange = 2;

export type StampKind = "hub" | "fastfiller" | "labs";
export type StampRotation = 0 | 90 | 180 | 270;

export type RoomStampAnchor = {
  x: number;
  y: number;
};

export type StampPlacement = {
  kind: StampKind;
  label: string;
  rotation: StampRotation;
  anchor: RoomStampAnchor;
  anchors: Record<string, RoomStampAnchor>;
  blockedTiles: number[];
  score: number[];
};

export type StampSearchOptions = {
  topK?: number;
};

export type RoomStampPlan = {
  roomName: string;
  policy: RoomPlanningPolicy;
  topK: number;
  score: number[];
  stamps: {
    hub: StampPlacement;
    fastfillers: [StampPlacement, StampPlacement];
    labs: StampPlacement | null;
  };
};

export type StampCandidateSummary = {
  key: string;
  kind: StampKind;
  label: string;
  rank: number;
  rotation: StampRotation;
  anchor: RoomStampAnchor;
  anchors: Record<string, RoomStampAnchor>;
  blockedTiles: number[];
  score: number[];
  rejected: false;
};

export type StampSearchDebugPhase = {
  name: string;
  selectedLabel: string | null;
  candidates: StampCandidateSummary[];
};

export type StampSearchDebug = {
  roomName: string;
  policy: RoomPlanningPolicy;
  topK: number;
  phases: StampSearchDebugPhase[];
};

export type StampSearchTreeNode = {
  id: string;
  candidate: StampCandidateSummary;
  selected: boolean;
  completeScore?: number[];
  children: StampSearchTreeNode[];
};

export type StampPlacementInteractiveDebug = {
  roomName: string;
  policy: RoomPlanningPolicy;
  topK: number;
  score: number[];
  selectedPath: string[];
  tree: StampSearchTreeNode[];
};

type Coord = {
  x: number;
  y: number;
};

type StampTemplate = {
  kind: StampKind;
  label: string;
  rotations: readonly StampRotation[];
  blockedOffsets: Coord[];
  anchors: Record<string, Coord>;
};

type RoomFeatures = {
  roomName: string;
  terrain: string;
  controller: RoomPlanningObject;
  sources: [RoomPlanningObject, RoomPlanningObject];
  mineral: RoomPlanningObject | null;
  exits: Coord[];
  baseOccupied: Uint8Array;
  basePathBlocked: Uint8Array;
  reservedPathMasks: ReservedPathMasks;
  terrainDistanceTransform: ReturnType<typeof createTerrainDistanceTransform>;
  exitDistanceMap: DijkstraMap;
};

type ReservedPathMasks = {
  default: Uint8Array;
  edgeOrigin: Uint8Array;
  sourceOrigins: [Uint8Array, Uint8Array];
};

type ReservedPathExemption =
  | { kind: "edge" }
  | { kind: "source"; index: number }
  | null;

type PlacementState = {
  occupied: Uint8Array;
  pathBlocked: Uint8Array;
  placements: StampPlacement[];
};

type PathContext = {
  storageDistanceMap: DijkstraMap | null;
  terminalDistanceMap: DijkstraMap | null;
  sourceDistanceMaps: [DijkstraMap | null, DijkstraMap | null];
  storageToSourceDistances: [number, number];
};

type Candidate = StampPlacement & {
  sourceDetours?: [number, number];
  storageDistance?: number;
  labDistance?: number;
};

type FastfillerScore = {
  storageDistance: number;
  sourceDetours: [number, number];
};

type SearchResult = {
  plan: RoomStampPlan;
  branch: {
    hub: StampPlacement;
    pod1: StampPlacement;
    pod2: StampPlacement;
    labs: StampPlacement | null;
  };
};

export function planRoomStamps(room: RoomPlanningRoomData, policy: RoomPlanningPolicy, options: StampSearchOptions = {}): RoomStampPlan {
  if (options.topK !== undefined) {
    return searchStampPlacements(room, policy, options).plan;
  }

  let lastError: unknown = null;
  for (const topK of fallbackTopKs) {
    try {
      return searchStampPlacements(room, policy, { topK }).plan;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function createStampPlacementDebug(
  room: RoomPlanningRoomData,
  policy: RoomPlanningPolicy,
  plan: RoomStampPlan,
  options: StampSearchOptions = {}
): StampSearchDebug {
  const topK = normalizeTopK(options.topK ?? plan.topK);
  const features = createRoomFeatures(room);
  const baseState = createBaseState(features);
  const hubCandidates = generateHubCandidates(features, baseState, policy, topK);
  const hubState = placeStamp(baseState, plan.stamps.hub);
  const pod1Candidates = generateFastfillerCandidates(features, hubState, plan.stamps.hub, topK);
  const pod1State = placeStamp(hubState, plan.stamps.fastfillers[0]);
  const pod2Candidates = generateFastfillerCandidates(features, pod1State, plan.stamps.hub, topK);
  const pod2State = placeStamp(pod1State, plan.stamps.fastfillers[1]);
  const labCandidates = policy === "normal" ? generateLabCandidates(features, pod2State, plan.stamps.hub, topK) : [];

  return {
    roomName: room.roomName,
    policy,
    topK,
    phases: [
      createDebugPhase("hub candidates", hubCandidates, plan.stamps.hub),
      createDebugPhase("pod1 candidates after hub", pod1Candidates, plan.stamps.fastfillers[0]),
      createDebugPhase("pod2 candidates after hub + pod1", pod2Candidates, plan.stamps.fastfillers[1]),
      ...(policy === "normal" ? [createDebugPhase("lab candidates after fastfillers", labCandidates, plan.stamps.labs)] : [])
    ]
  };
}

export function createInteractiveStampPlacementDebug(
  room: RoomPlanningRoomData,
  policy: RoomPlanningPolicy,
  plan: RoomStampPlan,
  options: StampSearchOptions = {}
): StampPlacementInteractiveDebug {
  const topK = normalizeTopK(options.topK ?? plan.topK);
  const features = createRoomFeatures(room);
  const baseState = createBaseState(features);
  const hubCandidates = generateHubCandidates(features, baseState, policy, topK);
  const selectedHubKey = candidateStableKey(plan.stamps.hub);
  const selectedPod1Key = candidateStableKey(plan.stamps.fastfillers[0]);
  const selectedPod2Key = candidateStableKey(plan.stamps.fastfillers[1]);
  const selectedLabKey = plan.stamps.labs ? candidateStableKey(plan.stamps.labs) : null;

  return {
    roomName: room.roomName,
    policy,
    topK,
    score: plan.score,
    selectedPath: [selectedHubKey, selectedPod1Key, selectedPod2Key, ...(selectedLabKey ? [selectedLabKey] : [])],
    tree: hubCandidates.map((hub, hubIndex) => {
      const hubState = placeStamp(baseState, hub);
      const pod1Candidates = generateFastfillerCandidates(features, hubState, hub, topK);
      const hubKey = candidateStableKey(hub);

      return createTreeNode(`hub-${hubIndex}`, hub, hubIndex, hubKey === selectedHubKey, pod1Candidates.map((pod1, pod1Index) => {
        const pod1State = placeStamp(hubState, pod1);
        const pod2Candidates = generateFastfillerCandidates(features, pod1State, hub, topK);
        const pod1Key = candidateStableKey(pod1);

        return createTreeNode(`hub-${hubIndex}-pod1-${pod1Index}`, pod1, pod1Index, hubKey === selectedHubKey && pod1Key === selectedPod1Key, pod2Candidates.map((pod2, pod2Index) => {
          const pod2State = placeStamp(pod1State, pod2);
          const labCandidates = policy === "normal" ? generateLabCandidates(features, pod2State, hub, topK) : [];
          const pod2Key = candidateStableKey(pod2);
          const pod2Selected = hubKey === selectedHubKey && pod1Key === selectedPod1Key && pod2Key === selectedPod2Key;

          if (policy === "temple") {
            return createTreeNode(
              `hub-${hubIndex}-pod1-${pod1Index}-pod2-${pod2Index}`,
              pod2,
              pod2Index,
              pod2Selected,
              [],
              scoreCompleteLayout(features, pod2State, policy, hub, pod1, pod2, null)
            );
          }

          return createTreeNode(`hub-${hubIndex}-pod1-${pod1Index}-pod2-${pod2Index}`, pod2, pod2Index, pod2Selected, labCandidates.map((labs, labIndex) => {
            const labKey = candidateStableKey(labs);
            const labState = placeStamp(pod2State, labs);
            return createTreeNode(
              `hub-${hubIndex}-pod1-${pod1Index}-pod2-${pod2Index}-labs-${labIndex}`,
              labs,
              labIndex,
              pod2Selected && labKey === selectedLabKey,
              [],
              scoreCompleteLayout(features, labState, policy, hub, pod1, pod2, labs)
            );
          }));
        }));
      }));
    })
  };
}

export function createStampPlacementCandidateTreeDebug(
  room: RoomPlanningRoomData,
  policy: RoomPlanningPolicy,
  options: StampSearchOptions = {}
): StampPlacementInteractiveDebug {
  const topK = normalizeTopK(options.topK ?? defaultTopK);
  const features = createRoomFeatures(room);
  const baseState = createBaseState(features);
  const hubCandidates = generateHubCandidates(features, baseState, policy, topK);

  return {
    roomName: room.roomName,
    policy,
    topK,
    score: [],
    selectedPath: [],
    tree: hubCandidates.map((hub, hubIndex) => {
      const hubState = placeStamp(baseState, hub);
      const pod1Candidates = generateFastfillerCandidates(features, hubState, hub, topK);

      return createTreeNode(`hub-${hubIndex}`, hub, hubIndex, false, pod1Candidates.map((pod1, pod1Index) => {
        const pod1State = placeStamp(hubState, pod1);
        const pod2Candidates = generateFastfillerCandidates(features, pod1State, hub, topK);

        return createTreeNode(`hub-${hubIndex}-pod1-${pod1Index}`, pod1, pod1Index, false, pod2Candidates.map((pod2, pod2Index) => {
          const pod2State = placeStamp(pod1State, pod2);
          const labCandidates = policy === "normal" ? generateLabCandidates(features, pod2State, hub, topK) : [];

          if (policy === "temple") {
            return createTreeNode(
              `hub-${hubIndex}-pod1-${pod1Index}-pod2-${pod2Index}`,
              pod2,
              pod2Index,
              false,
              [],
              scoreCompleteLayout(features, pod2State, policy, hub, pod1, pod2, null)
            );
          }

          return createTreeNode(`hub-${hubIndex}-pod1-${pod1Index}-pod2-${pod2Index}`, pod2, pod2Index, false, labCandidates.map((labs, labIndex) => {
            const labState = placeStamp(pod2State, labs);
            return createTreeNode(
              `hub-${hubIndex}-pod1-${pod1Index}-pod2-${pod2Index}-labs-${labIndex}`,
              labs,
              labIndex,
              false,
              [],
              scoreCompleteLayout(features, labState, policy, hub, pod1, pod2, labs)
            );
          }));
        }));
      }));
    })
  };
}

export function validateStampPlan(room: RoomPlanningRoomData, plan: RoomStampPlan): string[] {
  validateTerrain(room.terrain);
  const errors: string[] = [];
  const occupied = new Uint8Array(roomArea);
  for (const object of room.objects) {
    if (isNaturalBlocker(object)) {
      occupied[toIndex(object.x, object.y)] = 1;
    }
  }
  const stamps = [plan.stamps.hub, ...plan.stamps.fastfillers, ...(plan.stamps.labs ? [plan.stamps.labs] : [])];

  for (const stamp of stamps) {
    for (const tile of stamp.blockedTiles) {
      const coord = fromIndex(tile);
      if (!isBuildableStampTerrain(room.terrain, coord.x, coord.y)) {
        errors.push(`${stamp.label} blocks unbuildable tile ${coord.x},${coord.y}.`);
      }
      if (isReservedStampTileForRoom(room, coord.x, coord.y)) {
        errors.push(`${stamp.label} blocks reserved tile ${coord.x},${coord.y}.`);
      }
      if (occupied[tile] !== 0) {
        errors.push(`${stamp.label} overlaps occupied tile ${coord.x},${coord.y}.`);
      }
      occupied[tile] = 1;
    }
  }

  if (plan.stamps.fastfillers.length !== 2) {
    errors.push("Plan must contain exactly two fastfiller stamps.");
  }

  if (plan.policy === "normal" && plan.stamps.labs === null) {
    errors.push("Normal plan must contain a lab stamp.");
  }

  if (plan.policy === "temple" && plan.stamps.labs !== null) {
    errors.push("Temple plan must not contain a lab stamp.");
  }

  return errors;
}

function searchStampPlacements(room: RoomPlanningRoomData, policy: RoomPlanningPolicy, options: StampSearchOptions): SearchResult {
  const topK = normalizeTopK(options.topK ?? defaultTopK);
  const features = createRoomFeatures(room);
  const baseState = createBaseState(features);
  const hubCandidates = generateHubCandidates(features, baseState, policy, topK);
  let best: SearchResult | null = null;

  for (const hub of hubCandidates) {
    const hubState = placeStamp(baseState, hub);
    const pod1Candidates = generateFastfillerCandidates(features, hubState, hub, topK);

    for (const pod1 of pod1Candidates) {
      const pod1State = placeStamp(hubState, pod1);
      const pod2Candidates = generateFastfillerCandidates(features, pod1State, hub, topK);

      for (const pod2 of pod2Candidates) {
        const pod2State = placeStamp(pod1State, pod2);
        const labCandidates = policy === "normal" ? generateLabCandidates(features, pod2State, hub, topK) : [null];

        for (const labs of labCandidates) {
          const finalState = labs === null ? pod2State : placeStamp(pod2State, labs);
          const score = scoreCompleteLayout(features, finalState, policy, hub, pod1, pod2, labs);
          const plan: RoomStampPlan = {
            roomName: features.roomName,
            policy,
            topK,
            score,
            stamps: {
              hub,
              fastfillers: [pod1, pod2],
              labs
            }
          };
          const candidate: SearchResult = {
            plan,
            branch: {
              hub,
              pod1,
              pod2,
              labs
            }
          };

          if (best === null || compareScore(candidate.plan.score, best.plan.score) < 0 || (
            compareScore(candidate.plan.score, best.plan.score) === 0
            && layoutKey(candidate.plan).localeCompare(layoutKey(best.plan)) < 0
          )) {
            best = candidate;
          }
        }
      }
    }
  }

  if (best === null) {
    throw new Error(`No viable ${policy} stamp layout found for room '${room.roomName}'.`);
  }

  return best;
}

function generateHubCandidates(features: RoomFeatures, state: PlacementState, policy: RoomPlanningPolicy, topK: number): Candidate[] {
  const template = policy === "temple" ? templeHubTemplate : normalHubTemplate;
  const candidates: Candidate[] = [];

  for (let y = 1; y < roomSize - 1; y += 1) {
    for (let x = 1; x < roomSize - 1; x += 1) {
      for (const rotation of template.rotations) {
        const candidate = projectStamp(template, { x, y }, rotation, []);
        if (!fitsStamp(features, state, candidate)) {
          continue;
        }

        const center = candidate.anchors.hubCenter;
        if (!center) {
          continue;
        }

        if (range(center, features.controller) <= 4 || features.sources.some((source) => range(center, source) <= 4)) {
          continue;
        }

        if (policy === "temple" && !satisfiesTempleHubConstraints(features, state, candidate)) {
          continue;
        }

        candidate.score = policy === "temple"
          ? scoreTempleHub(features, candidate)
          : scoreNormalHub(features, candidate);
        candidates.push(candidate);
      }
    }
  }

  return topCandidates(candidates, topK);
}

function generateFastfillerCandidates(features: RoomFeatures, state: PlacementState, hub: StampPlacement, topK: number): Candidate[] {
  const paths = createPathContext(features, state, hub);
  if (paths.storageDistanceMap === null) {
    return [];
  }

  const preliminary: Candidate[] = [];

  for (let y = 1; y < roomSize - 1; y += 1) {
    for (let x = 1; x < roomSize - 1; x += 1) {
      for (const rotation of fastfillerTemplate.rotations) {
        const candidate = projectStamp(fastfillerTemplate, { x, y }, rotation, []);
        if (!fitsStamp(features, state, candidate)) {
          continue;
        }

        if (!hasOpenNeighborAfterPlacement(features, state, candidate, candidate.anchor)) {
          continue;
        }

        const metrics = scoreFastfillerWithPaths(paths, candidate);
        if (metrics === null) {
          continue;
        }

        const { storageDistance, sourceDetours } = metrics;
        const bestSourceDetour = Math.min(sourceDetours[0], sourceDetours[1]);
        if (bestSourceDetour === dijkstraUnreachable) {
          continue;
        }

        candidate.storageDistance = storageDistance;
        candidate.sourceDetours = sourceDetours;
        candidate.score = [-storageDistance, -bestSourceDetour, -candidate.anchor.y, -candidate.anchor.x];
        preliminary.push(candidate);
      }
    }
  }

  preliminary.sort(compareCandidates);
  const exactCandidates: Candidate[] = [];
  let evaluated = 0;
  let limit = Math.min(preliminary.length, topK * exactCandidateWindowMultiplier);

  while (evaluated < preliminary.length) {
    for (; evaluated < limit; evaluated += 1) {
      const candidate = preliminary[evaluated]!;
      const candidateState = placeStamp(state, candidate);
      const metrics = scoreFastfillerCandidate(features, candidateState, paths, hub, candidate);
      if (metrics === null) {
        continue;
      }

      const { storageDistance, sourceDetours } = metrics;
      const bestSourceDetour = Math.min(sourceDetours[0], sourceDetours[1]);
      if (bestSourceDetour === dijkstraUnreachable) {
        continue;
      }

      candidate.storageDistance = storageDistance;
      candidate.sourceDetours = sourceDetours;
      candidate.score = [-storageDistance, -bestSourceDetour, -candidate.anchor.y, -candidate.anchor.x];
      exactCandidates.push(candidate);
    }
    if (exactCandidates.length >= topK || limit === preliminary.length) {
      break;
    }
    limit = Math.min(preliminary.length, Math.max(limit + 1, limit * 2));
  }

  return topCandidates(exactCandidates, topK);
}

function generateLabCandidates(features: RoomFeatures, state: PlacementState, hub: StampPlacement, topK: number): Candidate[] {
  const paths = createPathContext(features, state, hub);
  if (paths.terminalDistanceMap === null) {
    return [];
  }

  const preliminary: Candidate[] = [];

  for (let y = 1; y < roomSize - 1; y += 1) {
    for (let x = 1; x < roomSize - 1; x += 1) {
      for (const rotation of labTemplate.rotations) {
        const candidate = projectStamp(labTemplate, { x, y }, rotation, []);
        if (!fitsStamp(features, state, candidate)) {
          continue;
        }

        const entrance = candidate.anchors.entrance ?? candidate.anchor;
        const labDistance = paths.terminalDistanceMap.get(entrance.x, entrance.y);
        if (labDistance === dijkstraUnreachable) {
          continue;
        }

        candidate.labDistance = labDistance;
        candidate.score = [-labDistance, -candidate.anchor.y, -candidate.anchor.x];
        preliminary.push(candidate);
      }
    }
  }

  preliminary.sort(compareCandidates);
  const exactCandidates: Candidate[] = [];
  let evaluated = 0;
  let limit = Math.min(preliminary.length, topK * exactCandidateWindowMultiplier);

  while (evaluated < preliminary.length) {
    for (; evaluated < limit; evaluated += 1) {
      const candidate = preliminary[evaluated]!;
      const candidateState = placeStamp(state, candidate);
      const labDistance = scoreLabCandidate(features, candidateState, hub, candidate);
      if (labDistance === null) {
        continue;
      }

      candidate.labDistance = labDistance;
      candidate.score = [-labDistance, -candidate.anchor.y, -candidate.anchor.x];
      exactCandidates.push(candidate);
    }
    if (exactCandidates.length >= topK || limit === preliminary.length) {
      break;
    }
    limit = Math.min(preliminary.length, Math.max(limit + 1, limit * 2));
  }

  return topCandidates(exactCandidates, topK);
}

function scoreCompleteLayout(
  features: RoomFeatures,
  finalState: PlacementState,
  policy: RoomPlanningPolicy,
  hub: Candidate,
  pod1: Candidate,
  pod2: Candidate,
  labs: Candidate | null
): number[] {
  const paths = createPathContext(features, finalState, hub);
  const pod1Score = scoreFastfillerWithPaths(paths, pod1);
  const pod2Score = scoreFastfillerWithPaths(paths, pod2);
  const storageDistance = (pod1Score?.storageDistance ?? dijkstraUnreachable) + (pod2Score?.storageDistance ?? dijkstraUnreachable);
  const sourceDetour = scorePodSourceAssignment(
    pod1Score?.sourceDetours ?? [dijkstraUnreachable, dijkstraUnreachable],
    pod2Score?.sourceDetours ?? [dijkstraUnreachable, dijkstraUnreachable]
  );
  const labDistance = policy === "normal" && labs !== null
    ? scoreLabDistance(features, finalState, paths.terminalDistanceMap, labs) ?? dijkstraUnreachable
    : 0;

  return [
    ...hub.score,
    -storageDistance,
    -sourceDetour,
    -labDistance,
    -(hub.blockedTiles.length + pod1.blockedTiles.length + pod2.blockedTiles.length + (labs?.blockedTiles.length ?? 0))
  ];
}

function scoreFastfillerCandidate(
  features: RoomFeatures,
  state: PlacementState,
  previousPaths: PathContext,
  hub: StampPlacement,
  candidate: Candidate
): FastfillerScore | null {
  const storageDistance = scoreFastfillerStorageDistance(features, state, hub, candidate);
  if (storageDistance === null) {
    return null;
  }

  const sourceDetours = scoreFastfillerSourceDetours(previousPaths, candidate, storageDistance);
  return {
    storageDistance,
    sourceDetours
  };
}

function scoreFastfillerWithPaths(paths: PathContext, candidate: Candidate): FastfillerScore | null {
  if (paths.storageDistanceMap === null) {
    return null;
  }

  const storageDistance = paths.storageDistanceMap.get(candidate.anchor.x, candidate.anchor.y);
  if (storageDistance === dijkstraUnreachable) {
    return null;
  }

  const sourceDetours = paths.sourceDistanceMaps.map((sourceMap, index) => {
    const storageToSourceDistance = paths.storageToSourceDistances[index]!;
    if (sourceMap === null || storageToSourceDistance === dijkstraUnreachable) {
      return dijkstraUnreachable;
    }

    const sourceDistance = sourceMap.get(candidate.anchor.x, candidate.anchor.y);
    if (sourceDistance === dijkstraUnreachable) {
      return dijkstraUnreachable;
    }

    return storageDistance + sourceDistance - storageToSourceDistance;
  }) as [number, number];

  return {
    storageDistance,
    sourceDetours
  };
}

function scoreFastfillerStorageDistance(features: RoomFeatures, state: PlacementState, hub: StampPlacement, candidate: Candidate): number | null {
  const storageDistanceMap = createStorageDistanceMap(features, state, hub);
  if (storageDistanceMap === null) {
    return null;
  }

  const storageDistance = storageDistanceMap.get(candidate.anchor.x, candidate.anchor.y);
  return storageDistance === dijkstraUnreachable ? null : storageDistance;
}

function scoreFastfillerSourceDetours(paths: PathContext, candidate: Candidate, storageDistance: number): [number, number] {
  return paths.sourceDistanceMaps.map((sourceMap, index) => {
    const storageToSourceDistance = paths.storageToSourceDistances[index]!;
    if (sourceMap === null || storageToSourceDistance === dijkstraUnreachable) {
      return dijkstraUnreachable;
    }

    const sourceDistance = sourceMap.get(candidate.anchor.x, candidate.anchor.y);
    if (sourceDistance === dijkstraUnreachable) {
      return dijkstraUnreachable;
    }

    return storageDistance + sourceDistance - storageToSourceDistance;
  }) as [number, number];
}

function scorePodSourceAssignment(first: [number, number], second: [number, number]): number {
  return Math.min(first[0] + second[1], first[1] + second[0]);
}

function scoreLabCandidate(features: RoomFeatures, state: PlacementState, hub: StampPlacement, labs: Candidate): number | null {
  return scoreLabDistance(features, state, createTerminalDistanceMap(features, state, hub), labs);
}

function scoreLabDistance(features: RoomFeatures, state: PlacementState, terminalDistanceMap: DijkstraMap | null, labs: Candidate): number | null {
  if (terminalDistanceMap === null) {
    return null;
  }

  const entrance = labs.anchors.entrance ?? labs.anchor;
  const accessGoals = getPathGoals(features, state, entrance, features.reservedPathMasks.default);
  if (accessGoals.length === 0) {
    return null;
  }

  const labDistance = minDistance(terminalDistanceMap, accessGoals);
  return labDistance === dijkstraUnreachable ? null : labDistance;
}

function scoreNormalHub(features: RoomFeatures, candidate: StampPlacement): number[] {
  const center = candidate.anchors.hubCenter ?? candidate.anchor;
  const exitDistance = features.exitDistanceMap.get(center.x, center.y);
  const clearance = features.terrainDistanceTransform.get(center.x, center.y);
  const provisionalCutSize = estimateProvisionalDefenseCutSize(features, center);
  return [
    exitDistance === dijkstraUnreachable ? 0 : exitDistance,
    clearance,
    -provisionalCutSize,
    -candidate.anchor.y,
    -candidate.anchor.x
  ];
}

function scoreTempleHub(features: RoomFeatures, candidate: StampPlacement): number[] {
  const center = candidate.anchors.hubCenter ?? candidate.anchor;
  const upgradingMask = createUpgradingMask(features);
  const connectedSeeds: Coord[] = [];
  let rangeTwoUpgradingTiles = 0;

  for (let y = Math.max(1, center.y - 2); y <= Math.min(roomSize - 2, center.y + 2); y += 1) {
    for (let x = Math.max(1, center.x - 2); x <= Math.min(roomSize - 2, center.x + 2); x += 1) {
      if (range({ x, y }, center) > 2 || upgradingMask[toIndex(x, y)] === 0) {
        continue;
      }
      rangeTwoUpgradingTiles += 1;
      connectedSeeds.push({ x, y });
    }
  }

  const connectedSize = connectedSeeds.length === 0 ? 0 : countConnectedTiles(upgradingMask, connectedSeeds);
  return [
    rangeTwoUpgradingTiles,
    connectedSize,
    -candidate.anchor.y,
    -candidate.anchor.x
  ];
}

function satisfiesTempleHubConstraints(features: RoomFeatures, state: PlacementState, candidate: StampPlacement): boolean {
  const center = candidate.anchors.hubCenter ?? candidate.anchor;
  const storage = candidate.anchors.storage ?? candidate.anchor;
  const terminal = candidate.anchors.terminal;
  if (!terminal) {
    return false;
  }

  if (range(center, features.controller) !== 5) {
    return false;
  }

  if (!isAdjacentToControllerRangeTile(features, storage, 3) || !isAdjacentToControllerRangeTile(features, terminal, 3)) {
    return false;
  }

  const nextState = placeStamp(state, candidate);
  const exitMap = createDijkstraMap(features.terrain, features.exits, {
    costMatrix: new GridCostMatrix(nextState.pathBlocked, features.reservedPathMasks.edgeOrigin)
  });

  return hasFiniteAccessDistance(features, nextState, exitMap, storage)
    && hasFiniteAccessDistance(features, nextState, exitMap, terminal);
}

function createPathContext(features: RoomFeatures, state: PlacementState, hub: StampPlacement): PathContext {
  const storage = hub.anchors.storage ?? hub.anchor;
  const storageGoals = getPathGoals(features, state, storage, features.reservedPathMasks.default);
  const sourceGoals = features.sources.map((source, index) => (
    getPathGoals(features, state, source, features.reservedPathMasks.sourceOrigins[index]!)
  )) as [Coord[], Coord[]];
  const sourceCostMatrices = features.sources.map((_, index) => (
    new GridCostMatrix(state.pathBlocked, features.reservedPathMasks.sourceOrigins[index]!)
  )) as [GridCostMatrix, GridCostMatrix];
  const storageDistanceMap = createStorageDistanceMap(features, state, hub);
  const terminalDistanceMap = createTerminalDistanceMap(features, state, hub);
  const sourceDistanceMaps = sourceGoals.map((goals, index) => (
    goals.length === 0 ? null : createDijkstraMap(features.terrain, goals, { costMatrix: sourceCostMatrices[index]! })
  )) as [DijkstraMap | null, DijkstraMap | null];

  return {
    storageDistanceMap,
    terminalDistanceMap,
    sourceDistanceMaps,
    storageToSourceDistances: sourceDistanceMaps.map((sourceDistanceMap) => {
      if (sourceDistanceMap === null || storageGoals.length === 0) {
        return dijkstraUnreachable;
      }

      return minDistance(sourceDistanceMap, storageGoals);
    }) as [number, number]
  };
}

function createStorageDistanceMap(features: RoomFeatures, state: PlacementState, hub: StampPlacement): DijkstraMap | null {
  const storage = hub.anchors.storage ?? hub.anchor;
  const storageGoals = getPathGoals(features, state, storage, features.reservedPathMasks.default);
  return storageGoals.length === 0 ? null : createDijkstraMap(features.terrain, storageGoals, {
    costMatrix: new GridCostMatrix(state.pathBlocked, features.reservedPathMasks.default)
  });
}

function createTerminalDistanceMap(features: RoomFeatures, state: PlacementState, hub: StampPlacement): DijkstraMap | null {
  const terminal = hub.anchors.terminal ?? null;
  if (terminal === null) {
    return null;
  }

  const terminalGoals = getPathGoals(features, state, terminal, features.reservedPathMasks.default);
  return terminalGoals.length === 0 ? null : createDijkstraMap(features.terrain, terminalGoals, {
    costMatrix: new GridCostMatrix(state.pathBlocked, features.reservedPathMasks.default)
  });
}

function createRoomFeatures(room: RoomPlanningRoomData): RoomFeatures {
  validateTerrain(room.terrain);
  const controller = room.objects.find((object) => object.type === "controller");
  if (!controller) {
    throw new Error(`Room '${room.roomName}' is missing a controller.`);
  }

  const sources = room.objects.filter((object) => object.type === "source").sort(compareObjects);
  if (sources.length !== 2) {
    throw new Error(`Room '${room.roomName}' must have exactly two sources for stamp planning.`);
  }

  const baseOccupied = new Uint8Array(roomArea);
  const basePathBlocked = new Uint8Array(roomArea);
  for (const object of room.objects) {
    if (isNaturalBlocker(object)) {
      const index = toIndex(object.x, object.y);
      baseOccupied[index] = 1;
      basePathBlocked[index] = 1;
    }
  }

  const exits = findExitTiles(room.terrain);
  if (exits.length === 0) {
    throw new Error(`Room '${room.roomName}' has no walkable exits.`);
  }
  const reservedPathMasks = createReservedPathMasks(controller, [sources[0]!, sources[1]!]);

  return {
    roomName: room.roomName,
    terrain: room.terrain,
    controller,
    sources: [sources[0]!, sources[1]!],
    mineral: room.objects.find((object) => object.type === "mineral") ?? null,
    exits,
    baseOccupied,
    basePathBlocked,
    reservedPathMasks,
    terrainDistanceTransform: createTerrainDistanceTransform(room.terrain),
    exitDistanceMap: createDijkstraMap(room.terrain, exits, {
      costMatrix: new GridCostMatrix(basePathBlocked, reservedPathMasks.edgeOrigin)
    })
  };
}

function createBaseState(features: RoomFeatures): PlacementState {
  return {
    occupied: new Uint8Array(features.baseOccupied),
    pathBlocked: new Uint8Array(features.basePathBlocked),
    placements: []
  };
}

function placeStamp(state: PlacementState, placement: StampPlacement): PlacementState {
  const occupied = new Uint8Array(state.occupied);
  const pathBlocked = new Uint8Array(state.pathBlocked);

  for (const tile of placement.blockedTiles) {
    occupied[tile] = 1;
    pathBlocked[tile] = 1;
  }

  if (placement.kind === "fastfiller") {
    pathBlocked[toIndex(placement.anchor.x, placement.anchor.y)] = 0;
  }

  return {
    occupied,
    pathBlocked,
    placements: [...state.placements, placement]
  };
}

function fitsStamp(features: RoomFeatures, state: PlacementState, placement: StampPlacement): boolean {
  for (const tile of placement.blockedTiles) {
    const { x, y } = fromIndex(tile);
    if (!isBuildableStampTile(features, x, y) || state.occupied[tile] !== 0) {
      return false;
    }
  }

  return true;
}

function projectStamp(template: StampTemplate, anchor: Coord, rotation: StampRotation, score: number[]): Candidate {
  const blockedTiles: number[] = [];
  const seenTiles = new Set<number>();

  for (const offset of template.blockedOffsets) {
    const rotated = rotateOffset(offset, rotation);
    const x = anchor.x + rotated.x;
    const y = anchor.y + rotated.y;
    if (!isInRoom(x, y)) {
      blockedTiles.push(-1);
      continue;
    }

    const tile = toIndex(x, y);
    if (!seenTiles.has(tile)) {
      seenTiles.add(tile);
      blockedTiles.push(tile);
    }
  }

  const anchors: Record<string, RoomStampAnchor> = {};
  for (const [name, offset] of Object.entries(template.anchors)) {
    const rotated = rotateOffset(offset, rotation);
    anchors[name] = {
      x: anchor.x + rotated.x,
      y: anchor.y + rotated.y
    };
  }

  return {
    kind: template.kind,
    label: `${template.label}@${anchor.x},${anchor.y},r${rotation}`,
    rotation,
    anchor,
    anchors,
    blockedTiles,
    score
  };
}

function rotateOffset(offset: Coord, rotation: StampRotation): Coord {
  switch (rotation) {
    case 0:
      return offset;
    case 90:
      return { x: -offset.y, y: offset.x };
    case 180:
      return { x: -offset.x, y: -offset.y };
    case 270:
      return { x: offset.y, y: -offset.x };
  }
}

function topCandidates<T extends Candidate>(candidates: T[], topK: number): T[] {
  candidates.sort(compareCandidates);
  return candidates.slice(0, topK).map((candidate, index) => ({
    ...candidate,
    label: `${candidate.label}#${index + 1}`
  }));
}

function compareCandidates(left: Candidate, right: Candidate): number {
  const scoreComparison = compareScore(left.score, right.score);
  if (scoreComparison !== 0) {
    return scoreComparison;
  }
  return candidateStableKey(left).localeCompare(candidateStableKey(right));
}

function compareScore(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftScore = left[index] ?? 0;
    const rightScore = right[index] ?? 0;
    if (leftScore > rightScore) {
      return -1;
    }
    if (leftScore < rightScore) {
      return 1;
    }
  }
  return 0;
}

function candidateStableKey(candidate: StampPlacement): string {
  return `${candidate.kind}:${candidate.rotation}:${candidate.anchor.x.toString().padStart(2, "0")}:${candidate.anchor.y.toString().padStart(2, "0")}`;
}

function layoutKey(plan: RoomStampPlan): string {
  const stamps = [plan.stamps.hub, ...plan.stamps.fastfillers, ...(plan.stamps.labs ? [plan.stamps.labs] : [])];
  return stamps.map(candidateStableKey).join("|");
}

function normalizeTopK(topK: number): number {
  if (!Number.isInteger(topK) || topK <= 0) {
    throw new Error(`topK must be a positive integer, received ${topK}.`);
  }
  return topK;
}

function estimateProvisionalDefenseCutSize(features: RoomFeatures, center: Coord): number {
  const left = Math.max(1, center.x - 5);
  const right = Math.min(roomSize - 2, center.x + 4);
  const top = Math.max(1, center.y - 5);
  const bottom = Math.min(roomSize - 2, center.y + 4);
  let openings = 0;

  for (let x = left; x <= right; x += 1) {
    if (isWalkableTerrain(features.terrain, x, top)) {
      openings += 1;
    }
    if (bottom !== top && isWalkableTerrain(features.terrain, x, bottom)) {
      openings += 1;
    }
  }

  for (let y = top + 1; y < bottom; y += 1) {
    if (isWalkableTerrain(features.terrain, left, y)) {
      openings += 1;
    }
    if (right !== left && isWalkableTerrain(features.terrain, right, y)) {
      openings += 1;
    }
  }

  return openings;
}

function createUpgradingMask(features: RoomFeatures): Uint8Array {
  const mask = new Uint8Array(roomArea);
  for (let y = 1; y < roomSize - 1; y += 1) {
    for (let x = 1; x < roomSize - 1; x += 1) {
      if (range({ x, y }, features.controller) <= 3 && isWalkableTerrain(features.terrain, x, y)) {
        mask[toIndex(x, y)] = 1;
      }
    }
  }
  return mask;
}

function countConnectedTiles(mask: Uint8Array, seeds: Coord[]): number {
  const visited = new Uint8Array(roomArea);
  const stack = new Uint16Array(roomArea);
  let stackSize = 0;
  let count = 0;

  for (const seed of seeds) {
    const index = toIndex(seed.x, seed.y);
    if (mask[index] === 0 || visited[index] !== 0) {
      continue;
    }
    visited[index] = 1;
    stack[stackSize] = index;
    stackSize += 1;
  }

  while (stackSize > 0) {
    stackSize -= 1;
    const index = stack[stackSize]!;
    count += 1;
    const { x, y } = fromIndex(index);

    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        const nextX = x + dx;
        const nextY = y + dy;
        if (!isInRoom(nextX, nextY)) {
          continue;
        }
        const nextIndex = toIndex(nextX, nextY);
        if (mask[nextIndex] === 0 || visited[nextIndex] !== 0) {
          continue;
        }
        visited[nextIndex] = 1;
        stack[stackSize] = nextIndex;
        stackSize += 1;
      }
    }
  }

  return count;
}

function hasOpenNeighborAfterPlacement(features: RoomFeatures, state: PlacementState, placement: StampPlacement, coord: Coord): boolean {
  const blocked = new Uint8Array(state.pathBlocked);
  for (const tile of placement.blockedTiles) {
    if (tile >= 0) {
      blocked[tile] = 1;
    }
  }
  blocked[toIndex(coord.x, coord.y)] = 0;

  for (const neighbor of neighbors(coord)) {
    if (isWalkableTerrain(features.terrain, neighbor.x, neighbor.y) && blocked[toIndex(neighbor.x, neighbor.y)] === 0) {
      return true;
    }
  }

  return false;
}

function hasFiniteAccessDistance(features: RoomFeatures, state: PlacementState, map: DijkstraMap, target: Coord): boolean {
  return minDistance(map, getPathGoals(features, state, target, features.reservedPathMasks.default)) !== dijkstraUnreachable;
}

function getPathGoals(features: RoomFeatures, state: PlacementState, target: Coord, reservedPathMask: Uint8Array): Coord[] {
  return neighbors(target).filter((coord) => (
    isWalkableTerrain(features.terrain, coord.x, coord.y)
    && state.pathBlocked[toIndex(coord.x, coord.y)] === 0
    && reservedPathMask[toIndex(coord.x, coord.y)] === 0
  ));
}

function minDistance(map: DijkstraMap, goals: Coord[]): number {
  let best = dijkstraUnreachable;
  for (const goal of goals) {
    const distance = map.get(goal.x, goal.y);
    if (distance < best) {
      best = distance;
    }
  }
  return best;
}

function isAdjacentToControllerRangeTile(features: RoomFeatures, target: Coord, controllerRange: number): boolean {
  return neighbors(target).some((coord) => (
    isWalkableTerrain(features.terrain, coord.x, coord.y)
    && range(coord, features.controller) <= controllerRange
  ));
}

function findExitTiles(terrain: string): Coord[] {
  const exits: Coord[] = [];
  for (let x = 0; x < roomSize; x += 1) {
    if (isWalkableTerrain(terrain, x, 0)) {
      exits.push({ x, y: 0 });
    }
    if (isWalkableTerrain(terrain, x, roomSize - 1)) {
      exits.push({ x, y: roomSize - 1 });
    }
  }
  for (let y = 1; y < roomSize - 1; y += 1) {
    if (isWalkableTerrain(terrain, 0, y)) {
      exits.push({ x: 0, y });
    }
    if (isWalkableTerrain(terrain, roomSize - 1, y)) {
      exits.push({ x: roomSize - 1, y });
    }
  }
  return exits;
}

function isNaturalBlocker(object: RoomPlanningObject): boolean {
  return object.type === "controller" || object.type === "source" || object.type === "mineral" || object.type === "deposit";
}

function isBuildableStampTile(features: RoomFeatures, x: number, y: number): boolean {
  return isBuildableStampTerrain(features.terrain, x, y) && !isReservedStampTileForFeatures(features, x, y);
}

function isBuildableStampTerrain(terrain: string, x: number, y: number): boolean {
  return x > 0 && x < roomSize - 1 && y > 0 && y < roomSize - 1 && isWalkableTerrain(terrain, x, y);
}

function isReservedStampTileForFeatures(features: RoomFeatures, x: number, y: number): boolean {
  if (!isInRoom(x, y)) {
    return false;
  }
  if (isEdgeReservedStampTile(x, y)) {
    return true;
  }

  const coord = { x, y };
  return range(coord, features.controller) <= controllerStampReserveRange
    || features.sources.some((source) => range(coord, source) <= sourceStampReserveRange);
}

function isReservedStampTileForRoom(room: RoomPlanningRoomData, x: number, y: number): boolean {
  if (!isInRoom(x, y)) {
    return false;
  }
  if (isEdgeReservedStampTile(x, y)) {
    return true;
  }

  const coord = { x, y };
  return room.objects.some((object) => (
    (object.type === "controller" && range(coord, object) <= controllerStampReserveRange)
    || (object.type === "source" && range(coord, object) <= sourceStampReserveRange)
  ));
}

function createReservedPathMasks(controller: RoomPlanningObject, sources: [RoomPlanningObject, RoomPlanningObject]): ReservedPathMasks {
  return {
    default: createReservedPathMask(controller, sources, null),
    edgeOrigin: createReservedPathMask(controller, sources, { kind: "edge" }),
    sourceOrigins: [
      createReservedPathMask(controller, sources, { kind: "source", index: 0 }),
      createReservedPathMask(controller, sources, { kind: "source", index: 1 })
    ]
  };
}

function createReservedPathMask(
  controller: RoomPlanningObject,
  sources: [RoomPlanningObject, RoomPlanningObject],
  exemption: ReservedPathExemption
): Uint8Array {
  const mask = new Uint8Array(roomArea);

  for (let y = 0; y < roomSize; y += 1) {
    for (let x = 0; x < roomSize; x += 1) {
      if (isReservedPathTile(controller, sources, x, y, exemption)) {
        mask[toIndex(x, y)] = 1;
      }
    }
  }

  return mask;
}

function isReservedPathTile(
  controller: RoomPlanningObject,
  sources: [RoomPlanningObject, RoomPlanningObject],
  x: number,
  y: number,
  exemption: ReservedPathExemption
): boolean {
  const coord = { x, y };
  if (exemption?.kind === "source" && range(coord, sources[exemption.index]!) <= sourceStampReserveRange) {
    return false;
  }
  if (exemption?.kind === "edge" && isEdgeReservedStampTile(x, y)) {
    return false;
  }

  if (isEdgeReservedStampTile(x, y)) {
    return true;
  }

  if (range(coord, controller) <= controllerStampReserveRange) {
    return true;
  }

  return sources.some((source, index) => (
    range(coord, source) <= sourceStampReserveRange
    && !(exemption?.kind === "source" && exemption.index === index)
  ));
}

function isEdgeReservedStampTile(x: number, y: number): boolean {
  return x <= edgeStampReserveRange || y <= edgeStampReserveRange
    || x >= roomSize - 1 - edgeStampReserveRange || y >= roomSize - 1 - edgeStampReserveRange;
}

function isWalkableTerrain(terrain: string, x: number, y: number): boolean {
  return isInRoom(x, y) && (terrain.charCodeAt(toIndex(x, y)) - 48 & terrainMaskWall) === 0;
}

function neighbors(coord: Coord): Coord[] {
  const result: Coord[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const x = coord.x + dx;
      const y = coord.y + dy;
      if (isInRoom(x, y)) {
        result.push({ x, y });
      }
    }
  }
  return result;
}

function compareObjects(left: RoomPlanningObject, right: RoomPlanningObject): number {
  if (left.x !== right.x) {
    return left.x - right.x;
  }
  if (left.y !== right.y) {
    return left.y - right.y;
  }
  return left.id.localeCompare(right.id);
}

function range(left: Coord, right: Coord): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

function isInRoom(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < roomSize && y >= 0 && y < roomSize;
}

function toIndex(x: number, y: number): number {
  return y * roomSize + x;
}

function fromIndex(index: number): Coord {
  return {
    x: index % roomSize,
    y: Math.floor(index / roomSize)
  };
}

function validateTerrain(terrain: string): void {
  if (terrain.length !== roomArea) {
    throw new Error(`Expected terrain string length ${roomArea}, received ${terrain.length}.`);
  }
}

function createDebugPhase(name: string, candidates: Candidate[], selected: StampPlacement | null): StampSearchDebugPhase {
  return {
    name,
    selectedLabel: selected?.label ?? null,
    candidates: candidates.map((candidate, index) => ({
      key: candidateStableKey(candidate),
      kind: candidate.kind,
      label: candidate.label,
      rank: index + 1,
      rotation: candidate.rotation,
      anchor: candidate.anchor,
      anchors: candidate.anchors,
      blockedTiles: candidate.blockedTiles,
      score: candidate.score,
      rejected: false
    }))
  };
}

function createTreeNode(
  id: string,
  candidate: Candidate,
  index: number,
  selected: boolean,
  children: StampSearchTreeNode[],
  completeScore?: number[]
): StampSearchTreeNode {
  return {
    id,
    candidate: {
      key: candidateStableKey(candidate),
      kind: candidate.kind,
      label: candidate.label,
      rank: index + 1,
      rotation: candidate.rotation,
      anchor: candidate.anchor,
      anchors: candidate.anchors,
      blockedTiles: candidate.blockedTiles,
      score: candidate.score,
      rejected: false
    },
    selected,
    completeScore,
    children
  };
}

class GridCostMatrix implements Pick<PathFinder["CostMatrix"], "get"> {
  private readonly blocked: Uint8Array;
  private readonly reserved: Uint8Array | null;

  constructor(blocked: Uint8Array, reserved: Uint8Array | null = null) {
    this.blocked = blocked;
    this.reserved = reserved;
  }

  get(x: number, y: number): number {
    const index = toIndex(x, y);
    return this.blocked[index] === 0 && (this.reserved === null || this.reserved[index] === 0) ? 0 : 255;
  }
}

function rectangleOffsets(width: number, height: number, origin: Coord = { x: 0, y: 0 }): Coord[] {
  const offsets: Coord[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      offsets.push({ x: x + origin.x, y: y + origin.y });
    }
  }
  return offsets;
}

function fastfillerOffsets(): Coord[] {
  const offsets = new Map<string, Coord>();
  for (const coord of [
    ...rectangleOffsets(3, 3, { x: -2, y: 0 }),
    ...rectangleOffsets(3, 3, { x: 0, y: -2 })
  ]) {
    offsets.set(`${coord.x},${coord.y}`, coord);
  }
  return [...offsets.values()];
}

const normalHubTemplate: StampTemplate = {
  kind: "hub",
  label: "hub-normal",
  rotations: [0, 90, 180, 270],
  blockedOffsets: rectangleOffsets(3, 3),
  anchors: {
    storage: { x: 0, y: 0 },
    terminal: { x: 2, y: 0 },
    hubCenter: { x: 1, y: 1 }
  }
};

const templeHubTemplate: StampTemplate = {
  kind: "hub",
  label: "hub-temple",
  rotations: [0, 90, 180, 270],
  blockedOffsets: rectangleOffsets(4, 3),
  anchors: {
    storage: { x: 0, y: 0 },
    terminal: { x: 2, y: 0 },
    hubCenter: { x: 1, y: 1 }
  }
};

const fastfillerTemplate: StampTemplate = {
  kind: "fastfiller",
  label: "fastfiller",
  rotations: [0, 90],
  blockedOffsets: fastfillerOffsets(),
  anchors: {
    container: { x: 0, y: 0 }
  }
};

const labTemplate: StampTemplate = {
  kind: "labs",
  label: "labs",
  rotations: [0, 90, 180, 270],
  blockedOffsets: rectangleOffsets(4, 4),
  anchors: {
    entrance: { x: 0, y: 0 }
  }
};
