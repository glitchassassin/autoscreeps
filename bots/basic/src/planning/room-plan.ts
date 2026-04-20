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
};

export function planRoom(request: RoomPlanRequest): RoomPlan {
  if (request.map.getRoom(request.roomName) === null) {
    throw new Error(`Room '${request.roomName}' is not available for planning.`);
  }

  throw new Error("Room planning not implemented yet.");
}
