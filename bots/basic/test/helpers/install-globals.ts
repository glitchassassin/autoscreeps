export function installScreepsGlobals(): void {
  Object.assign(globalThis, {
    OK: 0,
    ERR_NOT_FOUND: -5,
    ERR_NOT_IN_RANGE: -9,
    WORK: "work",
    CARRY: "carry",
    MOVE: "move",
    RESOURCE_ENERGY: "energy",
    FIND_MY_STRUCTURES: 1,
    FIND_SOURCES: 2,
    FIND_SOURCES_ACTIVE: 3,
    STRUCTURE_SPAWN: "spawn",
    STRUCTURE_EXTENSION: "extension",
    STRUCTURE_TOWER: "tower"
  });
}
