const { Battle, Dex } = require("@pkmn/sim");

const sides = ["p1", "p2", "p3", "p4"];
const battleStatuses = new Set(["brn", "par", "slp", "frz", "psn", "tox"]);

function toTeamSet(mon) {
  const species = Dex.species.get(mon.species || mon.slug);
  if (!species.exists)
    throw new Error("Espécie indisponível no simulador: " + mon.name);
  const moves = (mon.moves || [])
    .map((id) => Dex.moves.get(id))
    .filter((move) => move.exists);
  return {
    species: species.name,
    name: mon.name || species.name,
    level: mon.level,
    moves: moves.length
      ? moves.slice(0, 4).map((move) => move.name)
      : ["Struggle"],
    ability: mon.ability || species.abilities[0],
    item: mon.heldItem || "",
    nature: mon.nature || "Serious",
    gender: mon.gender,
    shiny: Boolean(mon.shiny),
    happiness: mon.happiness,
    ivs: mon.ivs,
    evs: mon.evs,
  };
}

const effectLabels = {
  confusion: "Confusão", substitute: "Substituto", leechseed: "Semente drenante",
  taunt: "Provocação", encore: "Bis", torment: "Tormento", disable: "Golpe bloqueado",
  yawn: "Sonolência", attract: "Atração", perishsong: "Canção da perdição",
  partiallytrapped: "Aprisionado", ingrain: "Raízes", aquaring: "Anel de água",
  focusenergy: "Foco crítico", magnetrise: "Levitação magnética", curse: "Maldição",
  healblock: "Cura bloqueada", embargo: "Itens bloqueados", nightmared: "Pesadelo",
  telekinesis: "Telecinese", uproar: "Alvoroço", recharge: "Recarga",
  roost: "Pouso", smackdown: "Derrubado", charge: "Carga elétrica", stockpile: "Estoque",
  mustrecharge: "Recarga", flashfire: "Fogo intensificado", destinybond: "Vínculo do destino",
  reflect: "Refletor", lightscreen: "Tela de luz", auroraveil: "Véu de aurora",
  safeguard: "Proteção contra status", mist: "Névoa protetora", tailwind: "Vento a favor",
  spikes: "Espinhos", toxicspikes: "Espinhos tóxicos", stealthrock: "Rochas furtivas",
  stickyweb: "Teia pegajosa", quickguard: "Guarda rápida", wideguard: "Guarda ampla",
  raindance: "Chuva", primordialsea: "Chuva intensa", sunnyday: "Sol forte",
  desolateland: "Sol abrasador", sandstorm: "Tempestade de areia", snow: "Neve",
  hail: "Granizo", deltastream: "Ventos fortes",
  electricterrain: "Terreno elétrico", grassyterrain: "Terreno de grama",
  psychicterrain: "Terreno psíquico", mistyterrain: "Terreno nebuloso",
  trickroom: "Sala de inversão", magicroom: "Sala mágica", wonderroom: "Sala das maravilhas",
  gravity: "Gravidade", watersport: "Esporte aquático", mudsport: "Esporte de lama",
};
const publicVolatiles = new Set([
  "confusion", "substitute", "leechseed", "taunt", "encore", "torment", "disable",
  "yawn", "attract", "perishsong", "partiallytrapped", "ingrain", "aquaring",
  "focusenergy", "magnetrise", "curse", "healblock", "embargo", "telekinesis",
  "uproar", "charge", "stockpile", "mustrecharge", "flashfire", "destinybond", "smackdown",
]);
const statLabels = {
  atk: "Ataque", def: "Defesa", spa: "Ataque Especial", spd: "Defesa Especial",
  spe: "Velocidade", accuracy: "Precisão", evasion: "Evasão",
};

const effectName = raw => {
  const name = raw.replace(/^(?:move|ability|item): /i, "");
  return effectLabels[name.toLowerCase().replace(/[^a-z0-9]/g, "")] || name;
};

function listEffects(states) {
  return Object.entries(states).map(([id, state]) => ({
    id, label: effectName(Dex.conditions.get(id).name || id),
    layers: state.layers > 1 ? state.layers : undefined,
  }));
}

function battleLog(line, viewer) {
  const [, event, first = "", second = "", third = ""] = line.split("|");
  const who = first.replace(/^p[1-4][a-z]?: /, "");
  switch (event) {
    case "move":
      return who + " usou " + second + ".";
    case "switch":
    case "drag":
      return who + " entrou em campo.";
    case "faint":
      return who + " desmaiou.";
    case "-supereffective":
      return "Foi supereficaz!";
    case "-resisted":
      return who + " resistiu ao golpe.";
    case "-immune":
      return who + " ficou imune.";
    case "-crit":
      return "Acerto crítico!";
    case "-miss":
      return who + " errou o alvo.";
    case "-status":
      return who + " recebeu a condição " + second.toUpperCase() + ".";
    case "-start":
      if (second === "confusion") return who + " ficou confuso!";
      return who + " recebeu o efeito " + effectName(second) + ".";
    case "-end":
      if (second === "confusion") return who + " se livrou da confusão.";
      return effectName(second) + " terminou para " + who + ".";
    case "-activate":
      if (second === "confusion") return who + " está confuso!";
      return who + " ativou " + effectName(second) + ".";
    case "-damage":
      return third === "[from] confusion" ? who + " se machucou na confusão!" : who + " perdeu PV.";
    case "-heal":
      return who + " recuperou PV.";
    case "-boost":
    case "-unboost":
      return (statLabels[second] || second) + " de " + who +
        (event === "-boost" ? " subiu " : " caiu ") + (third || "1") +
        (third && third !== "1" ? " estágios." : " estágio.");
    case "-setboost":
      return (statLabels[second] || second) + " de " + who + " foi ajustado para " + third + ".";
    case "-clearboost":
      return "Os atributos de " + who + " voltaram ao normal.";
    case "-clearallboost":
      return "As alterações de atributos foram removidas do campo.";
    case "-weather":
      if (second === "[upkeep]") return null;
      return first === "none" ? "O clima voltou ao normal." : "Clima: " + effectName(first) + ".";
    case "-fieldstart":
    case "-fieldend":
      return effectName(first) + (event === "-fieldstart" ? " entrou em efeito." : " terminou.");
    case "-sidestart":
    case "-sideend":
      return effectName(second) + (event === "-sidestart" ? " entrou em efeito " : " terminou ") +
        (Number(first[1]) % 2 === Number(viewer[1]) % 2 ? "no seu lado." : "no lado adversário.");
    case "-ability":
      return who + " ativou " + effectName(second) + ".";
    case "-item":
      return who + " recebeu " + effectName(second) + ".";
    case "-heal":
      return who + " recuperou PV.";
    case "-enditem":
      return who + " perdeu ou consumiu " + effectName(second) + ".";
    case "-curestatus":
      return who + " se recuperou da condição de status.";
    case "cant":
      return who + " não conseguiu agir.";
    case "-mega":
      return who + " megaevoluiu!";
    case "-fail":
      return "A ação falhou.";
    default:
      return null;
  }
}

function exhaustedSlots(pokemon, active) {
  if (!active?.moves.some(move => move.id === "struggle")) return [];
  return pokemon.moveSlots.filter(move => move.pp === 0);
}

function typeMultiplier(type, target) {
  const types = target.getTypes();
  if (!Dex.getImmunity(type, types) ||
      (type === "Ground" && target.hasAbility("levitate") && !target.battle.field.getPseudoWeather("gravity")))
    return 0;
  return 2 ** Dex.getEffectiveness(type, types);
}

function cpuMoveScore(battle, choice, attacker, defender) {
  const index = Number(choice.command.split(" ")[1]) - 1;
  const move = Dex.moves.get(attacker.side.activeRequest?.active?.[0]?.moves[index]?.id || "struggle");
  const health = attacker.hp / attacker.maxhp;
  if (move.heal) return health < .55 ? 75 : 0;
  const effectiveness = move.ignoreImmunity ? 1 : typeMultiplier(move.type, defender);
  if (!effectiveness) return -100;
  if (move.category === "Status") {
    if (move.status && !defender.status) return 22;
    if (move.boosts && Object.entries(move.boosts).some(([stat, amount]) => amount > 0 && attacker.boosts[stat] < 1))
      return health >= .65 ? 14 : 0;
    return 1;
  }
  const physical = move.category === "Physical";
  const attack = attacker.getStat(physical ? "atk" : "spa", false, true);
  const defense = defender.getStat(physical ? "def" : "spd", false, true);
  const accuracy = move.accuracy === true ? 1 : move.accuracy / 100;
  const stab = attacker.hasType(move.type) ? 1.5 : 1;
  const strikes = Array.isArray(move.multihit) ? (move.multihit[0] + move.multihit[1]) / 2 : move.multihit || 1;
  const damage = (move.basePower || 40) * attack / defense * effectiveness * accuracy * stab * strikes;
  const estimated = ((2 * attacker.level / 5 + 2) * damage / 50 + 2);
  return damage + (estimated >= defender.hp ? 40 + Math.max(0, move.priority) * 14 : 0) +
    (choice.command.endsWith(" mega") ? 5 : 0) + battle.random(5);
}

class BattleSession {
  constructor({ p1, p2, p3, p4, cpu = false, seed, mode = "solo" }) {
    this.cpu = cpu;
    this.engine = new Battle({
      formatid: {solo:"gen9customgame", doubles:"gen9doublescustomgame", multi:"gen9multirandombattle"}[mode],
      ...(seed && { seed }),
    });
    this.roster = new Map();
    for (const [index, party] of (mode === "multi" ? [p1, p2, p3, p4] : [p1, p2]).entries()) {
      const available = party.filter((mon) => mon.hp > 0).slice(0, 6);
      if (!available.length)
        throw new Error("Sua equipe precisa de um Pokémon com vida.");
      const id = sides[index];
      this.engine.setPlayer(id, { name: id, team: available.map(toTeamSet) });
      this.engine.getSide(id).pokemon.forEach((pm, i) => {
        const mon = available[i];
        this.roster.set(pm, mon);
        pm.hp = Math.max(
          1,
          Math.min(
            pm.maxhp,
            Math.round((mon.hp * pm.maxhp) / (mon.maxhp || pm.maxhp)),
          ),
        );
        if (battleStatuses.has(mon.status)) {
          pm.status = mon.status;
          pm.statusState = this.engine.initEffectState({
            id: mon.status,
            target: pm,
          });
          if (mon.status === "slp")
            pm.statusState.time = mon.sleepTurns ?? this.engine.random(2, 5);
          if (mon.status === "tox") pm.statusState.stage = 0;
        }
        for (const slot of pm.baseMoveSlots) {
          slot.maxpp = Dex.moves.get(slot.id).pp;
          slot.pp = Math.max(
            0,
            Math.min(slot.maxpp, mon.pp?.[slot.id] ?? slot.maxpp),
          );
        }
      });
    }
    if (this.engine.requestState === "teampreview") this.engine.makeChoices();
    this.advanceCpu();
    this.sync();
  }

  snapshot() {
    return {
      cpu: this.cpu,
      engine: this.engine.toJSON(),
      teams: this.engine.sides.map(side => side.pokemon.map(pm => this.roster.get(pm))),
    };
  }

  static restore(saved) {
    const session = Object.create(BattleSession.prototype);
    session.cpu = saved.cpu;
    session.engine = Battle.fromJSON(saved.engine);
    session.roster = new Map();
    session.engine.sides.forEach((side, i) => side.pokemon.forEach((pm, j) =>
      session.roster.set(pm, saved.teams[i][j])));
    return session;
  }

  sync() {
    for (const [pm, mon] of this.roster) {
      mon.hp =
        pm.hp <= 0
          ? 0
          : Math.max(
              1,
              Math.min(mon.maxhp, Math.round((pm.hp * mon.maxhp) / pm.maxhp)),
            );
      mon.heldItem = pm.item;
      mon.status = battleStatuses.has(pm.status) ? pm.status : "";
      mon.sleepTurns = mon.status === "slp" ? pm.statusState.time : undefined;
      mon.pp = Object.fromEntries(
        pm.baseMoveSlots.map((slot) => [slot.id, slot.pp]),
      );
    }
  }

  choices(id) {
    const side = this.engine.getSide(id);
    const req = side.activeRequest;
    if (this.engine.ended || !req || req.wait || side.isChoiceDone()) return [];
    const result = [];
    const active = req.active?.[0];
    for (const [i, move] of (active?.moves || []).entries()) {
      const disabled = Boolean(move.disabled || move.pp === 0);
      const command = "move " + (i + 1);
      const { type, category, basePower, accuracy, priority } = Dex.moves.get(move.id);
      const choice = {
        kind: "move",
        command,
        label: move.move,
        type,
        category,
        basePower,
        accuracy,
        priority,
        disabled,
        pp: move.pp,
        maxpp: move.maxpp,
      };
      result.push(choice);
      if (!disabled && active.canMegaEvo)
        result.push({ ...choice, command: command + " mega", label: move.move + " · Mega" });
    }
    for (const move of exhaustedSlots(side.active[0], active))
      result.push({kind:"move", label:move.move, pp:0, maxpp:move.maxpp, disabled:true});
    if (!active?.trapped) {
      for (const [i, pm] of side.pokemon.entries()) {
        if (
          pm.isActive ||
          (side.active[0]?.volatiles.revivalblessing ? !pm.fainted : pm.fainted)
        )
          continue;
        result.push({
          kind: "switch",
          command: "switch " + (i + 1),
          label: "Trocar para " + pm.name,
        });
      }
    }
    return result;
  }

  groupChoices(id) {
    const side = this.engine.getSide(id);
    const req = side.activeRequest;
    if (this.engine.ended || !req || req.wait || side.isChoiceDone()) return [];
    const reserve = side.pokemon.map((pm, index) => ({pm, index}))
      .filter(({pm}) => !pm.isActive && !pm.fainted);
    const switches = reserve.map(({pm, index}) => ({
      command: "switch " + (index + 1), label: pm.name, kind:"switch",
    }));
    return side.active.flatMap((pm, slot) => {
      if (req.forceSwitch) {
        if (!req.forceSwitch[slot]) return [{name:pm.name, options:[{command:"pass", label:"Sem troca"}]}];
        const canPass = reserve.length < req.forceSwitch.filter(Boolean).length;
        return [{name:pm.name, forced:true, options:canPass ? [...switches, {command:"pass", label:"Deixar espaço vazio"}] : switches}];
      }
      if (pm.fainted || pm.volatiles.commanding)
        return [{name:pm.name, options:[{command:"pass", label:"Sem ação"}]}];
      const active = req.active?.[slot];
      if (!active) return [];
      const moves = active.moves.flatMap((move, i) => {
        const {type, category, basePower, accuracy, shortDesc} = Dex.moves.get(move.id);
        const details = {name:move.move, type, category, basePower, accuracy, shortDesc, pp:move.pp, maxpp:move.maxpp};
        if (move.disabled || move.pp === 0) return [{...details, label:move.move, disabled:true}];
        const base = "move " + (i + 1);
        const targetType = move.target || Dex.moves.get(move.id).target;
        const needsTarget = this.engine.actions.targetTypeChoices(targetType);
        const valid = this.engine.sides.flatMap(s => s.active).filter(target =>
          target && this.engine.validTarget(target, pm, targetType));
        const available = valid.filter(target => !target.fainted);
        const affected = this.engine.sides.flatMap(s => s.active).filter(other => {
          if (!other || other.fainted) return false;
          if (other === pm) return targetType === "self";
          if (targetType === "all") return true;
          if (!pm.isAdjacent(other)) return false;
          return targetType === "allAdjacent" ||
            (targetType === "allAdjacentFoes" && other.side.n % 2 !== side.n % 2);
        }).map(other => this.roster.get(other)?.uid).filter(Boolean);
        const targets = needsTarget && valid.length ? (available.length ? available : valid) : [null];
        return targets.flatMap(target => {
          const command = base + (target ? " " + pm.getLocOf(target) : "");
          const label = move.move + (target ? " → " + target.name +
            (target.side.n % 2 === side.n % 2 ? " (aliado)" : " (rival)") : "");
          const choice = {...details, command, label, moveKey:base,
            target:target ? {uid:this.roster.get(target)?.uid, name:target.name,
              ally:target.side.n % 2 === side.n % 2} : null,
            affected};
          return active.canMegaEvo ? [choice, {...choice, command:command + " mega",
            moveKey:base + " mega", name:move.move + " · Mega", label:label + " · Mega"}] : [choice];
        });
      });
      for (const move of exhaustedSlots(pm, active))
        moves.push({name:move.move, label:move.move, pp:0, maxpp:move.maxpp, disabled:true});
      return [{name:pm.name, options:active.trapped ? moves : [...moves, ...switches]}];
    });
  }

  choose(id, command) {
    if (!this.engine.sides.some(side => side.id === id) || typeof command !== "string" ||
        (this.cpu && id === "p2"))
      throw new Error("Essa ação não está disponível nesta batalha.");
    const commands = command.split(",").map(choice => choice.trim());
    const groups = this.engine.gameType === "singles"
      ? [{options:this.choices(id)}] : this.groupChoices(id);
    if (commands.length !== groups.length ||
        !groups.every((group, index) => group.options.some(option => !option.disabled && option.command === commands[index])))
      throw new Error("Essa ação não está disponível nesta batalha.");
    if (!this.engine.choose(id, command))
      throw new Error("O simulador recusou essa ação.");
    this.advanceCpu();
    this.sync();
    return this.view(id);
  }

  // The trainer used the turn throwing a ball. Allow just the wild opponent to act.
  cpuTurnAfterItem(id = "p1") {
    if (!this.cpu || id !== "p1" || !this.canUseItem(id)) {
      throw new Error("Aguarde sua vez de usar um item.");
    }
    this.engine.p1.choice.actions.push({ choice: "pass" });
    if (this.engine.allChoicesDone()) this.engine.commitChoices();
    this.advanceCpu();
    this.sync();
    return this.view(id);
  }

  canUseItem(id) {
    return (
      !this.engine.ended &&
      this.engine.getSide(id).requestState === "move" &&
      !this.engine.getSide(id).isChoiceDone()
    );
  }

  advanceCpu() {
    if (!this.cpu) return;
    while (!this.engine.ended) {
      const options = this.choices("p2").filter(choice => !choice.disabled);
      if (!options.length) break;
      const moves = options.filter((choice) => choice.kind === "move");
      const optionsToTry = (moves.length ? moves : options).slice();
      this.engine.prng.shuffle(optionsToTry);
      const active = this.engine.p2.active[0], opponent = this.engine.p1.active[0];
      if (active && opponent && !opponent.fainted) {
        const score = choice => {
          if (choice.kind === "move") return cpuMoveScore(this.engine, choice, active, opponent);
          const reserve = this.engine.p2.pokemon[Number(choice.command.split(" ")[1]) - 1];
          return reserve ? Math.max(...reserve.getTypes().map(type => typeMultiplier(type, opponent))) : 0;
        };
        const scores = new Map(optionsToTry.map(choice => [choice, score(choice)]));
        optionsToTry.sort((a, b) => scores.get(b) - scores.get(a));
      }
      if (
        !optionsToTry.some((choice) => this.engine.choose("p2", choice.command))
      ) {
        throw new Error("O adversário ficou sem uma ação válida.");
      }
    }
  }

  view(id) {
    const describe = (pm) => {
      if (!pm) return null;
      const mon = this.roster.get(pm);
      return {
        uid: mon.uid,
        position: pm.getSlot(),
        name: pm.name,
        species: pm.species.name,
        slug: mon.slug,
        spriteId: pm.species.spriteid,
        pokemonId: mon.pokemonId,
        shiny: Boolean(mon.shiny),
        level: pm.level,
        hp: pm.hp,
        maxHp: pm.maxhp,
        maxhp: pm.maxhp,
        status: pm.status,
        boosts: Object.fromEntries(Object.entries(pm.boosts).filter(([, stage]) => stage)),
        effects: listEffects(Object.fromEntries(Object.entries(pm.volatiles)
          .filter(([key]) => publicVolatiles.has(key)))),
        types: pm.getTypes(),
      };
    };
    const ownSide = this.engine.getSide(id);
    const foeSide = ownSide.foe;
    const activePokemon = side => [side, side.allySide].filter(Boolean)
      .flatMap(s => s.active.map(describe)).filter(Boolean);
    const choices = this.engine.gameType === "singles" ? this.choices(id) : [];
    const groups = this.engine.gameType === "singles" ? [] : this.groupChoices(id);
    const log = [];
    const timeline = [];
    for (let i = 0; i < this.engine.log.length; i++) {
      if (this.engine.log[i].startsWith("|split|")) {
        i++; // Skip the private variant. Process the public line on the next iteration.
        continue;
      }
      const text = battleLog(this.engine.log[i], id);
      if (text) log.push(text);
      const [, kind, actor, value] = this.engine.log[i].split("|");
      if (["move", "-damage", "-heal", "faint", "switch", "drag"].includes(kind) &&
          /^p[1-4][a-z]: /.test(actor || "")) {
        const position = actor.slice(0, 3);
        const entry = {index:i, kind, position, text};
        if (["-damage", "-heal", "switch", "drag"].includes(kind)) {
          const condition = kind === "switch" || kind === "drag" ? this.engine.log[i].split("|")[4] : value;
          const [hp, max] = (condition || "").split(" ")[0].split("/").map(Number);
          entry.hp = max ? hp / max : hp === 0 ? 0 : null;
        }
        if (kind === "switch" || kind === "drag") {
          const side = this.engine.getSide(position.slice(0, 2));
          const name = actor.slice(5);
          const species = value.split(",")[0];
          const incoming = side.pokemon.find(pm => pm.name === name && pm.species.name === species) ||
            side.pokemon.find(pm => pm.name === name);
          if (incoming) entry.mon = {...describe(incoming), position};
        }
        timeline.push(entry);
      }
    }
    return {
      field: {
        weather: this.engine.field.weather ? effectName(this.engine.field.getWeather().name) : null,
        terrain: this.engine.field.terrain ? effectName(this.engine.field.getTerrain().name) : null,
        effects: listEffects(this.engine.field.pseudoWeather),
        own: listEffects(this.engine.getSide(id).sideConditions),
        foe: listEffects(foeSide.sideConditions),
      },
      turn: this.engine.turn,
      ended: this.engine.ended,
      winner: this.engine.winner || null,
      waiting: !this.engine.ended && !choices.length && !groups.length,
      mode: this.engine.gameType,
      own: describe(ownSide.active[0]),
      foe: describe(foeSide.active[0]),
      ownActive: activePokemon(ownSide),
      foeActive: activePokemon(foeSide),
      arenaSlots: this.engine.gameType === "singles" ? null : [foeSide, ownSide].map(side =>
        [side, side.allySide].filter(Boolean).flatMap(member => member.active.map(describe))),
      groups,
      readySides: this.engine.sides.filter(side => !side.activeRequest || side.activeRequest.wait || side.isChoiceDone())
        .map(side => side.id),
      choices,
      log,
      logCount: log.length,
      timeline,
      timelineLength: this.engine.log.length,
    };
  }
}

module.exports = { BattleSession };
