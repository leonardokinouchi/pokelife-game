const { test } = require("node:test");
const assert = require("node:assert/strict");
const { BattleSession } = require("../battle.cjs");

function pokemon(species, moves, level = 10, hp = 30) {
  return {
    uid: species,
    species,
    slug: species.toLowerCase(),
    name: species,
    moves,
    level,
    hp,
    maxhp: 30,
  };
}
const seed = [1, 2, 3, 4];

test("CPU prefers type advantage and avoids immune moves", () => {
  for (const [target, moves, expected] of [
    ["Charmander", ["tackle", "water-gun"], "Water Gun"],
    ["Sandshrew", ["thunderbolt", "tackle"], "Tackle"],
  ]) {
    const battle = new BattleSession({
      p1:[pokemon(target, ["protect"])],
      p2:[pokemon("Squirtle", moves)],
      cpu:true,
      seed,
    });
    battle.choose("p1", "move 1");
    assert.ok(battle.view("p1").log.includes("Squirtle usou " + expected + "."));
  }
});

test("PvP waits for both players, rejects invalid inputs and syncs HP after switches", () => {
  const party = [
    pokemon("Squirtle", ["water-gun"]),
    pokemon("Bulbasaur", ["tackle"]),
  ];
  const battle = new BattleSession({
    p1: party,
    p2: [pokemon("Charmander", ["scratch"])],
    seed,
  });
  assert.throws(() => battle.choose("p1", "move 44"));
  battle.choose("p1", "switch 2");
  assert.equal(battle.view("p1").waiting, true);
  assert.throws(() => battle.choose("p1", "move 1"));
  battle.choose("p2", "move 1");
  assert.equal(battle.view("p1").own.name, "Bulbasaur");
  assert.ok(party[1].hp < 30);
  assert.equal(party[0].hp, 30);
});

test("failed ball consumes the trainer action and PP only on the wild side", () => {
  const trainer = pokemon("Snorlax", ["tackle"]);
  const wild = pokemon("Meowth", ["scratch"]);
  const battle = new BattleSession({
    p1: [trainer],
    p2: [wild],
    cpu: true,
    seed,
  });
  const startingPP = trainer.pp.tackle;
  const wildPP = wild.pp.scratch;
  battle.cpuTurnAfterItem();
  assert.equal(battle.view("p1").turn, 2);
  assert.equal(trainer.pp.tackle, startingPP);
  assert.equal(wild.pp.scratch, wildPP - 1);
  assert.equal(wild.hp, 30);
  assert.ok(trainer.hp < 30);
});

test("forced switch disallows ball use, ends with winner and preserves fainted state", () => {
  const party = [
    pokemon("Caterpie", ["tackle"], 2, 1),
    pokemon("Weedle", ["poison-sting"], 2),
  ];
  const battle = new BattleSession({
    p1: party,
    p2: [pokemon("Charizard", ["flamethrower"], 60)],
    cpu: true,
    seed,
  });
  battle.choose("p1", "move 1");
  assert.equal(party[0].hp, 0);
  assert.deepEqual(
    battle.view("p1").choices.map((x) => x.command),
    ["switch 2"],
  );
  assert.throws(() => battle.cpuTurnAfterItem());
  battle.choose("p1", "switch 2");
  battle.choose("p1", "move 1");
  assert.equal(battle.view("p1").winner, "p2");
  assert.equal(party[1].hp, 0);
});

test("zero PP on reopening a battle exposes Struggle", () => {
  const trainer = pokemon("Pikachu", ["thunder-shock"]);
  trainer.pp = { thundershock: 0 };
  const battle = new BattleSession({
    p1: [trainer],
    p2: [pokemon("Pidgey", ["tackle"])],
    cpu: true,
    seed,
  });
  assert.equal(battle.view("p1").choices[0].label, "Struggle");
  const exhausted = battle.view("p1").choices.find(choice => choice.label === "Thunder Shock");
  assert.equal(exhausted?.pp, 0);
  assert.equal(exhausted.disabled, true);
});

test("battle view publishes confusion, stat changes and field effects to both players", () => {
  const battle = new BattleSession({
    p1: [pokemon("Pikachu", ["tackle"])],
    p2: [pokemon("Rattata", ["tackle"])],
    seed,
  });
  const { engine } = battle;
  const pikachu = engine.p1.active[0];
  pikachu.addVolatile("confusion", engine.p2.active[0]);
  engine.boost({atk: 2, spe: -1}, pikachu);
  engine.field.setWeather("raindance", pikachu);
  engine.field.setTerrain("electricterrain", pikachu);
  engine.field.addPseudoWeather("trickroom", pikachu);
  engine.p2.addSideCondition("spikes", pikachu);
  engine.p2.addSideCondition("spikes", pikachu);

  const own = battle.view("p1"), other = battle.view("p2");
  assert.equal(own.own.effects[0].id, "confusion");
  assert.deepEqual(other.foe.boosts, {atk: 2, spe: -1});
  assert.equal(own.field.weather, "Chuva");
  assert.equal(own.field.terrain, "Terreno elétrico");
  assert.equal(own.field.effects[0].id, "trickroom");
  assert.deepEqual(other.field.own[0], {id: "spikes", label: "Espinhos", layers: 2});
  assert.ok(own.log.some(line => line.includes("ficou confuso")));
  pikachu.removeVolatile("confusion");
  assert.ok(battle.view("p1").log.some(line => line.includes("se livrou da confusão")));
  assert.deepEqual(battle.view("p1").own.effects, []);
});

test("double battles require a legal move and target for each active Pokémon", () => {
  const battle = new BattleSession({
    mode: "doubles",
    p1: [pokemon("Pikachu", ["tackle"]), pokemon("Bulbasaur", ["protect"])],
    p2: [pokemon("Rattata", ["tackle"]), pokemon("Squirtle", ["protect"])],
    seed,
  });
  const view = battle.view("p1");
  assert.equal(view.ownActive.length, 2);
  assert.equal(view.foeActive.length, 2);
  assert.equal(view.groups.length, 2);
  assert.ok(view.groups[0].options.some(c => c.command === "move 1 2"));
  assert.deepEqual(view.groups[0].options.map(c => [c.target.name, c.target.ally]).sort(),
    [["Bulbasaur", true], ["Rattata", false], ["Squirtle", false]]);
  assert.equal(view.groups[1].options[0].target, null);
  assert.throws(() => battle.choose("p1", "move 1 9, move 1"));
  assert.throws(() => battle.choose("p1", "move 1 2"));
  battle.choose("p1", "move 1 2, move 1");
  assert.equal(battle.view("p1").waiting, true);
  assert.ok(battle.view("p2").readySides.includes("p1"));
  battle.choose("p2", "move 1 1, move 1");
  assert.ok(battle.view("p1").turn > view.turn);
});

test("multi battles give four trainers their own commands and survive save/restore", () => {
  let battle = new BattleSession({
    mode: "multi",
    p1: [pokemon("Pikachu", ["tackle"])],
    p2: [pokemon("Rattata", ["tackle"])],
    p3: [pokemon("Bulbasaur", ["helping-hand"])],
    p4: [pokemon("Squirtle", ["protect"])],
    seed,
  });
  const initial = battle.view("p3");
  assert.deepEqual(initial.ownActive.map(p=>p.name), ["Bulbasaur", "Pikachu"]);
  assert.deepEqual(initial.foeActive.map(p=>p.name), ["Rattata", "Squirtle"]);
  assert.deepEqual(initial.groups[0].options.map(c=>c.command), ["move 1 -1"]);
  battle.choose("p1", "move 1 2");
  battle = BattleSession.restore(JSON.parse(JSON.stringify(battle.snapshot())));
  assert.equal(battle.view("p1").waiting, true);
  battle.choose("p2", "move 1 1");
  battle.choose("p3", "move 1 -1");
  battle.choose("p4", "move 1");
  assert.ok(battle.view("p4").turn > initial.turn);
});

test("Earthquake shows both rivals and the adjacent ally as affected", () => {
  const battle = new BattleSession({
    mode: "doubles",
    p1: [pokemon("Pikachu", ["earthquake"]), pokemon("Bulbasaur", ["protect"])],
    p2: [pokemon("Rattata", ["tackle"]), pokemon("Squirtle", ["protect"])],
    seed,
  });
  const view = battle.view("p1");
  const earthquake = view.groups[0].options.find(choice => choice.name === "Earthquake");
  assert.deepEqual(earthquake.affected.sort(), [view.ownActive[1].uid, ...view.foeActive.map(mon => mon.uid)].sort());
  assert.equal(earthquake.target, null);
});
