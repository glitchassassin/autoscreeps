export function countActiveBodyParts(creep: Creep, part: BodyPartConstant): number {
  if (typeof creep.getActiveBodyparts === "function") {
    return creep.getActiveBodyparts(part);
  }

  return countBodyParts(creep, part);
}

export function countBodyParts(creep: Creep, part: BodyPartConstant): number {
  return creep.body?.filter((bodyPart) => bodyPart.type === part).length ?? 0;
}
