import type { ConstructionPlan } from "../core/types";

export function executeConstructionPlan(plan: ConstructionPlan): ScreepsReturnCode | null {
  const request = plan.request;
  if (request === null) {
    return null;
  }

  const room = Game.rooms[request.roomName];
  if (!room?.controller?.my) {
    return null;
  }

  return room.createConstructionSite(request.x, request.y, request.structureType);
}
