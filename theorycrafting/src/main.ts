import "./styles.css";

type PartType = "attack" | "ranged_attack" | "heal" | "move" | "tough" | "work" | "carry" | "claim";
type MeleeAction = "attack" | "heal";
type Outcome = "running" | "win" | "loss" | "stalled" | "timeout";
type Formation = "stacked" | "duo" | "quad";

type Position = {
  x: number;
  y: number;
};

type BodyPartState = {
  type: PartType;
  hits: number;
};

type CreepSpec = {
  name: string;
  body: PartType[];
};

type CombatantSnapshot = {
  name: string;
  body: BodyPartState[];
  fatigue: number;
  hits: number;
  hitsMax: number;
  cost: number;
  alive: boolean;
  damageTaken: number;
};

type Frame = {
  tick: number;
  range: number;
  keeperX: number;
  friendlyX: number;
  keeperPosition: Position;
  friendlyPositions: Position[];
  keeper: CombatantSnapshot;
  friendlies: CombatantSnapshot[];
  events: string[];
  outcome: Outcome;
  killTick?: number;
  fullHealTick?: number;
};

type SimulationOptions = {
  meleeAction: MeleeAction;
  maxTicks: number;
  startRange: number;
  preferredRange: number;
  formation: Formation;
  keeperBody: PartType[];
};

type SimulationResult = {
  frames: Frame[];
  outcome: Outcome;
  formation: Formation;
  killTick?: number;
  fullHealTick?: number;
  friendlyDamageTaken: number;
  keeperDamageTaken: number;
};

type Preset = {
  id: string;
  label: string;
  meleeAction: MeleeAction;
  preferredRange: number;
  startRange: number;
  maxTicks: number;
  formation: Formation;
  creeps: CreepSpec[];
};

const partHits = 100;
const meleeDamagePerPart = 30;
const rangedDamagePerPart = 10;
const adjacentHealPerPart = 12;
const rangedHealPerPart = 4;
const plainFatigue = 2;
const moveFatigueReduction = 2;
const friendlyStartX = 1;

const partCost: Record<PartType, number> = {
  attack: 80,
  ranged_attack: 150,
  heal: 250,
  move: 50,
  tough: 10,
  work: 100,
  carry: 50,
  claim: 600
};

const partAlias: Record<string, PartType> = {
  a: "attack",
  attack: "attack",
  ra: "ranged_attack",
  ranged: "ranged_attack",
  ranged_attack: "ranged_attack",
  h: "heal",
  heal: "heal",
  m: "move",
  move: "move",
  t: "tough",
  tough: "tough",
  w: "work",
  work: "work",
  c: "carry",
  carry: "carry",
  cl: "claim",
  claim: "claim"
};

const partShortName: Record<PartType, string> = {
  attack: "A",
  ranged_attack: "R",
  heal: "H",
  move: "M",
  tough: "T",
  work: "W",
  carry: "C",
  claim: "CL"
};

const partClassName: Record<PartType, string> = {
  attack: "text-red-500",
  ranged_attack: "text-blue-500",
  heal: "text-lime-500",
  move: "text-blue-300",
  tough: "text-slate-50",
  work: "text-amber-500",
  carry: "text-stone-300",
  claim: "text-violet-400"
};

const factClass =
  "grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-amber-200 bg-orange-50/65 px-[9px] py-2 text-xs dark:border-zinc-600 dark:bg-zinc-700/40";
const factLabelClass = "text-stone-500 [overflow-wrap:anywhere] dark:text-stone-400";
const factValueClass = "text-right font-semibold text-stone-950 dark:text-stone-50";
const eventPillClass =
  "rounded-full border border-amber-200 bg-amber-100/70 px-2 py-1 text-xs text-stone-600 dark:border-zinc-600 dark:bg-zinc-700/55 dark:text-stone-300";
const bodyPanelClass = "rounded-lg border border-amber-200 bg-orange-50/65 p-2.5 dark:border-zinc-600 dark:bg-zinc-700/40";
const bodyHeadingClass = "mb-[3px] flex items-baseline justify-between gap-2";
const bodyNameClass = "font-serif text-[15px] font-bold text-stone-950 dark:text-stone-50";
const bodyHitsClass = "text-xs text-stone-500 dark:text-stone-400";
const bodySubtitleClass = "mb-[9px] text-xs text-stone-500 dark:text-stone-400";
const bodyGridClass = "grid grid-cols-[repeat(10,24px)] gap-1";
const bodyPartBaseClass =
  "relative grid h-6 w-6 place-items-center overflow-hidden rounded-full border-2 border-current bg-stone-900 dark:bg-zinc-950";
const bodyPartDeadClass = "opacity-30";
const partFillClass = "absolute inset-x-0 bottom-0 bg-current opacity-95";
const partLabelBaseClass = "relative z-10 text-[8px] leading-none font-extrabold";
const partLabelAliveClass = "text-stone-900 dark:text-zinc-950";
const partLabelDeadClass = "text-amber-50";
const stageBackgroundClass = "fill-[#19130d] dark:fill-[#111113]";
const tileBaseClass = "stroke-[#6f604b] [stroke-width:0.04] [shape-rendering:crispEdges] dark:stroke-zinc-700";
const tileAClass = "fill-[#2e281f] dark:fill-[#1f1f22]";
const tileBClass = "fill-[#252017] dark:fill-[#18181b]";
const rangeLineClass = "stroke-amber-400 [stroke-width:0.055] [stroke-dasharray:0.18_0.14]";
const rangeLabelClass = "fill-amber-300 text-[0.34px] [text-anchor:middle] [dominant-baseline:middle]";
const combatLabelClass = "fill-amber-50 text-[0.34px] [text-anchor:middle] [dominant-baseline:middle]";
const deadMarkerClass = "opacity-35";
const keeperRingClass =
  "fill-stone-900 stroke-red-500 [stroke-width:0.1] [shape-rendering:geometricPrecision] dark:fill-zinc-950";
const keeperCoreClass = "fill-red-950";
const friendlyRingClass =
  "fill-stone-900 stroke-teal-400 [stroke-width:0.1] [shape-rendering:geometricPrecision] dark:fill-zinc-950";
const friendlyCoreClass = "fill-teal-900";
const hpTrackClass = "fill-stone-600 dark:fill-zinc-700";
const hpFillClass = "fill-lime-500";

const presets: Preset[] = [
  {
    id: "rcl7-ranged",
    label: "RCL7 ranged solo",
    meleeAction: "attack",
    preferredRange: 3,
    startRange: 3,
    maxTicks: 500,
    formation: "stacked",
    creeps: [{ name: "ranger", body: parseBodySpec("25m,19ra,6h") }]
  },
  {
    id: "rcl7-passive-melee",
    label: "RCL7 passive melee",
    meleeAction: "heal",
    preferredRange: 1,
    startRange: 3,
    maxTicks: 500,
    formation: "stacked",
    creeps: [{ name: "guard", body: parseBodySpec("2t,25m,13a,10h") }]
  },
  {
    id: "rcl6-ranged-duo",
    label: "RCL6 ranged duo",
    meleeAction: "attack",
    preferredRange: 2,
    startRange: 2,
    maxTicks: 500,
    formation: "duo",
    creeps: [
      { name: "point", body: parseBodySpec("9m,5ra,4h") },
      { name: "support", body: parseBodySpec("7m,7h") }
    ]
  },
  {
    id: "rcl6-cat-duo",
    label: "rcl6 cat duo",
    meleeAction: "attack",
    preferredRange: 2,
    startRange: 2,
    maxTicks: 500,
    formation: "duo",
    creeps: [1, 2].map((index) => ({ name: `cat${index}`, body: parseBodySpec("6m,10ra,4h") }))
  },
  {
    id: "rcl6-quad",
    label: "RCL6 ranged quad",
    meleeAction: "attack",
    preferredRange: 3,
    startRange: 3,
    maxTicks: 500,
    formation: "quad",
    creeps: [0, 1, 2, 3].map((index) => ({ name: `q${index + 1}`, body: parseBodySpec("8ra,10m,2h") }))
  },
  {
    id: "rcl6-passive-melee",
    label: "RCL6 passive melee",
    meleeAction: "heal",
    preferredRange: 1,
    startRange: 3,
    maxTicks: 500,
    formation: "stacked",
    creeps: [{ name: "probe", body: parseBodySpec("11m,6a,5h") }]
  },
  {
    id: "rcl8-ranged",
    label: "RCL8 ranged solo",
    meleeAction: "attack",
    preferredRange: 3,
    startRange: 3,
    maxTicks: 500,
    formation: "stacked",
    creeps: [{ name: "ranger", body: parseBodySpec("25m,20ra,5h") }]
  },
  {
    id: "rcl8-passive-melee",
    label: "RCL8 passive melee",
    meleeAction: "heal",
    preferredRange: 1,
    startRange: 3,
    maxTicks: 500,
    formation: "stacked",
    creeps: [{ name: "guard", body: parseBodySpec("25m,17a,8h") }]
  }
];

class SimCreep {
  public readonly body: BodyPartState[];
  public fatigue = 0;
  public totalDamageTaken = 0;

  constructor(
    public readonly name: string,
    body: PartType[]
  ) {
    this.body = body.map((type) => ({ type, hits: partHits }));
  }

  get hitsMax(): number {
    return this.body.length * partHits;
  }

  get hits(): number {
    return this.body.reduce((sum, part) => sum + part.hits, 0);
  }

  get alive(): boolean {
    return this.hits > 0;
  }

  get damaged(): boolean {
    return this.hits < this.hitsMax;
  }

  get cost(): number {
    return this.body.reduce((sum, part) => sum + partCost[part.type], 0);
  }

  active(type: PartType): number {
    return this.body.filter((part) => part.type === type && part.hits > 0).length;
  }

  fatigueGeneratingParts(): number {
    // Dead MOVE parts are carried weight: they add fatigue but no longer reduce it.
    return this.body.filter((part) => part.type !== "move" || part.hits <= 0).length;
  }

  canMove(): boolean {
    return this.alive && this.active("move") > 0 && this.fatigue === 0;
  }

  movePlain(): boolean {
    if (!this.canMove()) {
      return false;
    }
    this.fatigue += this.fatigueGeneratingParts() * plainFatigue;
    return true;
  }

  recoverFatigue(): void {
    if (!this.alive) {
      return;
    }
    this.fatigue = Math.max(0, this.fatigue - this.active("move") * moveFatigueReduction);
  }

  damage(amount: number): number {
    let remaining = Math.max(0, amount);
    const before = this.hits;
    for (const part of this.body) {
      if (remaining <= 0) {
        break;
      }
      const applied = Math.min(part.hits, remaining);
      part.hits -= applied;
      remaining -= applied;
    }
    const actual = before - this.hits;
    this.totalDamageTaken += actual;
    return actual;
  }

  heal(amount: number): number {
    let remaining = Math.max(0, amount);
    const before = this.hits;
    for (let index = this.body.length - 1; index >= 0; index -= 1) {
      if (remaining <= 0) {
        break;
      }
      const part = this.body[index]!;
      const applied = Math.min(partHits - part.hits, remaining);
      part.hits += applied;
      remaining -= applied;
    }
    return this.hits - before;
  }

  snapshot(): CombatantSnapshot {
    return {
      name: this.name,
      body: this.body.map((part) => ({ ...part })),
      fatigue: this.fatigue,
      hits: this.hits,
      hitsMax: this.hitsMax,
      cost: this.cost,
      alive: this.alive,
      damageTaken: this.totalDamageTaken
    };
  }
}

const presetSelect = getElement<HTMLSelectElement>("preset-select");
const directoryShell = getElement<HTMLElement>("directory-shell");
const combatShell = getElement<HTMLElement>("combat-shell");
const meleeActionSelect = getElement<HTMLSelectElement>("melee-action-select");
const formationSelect = getElement<HTMLSelectElement>("formation-select");
const startRangeInput = getElement<HTMLInputElement>("start-range-input");
const preferredRangeInput = getElement<HTMLInputElement>("preferred-range-input");
const maxTicksInput = getElement<HTMLInputElement>("max-ticks-input");
const creepSpecsInput = getElement<HTMLTextAreaElement>("creep-specs");
const keeperSpecInput = getElement<HTMLInputElement>("keeper-spec");
const runButton = getElement<HTMLButtonElement>("run-button");
const statusText = getElement<HTMLElement>("status-text");
const scenarioFacts = getElement<HTMLElement>("scenario-facts");
const combatSvg = getElement<SVGSVGElement>("combat-svg");
const previousButton = getElement<HTMLButtonElement>("previous-button");
const playButton = getElement<HTMLButtonElement>("play-button");
const nextButton = getElement<HTMLButtonElement>("next-button");
const tickSlider = getElement<HTMLInputElement>("tick-slider");
const tickLabel = getElement<HTMLElement>("tick-label");
const eventLog = getElement<HTMLElement>("event-log");
const bodyList = getElement<HTMLElement>("body-list");

let result: SimulationResult = simulate(
  presets[0]!.creeps,
  {
    meleeAction: presets[0]!.meleeAction,
    maxTicks: presets[0]!.maxTicks,
    startRange: presets[0]!.startRange,
    preferredRange: presets[0]!.preferredRange,
    formation: presets[0]!.formation,
    keeperBody: defaultKeeperBody()
  }
);
let activeFrameIndex = 0;
let playTimer: number | undefined;

init();

function init(): void {
  presetSelect.innerHTML = presets
    .map((preset) => `<option value="${escapeAttr(preset.id)}">${escapeHtml(preset.label)}</option>`)
    .join("");
  keeperSpecInput.value = formatBody(defaultKeeperBody());
  loadPreset(presets[0]!.id);

  presetSelect.addEventListener("change", () => {
    loadPreset(presetSelect.value);
  });
  runButton.addEventListener("click", () => {
    runSimulation();
  });
  previousButton.addEventListener("click", () => {
    setFrame(activeFrameIndex - 1);
  });
  nextButton.addEventListener("click", () => {
    setFrame(activeFrameIndex + 1);
  });
  playButton.addEventListener("click", () => {
    togglePlayback();
  });
  tickSlider.addEventListener("input", () => {
    setFrame(Number(tickSlider.value));
  });
  window.addEventListener("hashchange", renderRoute);
  renderRoute();
}

function renderRoute(): void {
  const route = window.location.hash.replace(/^#\/?/, "");
  const showCombat = route === "source-keeper-combat";
  directoryShell.hidden = showCombat;
  combatShell.hidden = !showCombat;
  document.title = showCombat ? "Source Keeper Combat" : "Autoscreeps Theorycrafting";
  if (!showCombat) {
    stopPlayback();
  }
}

function loadPreset(id: string): void {
  const preset = presets.find((candidate) => candidate.id === id) ?? presets[0]!;
  presetSelect.value = preset.id;
  meleeActionSelect.value = preset.meleeAction;
  startRangeInput.value = String(preset.startRange);
  preferredRangeInput.value = String(preset.preferredRange);
  maxTicksInput.value = String(preset.maxTicks);
  formationSelect.value = preset.formation;
  creepSpecsInput.value = preset.creeps.map((creep) => `${creep.name}=${formatBody(creep.body)}`).join("\n");
  runSimulation();
}

function runSimulation(): void {
  try {
    stopPlayback();
    const creeps = parseCreepSpecs(creepSpecsInput.value);
    const options: SimulationOptions = {
      meleeAction: parseMeleeAction(meleeActionSelect.value),
      maxTicks: clampInt(Number(maxTicksInput.value), 1, 5000),
      startRange: clampInt(Number(startRangeInput.value), 1, 50),
      preferredRange: clampInt(Number(preferredRangeInput.value), 1, 3),
      formation: parseFormation(formationSelect.value),
      keeperBody: parseBodySpec(keeperSpecInput.value)
    };
    result = simulate(creeps, options);
    activeFrameIndex = 0;
    tickSlider.max = String(result.frames.length - 1);
    tickSlider.value = "0";
    statusText.textContent = formatOutcome(result);
    renderFrame();
  } catch (error) {
    stopPlayback();
    statusText.textContent = error instanceof Error ? error.message : String(error);
  }
}

function simulate(creeps: CreepSpec[], options: SimulationOptions): SimulationResult {
  const friendlies = creeps.map((spec) => new SimCreep(spec.name, spec.body));
  const formation = effectiveFormation(options.formation, friendlies.length);
  const keeper = new SimCreep("keeper", options.keeperBody);
  const frames: Frame[] = [];
  let friendlyX = friendlyStartX;
  let friendlyPositions = formationPositions(friendlyX, friendlies.length, formation);
  let keeperX = formationFrontX(friendlyPositions) + options.startRange;
  let keeperPosition: Position = { x: keeperX, y: 0 };
  let range = closestRange(keeperPosition, friendlyPositions);
  let killTick: number | undefined;
  let fullHealTick: number | undefined;
  let outcome: Outcome = "running";
  let lastKeeperHits = keeper.hits;
  let stalledTicks = 0;
  const seenStates = new Map<string, number>();

  const addFrame = (tick: number, events: string[], frameOutcome: Outcome) => {
    frames.push({
      tick,
      range,
      keeperX,
      friendlyX,
      keeperPosition: { ...keeperPosition },
      friendlyPositions: friendlyPositions.map((position) => ({ ...position })),
      keeper: keeper.snapshot(),
      friendlies: friendlies.map((creep) => creep.snapshot()),
      events,
      outcome: frameOutcome,
      killTick,
      fullHealTick
    });
  };

  addFrame(0, ["initial range established"], "running");
  seenStates.set(combatStateSignature(keeperPosition, friendlyPositions, keeper, friendlies), 0);

  for (let tick = 1; tick <= options.maxTicks; tick += 1) {
    const events: string[] = [];
    if (keeper.alive) {
      const mainEffects = new Map<SimCreep, { damage: number; heal: number }>();
      const mainActionUsed = new Set<SimCreep>();
      let keeperMainDamage = 0;

      for (const [index, creep] of friendlies.entries()) {
        if (!creep.alive) {
          continue;
        }
        const creepRange = positionRange(friendlyPositions[index]!, keeperPosition);
        const useMeleeAttack =
          creepRange <= 1 &&
          creep.active("attack") > 0 &&
          (options.meleeAction === "attack" || keeper.active("attack") === 0);
        if (useMeleeAttack) {
          const damage = creep.active("attack") * meleeDamagePerPart;
          const hitBack = keeper.active("attack") * meleeDamagePerPart;
          keeperMainDamage += damage;
          addEffect(mainEffects, creep, { damage: hitBack });
          mainActionUsed.add(creep);
          const fallback = options.meleeAction === "heal" ? " fallback" : "";
          events.push(`${creep.name}${fallback} attacks for ${damage}; hit-back ${hitBack}`);
          continue;
        }

        const target = chooseHealTarget(friendlies, friendlyPositions, friendlyPositions[index]!, 1);
        if (target && creep.active("heal") > 0) {
          const heal = creep.active("heal") * adjacentHealPerPart;
          addEffect(mainEffects, target, { heal });
          mainActionUsed.add(creep);
          events.push(`${creep.name} heals ${target.name} for ${heal}`);
        }
      }

      const meleeTarget = chooseKeeperTarget(friendlies, friendlyPositions, keeperPosition, 1);
      if (meleeTarget) {
        const attackDamage = keeper.active("attack") * meleeDamagePerPart;
        const reflectedDamage = keeper.active("attack") > 0 ? meleeTarget.active("attack") * meleeDamagePerPart : 0;
        addEffect(mainEffects, meleeTarget, { damage: attackDamage });
        keeperMainDamage += reflectedDamage;
        events.push(`keeper attacks ${meleeTarget.name} for ${attackDamage}; reflected ${reflectedDamage}`);
      }

      if (keeperMainDamage > 0) {
        keeper.damage(keeperMainDamage);
      }
      applyNetEffects(mainEffects);

      const rangedEffects = new Map<SimCreep, { damage: number; heal: number }>();
      if (keeper.alive) {
        let keeperRangedDamage = 0;
        for (const [index, creep] of friendlies.entries()) {
          if (!creep.alive) {
            continue;
          }
          const creepRange = positionRange(friendlyPositions[index]!, keeperPosition);
          if (creepRange <= 3 && creep.active("ranged_attack") > 0) {
            const damage = creep.active("ranged_attack") * rangedDamagePerPart;
            keeperRangedDamage += damage;
            events.push(`${creep.name} ranges for ${damage}`);
          } else if (!mainActionUsed.has(creep)) {
            const target = chooseHealTarget(friendlies, friendlyPositions, friendlyPositions[index]!, 3);
            if (target && creep.active("heal") > 0) {
              const heal = creep.active("heal") * rangedHealPerPart;
              addEffect(rangedEffects, target, { heal });
              events.push(`${creep.name} ranged-heals ${target.name} for ${heal}`);
            }
          }
        }

        const rangedTarget = chooseKeeperTarget(friendlies, friendlyPositions, keeperPosition, 3);
        if (rangedTarget) {
          const damage = keeper.active("ranged_attack") * rangedDamagePerPart;
          addEffect(rangedEffects, rangedTarget, { damage });
          events.push(`keeper ranges ${rangedTarget.name} for ${damage}`);
        }

        if (keeperRangedDamage > 0) {
          keeper.damage(keeperRangedDamage);
        }
        applyNetEffects(rangedEffects);
      }

      if (!keeper.alive && killTick === undefined) {
        killTick = tick;
        events.push("keeper killed");
      }

      if (friendlies.every((creep) => !creep.alive)) {
        outcome = "loss";
        addFrame(tick, events, outcome);
        return finishResult(frames, outcome, killTick, fullHealTick, friendlies, keeper, formation);
      }
    } else {
      const healEffects = new Map<SimCreep, { damage: number; heal: number }>();
      for (const [index, creep] of friendlies.entries()) {
        if (!creep.alive) {
          continue;
        }
        const target = chooseHealTarget(friendlies, friendlyPositions, friendlyPositions[index]!, 1);
        if (!target || creep.active("heal") === 0) {
          continue;
        }
        const heal = creep.active("heal") * adjacentHealPerPart;
        addEffect(healEffects, target, { heal });
        events.push(`${creep.name} heals ${target.name} for ${heal}`);
      }
      applyNetEffects(healEffects);

      if (friendlies.every((creep) => !creep.alive || !creep.damaged)) {
        outcome = "win";
        fullHealTick = tick;
        addFrame(tick, events.length ? events : ["fully healed"], outcome);
        return finishResult(frames, outcome, killTick, fullHealTick, friendlies, keeper, formation);
      }
    }

    if (keeper.alive) {
      const keeperMoved = keeper.canMove();
      const aliveFriendlies = friendlies.filter((creep) => creep.alive);
      if (keeperMoved) {
        keeper.movePlain();
        keeperX += 1;
        keeperPosition = { ...keeperPosition, x: keeperX };
        range = closestRange(keeperPosition, friendlyPositions, friendlies);
        events.push(`keeper moves right to x${keeperX}`);
      }
      const shouldChase = range > options.preferredRange;
      const groupMoved = shouldChase && aliveFriendlies.length > 0 && aliveFriendlies.every((creep) => creep.canMove());
      if (groupMoved) {
        for (const creep of aliveFriendlies) {
          creep.movePlain();
        }
        friendlyX += 1;
        friendlyPositions = formationPositions(friendlyX, friendlies.length, formation);
        range = closestRange(keeperPosition, friendlyPositions, friendlies);
        events.push(`friendlies move right to x${friendlyX}`);
      }
    }

    for (const creep of friendlies) {
      creep.recoverFatigue();
    }
    keeper.recoverFatigue();

    if (keeper.hits === lastKeeperHits) {
      stalledTicks += 1;
      if (stalledTicks === 100 && range > 3) {
        events.push("no keeper damage for 100 ticks");
      }
    } else {
      stalledTicks = 0;
      lastKeeperHits = keeper.hits;
    }

    if (keeper.alive) {
      range = closestRange(keeperPosition, friendlyPositions, friendlies);
      const signature = combatStateSignature(keeperPosition, friendlyPositions, keeper, friendlies);
      const previousTick = seenStates.get(signature);
      if (previousTick !== undefined) {
        outcome = "stalled";
        events.push(`combat state repeated from tick ${previousTick}`);
        addFrame(tick, events, outcome);
        return finishResult(frames, outcome, killTick, fullHealTick, friendlies, keeper, formation);
      }
      seenStates.set(signature, tick);
    }

    addFrame(tick, events.length ? events : ["no visible action"], outcome);
  }

  outcome = "timeout";
  frames[frames.length - 1] = { ...frames[frames.length - 1]!, outcome };
  return finishResult(frames, outcome, killTick, fullHealTick, friendlies, keeper, formation);
}

function renderFrame(): void {
  const frame = result.frames[activeFrameIndex] ?? result.frames[0]!;
  tickSlider.max = String(result.frames.length - 1);
  tickSlider.value = String(activeFrameIndex);
  tickLabel.textContent = `tick ${frame.tick}`;
  previousButton.disabled = activeFrameIndex <= 0;
  nextButton.disabled = activeFrameIndex >= result.frames.length - 1;

  renderScenarioFacts();
  renderCombatSvg(frame);
  renderBodies(frame);
  renderEvents(frame);
}

function renderScenarioFacts(): void {
  const initial = result.frames[0]!;
  const creepCount = initial.friendlies.length;
  const spawnCost = initial.friendlies.reduce((sum, creep) => sum + creep.cost, 0);
  scenarioFacts.innerHTML = [
    fact("Creeps", String(creepCount)),
    fact("Formation", formatFormation(result.formation)),
    fact("Total spawn cost", `${spawnCost}e`),
    fact("Keeper body", `${initial.keeper.body.length} parts`),
    fact("Outcome", formatOutcome(result))
  ].join("");
}

function renderCombatSvg(frame: Frame): void {
  const maxX = Math.max(
    ...result.frames.flatMap((candidate) => [
      candidate.keeperPosition.x,
      ...candidate.friendlyPositions.map((position) => position.x)
    ])
  );
  const width = Math.max(16, maxX + 4);
  const framePositions = [frame.keeperPosition, ...frame.friendlyPositions];
  const minY = Math.min(...framePositions.map((position) => position.y));
  const maxY = Math.max(...framePositions.map((position) => position.y));
  const height = Math.max(10, 6 + maxY - minY + 1);
  const rowCount = maxY - minY + 1;
  const yOffset = Math.ceil((height - rowCount) / 2) - minY;
  const displayPosition = (position: Position) => ({
    x: position.x + 0.5,
    y: position.y + yOffset + 0.5
  });
  const keeperDisplay = displayPosition(frame.keeperPosition);
  const friendlies = frame.friendlies.map((creep, index) => {
    const position = frame.friendlyPositions[index]!;
    return { creep, position, ...displayPosition(position) };
  });
  const closestIndex = closestFriendlyIndex(frame);
  const closestFriendly = friendlies[closestIndex] ?? friendlies[0]!;

  const tiles = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      const tileClass = `${tileBaseClass} ${(x + y) % 2 === 0 ? tileAClass : tileBClass}`;
      return `<rect class="${tileClass}" x="${x}" y="${y}" width="1" height="1"></rect>`;
    }).join("")
  ).join("");

  const rangeLine = `<line class="${rangeLineClass}" x1="${closestFriendly.x}" y1="${closestFriendly.y}" x2="${keeperDisplay.x}" y2="${keeperDisplay.y}"></line>`;
  const rangeText = `<text class="${rangeLabelClass}" x="${(keeperDisplay.x + closestFriendly.x) / 2}" y="${Math.min(keeperDisplay.y, closestFriendly.y) - 0.75}">range ${frame.range}</text>`;
  const keeper = renderCreepMarker(frame.keeper, keeperDisplay.x, keeperDisplay.y, "keeper");
  const friendlyMarkers = friendlies
    .map(({ creep, x, y }) => renderCreepMarker(creep, x, y, "friendly"))
    .join("");
  const labelsAbove = maxY > minY;
  const labels = [
    `<text class="${combatLabelClass}" x="${keeperDisplay.x}" y="${keeperDisplay.y + 1.05}">keeper</text>`,
    ...friendlies.map(({ creep, position, x, y }) => {
      const labelY = labelsAbove && position.y === minY ? y - 0.9 : y + 0.95;
      return `<text class="${combatLabelClass}" x="${x}" y="${labelY}">${escapeHtml(creep.name)}</text>`;
    })
  ].join("");

  combatSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  combatSvg.innerHTML = `
    <rect class="${stageBackgroundClass}" x="0" y="0" width="${width}" height="${height}"></rect>
    ${tiles}
    ${rangeLine}
    ${rangeText}
    ${keeper}
    ${friendlyMarkers}
    ${labels}
  `;
}

function renderCreepMarker(creep: CombatantSnapshot, x: number, y: number, marker: "keeper" | "friendly"): string {
  const health = creep.hitsMax > 0 ? creep.hits / creep.hitsMax : 0;
  const healthWidth = 1.1 * clampNumber(health, 0, 1);
  const faded = creep.alive ? "" : deadMarkerClass;
  const ringClass = marker === "keeper" ? keeperRingClass : friendlyRingClass;
  const coreClass = marker === "keeper" ? keeperCoreClass : friendlyCoreClass;
  return `
    <g class="${faded}" transform="translate(${x} ${y})">
      <circle class="${ringClass}" r="0.46"></circle>
      <circle class="${coreClass}" r="0.34"></circle>
      <rect class="${hpTrackClass}" x="-0.55" y="-0.74" width="1.1" height="0.12" rx="0.04"></rect>
      <rect class="${hpFillClass}" x="-0.55" y="-0.74" width="${healthWidth}" height="0.12" rx="0.04"></rect>
    </g>
  `;
}

function renderBodies(frame: Frame): void {
  bodyList.innerHTML = [...frame.friendlies, frame.keeper].map(renderBodyPanel).join("");
}

function renderBodyPanel(creep: CombatantSnapshot): string {
  const partHtml = creep.body.map(renderBodyPart).join("");
  return `
    <section class="${bodyPanelClass}">
      <div class="${bodyHeadingClass}">
        <strong class="${bodyNameClass}">${escapeHtml(creep.name)}</strong>
        <span class="${bodyHitsClass}">${creep.hits}/${creep.hitsMax} hits</span>
      </div>
      <div class="${bodySubtitleClass}">${creep.body.length} parts / ${creep.cost}e / fatigue ${creep.fatigue}</div>
      <div class="${bodyGridClass}">${partHtml}</div>
    </section>
  `;
}

function renderBodyPart(part: BodyPartState): string {
  const fill = clampNumber(part.hits / partHits, 0, 1) * 100;
  const deadClass = part.hits <= 0 ? ` ${bodyPartDeadClass}` : "";
  const labelClass = part.hits <= 0 ? partLabelDeadClass : partLabelAliveClass;
  return `
    <span class="${bodyPartBaseClass} ${partClassName[part.type]}${deadClass}" title="${part.type} ${part.hits}/${partHits}">
      <span class="${partFillClass}" style="height: ${fill}%"></span>
      <span class="${partLabelBaseClass} ${labelClass}">${partShortName[part.type]}</span>
    </span>
  `;
}

function renderEvents(frame: Frame): void {
  eventLog.innerHTML = frame.events.map((event) => `<span class="${eventPillClass}">${escapeHtml(event)}</span>`).join("");
}

function setFrame(index: number): void {
  activeFrameIndex = clampInt(index, 0, result.frames.length - 1);
  renderFrame();
}

function togglePlayback(): void {
  if (playTimer !== undefined) {
    stopPlayback();
    return;
  }

  if (activeFrameIndex >= result.frames.length - 1) {
    activeFrameIndex = 0;
  }
  playButton.textContent = "Pause";
  playTimer = window.setInterval(() => {
    if (activeFrameIndex >= result.frames.length - 1) {
      stopPlayback();
      return;
    }
    setFrame(activeFrameIndex + 1);
  }, 180);
}

function stopPlayback(): void {
  if (playTimer !== undefined) {
    window.clearInterval(playTimer);
    playTimer = undefined;
  }
  playButton.textContent = "Play";
}

function finishResult(
  frames: Frame[],
  outcome: Outcome,
  killTick: number | undefined,
  fullHealTick: number | undefined,
  friendlies: SimCreep[],
  keeper: SimCreep,
  formation: Formation
): SimulationResult {
  return {
    frames,
    outcome,
    formation,
    killTick,
    fullHealTick,
    friendlyDamageTaken: friendlies.reduce((sum, creep) => sum + creep.totalDamageTaken, 0),
    keeperDamageTaken: keeper.totalDamageTaken
  };
}

function effectiveFormation(formation: Formation, creepCount: number): Formation {
  if (formation === "duo") {
    if (creepCount !== 2) {
      throw new Error("Duo formation requires exactly 2 creeps.");
    }
    return "duo";
  }
  if (formation === "quad") {
    if (creepCount !== 4) {
      throw new Error("Quad formation requires exactly 4 creeps.");
    }
    return "quad";
  }
  return "stacked";
}

function formationPositions(anchorX: number, creepCount: number, formation: Formation): Position[] {
  if (formation === "duo") {
    return [
      { x: anchorX, y: 0 },
      { x: anchorX, y: 1 }
    ];
  }
  if (formation === "quad") {
    return [
      { x: anchorX, y: 0 },
      { x: anchorX, y: 1 },
      { x: anchorX - 1, y: 0 },
      { x: anchorX - 1, y: 1 }
    ];
  }
  return Array.from({ length: creepCount }, () => ({ x: anchorX, y: 0 }));
}

function formationFrontX(positions: Position[]): number {
  return Math.max(...positions.map((position) => position.x));
}

function closestRange(keeperPosition: Position, friendlyPositions: Position[], friendlies?: SimCreep[]): number {
  const ranges = friendlyPositions
    .filter((_, index) => !friendlies || friendlies[index]?.alive)
    .map((position) => positionRange(position, keeperPosition));
  return ranges.length > 0 ? Math.min(...ranges) : Infinity;
}

function positionRange(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function combatStateSignature(
  keeperPosition: Position,
  friendlyPositions: Position[],
  keeper: SimCreep,
  friendlies: SimCreep[]
): string {
  return [
    `${keeperPosition.x},${keeperPosition.y}`,
    friendlyPositions.map((position) => `${position.x},${position.y}`).join(";"),
    creepStateSignature(keeper),
    ...friendlies.map((creep) => creepStateSignature(creep))
  ].join("|");
}

function creepStateSignature(creep: SimCreep): string {
  return `${creep.fatigue}:${creep.body.map((part) => part.hits).join(",")}`;
}

function chooseKeeperTarget(
  friendlies: SimCreep[],
  friendlyPositions: Position[],
  keeperPosition: Position,
  maxRange: number
): SimCreep | undefined {
  return friendlies
    .map((creep, index) => ({ creep, range: positionRange(friendlyPositions[index]!, keeperPosition) }))
    .filter(({ creep, range }) => creep.alive && range <= maxRange)
    .sort((a, b) => friendlyPotentialDamage(b.creep, b.range) - friendlyPotentialDamage(a.creep, a.range) || a.range - b.range)[0]
    ?.creep;
}

function chooseHealTarget(
  friendlies: SimCreep[],
  friendlyPositions: Position[],
  healerPosition: Position,
  maxRange: number
): SimCreep | undefined {
  return friendlies
    .map((creep, index) => ({ creep, range: positionRange(friendlyPositions[index]!, healerPosition) }))
    .filter(({ creep, range }) => creep.alive && creep.damaged && range <= maxRange)
    .sort((a, b) => a.creep.hits / a.creep.hitsMax - b.creep.hits / b.creep.hitsMax || a.range - b.range)[0]
    ?.creep;
}

function friendlyPotentialDamage(creep: SimCreep, range: number): number {
  let damage = 0;
  if (range <= 1) {
    damage += creep.active("attack") * meleeDamagePerPart;
  }
  if (range <= 3) {
    damage += creep.active("ranged_attack") * rangedDamagePerPart;
  }
  return damage;
}

function applyNetEffects(creeps: Map<SimCreep, { damage: number; heal: number }>): void {
  for (const [creep, effect] of creeps) {
    const net = effect.damage - effect.heal;
    if (net > 0) {
      creep.damage(net);
    } else if (net < 0) {
      creep.heal(-net);
    }
  }
}

function addEffect(
  map: Map<SimCreep, { damage: number; heal: number }>,
  creep: SimCreep,
  effect: Partial<{ damage: number; heal: number }>
): void {
  const current = map.get(creep) ?? { damage: 0, heal: 0 };
  current.damage += effect.damage ?? 0;
  current.heal += effect.heal ?? 0;
  map.set(creep, current);
}

function defaultKeeperBody(): PartType[] {
  return body(
    repeat("tough", 17),
    repeat("move", 13),
    ...Array.from({ length: 10 }, () => body(["attack"], ["ranged_attack"]))
  );
}

function parseCreepSpecs(value: string): CreepSpec[] {
  const specs = value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => parseCreepSpec(line, index));
  if (specs.length === 0) {
    throw new Error("Add at least one creep body.");
  }
  return specs;
}

function parseCreepSpec(spec: string, index: number): CreepSpec {
  const [maybeName, maybeBody] = spec.split("=");
  if (maybeBody !== undefined) {
    return { name: maybeName.trim() || `creep${index + 1}`, body: parseBodySpec(maybeBody) };
  }
  return { name: `creep${index + 1}`, body: parseBodySpec(maybeName) };
}

function parseBodySpec(spec: string): PartType[] {
  const parts: PartType[] = [];
  for (const rawToken of spec.split(/[,/ ]+/)) {
    const token = rawToken.trim().toLowerCase();
    if (!token) {
      continue;
    }
    const match = token.match(/^(\d+)([a-z_]+)$/);
    if (!match) {
      throw new Error(`Invalid body token "${rawToken}".`);
    }
    const count = Number(match[1]);
    const part = partAlias[match[2]!];
    if (!part || !Number.isInteger(count) || count < 0) {
      throw new Error(`Invalid body token "${rawToken}".`);
    }
    parts.push(...repeat(part, count));
  }
  if (parts.length === 0) {
    throw new Error(`Empty body spec "${spec}".`);
  }
  if (parts.length > 50) {
    throw new Error(`Body spec "${spec}" has ${parts.length} parts; max is 50.`);
  }
  return parts;
}

function parseMeleeAction(value: string): MeleeAction {
  if (value !== "attack" && value !== "heal") {
    throw new Error(`Invalid melee action "${value}".`);
  }
  return value;
}

function parseFormation(value: string): Formation {
  if (value !== "stacked" && value !== "duo" && value !== "quad") {
    throw new Error(`Invalid formation "${value}".`);
  }
  return value;
}

function repeat(part: PartType, count: number): PartType[] {
  return Array.from({ length: count }, () => part);
}

function body(...segments: PartType[][]): PartType[] {
  return segments.flat();
}

function formatBody(parts: PartType[]): string {
  const segments: string[] = [];
  let current = parts[0];
  let count = 0;

  for (const part of parts) {
    if (part === current) {
      count += 1;
      continue;
    }
    segments.push(`${count}${formatPart(current)}`);
    current = part;
    count = 1;
  }

  if (current) {
    segments.push(`${count}${formatPart(current)}`);
  }
  return segments.join(",");
}

function formatPart(part: PartType): string {
  const reverseAlias: Record<PartType, string> = {
    attack: "a",
    ranged_attack: "ra",
    heal: "h",
    move: "m",
    tough: "t",
    work: "w",
    carry: "c",
    claim: "cl"
  };
  return reverseAlias[part];
}

function formatOutcome(simulation: SimulationResult): string {
  if (simulation.outcome === "win") {
    return `win: kill ${simulation.killTick}, full ${simulation.fullHealTick}`;
  }
  if (simulation.outcome === "loss") {
    return "loss";
  }
  if (simulation.outcome === "stalled") {
    return "stalled";
  }
  if (simulation.outcome === "timeout") {
    return "timeout";
  }
  return "running";
}

function formatFormation(formation: Formation): string {
  if (formation === "stacked") {
    return "solo / stacked";
  }
  return formation;
}

function closestFriendlyIndex(frame: Frame): number {
  let bestIndex = 0;
  let bestRange = Infinity;
  for (const [index, creep] of frame.friendlies.entries()) {
    if (!creep.alive) {
      continue;
    }
    const candidateRange = positionRange(frame.friendlyPositions[index]!, frame.keeperPosition);
    if (candidateRange < bestRange) {
      bestIndex = index;
      bestRange = candidateRange;
    }
  }
  return bestIndex;
}

function fact(label: string, value: string): string {
  return `
    <div class="${factClass}">
      <span class="${factLabelClass}">${escapeHtml(label)}</span>
      <strong class="${factValueClass}">${escapeHtml(value)}</strong>
    </div>
  `;
}

function getElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as unknown as T;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
