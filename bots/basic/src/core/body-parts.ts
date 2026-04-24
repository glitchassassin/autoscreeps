export function countActiveBodyParts(creep: Creep, part: BodyPartConstant): number {
  if (typeof creep.getActiveBodyparts === "function") {
    return creep.getActiveBodyparts(part);
  }

  return countBodyParts(creep, part);
}

export function countBodyParts(creep: Creep, part: BodyPartConstant): number {
  return creep.body?.filter((bodyPart) => bodyPart.type === part).length ?? 0;
}

export function calculateBodyCost(body: BodyPartConstant[]): number {
  return body.reduce((total, part) => total + getBodyPartCost(part), 0);
}

export function getBodyPartCost(part: BodyPartConstant): number {
  switch (part) {
    case WORK:
      return 100;
    case CARRY:
      return 50;
    case MOVE:
      return 50;
    default:
      return 0;
  }
}
