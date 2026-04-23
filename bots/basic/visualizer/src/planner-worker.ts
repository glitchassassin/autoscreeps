import { createRoomPlanningVisualization, type RoomPlanningVisualization } from "../../src/planning/room-planning-visualization.ts";
import type { RoomPlanningPolicy } from "../../src/planning/room-plan.ts";
import { loadBrowserPlanningFixture } from "./fixture.ts";

export type PlannerWorkerRequest = {
  roomName: string;
  policy: RoomPlanningPolicy;
  topK?: number;
};

export type PlannerWorkerResponse =
  | { ok: true; visualization: RoomPlanningVisualization }
  | { ok: false; error: string };

self.addEventListener("message", (event: MessageEvent<PlannerWorkerRequest>) => {
  void handleRequest(event.data);
});

async function handleRequest(request: PlannerWorkerRequest): Promise<void> {
  try {
    const fixture = await loadBrowserPlanningFixture();
    const room = fixture.map.getRoom(request.roomName);
    if (room === null) {
      throw new Error(`Room '${request.roomName}' is not available in the bundled fixture.`);
    }

    const visualization = createRoomPlanningVisualization(room, request.policy, {
      topK: request.topK
    });
    postMessage({ ok: true, visualization } satisfies PlannerWorkerResponse);
  } catch (error) {
    postMessage({
      ok: false,
      error: error instanceof Error ? error.stack ?? error.message : String(error)
    } satisfies PlannerWorkerResponse);
  }
}
