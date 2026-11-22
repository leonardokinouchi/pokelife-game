"use strict";

const { randomUUID, randomInt } = require("node:crypto");
const { Dex } = require("@pkmn/sim");
const catalog = require("./data/rules.json");

const statNames = ["hp", "atk", "def", "spa", "spd", "spe"];
const byId = new Map(catalog.mons.map((m) => [m.id, m]));
const bySlug = new Map(catalog.mons.map((m) => [m.slug, m]));
const defaults = new Map(
  catalog.mons.filter((m) => m.isDefault).map((m) => [m.speciesId, m]),
);
const idOf = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pick = (a) => a[randomInt(a.length)];
const dexById = new Map();
const byShowdown = new Map();

function showdownName(m) {
  const aliases = {
    "raticate-totem-alola": "Raticate-Alola-Totem",
    "marowak-totem": "Marowak-Alola-Totem",
    "mimikyu-totem-disguised": "Mimikyu-Totem",
    "mimikyu-totem-busted": "Mimikyu-Busted-Totem",
    "rockruff-own-tempo": "Rockruff-Dusk",
    "zygarde-10-power-construct": "Zygarde-10%",
    "zygarde-50-power-construct": "Zygarde",
    "darmanitan-galar-standard": "Darmanitan-Galar",
    "meowstic-male-mega": "Meowstic-Mega",
    "tauros-paldea-combat-breed": "Tauros-Paldea-Combat",
    "maushold-family-of-three": "Maushold-Three",
    "maushold-family-of-four": "Maushold",
  };
  const transformed = m.slug
    .replace(/-female$/, "-f")
    .replace(/-male$/, "")
    .replace(/-cap$/, "")
    .replace(/-breed$/, "")
    .replace(/-plumage$/, "")
    .replace(/^minior-.*-meteor$/, "minior-meteor");
  const candidates = [m.slug, aliases[m.slug], transformed];
  if (m.isDefault || ["koraidon", "miraidon"].includes(m.baseSlug))
    candidates.push(m.baseSlug);
  for (const candidate of candidates.filter(Boolean)) {
    const species = Dex.species.get(candidate);
    if (species.exists) return species;
  }
  return null;
}

for (const m of catalog.mons) {
  const species = showdownName(m);
  if (species) {
    dexById.set(m.id, species);
    if (m.isDefault || !byShowdown.has(species.id))
      byShowdown.set(species.id, m);
  }
}
function record(input) {
  const key =
    input && typeof input === "object"
      ? (input.pokemonId ?? input.slug ?? input.species)
      : input;
  const result =
    byId.get(Number(key)) ||
    bySlug.get(String(key).toLowerCase()) ||
    byShowdown.get(idOf(key));
  if (!result || !dexById.has(result.id))
    throw Error("Espécie ou forma indisponível: " + key);
  return result;
}
function statsFor(mon) {
  const data = record(mon);
  const base = dexById.get(data.id).baseStats;
  const nature = Dex.natures.get(mon.nature || "Serious");
  const stats = {};
  for (const stat of statNames) {
    const core = Math.floor(
      ((2 * base[stat] + mon.ivs[stat] + Math.floor((mon.evs?.[stat] || 0) / 4)) * mon.level) / 100,
    );
    const multiplier = stat === nature.plus ? 110 : stat === nature.minus ? 90 : 100;
    stats[stat] = stat === "hp" ? (base.hp === 1 ? 1 : core + mon.level + 10) :
      Math.floor((core + 5) * multiplier / 100);
  }
  return stats;
}
function xpInfo(mon) {
  const table = catalog.growth[record(mon).growth];
  const base = table[mon.level];
  const next = table[Math.min(100, mon.level + 1)];
  return {
    current: mon.xp - base,
    needed: next - base,
    next,
    percent: next === base ? 100 : (100 * (mon.xp - base)) / (next - base),
  };
}
function refresh(mon) {
  const prior = mon.maxhp;
  mon.stats = statsFor(mon);
  mon.maxhp = mon.stats.hp;
  mon.hp =
    prior == null
      ? mon.maxhp
      : mon.hp === 0
        ? 0
        : clamp(mon.hp + mon.maxhp - prior, 1, mon.maxhp);
  const exp = xpInfo(mon);
  mon.xpIntoLevel = exp.current;
  mon.xpNeeded = exp.needed;
}
function identify(mon, data) {
  mon.pokemonId = data.id;
  mon.speciesId = data.speciesId;
  mon.slug = data.slug;
  mon.species = dexById.get(data.id).name;
  mon.spriteId = dexById.get(data.id).spriteid;
  mon.name = mon.species;
  mon.types = data.types;
  const abilities = dexById.get(data.id).abilities;
  const slot = mon.abilitySlot === "H" && abilities.H ? "H" :
    Number(mon.abilitySlot || 0) % (data.abilities.length || 1);
  mon.ability = abilities[slot] || abilities[0];
}
const laboratoryNatures = Dex.natures.all().map(({ name, plus, minus }) => ({ name, plus, minus }));
function laboratoryAbilities(mon) {
  const abilities = dexById.get(record(mon).id).abilities;
  return Object.fromEntries(["0", "1", "H"].filter(slot => abilities[slot])
    .map(slot => [slot, abilities[slot]]));
}

function modifyTraining(mon, { ivs, evs, nature, abilitySlot }) {
  const validStats = (values, maximum) => values && Object.keys(values).length === statNames.length &&
    statNames.every(stat => Number.isInteger(values[stat]) && values[stat] >= 0 && values[stat] <= maximum);
  if (!validStats(ivs, 31)) throw Error("Os IVs devem ser inteiros entre 0 e 31.");
  if (!validStats(evs, 252) || statNames.reduce((sum, stat) => sum + evs[stat], 0) > 510)
    throw Error("Os EVs permitem até 252 por atributo e 510 no total.");
  if (typeof nature !== "string" || !Dex.natures.get(nature).exists)
    throw Error("Natureza inválida.");
  const abilities = laboratoryAbilities(mon);
  if (typeof abilitySlot !== "string" || !Object.hasOwn(abilities, abilitySlot))
    throw Error("Habilidade indisponível para essa forma.");
  const newNature = Dex.natures.get(nature).name;
  const changed = newNature !== (mon.nature || "Serious") ||
    idOf(abilities[abilitySlot]) !== idOf(mon.ability) ||
    statNames.some(stat => ivs[stat] !== mon.ivs[stat] || evs[stat] !== (mon.evs?.[stat] || 0));
  if (!changed) throw Error("Altere pelo menos um atributo, a natureza ou a habilidade.");

  mon.ivs = { ...ivs };
  mon.evs = { ...evs };
  mon.nature = newNature;
  mon.abilitySlot = abilitySlot === "H" ? "H" : Number(abilitySlot);
  mon.ability = abilities[abilitySlot];
  refresh(mon);
}

function learn(mon, names, initial = false) {
  for (const name of names) {
    if (mon.moves.includes(name) || mon.pendingMoves?.includes(name) ||
        !Dex.moves.get(name).exists) continue;
    if (!initial && mon.moves.length >= 4) {
      (mon.pendingMoves ??= []).push(name);
    } else {
      if (mon.moves.length === 1 && mon.moves[0] === "struggle") mon.moves.pop();
      mon.moves.push(name);
    }
  }
  if (initial) mon.moves = mon.moves.slice(-4);
}

function resolveMove(mon, newMove, replacedMove) {
  if (mon.pendingMoves?.[0] !== newMove) return false;
  if (replacedMove !== null) {
    const index = mon.moves.indexOf(replacedMove);
    if (index < 0) return false;
    mon.moves[index] = newMove;
    if (mon.pp) {
      delete mon.pp[idOf(replacedMove)];
      delete mon.pp[idOf(newMove)];
    }
  }
  mon.pendingMoves.shift();
  if (!mon.pendingMoves.length) delete mon.pendingMoves;
  return true;
}
function makeMon(input, level = 5) {
  const data = record(input);
  const gender =
    dexById.get(data.id).gender ||
    (data.genderRate < 0 ? "N" : randomInt(8) < data.genderRate ? "F" : "M");
  const mon = {
    uid: randomUUID(),
    level: clamp(Math.floor(Number(level) || 1), 1, 100),
    gender,
    happiness: data.happiness ?? 50,
    ivs: Object.fromEntries(statNames.map((s) => [s, randomInt(32)])),
    abilitySlot: randomInt(Math.max(1, data.abilities.length)),
    personality: randomInt(0x100000000),
    moves: [],
    status: "",
    heldItem: "",
  };
  identify(mon, data);
  mon.xp = catalog.growth[data.growth][mon.level];
  learn(
    mon,
    data.moves
      .filter(([lv]) => lv > 0 && lv <= mon.level)
      .map(([, name]) => name),
    true,
  );
  if (!mon.moves.length) mon.moves = ["struggle"];
  refresh(mon);
  return mon;
}

const habitats = {
  campo: ["normal", "flying", "fairy"],
  floresta: ["grass", "bug", "poison"],
  caverna: ["rock", "ground", "ghost"],
  praia: ["water", "flying", "ground"],
  lago: ["water", "grass", "dragon"],
  neve: ["ice", "steel", "fairy"],
  vulcao: ["fire", "rock", "dragon"],
  cidade: ["electric", "steel", "psychic", "fighting", "dark"],
};
const pools = Object.fromEntries(
  Object.entries(habitats).map(([biome, types]) => [
    biome,
    catalog.mons.filter(
      (m) =>
        (m.isDefault || /-(alola|galar|hisui|paldea)$/.test(m.slug)) &&
        dexById.has(m.id) &&
        m.types.some((t) => types.includes(t)),
    ),
  ]),
);
const timedFamilies = require("./data/timed-families.json");
const species = new Map(catalog.mons.filter(mon => mon.isDefault)
  .map(mon => [mon.speciesId, mon]));

function familyRoot(mon) {
  let root = species.get(mon.speciesId);
  while (species.has(root.parent)) root = species.get(root.parent);
  return root.slug;
}

const encounterPeriods = new Map(Object.entries(timedFamilies.families)
  .flatMap(([period, roots]) => roots.map(root => [root, period])));
const timedHabitats = Object.fromEntries(Object.entries(pools).map(([biome, pool]) => {
  const commonIds = new Set(pool.map(mon => mon.id));
  const extraFamilies = new Set(timedFamilies.habitats[biome] || []);
  const themed = catalog.mons.filter(mon => !mon.rare && dexById.has(mon.id) &&
    (mon.isDefault || /-(alola|galar|hisui|paldea)$/.test(mon.slug)) &&
    (commonIds.has(mon.id) || extraFamilies.has(familyRoot(mon))));
  return [biome, Object.fromEntries(["day", "dusk", "night"].map(period =>
    [period, themed.filter(mon => encounterPeriods.get(familyRoot(mon)) === period)],
  ))];
}));

const themedEncounterChance = .6;

const encounterLevels = new Map();
function minimumEncounterLevel(mon, visiting = new Set()) {
  if (!mon?.parent || visiting.has(mon.id)) return 1;
  if (encounterLevels.has(mon.id)) return encounterLevels.get(mon.id);
  const path = new Set(visiting).add(mon.id);
  const routes = catalog.evolution.filter(rule => rule.evolved_species_id === mon.speciesId &&
    (rule.targetPokemon ? rule.targetPokemon === mon.id : mon.isDefault));
  const level = routes.length ? Math.min(...routes.map(rule => Math.max(18,
    rule.minimum_level || 1, minimumEncounterLevel(byId.get(rule.requiredPokemon) || defaults.get(rule.parent), path)))) :
    Math.max(18, minimumEncounterLevel(defaults.get(mon.parent), path));
  encounterLevels.set(mon.id, level);
  return level;
}

function evolutionDetails(mon) {
  return catalog.evolution.filter(rule => rule.parent === mon.speciesId &&
    (rule.requiredPokemon ? rule.requiredPokemon === mon.pokemonId : record(mon).isDefault))
    .map(rule => ({
      ...rule,
      name: dexById.get(rule.targetPokemon || defaults.get(rule.evolved_species_id)?.id)?.name,
      parentParty: dexById.get(defaults.get(rule.party_species_id)?.id)?.name,
      tradeTarget: dexById.get(defaults.get(rule.trade_species_id)?.id)?.name,
    })).filter(rule => rule.name);
}

function encounterPools(biome, level, period) {
  const pool = pools[biome] || pools.campo;
  const eligible = m => (level >= 50 || !m.rare) &&
    level >= minimumEncounterLevel(m) && (level >= 8 || m.catchRate >= 120);
  const possible = pool.filter(eligible);
  return {
    common: possible.length ? possible : pools.campo.filter(eligible),
    themed: timedHabitats[biome]?.[period]?.filter(eligible) || [],
  };
}

function wild(biome, targetLevel = 5, period, roll = randomInt) {
  const level = clamp(Math.round(targetLevel) + randomInt(-1, 2), 1, 100);
  const { common, themed } = encounterPools(biome, level, period);
  return makeMon(pick(themed.length && roll(100) < themedEncounterChance * 100 ? themed : common).id, level);
}

function auctionPokemon(average, roll = randomInt) {
  const level = clamp(Math.round(average) + roll(5) - 2, 1, 100);
  const candidates = [...defaults.values()].filter(m => dexById.has(m.id));
  const rare = average > 50 && roll(100) < 15;
  const minimumCatchRate = level < 12 ? 120 : level < 25 ? 75 : level < 40 ? 45 : 0;
  const pool = candidates.filter(m => rare ? m.rare :
    !m.rare && (level >= 18 || !m.parent) && m.catchRate >= minimumCatchRate);
  const pokemon = makeMon(pool[roll(pool.length)].id, level);
  pokemon.shiny = roll(100) < 10;
  return pokemon;
}

function encounterGuide(biome, period, leaderLevel) {
  const results = new Map();
  for (const adjustment of [-2, -1, 0, 1, 2]) {
    const target = clamp(leaderLevel + adjustment, 2, 100);
    for (const variation of [-1, 0, 1]) {
      const level = clamp(target + variation, 1, 100);
      const { common, themed } = encounterPools(biome, level, period);
      const weight = themed.length ? themedEncounterChance : 0;
      for (const [pool, chance, group] of [[common, 1 - weight, "common"], [themed, weight, "themed"]]) {
        for (const mon of pool) {
          if (!results.has(mon.id)) results.set(mon.id, {id: mon.id, name: dexById.get(mon.id).name,
            types: mon.types, common: 0, themed: 0});
          results.get(mon.id)[group] += chance / (15 * pool.length);
        }
      }
    }
  }
  return [...results.values()].sort((a, b) => b.common + b.themed - a.common - a.themed ||
    a.name.localeCompare(b.name));
}

function captureGuide() {
  return catalog.mons.filter(mon => dexById.has(mon.id)).map(mon => ({
    id: mon.id, name: dexById.get(mon.id).name, rate: mon.catchRate,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function silhouetteSpecies() {
  return [...defaults.values()].filter(m => dexById.has(m.id)).map(m => {
    const species = dexById.get(m.id);
    return { name: species.name, spriteId: species.spriteid, slug: m.slug, pokemonId: m.id };
  });
}
function encounter(biome, level, roll = randomInt, period) {
  const pokemon = wild(biome, level, period, roll);
  pokemon.shiny = roll(100) < 5;
  return pokemon;
}

function captureChance(mon, ball = "poke-ball") {
  const rate = record(mon).catchRate;
  const slug = idOf(ball);
  if (slug === "masterball") return 1;
  const modifier = {
    pokeball: 1,
    greatball: 1.5,
    ultraball: 2,
    premierball: 1,
  }[slug];
  if (!modifier || mon.hp <= 0) return 0;
  const status = ["slp", "frz"].includes(mon.status)
    ? 2.5
    : mon.status
      ? 1.5
      : 1;
  // Four independent shake checks approximate the modern games' HP and status influence.
  const a =
    ((3 * mon.maxhp - 2 * mon.hp) / (3 * mon.maxhp)) * rate * modifier * status;
  return Math.min(1, (a / 255) ** 0.75);
}
function heal(mon) {
  mon.hp = mon.maxhp;
  mon.pp = {};
  mon.sleepTurns = undefined;
  mon.status = "";
  return mon;
}
function copyForBattleAtLevel(mon, level) {
  const copy = structuredClone(mon);
  copy.level = level;
  copy.xp = catalog.growth[record(copy).growth][level];
  refresh(copy);
  return heal(copy);
}
function toSet(mon) {
  return {
    name: mon.name,
    species: mon.species,
    gender: mon.gender,
    level: mon.level,
    nature: "Serious",
    ivs: { ...mon.ivs },
    evs: Object.fromEntries(statNames.map((n) => [n, 0])),
    moves: [...mon.moves],
    ability: mon.ability,
    item: mon.heldItem || "",
    happiness: mon.happiness,
  };
}

function checkExpression(expression, mon) {
  if (!expression) return true;
  if (expression === "EC 100 % 0 ==") return mon.personality % 100 === 0;
  if (expression === "EC 100 % 0 !=") return mon.personality % 100 !== 0;
  if (/^(EC|PID) 16 >> 10 % 4 <=$/.test(expression))
    return (mon.personality >>> 16) % 10 <= 4;
  if (/^(EC|PID) 16 >> 10 % 5 >=$/.test(expression))
    return (mon.personality >>> 16) % 10 >= 5;
  return false;
}
function canEvolve(rule, mon, ctx) {
  if (rule.trigger !== ctx.event || rule.parent !== mon.speciesId) return false;
  if (
    rule.requiredPokemon
      ? rule.requiredPokemon !== mon.pokemonId
      : !record(mon).isDefault
  )
    return false;
  if (rule.item && rule.item !== ctx.item) return false;
  if (rule.heldItem && rule.heldItem !== mon.heldItem) return false;
  if (rule.minimum_level > mon.level || rule.minimum_happiness > mon.happiness)
    return false;
  if (rule.gender_id && rule.gender_id !== { F: 1, M: 2, N: 3 }[mon.gender])
    return false;
  if (rule.time_of_day && rule.time_of_day !== ctx.timeOfDay) return false;
  if (rule.knownMove && !mon.moves.includes(rule.knownMove)) return false;
  if (
    rule.knownType &&
    !mon.moves.some(
      (m) => Dex.moves.get(m).type.toLowerCase() === rule.knownType,
    )
  )
    return false;
  if (
    "relative_physical_stats" in rule &&
    rule.relative_physical_stats !== Math.sign(mon.stats.atk - mon.stats.def)
  )
    return false;
  if (
    rule.party_species_id &&
    !(ctx.party || []).some((m) => m.speciesId === rule.party_species_id)
  )
    return false;
  if (
    rule.partyType &&
    !(ctx.party || []).some((m) => m.types.includes(rule.partyType))
  )
    return false;
  if (rule.trade_species_id && ctx.tradeSpeciesId !== rule.trade_species_id)
    return false;
  if (rule.region_id && rule.region_id !== ctx.regionId) return false;
  if (rule.location_id && rule.location_id !== ctx.locationId) return false;
  if (
    (rule.needs_overworld_rain && !ctx.rain) ||
    (rule.turn_upside_down && !ctx.upsideDown) ||
    (rule.near_special_rock && !ctx.nearSpecialRock) ||
    (rule.needs_multiplayer && !ctx.multiplayer)
  )
    return false;
  // Conditions requiring counters or map-specific mechanics stay pending without evidence.
  if (
    rule.minimum_steps > (ctx.steps || 0) ||
    rule.minimum_damage_taken > (ctx.damageTaken || 0) ||
    rule.minimum_beauty > (ctx.beauty || 0) ||
    rule.minimum_affection > (ctx.affection || 0) ||
    rule.minimum_move_count > (ctx.moveCounts?.[rule.usedMove] || 0) ||
    rule.nature_bitmask
  )
    return false;
  return checkExpression(rule.condition_expression, mon);
}
function evolutionAppearance({ name, pokemonId, slug, spriteId, shiny }) {
  return { name, pokemonId, slug, spriteId, shiny };
}

function evolve(mon, context = "level-up", extra = {}) {
  const ctx =
    typeof context === "string" ? { ...extra, event: context } : { ...context };
  ctx.event = ctx.event || ctx.trigger || (ctx.item ? "use-item" : "level-up");
  if (ctx.event === "item") ctx.event = "use-item";
  ctx.timeOfDay ??= "day";
  if (mon.heldItem === "everstone") return null;
  const eligible = catalog.evolution.filter((r) => canEvolve(r, mon, ctx));
  // Specific branches, such as a regional evolution or Sylveon, beat a generic match.
  eligible.sort(
    (a, b) =>
      Boolean(b.region_id) - Boolean(a.region_id) ||
      Boolean(b.knownMove || b.knownType) - Boolean(a.knownMove || a.knownType),
  );
  for (const r of eligible) {
    const target = r.targetPokemon
      ? byId.get(r.targetPokemon)
      : defaults.get(r.evolved_species_id);
    if (!target || !dexById.has(target.id)) continue;
    const before = ctx.onEvolution && evolutionAppearance(mon);
    identify(mon, target);
    if (r.heldItem) mon.heldItem = "";
    learn(
      mon,
      target.moves
        .filter(([lv]) => lv === 0 || lv === mon.level)
        .map(([, name]) => name),
    );
    refresh(mon);
    if (before) ctx.onEvolution(before, evolutionAppearance(mon));
    return mon.name;
  }
  return null;
}
function battleXP(mon, defeated, multiplier = 1) {
  const opponent = record(defeated);
  const n = defeated.level;
  return Math.max(
    1,
    Math.floor(
      ((((opponent.baseXp || 60) * n) / 5) *
        ((2 * n + 10) / (mon.level + n + 10)) ** 2.5 +
        1) *
        clamp(Number(multiplier) || 1, 0.1, 100),
    ),
  );
}
function addXP(mon, amount, context = {}) {
  const curve = catalog.growth[record(mon).growth];
  const initial = mon.level;
  const oldXp = mon.xp;
  mon.xp = Math.min(curve[100], mon.xp + amount);
  let evolution = null;
  while (mon.level < 100 && mon.xp >= curve[mon.level + 1]) {
    mon.level++;
    mon.happiness = Math.min(255, mon.happiness + 2);
    learn(
      mon,
      record(mon)
        .moves.filter(([lv]) => lv === mon.level)
        .map(([, name]) => name),
    );
    refresh(mon);
    evolution = evolve(mon, { ...context, event: "level-up" }) || evolution;
  }
  refresh(mon);
  return { xp: mon.xp - oldXp, levels: mon.level - initial, evolution };
}
function gainXP(mon, defeated, multiplier = 1, context = {}) {
  return addXP(mon, battleXP(mon, defeated, multiplier), context);
}
module.exports = {
  battleXP,
  addXP,
  makeMon,
  wild,
  auctionPokemon,
  captureChance,
  captureGuide,
  silhouetteSpecies,
  encounterGuide,
  evolutionDetails,
  xpInfo,
  gainXP,
  laboratoryNatures,
  laboratoryAbilities,
  modifyTraining,
  resolveMove,
  moveName: (id) => Dex.moves.get(id).name,
  evolve,
  heal,
  copyForBattleAtLevel,
  toSet,
  createMon: makeMon,
  encounter,
  capture: (mon, ball) => Math.random() < captureChance(mon, ball),
  rewardXP: gainXP,
  info: record,
};
