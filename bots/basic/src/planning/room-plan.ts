import { planRoomStamps, type RoomStampPlan } from "./stamp-placement.ts";

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
