import { describe, expect, it } from "vitest";
import { buildRoomStatusData, type RoomDoc } from "../src/lib/offline-map-import.ts";

describe("buildRoomStatusData", () => {
  it("creates the runtime room status blob expected by Game.map.getRoomStatus", () => {
    const now = 1000;
    const rooms: RoomDoc[] = [
      makeRoom("W0N0", "normal"),
      makeRoom("W0N1", "normal", { novice: 2000 }),
      makeRoom("W0N2", "normal", { respawnArea: 3000 }),
      makeRoom("W0N3", "normal", { openTime: 4000 }),
      makeRoom("W0N4", "out of borders"),
      makeRoom("W0N5", "normal", { novice: 500 })
    ];

    expect(buildRoomStatusData(rooms, now)).toEqual({
      novice: {
        W0N1: 2000
      },
      respawn: {
        W0N2: 3000
      },
      closed: {
        W0N3: 4000,
        W0N4: null
      }
    });
  });
});

function makeRoom(
  _id: string,
  status: string,
  overrides: Partial<RoomDoc> = {}
): RoomDoc {
  return {
    _id,
    name: _id,
    status,
    ...overrides
  };
}
