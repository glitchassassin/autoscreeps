import { createRoomPlanningVisualization, type RoomPlanningVisualization } from "../../src/planning/room-planning-visualization.ts";
import type { RoomPlanningPolicy, RoomPlanningRoomData } from "../../src/planning/room-plan.ts";

export type PlannerWorkerRequest = {
  requestId: number;
  room: RoomPlanningRoomData;
  policy: RoomPlanningPolicy;
  topK?: number;
};

export type PlannerWorkerResponse =
  | { ok: true; requestId: number; visualization: RoomPlanningVisualization }
  | { ok: false; requestId: number; error: string };

self.addEventListener("message", (event: MessageEvent<PlannerWorkerRequest>) => {
  void handleRequest(event.data);
});

async function handleRequest(request: PlannerWorkerRequest): Promise<void> {
  try {
    const visualization = createRoomPlanningVisualization(request.room, request.policy, {
      topK: request.topK
    });
    postMessage({ ok: true, requestId: request.requestId, visualization } satisfies PlannerWorkerResponse);
  } catch (error) {
    postMessage({
      ok: false,
      requestId: request.requestId,
      error: error instanceof Error ? error.stack ?? error.message : String(error)
    } satisfies PlannerWorkerResponse);
  }
}
