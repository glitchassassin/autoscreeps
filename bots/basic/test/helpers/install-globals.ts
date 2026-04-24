export function installScreepsGlobals(): void {
  class TestRoomPosition {
    constructor(
      readonly x: number,
      readonly y: number,
      readonly roomName: string
    ) {}

    getRangeTo(targetOrX: number | RoomPosition | { pos: RoomPosition }, y?: number): number {
      const target = typeof targetOrX === "number"
        ? { x: targetOrX, y: y ?? 0 }
        : "pos" in targetOrX
          ? targetOrX.pos
          : targetOrX;
      return Math.max(Math.abs(this.x - target.x), Math.abs(this.y - target.y));
    }

    isEqualTo(target: RoomPosition | { pos: RoomPosition }): boolean {
      const position = "pos" in target ? target.pos : target;
      return this.x === position.x && this.y === position.y && this.roomName === position.roomName;
    }

    isNearTo(target: RoomPosition | { pos: RoomPosition }): boolean {
      return this.getRangeTo(target) <= 1;
    }

    findClosestByPath<T>(targets: T[]): T | null {
      return targets[0] ?? null;
    }

    lookFor(): unknown[] {
      return [];
    }
  }

  Object.assign(globalThis, {
    OK: 0,
    ERR_TIRED: -11,
    ERR_NO_PATH: -2,
    ERR_NOT_FOUND: -5,
    ERR_NOT_IN_RANGE: -9,
    ERR_INVALID_TARGET: -7,
    WORK: "work",
    CARRY: "carry",
    MOVE: "move",
    RESOURCE_ENERGY: "energy",
    FIND_MY_SPAWNS: 0,
    FIND_MY_STRUCTURES: 1,
    FIND_STRUCTURES: 8,
    FIND_SOURCES: 2,
    FIND_SOURCES_ACTIVE: 3,
    FIND_MY_CONSTRUCTION_SITES: 4,
    FIND_DROPPED_RESOURCES: 5,
    FIND_MINERALS: 6,
    FIND_DEPOSITS: 7,
    LOOK_CREEPS: "creep",
    STRUCTURE_SPAWN: "spawn",
    STRUCTURE_EXTENSION: "extension",
    STRUCTURE_TOWER: "tower",
    STRUCTURE_ROAD: "road",
    STRUCTURE_WALL: "constructedWall",
    STRUCTURE_RAMPART: "rampart",
    STRUCTURE_CONTAINER: "container",
    STRUCTURE_STORAGE: "storage",
    STRUCTURE_LINK: "link",
    STRUCTURE_TERMINAL: "terminal",
    STRUCTURE_LAB: "lab",
    STRUCTURE_EXTRACTOR: "extractor",
    STRUCTURE_FACTORY: "factory",
    STRUCTURE_POWER_SPAWN: "powerSpawn",
    STRUCTURE_NUKER: "nuker",
    STRUCTURE_OBSERVER: "observer",
    TERRAIN_MASK_WALL: 1,
    RawMemory: {
      segments: {},
      setActiveSegments: () => {}
    },
    RoomPosition: TestRoomPosition
  });
}
