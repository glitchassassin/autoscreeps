export function installScreepsGlobals(): void {
  Object.assign(globalThis, {
    OK: 0,
    ERR_NOT_FOUND: -5,
    ERR_NOT_IN_RANGE: -9,
    ERR_INVALID_TARGET: -7,
    WORK: "work",
    CARRY: "carry",
    MOVE: "move",
    RESOURCE_ENERGY: "energy",
    FIND_MY_SPAWNS: 0,
    FIND_MY_STRUCTURES: 1,
    FIND_SOURCES: 2,
    FIND_SOURCES_ACTIVE: 3,
    FIND_MY_CONSTRUCTION_SITES: 4,
    STRUCTURE_SPAWN: "spawn",
    STRUCTURE_EXTENSION: "extension",
    STRUCTURE_TOWER: "tower",
    TERRAIN_MASK_WALL: 1
  });
}
