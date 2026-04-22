import { planRamparts, type RampartPlan } from "./rampart-plan.ts";
import { planRoads, type RoadPlan } from "./road-plan.ts";
import { planRoomStamps, type RoomStampPlan } from "./stamp-placement.ts";
import { planRoomStructures, type RoomStructurePlan } from "./structure-plan.ts";

export type RoomPlanningPolicy = "normal" | "temple";

export type RoomPlanningObject = {
  id: string;
  roomName: string;
  type: string;
  x: number;
  y: number;
  mineralType?: string;
  depositType?: string;
};

export type RoomPlanningRoomData = {
  roomName: string;
  terrain: string;
  objects: RoomPlanningObject[];
};

export type RoomPlanningMap = {
  getRoom(roomName: string): RoomPlanningRoomData | null;
};

export type RoomPlanRequest = {
  roomName: string;
  policy: RoomPlanningPolicy;
  map: RoomPlanningMap;
};

export type RoomPlan = {
  roomName: string;
  policy: RoomPlanningPolicy;
  stampPlan: RoomStampPlan;
};

export type CompleteRoomPlan = RoomPlan & {
  roadPlan: RoadPlan;
  rampartPlan: RampartPlan;
  structurePlan: RoomStructurePlan;
};

export function planRoom(request: RoomPlanRequest): RoomPlan {
  const room = request.map.getRoom(request.roomName);
  if (room === null) {
    throw new Error(`Room '${request.roomName}' is not available for planning.`);
  }

  return {
    roomName: request.roomName,
    policy: request.policy,
    stampPlan: planRoomStamps(room, request.policy)
  };
}

export function planCompleteRoom(request: RoomPlanRequest): CompleteRoomPlan {
  const room = request.map.getRoom(request.roomName);
  if (room === null) {
    throw new Error(`Room '${request.roomName}' is not available for planning.`);
  }

  const stampPlan = planRoomStamps(room, request.policy);
  const roadPlan = planRoads(room, stampPlan);
  const rampartPlan = planRamparts(room, stampPlan, roadPlan);
  const structurePlan = planRoomStructures(room, stampPlan, roadPlan, rampartPlan);

  return {
    roomName: request.roomName,
    policy: request.policy,
    stampPlan,
    roadPlan,
    rampartPlan,
    structurePlan
  };
}
