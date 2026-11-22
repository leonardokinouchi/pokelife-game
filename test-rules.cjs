"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const rules = require("./rules.cjs");
const data = require("./data/rules.json");
const { Dex } = require("@pkmn/sim");

test("wild encounter guide excludes Dragonite below its evolution level", () => {
  const appears = level => ["campo", "floresta", "caverna", "praia", "lago", "neve", "vulcao", "cidade"]
    .some(biome => ["day", "dusk", "night"].some(period =>
      rules.encounterGuide(biome, period, level).some(mon => mon.name === "Dragonite")));
  assert.equal(appears(51), false);
  assert.equal(appears(55), true);
});

test("all 1,025 species and their battle records have simulator IDs", () => {
  assert.equal(data.mons.filter((m) => m.isDefault).length, 1025);
  for (const row of data.mons) {
    const mon = rules.makeMon(row.id, 5);
    assert.equal(mon.speciesId, row.speciesId);
    assert.ok(Dex.species.get(mon.species).exists);
    assert.ok(mon.moves.length >= 1 && mon.moves.length <= 4);
  }
});

test("a regional evolution keeps the form and honors friendship", () => {
  const mon = rules.makeMon("meowth-alola", 30);
  mon.happiness = 5;
  assert.equal(rules.evolve(mon, "level-up"), null);
  mon.happiness = 200;
  assert.equal(rules.evolve(mon, "level-up"), "Persian-Alola");
  assert.equal(mon.speciesId, 53);
});

test("stones, trades and held-item trades use separate triggers", () => {
  assert.equal(
    rules.evolve(rules.makeMon("eevee", 3), { item: "water-stone" }),
    "Vaporeon",
  );
  assert.equal(rules.evolve(rules.makeMon("kadabra", 30), "trade"), "Alakazam");
  const onix = rules.makeMon("onix", 30);
  assert.equal(rules.evolve(onix, "trade"), null);
  onix.heldItem = "metal-coat";
  assert.equal(rules.evolve(onix, "trade"), "Steelix");
  assert.equal(onix.heldItem, "");
});

test("XP curves advance levels, preserve injury and cap at 100", () => {
  const mon = rules.makeMon("bulbasaur", 15);
  const opponent = rules.makeMon("chansey", 30);
  mon.hp -= 3;
  const evolved = [];
  const result = rules.gainXP(mon, opponent, 1, {
    onEvolution: (before, after) => evolved.push([before.slug, after.slug]),
  });
  assert.deepEqual(evolved, [["bulbasaur", "ivysaur"]]);
  assert.ok(result.levels >= 1);
  assert.ok(result.evolution);
  assert.equal(mon.hp, mon.maxhp - 3);
  const max = rules.makeMon("mewtwo", 100);
  assert.equal(rules.gainXP(max, opponent, 100).xp, 0);
});

test("capture responds to missing HP, status and ball type", () => {
  const mon = rules.makeMon("bulbasaur", 5);
  const base = rules.captureChance(mon);
  mon.hp = 1;
  assert.ok(rules.captureChance(mon) > base);
  assert.ok(rules.captureChance(mon, "great-ball") > rules.captureChance(mon));
  mon.status = "slp";
  assert.ok(rules.captureChance(mon) > base);
  assert.equal(rules.captureChance(mon, "master-ball"), 1);
  rules.heal(mon);
  assert.equal(mon.hp, mon.maxhp);
  assert.equal(mon.status, "");
});

test("level-up learns into free slots and queues new moves for a full moveset", () => {
  const pikachu = rules.makeMon("pikachu", 11);
  const magikarp = rules.makeMon("magikarp", 14);
  const opponent = rules.makeMon("rattata", 2);
  const learnAtNextLevel = (mon) => {
    mon.xp = data.growth[rules.info(mon).growth][mon.level + 1] - 1;
    assert.equal(rules.gainXP(mon, opponent, .1).levels, 1);
  };
  const original = [...pikachu.moves];
  learnAtNextLevel(magikarp);
  assert.deepEqual(magikarp.moves, ["splash", "tackle"]);
  assert.equal(magikarp.pendingMoves, undefined);
  learnAtNextLevel(pikachu);
  assert.deepEqual(pikachu.moves, original);
  assert.deepEqual(pikachu.pendingMoves, ["electro-ball"]);
});

test("wild encounters roll a five percent shiny chance", () => {
  let outcomes = 0;
  for (let roll = 0; roll < 100; roll++) {
    const pokemon = rules.encounter("campo", 10, (maximum) => {
      assert.equal(maximum, 100);
      return roll;
    });
    if (pokemon.shiny) outcomes++;
  }
  assert.equal(outcomes, 5);
});

test("themed encounters use the assigned evolution-family period in every biome", () => {
  const { families } = require("./data/timed-families.json");
  const species = new Map(data.mons.filter(mon => mon.isDefault)
    .map(mon => [mon.speciesId, mon]));
  const periodOf = new Map();
  for (const [period, roots] of Object.entries(families)) {
    for (const root of roots) {
      assert.equal(periodOf.has(root), false);
      const mon = rules.info(root);
      assert.ok(!mon.rare && !mon.parent);
      periodOf.set(root, period);
    }
  }
  for (const biome of ["campo", "floresta", "caverna", "praia", "lago", "neve", "vulcao", "cidade"]) {
    for (const period of ["day", "dusk", "night"]) {
      for (const level of [5, 60]) {
        const mon = rules.info(rules.encounter(biome, level, () => 10, period));
        assert.equal(mon.rare, 0);
        let root = species.get(mon.speciesId);
        while (species.has(root.parent)) root = species.get(root.parent);
        assert.equal(periodOf.get(root.slug), period, biome + " " + period + " nível " + level);
      }
    }
  }
});
