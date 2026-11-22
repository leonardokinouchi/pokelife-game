const assert = require("node:assert/strict");
const test = require("node:test");
const { beginRound, newRoom, player, command, view } = require("../game.cjs");
const { avatars, maxPlayers } = require("../public/world.js");
const rules = require("../rules.cjs");
function lobby(size) {
  const players = Array.from({ length: size }, (_, i) =>
    player("Treinador " + i, Object.keys(avatars)[i]),
  );
  const room = newRoom("TESTE", players[0]);
  room.players = players;
  players.forEach((p) => command(room, p, "ready"));
  return room;
}
function readTutorials(r) {
  for (const [i, player] of r.players.entries()) {
    assert.equal(r.phase, "cards");
    assert.equal(r.cards[i].owner, player.id);
    command(r, player, "card", {id: r.cards[i].id});
  }
}
const options = { rounds: 1, mult: 3, mini: false };
test("even lobbies start together, while odd or unready lobbies cannot start", () => {
  for (let n = 1; n <= maxPlayers + 2; n++) {
    const r = lobby(n);
    if (n % 2 || n > maxPlayers) {
      assert.throws(() => command(r, r.players[0], "start", options), /2 a 12 treinadores/);
    }
    else {
      command(r, r.players[0], "start", options);
      readTutorials(r);
      assert.equal(r.phase, "actions");
    }
  }
  const r = lobby(2);
  command(r, r.players[1], "ready");
  assert.throws(() => command(r, r.players[0], "start", options));
});
test("economy respects action budgets, place, ownership and failed purchases", () => {
  const r = lobby(2),
    p = r.players[0];
  command(r, p, "start", options);
  readTutorials(r);
  assert.throws(() => command(r, p, "shop", { item: "poke-ball", qty: 1 }));
  assert.equal(p.actions, 10);
  command(r, p, "hire", { job: "vendedor" });
  assert.equal(p.actions, 9);
  assert.throws(() => command(r, p, "hire", {job:"vendedor"}));
  assert.equal(p.actions, 9);
  command(r, p, "work");
  command(r, p, "enterShop");
  command(r, p, "shop", { item: "poke-ball", qty: 1 });
  assert.equal(p.money, 0);
  const beforeTravel = p.actions;
  assert.throws(() => command(r, p, "move", { loc: "city8" }));
  assert.equal(p.actions, beforeTravel);
  command(r, p, "move", { loc: "biome1" });
  assert.equal(p.actions, beforeTravel);
  assert.deepEqual(view(r, r.players[1]).players[0].travel, [{ from: "city1", loc: "biome1", step: 1 }]);
  command(r, p, "explore");
  assert.equal(view(r, p).you.enc.battle, undefined);
  assert.throws(() => command(r, p, "work", { job: "vendedor" }));
  command(r, p, "flee");
  command(r, p, "move", { loc: "city1" });
  while (p.actions) command(r, p, "work", { job: "vendedor" });
  assert.throws(() => command(r, p, "work", { job: "vendedor" }));
});

test("free travel still counts all six crossings for fatigue", () => {
  const r = lobby(2), [p] = r.players;
  command(r, p, "start", {...options, rounds:2});
  readTutorials(r);
  for (let i = 0; i < 6; i++)
    command(r, p, "move", {loc:i % 2 ? "city1" : "biome1"});
  assert.equal(p.actions, 10);
  r.round = 2;
  require("../game.cjs").beginRound(r, () => 0);
  assert.equal(r.cards[0].type, "fatigue");
  command(r, p, "card", {id:r.cards[0].id});
  assert.equal(p.actions, 8);
});
test("trade transfers once, cancels a stale offer and awards correct end scores", () => {
  const r = lobby(2),
    [a, b] = r.players;
  command(r, a, "start", { ...options, rounds: 2 });
  readTutorials(r);
  a.money = 200;
  b.items = { "poke-ball": 1 };

    for (const p of r.players) command(r, p, "finish");
  const order = {
    to: b.id,
    give: { kind: "money", qty: 100 },
    want: { kind: "item", id: "poke-ball", qty: 1 },
  };
  command(r, a, "offer", order);
  command(r, a, "offer", order);
  command(r, b, "accept", { id: r.offers[0].id });
  assert.throws(() => command(r, b, "accept", { id: r.offers[0].id }));
  assert.equal(a.money, 100);
  assert.equal(b.money, 100);
  assert.equal(a.items["poke-ball"], 1);
  for (let i = 0; i < 2; i++)
    for (const p of r.players) command(r, p, "finish");
  assert.equal(r.round, 2);
  readRoundCards(r);
  assert.equal(r.phase, "actions");
  for (const p of r.players) command(r, p, "finish");
  assert.equal(r.phase, "final");
});

test("mixed counteroffers replace the original and shared Pokémon can only be traded once", () => {
  const r = lobby(4);
  const [a, b, c, spectator] = r.players;
  r.phase = "trocas";
  const mon = rules.createMon("abra", 10);
  a.party = [mon];
  a.items = {"poke-ball":2};
  b.money = c.money = 400;
  const give = [{kind:"mon", id:mon.uid}, {kind:"item", id:"poke-ball", qty:2}];
  const want = [{kind:"money", qty:200}];
  assert.throws(() => command(r, a, "offer", {to:b.id, give:[...give,give[1]], want}), /repetidos/);
  command(r, a, "offer", {to:b.id, give, want});
  command(r, a, "offer", {to:c.id, give, want});
  command(r, a, "box", {uid:mon.uid});
  assert.equal(view(r, b).players[0].box[0].uid, mon.uid);
  const [original, competing] = r.offers;
  assert.deepEqual(view(r, spectator).offers, []);
  command(r, b, "counter", {id:original.id, give:[{kind:"money", qty:250}], want:give});
  assert.equal(original.status, "countered");
  assert.throws(() => command(r, b, "accept", {id:original.id}), /indisponível/);
  assert.equal(command(r, a, "accept", {id:r.offers[2].id}).tradeNotice, "Troca concluída.");
  const after = [a.money, b.money, c.money];
  assert.match(command(r, c, "accept", {id:competing.id}).tradeNotice, /inválida/);
  assert.equal(competing.status, "invalid");
  assert.deepEqual([a.money, b.money, c.money], after);
  assert.equal(b.party[0].uid, mon.uid);
  assert.equal(b.items["poke-ball"], 2);
  assert.equal(a.party.length, 0);
  command(r, b, "offer", {to:c.id, give:[{kind:"mon",id:mon.uid}], want});
  command(r, c, "finish");
  assert.equal(r.offers.at(-1).status, "cancelled");
});
test("healthy teams with saved battle PP and empty teams cannot be charged for healing", () => {
  const r = lobby(2), [p] = r.players;
  command(r, p, "start", options);
  readTutorials(r);
  p.money = 200;
  const actions = p.actions;
  const mon = rules.makeMon("pikachu", 10);
  mon.moves = ["tackle"];
  mon.pp = { tackle: 35 };
  for (const party of [[], [mon]]) {
    p.party = party;
    assert.throws(() => command(r, p, "heal"), /recuperar/);
    assert.equal(p.money, 200);
    assert.equal(p.actions, actions);
    assert.equal(view(r, p).you.needsHealing, false);
  }
  mon.pp.tackle--;
  assert.equal(view(r, p).you.needsHealing, true);
  command(r, p, "heal");
  assert.equal(view(r, p).you.needsHealing, false);
  assert.equal(p.money, 100);
  assert.equal(p.actions, actions - 1);
});

test("center restores PP, HP, status and forms can hold Mega Stones", () => {
  const r = lobby(2),
    p = r.players[0];
  command(r, p, "start", options);
  readTutorials(r);
  const m = rules.makeMon("charizard", 50);
  m.hp = 0;
  m.pp = { flamethrower: 0 };
  m.status = "brn";
  p.party = [m];
  const actionsBeforeHealing = p.actions;
  p.money = view(r, p).healCost - 1;
  assert.throws(() => command(r, p, "heal"), /Saldo insuficiente/);
  assert.equal(p.money, 99);
  assert.equal(p.actions, actionsBeforeHealing);
  assert.equal(m.hp, 0);

  p.money = 100;
  command(r, p, "heal");
  assert.equal(p.money, 0);
  assert.equal(p.actions, actionsBeforeHealing - 1);
  assert.equal(m.hp, m.maxhp);
  assert.deepEqual(m.pp, {});
  assert.equal(m.status, "");
  p.items.charizarditex = 1;
  command(r, p, "item", { item: "charizarditex", uid: m.uid });
  assert.equal(m.heldItem, "charizarditex");
});

test("avatars can be selected before entering a room and changed in the lobby", () => {
  assert.equal(player("Entrada", "aurora").avatar, "aurora");
  assert.equal(player("Entrada", "inválido").avatar, "mar");
  const r = lobby(2), [p, other] = r.players;
  assert.throws(() => command(r, p, "avatar", { avatar: "missing" }));
  assert.throws(() => command(r, p, "avatar", { avatar: other.avatar }), /já está em uso/);
  assert.equal(p.ready, true);
  command(r, p, "avatar", { avatar: "jade" });
  assert.equal(p.ready, false);
  assert.equal(view(r, other).players[0].avatar, "jade");
  command(r, other, "avatar", { avatar: "mar" });
  assert.equal(other.avatar, "mar");
});

test("job promotions require two and three eligible Pokémon and every action pays", () => {
  const r = lobby(2), [p] = r.players;
  command(r, p, "start", options);
  readTutorials(r);
  assert.equal(Object.keys(view(r, p).jobs).length, 33);
  command(r, p, "hire", {job:"vendedor"});
  for (let i = 0; i < 3; i++) command(r, p, "work");
  assert.equal(p.money, 300);
  assert.equal(p.jobProgress.vendedor, 200);
  const pikachu = rules.makeMon("pikachu", 15);
  p.party.push(pikachu);
  assert.throws(() => command(r, p, "hire", {job:"gerente"}));
  p.jobProgress.vendedor = 500;
  pikachu.hp = 0;
  assert.throws(() => command(r, p, "hire", {job:"gerente"}));
  rules.heal(pikachu);
  assert.throws(() => command(r, p, "hire", {job:"gerente"}), /1\/2/);
  p.party.push(rules.makeMon("helioptile", 15));
  command(r, p, "hire", {job:"gerente"});
  command(r, p, "work");
  assert.equal(p.money, 490);
  p.jobProgress.gerente = 400;
  assert.throws(() => command(r, p, "hire", {job:"administrador"}));
  p.party = ["pikachu", "helioptile", "meowth"].map(species => rules.makeMon(species, 30));
  command(r, p, "hire", {job:"administrador"});
  p.party[2].hp = 0;
  const actions = p.actions;
  assert.throws(() => command(r, p, "work"), /2\/3/);
  assert.equal(p.actions, actions);
  assert.equal(p.money, 490);
  rules.heal(p.party[2]);
  for (let i = 0; i < 3; i++) command(r, p, "work");
  assert.equal(p.money, 1315);
  assert.equal(p.jobProgress.administrador, 200);
  assert.equal(p.actions, actions - 3);
});


test("field jobs require Pokémon of the right types and a specific workplace", () => {
  const r = lobby(2), [p] = r.players;
  command(r, p, "start", options);
  readTutorials(r);
  assert.equal(view(r, p).jobs.lenhador.requirement.met, false);
  assert.throws(() => command(r, p, "hire", { job: "lenhador" }));
  p.box.push(rules.makeMon("caterpie"));
  assert.throws(() => command(r, p, "hire", {job:"lenhador"}));
  p.party.push(p.box.pop());
  command(r, p, "hire", { job: "lenhador" });
  assert.equal(p.jobLocation, "biome2");
  assert.throws(() => command(r, p, "work"));
  assert.throws(() => command(r, p, "hire", { job: "minerador" }));
  p.party.push(rules.makeMon("diglett"));
  command(r, p, "hire", { job: "minerador" });
  command(r, p, "move", { loc: "biome3" });
  command(r, p, "work");
  assert.equal(p.money, 145);
  assert.equal(p.jobProgress.minerador, 100);
  p.party = [];
  assert.throws(() => command(r, p, "work"));
});

test("round cards are public, ordered by owner and resolved once", () => {
  const r = lobby(2), [a,b] = r.players;
  command(r, a, "start", options);
  assert.equal(r.cards.length, 2);
  assert.equal(r.cards[0].type, "tutorial");
  assert.throws(() => command(r, b, "card", {id:r.cards[0].id}));
  command(r, a, "card", {id:r.cards[0].id});
  assert.equal(r.phase, "cards");
  assert.throws(() => command(r, a, "move", {loc:"biome1"}));
  command(r, b, "card", {id:r.cards[1].id});
  assert.equal(r.phase, "actions");
  r.round++;
  a.walks = 6;
  b.walks = 5;
  a.party.push(rules.makeMon("abra"));
  b.party.push(rules.makeMon("onix"));
  const happiness = a.party[0].happiness;
  const rolls = [0, 0, 0, 99, 0, 0, 99];
  beginRound(r, () => rolls.shift());
  assert.deepEqual(r.cards.map(c => c.type), ["fatigue", "lazy", "lazy"]);
  const first = r.cards[0].id;
  assert.deepEqual(view(r,a).cards, view(r,b).cards);
  assert.throws(() => command(r, a, "move", {loc:"biome1"}));
  command(r, a, "card", {id:first});
  assert.throws(() => command(r, a, "card", {id:first}));
  command(r, a, "card", {id:r.cards[1].id});
  command(r, b, "card", {id:r.cards[2].id});
  assert.equal(a.actions,8);
  assert.equal(b.actions,10);
  assert.equal(a.party[0].status,"par");
  assert.equal(a.party[0].happiness, Math.max(0,happiness-10));
  assert.equal(r.phase,"actions");
  a.walks=6;
  b.battled=true;
  beginRound(r, () => 80);
  assert.equal(r.phase,"actions");
  assert.equal(a.actions,10);
});

function readRoundCards(room) {
  for (const card of room.cards) {
    const owner = room.players.find(p => p.id === card.owner);
    command(room, owner, "card", { id: card.id });
  }
}

test("new round cards use their own roll thresholds and respect eligibility", () => {
  const r = lobby(2), [a, b] = r.players;
  r.round = 2;
  b.party.push(rules.makeMon("abra"), rules.makeMon("onix"));
  b.battled = true;
  let rolls = [50, 20, 40, 20];
  beginRound(r, () => rolls.shift());
  assert.equal(rolls.length, 0);
  assert.equal(r.phase, "actions");

  b.battled = true;
  rolls = [49, 19, 39, 19];
  beginRound(r, () => rolls.shift());
  assert.deepEqual(r.cards.map(c => c.type), ["restart-kit", "dusk-expedition", "quiet-camp", "dusk-expedition"]);
  assert.equal(r.phase, "cards");
  assert.equal(a.items["poke-ball"] || 0, 0);
  assert.equal(b.quietCamp, undefined);
  readRoundCards(r);
  assert.equal(a.items["poke-ball"], 1);
  assert.equal(a.restartKitUsed, true);

  a.items["poke-ball"] = 0;
  b.battled = true;
  beginRound(r, () => 0);
  assert.ok(!r.cards.some(c => c.type === "restart-kit"));
  delete a.restartKitUsed;
  for (const block of [{ money: 100 }, { items: { "great-ball": 1 } }, { box: [rules.makeMon("abra")] }]) {
    Object.assign(a, { money: 0, items: {}, box: [] }, block);
    beginRound(r, () => 0);
    assert.ok(!r.cards.some(c => c.type === "restart-kit"));
  }
});

test("quiet camp tracks distinct party members and survives a saved room round trip", () => {
  const { serialize, deserialize } = require("node:v8");
  let r = lobby(2);
  let [a, b] = r.players;
  r.round = r.rounds = 2;
  const first = rules.makeMon("abra"), second = rules.makeMon("onix"), boxed = rules.makeMon("eevee");
  first.happiness = second.happiness = boxed.happiness = 100;
  a.party.push(first, second);
  a.box.push(boxed);
  a.battled = true;
  beginRound(r, () => 0);
  readRoundCards(r);
  for (const uid of [boxed.uid, first.uid, first.uid]) command(r, a, "pet", { uid });
  assert.deepEqual(view(r, a).you.quietCamp, { first: first.uid, complete: false });
  r = deserialize(serialize(r));
  [a, b] = r.players;
  command(r, a, "pet", { uid: second.uid });
  assert.equal(a.party[1].happiness, 135);
  assert.equal(a.actions, 6);
  assert.equal(a.petsGiven, 4);
  command(r, a, "pet", { uid: second.uid });
  assert.equal(a.party[1].happiness, 160);
  command(r, a, "finish");
  command(r, b, "finish");
  assert.equal(r.phase, "final");
  assert.equal(a.quietCamp, undefined);
  assert.equal(a.duskExpedition, undefined);
});

test("dusk expedition rewards only a completed dusk exploration and pays once", (t) => {
  const r = lobby(2), [a] = r.players;
  r.round = 2;
  a.money = 100;
  beginRound(r, () => 0);
  readRoundCards(r);
  a.loc = "biome1";
  for (const actions of [6, 3]) {
    a.actions = actions;
    command(r, a, "explore");
    command(r, a, "flee");
    assert.equal(a.duskExpedition.complete, false);
  }
  a.actions = 4;
  a.items["poke-ball"] = 1;
  const capture = t.mock.method(rules, "capture", () => false);
  command(r, a, "explore");
  command(r, a, "catch", { ball: "poke-ball" });
  assert.ok(a.enc);
  assert.equal(a.items["poke-ball"], 0);
  command(r, a, "flee");
  assert.equal(a.items["poke-ball"], 1);

  a.actions = 5;
  capture.mock.mockImplementation(() => true);
  command(r, a, "explore");
  command(r, a, "catch", { ball: "poke-ball" });
  assert.equal(a.items["poke-ball"], 0);
  assert.equal(a.duskExpedition.complete, true);
  assert.throws(() => command(r, a, "flee"));

  a.duskExpedition = { complete: false };
  a.actions = 5;
  a.items["poke-ball"] = 1;
  command(r, a, "explore");
  assert.deepEqual(command(r, a, "catch", { ball: "poke-ball" }), { caught: true });
  assert.equal(a.items["poke-ball"], 1);
  assert.equal(a.duskExpedition.complete, true);

  for (const winner of ["p1", "p2"]) {
    a.duskExpedition = { complete: false };
    a.enc = {
      type: "wild", period: "dusk", target: rules.makeMon("caterpie"),
      battle: { choose() {}, view: () => ({ ended: true, winner }) },
    };
    const before = a.items["poke-ball"];
    command(r, a, "fight", { cmd: "move 1" });
    assert.equal(a.items["poke-ball"], before + 1);
    for (let lesson; (lesson = view(r, a).you.moveLesson); )
      command(r, a, "resolveMove", { uid: lesson.uid, move: lesson.move, replace: null });
  }
});

test("Elite Four requires eight badges and takes place on the League island", () => {
  const r = lobby(2), p = r.players[0];
  command(r, p, "start", options);
  readTutorials(r);
  p.loc = "city3";
  p.badges = [1, 2, 3, 4, 5, 6, 7];
  p.party = [rules.createMon("pikachu", 85)];

  assert.throws(() => command(r, p, "move", { loc: "league1" }), /8 insígnias/);
  assert.equal(p.loc, "city3");
  assert.equal(p.actions, 10);

  p.badges.push(8);
  p.loc = "city8";
  assert.throws(() => command(r, p, "move", { loc: "league1" }), /Costa Serena/);
  assert.equal(p.loc, "city8");
  assert.equal(p.actions, 10);
  assert.throws(() => command(r, p, "gym"), /Ilha da Liga/);
  p.loc = "city3";
  command(r, p, "move", { loc: "league1" });
  assert.equal(p.loc, "league1");
  assert.equal(p.actions, 10);
  command(r, p, "gym");
  assert.equal(p.enc.type, "elite");
  assert.equal(p.enc.target.level, view(r, p).gyms[8].levels.at(-1));
});

test("a Pokémon can only escape after its trainer reads the unhappy card", () => {
  const r = lobby(2), [a, b] = r.players;
  command(r, a, "start", { ...options, rounds: 3 });
  readTutorials(r);
  const escaping = rules.makeMon("buneary");
  const recovering = rules.makeMon("pikachu");
  const satisfied = rules.makeMon("eevee");
  escaping.happiness = 0;
  recovering.happiness = 51;
  satisfied.happiness = 52;
  a.box.push(escaping);
  a.party.push(recovering, satisfied);
  a.dex.push(escaping.speciesId);

  function finishPhase(phase) {
    assert.equal(r.phase, phase);
    command(r, a, "finish");
    command(r, b, "finish");
  }

  finishPhase("actions");
  assert.equal(r.phase, "trocas");
  assert.deepEqual(r.cards, []);
  assert.deepEqual(a.box, [escaping]);
  assert.equal(recovering.happiness, 49);
  assert.equal(satisfied.happiness, 50);

  a.battled = true;
  for (const phase of ["trocas", "duelos"]) finishPhase(phase);
  assert.equal(r.round, 2);
  assert.equal(r.phase, "cards");
  assert.deepEqual(r.cards.filter(c => c.type === "unhappy").map(c => [c.type, c.target]), [
    ["unhappy", recovering.uid],
    ["unhappy", escaping.uid],
  ]);
  readRoundCards(r);
  assert.equal(satisfied.unhappyWarningOwner, undefined);

  for (let i = 0; i < 3; i++) command(r, a, "pet", { uid: recovering.uid });
  command(r, a, "pet", { uid: satisfied.uid });
  assert.deepEqual(view(r, a).players.map(p => [p.petsGiven, p.points.carentesco]), [
    [4, 4], [0, 0],
  ]);
  finishPhase("actions");
  assert.equal(r.phase, "trocas");
  assert.deepEqual(r.cards, []);
  assert.deepEqual(a.box, []);
  assert.ok(a.party.includes(recovering));
  assert.equal(recovering.unhappyWarningOwner, undefined);
  assert.ok(a.dex.includes(escaping.speciesId));

  a.battled = true;
  for (const phase of ["trocas", "duelos"]) finishPhase(phase);
  assert.equal(r.round, 3);
  assert.equal(r.phase, "cards");
  assert.deepEqual(r.cards.filter(c => c.type === "cruel-trainer" || c.type === "unhappy").map(c => [c.type, c.target]), [
    ["cruel-trainer", escaping.uid],
  ]);
  readRoundCards(r);
  assert.equal(r.phase, "actions");
});

test("capture command reports the roll independently of encounter state", () => {
  const r = lobby(2), p = r.players[0];
  command(r, p, "start", options);
  readTutorials(r);
  const wild = rules.makeMon("caterpie");
  wild.shiny = true;
  p.loc = "biome1";
  p.items["poke-ball"] = 1;
  p.items["ultra-ball"] = 1;
  const lead = rules.makeMon("squirtle", 10);
  const reserve = rules.makeMon("pidgey", 10);
  p.party = [lead, reserve];
  const originalXP = lead.xp + reserve.xp;
  const expectedXP = Math.floor(rules.battleXP(lead, wild, r.mult) / 2);
  const wildXP = wild.xp;

  p.enc = { type: "wild", wild };
  wild.hp = wild.maxhp;
  wild.status = "";
  const capture = rules.capture;
  try {
    rules.capture = () => false;
    assert.deepEqual(command(r, p, "catch", { ball: "poke-ball" }), { caught: false });
    assert.equal(p.enc.wild, wild);
    assert.equal(p.shinyCaught, 0);
    assert.equal(lead.xp + reserve.xp, originalXP);

    rules.capture = () => true;
    assert.deepEqual(command(r, p, "catch", { ball: "ultra-ball" }), { caught: true });
    assert.equal(p.enc, null);
    assert.ok(p.party.includes(wild));
    assert.equal(lead.xp + reserve.xp, originalXP + expectedXP);
    assert.equal(wild.xp, wildXP);
    assert.equal(view(r, p).players[0].shinyCaught, 1);
    assert.equal(view(r, p).players[0].points.shinys, 10);
  } finally {
    rules.capture = capture;
  }
});

test("Box remains usable after a player's actions end and during the trainer summary", () => {
  const r = lobby(2), [a, b] = r.players;
  command(r, a, "start", { ...options, rounds: 2 });
  readTutorials(r);
  const onlyMon = rules.makeMon("pikachu");
  a.party.push(onlyMon);
  command(r, a, "finish");
  assert.equal(a.done, true);
  command(r, a, "box", { uid: onlyMon.uid });
  assert.deepEqual(a.party, []);
  assert.deepEqual(view(r, b).players[0].box, [onlyMon]);
  command(r, b, "finish");
  assert.equal(r.phase, "trocas");
  command(r, a, "box", { uid: onlyMon.uid });
  assert.deepEqual(view(r, b).players[0].party, [onlyMon]);
});

test("shop checkout validates a mixed cart atomically and spends one action", () => {
  const r = lobby(2), [p] = r.players;
  command(r, p, "start", options);
  readTutorials(r);
  p.actions = 1;
  p.money = 199;
  p.items.potion = 2;
  command(r, p, "enterShop");
  assert.equal(p.actions, 1);

  const buy = { item: "poke-ball", qty: 2, sell: false };
  const sell = { item: "potion", qty: 1, sell: true };
  assert.throws(() => command(r, p, "shop", { lines: [buy, { ...sell, qty: 3 }] }), /Estoque/);
  assert.throws(() => command(r, p, "shop", { lines: [{ ...buy, qty: 99 }, sell] }), /Saldo/);
  assert.equal(p.actions, 1);
  assert.equal(p.money, 199);
  assert.deepEqual(p.items, { potion: 2 });

  command(r, p, "shop", { lines: [buy, sell] });
  assert.equal(p.actions, 0);
  assert.equal(p.done, true);
  assert.equal(p.shopVisit, null);
  assert.equal(p.money, 199 - 200 + Math.floor(view(r, p).shop.potion.price / 2));
  assert.deepEqual(p.items, { potion: 1, "poke-ball": 2 });
});

test("move lessons can be declined or replace a move before the turn ends", () => {
  const r = lobby(2), [p] = r.players;
  command(r, p, "start", options);
  readTutorials(r);
  const pikachu = rules.makeMon("pikachu", 10);
  const known = [...pikachu.moves];
  pikachu.pendingMoves = ["electro-ball", "feint"];
  pikachu.pp = { thundershock: 3, growl: 7 };
  p.party.push(pikachu);
  p.actions = 0;

  assert.equal(view(r, p).you.moveLesson.name, "Electro Ball");
  assert.throws(() => command(r, p, "finish"), /golpe/);
  assert.throws(() => command(r, p, "resolveMove", {
    uid: pikachu.uid, move: "feint", replace: known[0],
  }), /inválida/);
  command(r, p, "resolveMove", { uid: pikachu.uid, move: "electro-ball", replace: null });
  assert.deepEqual(pikachu.moves, known);
  assert.equal(p.done, false);
  command(r, p, "resolveMove", { uid: pikachu.uid, move: "feint", replace: known[0] });
  assert.deepEqual(pikachu.moves, ["feint", ...known.slice(1)]);
  assert.equal(pikachu.pp.thundershock, undefined);
  assert.equal(pikachu.pp.growl, 7);
  assert.equal(view(r, p).you.moveLesson, null);
  assert.equal(p.done, true);
});

test("bag items are free and direct evolution items can be bought and consumed", () => {
  const r = lobby(2), [p] = r.players;
  command(r, p, "start", options);
  readTutorials(r);
  const applin = rules.makeMon("applin", 20);
  const charcadet = rules.makeMon("charcadet", 20);
  const duraludon = rules.makeMon("duraludon", 20);
  p.party = [applin, charcadet, duraludon];
  for (const rule of require("../data/rules.json").evolution) {
    if (rule.trigger === "use-item" && rule.item)
      assert.equal(view(r, p).shop[rule.item].category, "evolution");
  }
  const cases = [
    ["tart-apple", applin, "Flapple"],
    ["auspicious-armor", charcadet, "Armarouge"],
    ["metal-alloy", duraludon, "Archaludon"],
  ];
  p.money = 3000;
  command(r, p, "enterShop");
  command(r, p, "shop", {lines: [...cases.map(([item]) => item), "potion", "oranberry"]
    .map(item => ({item, qty:1, sell:false}))});
  assert.equal(p.actions, 9);
  assert.throws(() => command(r, p, "item", {item:"tart-apple", uid:charcadet.uid}), /não evolui/);
  assert.equal(p.items["tart-apple"], 1);
  for (const [item, mon, name] of cases) {
    command(r, p, "item", {item, uid:mon.uid});
    assert.equal(mon.name, name);
    assert.equal(p.items[item], 0);
    assert.ok(p.dex.includes(mon.speciesId));
    for (let lesson; (lesson = view(r, p).you.moveLesson); )
      command(r, p, "resolveMove", {uid:lesson.uid, move:lesson.move, replace:null});
  }
  assert.throws(() => command(r, p, "item", {item:"potion", uid:applin.uid}), /ferido/);
  assert.equal(p.items.potion, 1);
  applin.hp = applin.maxhp - 25;
  command(r, p, "item", {item:"potion", uid:applin.uid});
  assert.equal(applin.hp, applin.maxhp - 5);
  assert.equal(p.items.potion, 0);
  command(r, p, "item", {item:"oranberry", uid:applin.uid});
  assert.equal(applin.heldItem, "oranberry");
  assert.equal(p.actions, 9);
});

test("stone and trade evolutions record the before and after sprites for the owner", () => {
  const r = lobby(2), [a, b] = r.players;
  command(r, a, "start", { ...options, rounds: 2 });
  readTutorials(r);
  const pikachu = rules.makeMon("pikachu", 8);
  const kadabra = rules.makeMon("kadabra", 20);
  a.party.push(pikachu, kadabra);
  a.items["thunder-stone"] = 1;
  command(r, a, "item", { item: "thunder-stone", uid: pikachu.uid });
  let state = view(r, a);
  assert.deepEqual(state.you.evolutions.map(({ before, after }) => [before.slug, after.slug]), [
    ["pikachu", "raichu"],
  ]);
  assert.notEqual(state.you.evolutions[0].before.pokemonId, state.you.evolutions[0].after.pokemonId);
  assert.equal(view(r, b).you.evolutions, undefined);
  while (view(r, a).you.moveLesson) {
    const { uid, move } = view(r, a).you.moveLesson;
    command(r, a, "resolveMove", { uid, move, replace: null });
  }

  for (const phase of ["actions"]) {
    assert.equal(r.phase, phase);
    command(r, a, "finish");
    command(r, b, "finish");
  }
  b.money = 1;
  command(r, a, "offer", {
    to: b.id, give: { kind: "mon", id: kadabra.uid }, want: { kind: "money", qty: 1 },
  });
  command(r, b, "accept", { id: r.offers[0].id });
  state = view(r, b);
  assert.deepEqual(state.you.evolutions.map(({ before, after }) => [before.slug, after.slug]), [
    ["kadabra", "alakazam"],
  ]);
  assert.equal(view(r, a).you.evolutions.length, 1);
});

test("auction shares the lot, validates each bid and charges the winner once", () => {
  const { startMinigame, advanceAuction } = require("../game.cjs");
  const r = lobby(4);
  const [a, b, c, d] = r.players;
  a.money = b.money = 200;
  startMinigame(r, "auction");
  for (const p of r.players) command(r, p, "miniReady");
  assert.equal(view(r, a).auction.pokemon.uid, view(r, b).auction.pokemon.uid);
  const bid = (p, amount, lot = 0) => command(r, p, "bid", {amount, lot});
  const pass = p => command(r, p, "auctionPass", {lot:0});
  bid(a, 70);
  assert.throws(() => bid(b, 70));
  assert.throws(() => bid(b, 201));
  assert.throws(() => bid(b, 75.5));
  r.auction.deadline = Date.now() + 1000;
  bid(b, 90);
  assert.ok(r.auction.deadline > Date.now() + 19000);
  pass(a);
  pass(c);
  assert.throws(() => bid(c, 91));
  assert.equal(b.money, 200);
  pass(d);
  assert.equal(b.money, 110);
  assert.equal(a.money, 200);
  assert.equal(b.party[0].uid, r.auction.lots[0].uid);
  assert.ok(b.dex.includes(b.party[0].speciesId));
  assert.throws(() => pass(d));
  advanceAuction(r, r.auction.nextAt);
  assert.throws(() => bid(a, 10), /lote/);
  assert.throws(() => bid(b, 10, 1), /já comprou/);
  while (!view(r, a).auction.closed) advanceAuction(r, r.auction.deadline ?? r.auction.nextAt);
  assert.equal(r.auction.results.length, 4);
  assert.equal(new Set(r.auction.results.map(result => result.winner)).size, 4);
  assert.ok(r.players.every(p => p.party.length === 1));
  for (const p of r.players) command(r, p, "auctionContinue");
  assert.equal(r.phase, "duelos");
  assert.equal(view(r,b).pairs.flat().length, 4);
  assert.equal(b.party.length, 1);
  assert.deepEqual(view(r, b).players.map(p => p.points.minigames), [0, 5, 0, 0]);
});

test("the market and dark auction support rooms with zero balance or bids", () => {
  const { startMinigame, advanceAuction } = require("../game.cjs");
  const r = lobby(2);
  const [a,b] = r.players;
  startMinigame(r, "market");
  assert.throws(() => command(r, a, "quiz", {answer:0}));
  for (const p of r.players) command(r, p, "miniReady");
  assert.equal(view(r,a).minigame, "market");
  command(r, a, "quiz", {answer:a.quiz.a * a.quiz.b});
  command(r, b, "quiz", {answer:0});
  assert.equal(a.money, 180);
  assert.equal(b.money, 0);
  startMinigame(r, "darkAuction");
  for (const p of r.players) command(r, p, "miniReady");
  assert.equal(view(r,a).auction.hidden, true);
  assert.equal(view(r,a).auction.pokemon.name, undefined);
  command(r,a,"auctionPass",{lot:0});
  command(r,b,"auctionPass",{lot:0});
  assert.equal(view(r,a).auction.hidden, false);
  assert.ok(view(r,a).auction.pokemon.name);
  advanceAuction(r, r.auction.nextAt);
  advanceAuction(r, r.auction.nextAt);
  assert.equal(view(r,a).auction.closed, true);
  assert.equal(r.auction.results.find(result => result.winner === b.id).amount, 0);
  assert.equal(a.party.length + b.party.length, 2);
  assert.deepEqual(view(r, a).players.map(p => p.points.minigames), [5, 0]);
});

test("auction lots scale with the room and unlock legendary and mythical Pokémon above 50", () => {
  const rules = require("../rules.cjs");
  const low = rules.auctionPokemon(50, () => 0);
  const high = rules.auctionPokemon(51, () => 0);
  assert.equal(low.level, 48);
  assert.equal(high.level, 49);
  assert.equal(Boolean(rules.info(low).rare), false);
  assert.equal(Boolean(rules.info(high).rare), true);
  assert.equal(high.shiny, true);
  const rolls = [2, 0, 10];
  assert.equal(rules.auctionPokemon(20, () => rolls.shift()).shiny, false);
});

test("Pokémon quiz shares five distinct silhouettes and pays the top three", () => {
  const { startMinigame } = require("../game.cjs");
  const r = lobby(4);
  startMinigame(r, "pokemonQuiz");
  const quiz = r.million;
  assert.equal(new Set(quiz.questions.map(q => q.silhouette.pokemonId)).size, 5);
  for (const p of r.players) command(r, p, "miniReady");
  const initial = view(r, r.players[0]).million;
  assert.deepEqual(initial.question, view(r, r.players[1]).million.question);
  assert.equal(initial.question.answer, undefined);
  assert.equal(initial.question.silhouette.spots.length, 4);
  assert.equal(initial.question.choices.length, 24);
  assert.throws(() => command(r, r.players[0], "millionAnswer", {index:0, choice:24}));
  assert.equal(initial.review, null);
  for (const [rank, p] of r.players.entries()) {
    for (const [index, question] of quiz.questions.entries()) {
      assert.equal(new Set(question.choices).size, 24);
      const choice = index < 5 - rank ? question.answer : (question.answer + 1) % 24;
      command(r, p, "millionAnswer", {index, choice});
    }
  }
  const finished = view(r, r.players[0]).million;
  assert.deepEqual(finished.results.map(result => [result.score, result.prize]),
    [[5, 500], [4, 300], [3, 200], [2, 0]]);
  assert.equal(finished.review[0].correct, quiz.questions[0].choices[quiz.questions[0].answer]);
  for (const p of r.players) command(r, p, "millionContinue");
  assert.equal(r.phase, "duelos");
});

test("million quiz hides answers, rejects repeated submissions and pays the top three once", () => {
  const { startMinigame } = require("../game.cjs");
  const { advanceMillion } = require("../million.cjs");
  const r = lobby(4);
  startMinigame(r, "million");
  const quiz = r.million;
  assert.equal(new Set(quiz.questions.map(q => q.prompt)).size, 5);
  assert.equal(view(r, r.players[0]).million.question, null);
  for (const p of r.players) command(r, p, "miniReady");
  const initial = view(r, r.players[0]).million;
  assert.equal(initial.question.choices.length, 4);
  assert.throws(() => command(r, r.players[0], "millionAnswer", {index:0, choice:4}));
  assert.equal(initial.question.answer, undefined);
  assert.equal(initial.review, null);
  const scores = [2, 5, 4, 0];
  const balances = r.players.map(p => p.money);
  for (const [place, p] of r.players.entries()) {
    for (const [index, q] of quiz.questions.entries()) {
      const choice = index < scores[place] ? q.answer : (q.answer + 1) % 4;
      command(r, p, "millionAnswer", {index, choice});
      assert.throws(() => command(r, p, "millionAnswer", {index, choice}));
    }
  }
  assert.deepEqual(quiz.results.map(({score, prize}) => [score, prize]),
    [[5, 500], [4, 300], [2, 200], [0, 0]]);
  assert.equal(advanceMillion(r, quiz.deadline), false);
  assert.deepEqual(r.players.map((p, i) => p.money - balances[i]), [200, 500, 300, 0]);
  assert.deepEqual(view(r, r.players[0]).players.map(p => p.points.minigames), [0, 5, 0, 0]);
  assert.equal(view(r, r.players[0]).million.review.length, 5);
  assert.deepEqual(view(r, r.players[0]).million.results.map(result => result.checks), [
    [true, true, true, true, true], [true, true, true, true, false],
    [true, true, false, false, false], [false, false, false, false, false],
  ]);
  for (const p of r.players) command(r, p, "millionContinue");
  assert.equal(r.phase, "duelos");
});

test("million quiz scores partial answers at the deadline and ranks faster finishers first", () => {
  const { startMinigame } = require("../game.cjs");
  const { advanceMillion, recordAnswer } = require("../million.cjs");
  const r = lobby(4);
  const [a, b, c, d] = r.players;
  startMinigame(r, "million");
  for (const p of r.players) command(r, p, "miniReady");
  const quiz = r.million;
  for (const [index, q] of quiz.questions.entries()) {
    recordAnswer(quiz, quiz.entries[a.id], q.answer, quiz.deadline - 100);
    recordAnswer(quiz, quiz.entries[b.id], q.answer, quiz.deadline - 200);
    if (index === 0) recordAnswer(quiz, quiz.entries[c.id], q.answer, quiz.deadline - 300);
  }
  assert.equal(advanceMillion(r, quiz.deadline - 1), false);
  assert.equal(advanceMillion(r, quiz.deadline), true);
  assert.deepEqual(quiz.results.map(({id, score}) => [id, score]), [[b.id, 5], [a.id, 5], [c.id, 1], [d.id, 0]]);
});

test("survival race waits for readiness and resolves shared obstacles in server time", () => {
  const { startMinigame, advanceRace } = require("../game.cjs");
  const r = lobby(2);
  const [a, b] = r.players;
  startMinigame(r, "race");
  command(r, a, "miniReady");
  assert.equal(r.race, undefined);
  command(r, a, "miniReady");
  assert.equal(r.miniReady.length, 1);
  command(r, b, "miniReady");
  assert.ok(r.race.startsAt > Date.now());
  assert.throws(() => command(r, a, "dodge", {pose:"jump"}));
  const race = r.race;
  const obstacle = race.obstacles[0];
  race.startsAt = Date.now() - obstacle.at + 50;
  command(r, a, "dodge", {pose:obstacle.type});
  command(r, b, "dodge", {pose:obstacle.type === "jump" ? "duck" : "jump"});
  assert.equal(advanceRace(r, race.startsAt + obstacle.at + 190), true);
  assert.deepEqual(race.winners, [a.id]);
  assert.equal(race.runners[b.id].alive, false);
  assert.ok(race.obstacles[3].at - race.obstacles[2].at < race.obstacles[1].at - obstacle.at);
  for (const p of r.players) command(r, p, "raceContinue");
  assert.equal(r.phase, "duelos");
});

test("survival race narrows the dodge window and ends even if everyone survives", () => {
  const { startMinigame, advanceRace } = require("../game.cjs");
  const r = lobby(2);
  startMinigame(r, "race");
  for (const p of r.players) command(r, p, "miniReady");
  const race = r.race;
  const first = race.obstacles[0];
  const last = race.obstacles.at(-1);
  assert.ok(last.earlyMs + last.lateMs < (first.earlyMs + first.lateMs) / 2);
  assert.ok(last.at - race.obstacles.at(-2).at <= 500);
  assert.ok(last.at + last.lateMs < 45000);

  for (const [index, obstacle] of race.obstacles.entries()) {
    const impact = race.startsAt + obstacle.at + obstacle.lateMs;
    assert.equal(advanceRace(r, impact - 1), false);
    for (const p of r.players) race.runners[p.id].cleared = index;
    assert.equal(advanceRace(r, impact), true);
  }
  assert.deepEqual(race.winners, r.players.map(p => p.id));
  assert.equal(race.endedAt, race.startsAt + last.at + last.lateMs);
  assert.deepEqual(view(r, r.players[0]).players.map(p => p.points.minigames), [5, 5]);
});

test("the practice rival submits visible dodges and is eliminated if it stops dodging", () => {
  const { startMinigame, advanceRace } = require("../game.cjs");
  const r = lobby(2);
  const [human, bot] = r.players;
  r.practiceBot = bot.id;
  startMinigame(r, "race");
  for (const p of r.players) command(r, p, "miniReady");
  const race = r.race;
  for (const [index, obstacle] of race.obstacles.slice(0, 5).entries()) {
    const crossing = race.startsAt + obstacle.at;
    advanceRace(r, crossing - 140);
    if (index < 4) {
      const rival = view(r, human).race.runners[bot.id];
      assert.equal(rival.pose, obstacle.type);
      assert.equal(rival.poseAt, crossing - 140);
      assert.equal(rival.cleared, index);
    }
    race.runners[human.id].cleared = index;
    advanceRace(r, crossing + 190);
  }
  assert.equal(race.runners[bot.id].alive, false);
  assert.deepEqual(race.winners, [human.id]);
});

test("wild victories award shared XP without money and preserve fainted HP", () => {
  const r = lobby(2), [p] = r.players;
  command(r, p, "start", options);
  readTutorials(r);

  const lead = rules.makeMon("bulbasaur", 5);
  const reserve = rules.makeMon("squirtle", 5);
  const fainted = rules.makeMon("charmander", 5);
  const capped = rules.makeMon("caterpie", 100);
  const stored = rules.makeMon("pidgey", 5);
  fainted.hp = 0;
  p.party = [lead, reserve, fainted, capped];
  p.box = [stored];
  const target = rules.makeMon("rattata", 5);
  const expected = rules.battleXP(lead, target, r.mult);
  const previous = [...p.party, stored].map(mon => mon.xp);
  const balance = p.money;
  p.enc = {
    type: "wild", target,
    battle: { choose() {}, view: () => ({ended: true, winner: "p1", own: {uid: lead.uid}}) },
  };
  command(r, p, "fight", {cmd: "move 1"});

  const awarded = [...p.party, stored].map((mon, index) => mon.xp - previous[index]);
  assert.equal(p.money, balance);
  assert.deepEqual(awarded, [0, 1, 2].map(index =>
    Math.floor(expected / 3) + (index < expected % 3 ? 1 : 0)
  ).concat(0, 0));
  assert.equal(fainted.hp, 0);
});

test("last expedition round goes straight to the final even with minigames enabled", () => {
  const r = lobby(2), [a, b] = r.players;
  command(r, a, "start", { ...options, mini: true });
  readTutorials(r);
  command(r, a, "finish");
  assert.equal(r.phase, "actions");
  command(r, b, "finish");
  assert.equal(r.phase, "final");
  assert.deepEqual(r.duels, []);
  assert.equal(r.minigame, undefined);
});

test("gym rosters grow by pairs and every Elite Four challenge uses six Pokémon", () => {
  const r = lobby(2), [p] = r.players;
  command(r, p, "start", options);
  readTutorials(r);
  p.party = [rules.makeMon("pikachu", 95)];
  const sizes = [2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6, 6];
  const gyms = view(r, p).gyms;
  assert.deepEqual(gyms.map(({ team }) => team.length), sizes);
  assert.equal(new Set(gyms.map(({ name }) => name)).size, sizes.length);

  for (let index = 0; index < sizes.length; index++) {
    p.loc = index < 8 ? "city" + (index + 1) : "league1";
    p.badges = Array.from({ length: Math.min(index, 8) }, (_, n) => n + 1);
    p.eliteRun = index > 8 ? index - 8 : undefined;
    p.enc = null;
    p.actions = 2;
    if (index === 9) {
      p.party[0].hp = 1;
      p.items.potion = 1;
      command(r, p, "item", { item: "potion", uid: p.party[0].uid });
      assert.equal(p.party[0].hp, 21);
      assert.equal(p.actions, 2);
    }
    command(r, p, "gym");
    assert.equal(p.enc.battle.engine.getSide("p2").pokemon.length, sizes[index]);
    const levels = gyms[index].levels;
    const base = Math.min(90, (index + 1) * 10);
    assert.ok(levels.every(level => level >= base - 3 && level <= base + 2));
    assert.deepEqual(p.enc.battle.engine.getSide("p2").pokemon.map(mon => mon.level), levels);
    assert.deepEqual(view(r, p).gyms[index].levels, levels);
  }
});

test("Elite Four costs one action and pays only after four consecutive victories", () => {
  const r = lobby(2), [p] = r.players;
  command(r, p, "start", options);
  readTutorials(r);
  p.loc = "league1";
  p.badges = [1, 2, 3, 4, 5, 6, 7, 8];
  const mon = rules.makeMon("dragonite", 100);
  p.party = [mon];
  p.actions = 1;
  p.items.potion = 1;

  for (const ace of ["gardevoir", "absol", "metagross", "garchomp"]) {
    command(r, p, "gym");
    assert.equal(p.enc.target.slug, ace);
    assert.equal(p.actions, 0);
    p.enc.battle.choose = () => {};
    p.enc.battle.view = () => ({ ended: true, winner: "p1" });
    command(r, p, "fight", { cmd: "move 1" });
    if (ace !== "garchomp") {
      assert.equal(view(r, p).players[0].points.liga, 80);
      assert.equal(p.money, 0);
      assert.equal(p.done, false);
      assert.throws(() => command(r, p, "finish"), /sequência/);
    }
    if (ace === "gardevoir") {
      mon.hp = 1;
      command(r, p, "item", { item: "potion", uid: mon.uid });
      assert.equal(mon.hp, 21);
      assert.equal(p.actions, 0);
    }
  }
  assert.equal(p.done, true);
  assert.equal(p.eliteRun, undefined);
  assert.equal(view(r, p).players[0].points.liga, 120);
  assert.equal(p.money, 1400);
});

test("laboratory charges once and applies IVs, EVs, nature and legal ability to battle stats", () => {
  const r = lobby(2), [p] = r.players;
  command(r, p, "start", options);
  readTutorials(r);
  const { BattleSession } = require("../battle.cjs");
  const pokemon = rules.makeMon("pikachu", 50);
  pokemon.happiness = 155;
  p.party = [pokemon];
  p.money = 1500;
  const ivs = Object.fromEntries(Object.keys(pokemon.ivs).map(stat => [stat, 31]));
  const evs = { hp: 6, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 };
  const change = { uid: pokemon.uid, nature: "Adamant", abilitySlot: "H", ivs, evs };
  p.loc = "city2";
  assert.throws(() => command(r, p, "modifyPokemon", change), /laboratório/);
  p.loc = "village3";
  assert.throws(() => command(r, p, "modifyPokemon", { ...change, evs: {...evs, def: 1} }), /510/);
  assert.throws(() => command(r, p, "modifyPokemon", { ...change, abilitySlot: "1" }), /Habilidade/);
  assert.equal(p.money, 1500);
  assert.equal(p.actions, 10);
  assert.equal(pokemon.happiness, 155);

  command(r, p, "modifyPokemon", change);
  assert.equal(p.money, 0);
  assert.equal(p.actions, 9);
  assert.equal(pokemon.happiness, 55);
  assert.deepEqual(pokemon.ivs, ivs);
  assert.deepEqual(pokemon.evs, evs);
  assert.equal(pokemon.nature, "Adamant");
  assert.equal(pokemon.ability, "Lightning Rod");

  const battle = new BattleSession({p1: [pokemon], p2: [rules.makeMon("caterpie", 50)]});
  const fighter = battle.engine.p1.pokemon[0];
  const { hp, ...otherStats } = pokemon.stats;
  assert.deepEqual(fighter.storedStats, otherStats);
  assert.equal(fighter.maxhp, hp);
  assert.equal(fighter.ability, "lightningrod");
});

test("only the three selected villages offer laboratories", () => {
  const r = lobby(2), [p] = r.players;
  for (const id of ["village3", "village4", "village6"]) {
    p.loc = id;
    assert.equal(view(r, p).laboratory.cost, 1500);
    assert.equal(view(r, p).laboratory.happinessLoss, 100);
  }
  for (const id of ["city1", "city5", "city7", "biome4", "league1", "village1", "village2", "village5"]) {
    p.loc = id;
    assert.equal(view(r, p).laboratory, null);
  }
});

test("Monte Azul connects to the League island in both directions", () => {
  const r = lobby(2), [p] = r.players;
  command(r, p, "start", options);
  readTutorials(r);
  p.loc = "city4";
  assert.throws(() => command(r, p, "move", { loc: "league1" }), /8 insígnias/);
  p.badges = [1, 2, 3, 4, 5, 6, 7, 8];
  command(r, p, "move", { loc: "league1" });
  assert.equal(p.loc, "league1");
  command(r, p, "move", { loc: "city4" });
  assert.equal(p.loc, "city4");
  assert.equal(p.actions, 10);
});

test("duel roulette offers only formats supported by every party and room size", () => {
  const { eligibleDuelFormats } = require("../game.cjs");
  const formats = sizes => eligibleDuelFormats(sizes.map(size => ({party:Array(size)}))).map(f=>f.id);
  assert.deepEqual(formats([1, 4]), ["solo1"]);
  assert.deepEqual(formats([3, 3]), ["solo1","solo3"]);
  assert.deepEqual(formats([4, 4]), ["solo1","solo3","dual4"]);
  assert.deepEqual(formats([2, 2, 2, 2]), ["solo1","multi4"]);
  assert.deepEqual(formats(Array(6).fill(4)), ["solo1","solo3","dual4"]);
  assert.ok(formats(Array(12).fill(2)).includes("multi4"));
  assert.deepEqual(formats([0,4]), []);
});

test("duel selection locks valid ordered party picks until every trainer confirms", () => {
  const r = lobby(2), [a,b] = r.players;
  r.rounds = 2;
  r.phase = "trocas";
  r.mini = false;
  a.party = [rules.makeMon("bulbasaur"),rules.makeMon("squirtle", 10)];
  b.party = [rules.makeMon("charmander"),rules.makeMon("pikachu", 80)];
  const starter = a.party[1];
  Object.assign(starter, {nature:"Modest", evs:{spa:252}, hp:1, status:"par", pp:{tackle:0}});
  const parties = structuredClone([a.party, b.party]);
  a.box = [rules.makeMon("pidgey")];
  for(const p of r.players) command(r,p,"finish");
  assert.equal(r.phase,"duelos");
  assert.equal(view(r,a).duel.selection.size,1);
  assert.equal(view(r,a).duel.selection.level,50);
  assert.throws(() => command(r,a,"fight",{cmd:"move 1"}));
  assert.throws(() => command(r,a,"duelTeam",{uids:[a.box[0].uid]}));
  assert.throws(() => command(r,a,"duelTeam",{uids:a.party.map(m=>m.uid)}));
  command(r,a,"duelTeam",{uids:[a.party[0].uid]});
  assert.equal(view(r,b).duel.selection.trainers.find(t=>t.id===a.id).ready,true);
  assert.equal(view(r,b).duel.selection.picked,null);
  assert.equal(view(r,b).duel.battle,undefined);
  command(r,a,"duelEdit");
  assert.equal(view(r,a).duel.selection.picked,null);
  command(r,a,"duelTeam",{uids:[a.party[1].uid]});
  command(r,b,"duelTeam",{uids:[b.party[1].uid]});
  assert.equal(view(r,a).duel.selection,null);
  assert.equal(view(r,a).duel.battle.own.uid,a.party[1].uid);
  assert.equal(view(r,b).duel.battle.own.uid,b.party[1].uid);
  const duel = view(r,a).duel.battle;
  assert.deepEqual([duel.own.level, duel.foe.level], [50, 50]);
  assert.equal(duel.own.hp, duel.own.maxhp);
  assert.equal(duel.own.status, "");
  const battle = r.duels[0].battle;
  const side = battle.engine.sides.find(s => battle.roster.get(s.active[0]).uid === starter.uid);
  const expectedSpA = Math.floor((Math.floor((100 + starter.ivs.spa + 63) / 2) + 5) * 1.1);
  assert.equal(side.active[0].storedStats.spa, expectedSpA);
  command(r, a, "duelForfeit");
  assert.deepEqual([a.party,b.party], parties);
});

test("both double formats normalize every selected Pokémon, including reserves", () => {
  for (const [count, mode] of [[2,"doubles"], [4,"multi"]]) {
    const r = lobby(count);
    for (const p of r.players) p.party = [10, 80, 30, 70].map(level => rules.makeMon("pikachu", level));
    const selected = require("../game.cjs").eligibleDuelFormats(r.players).find(format => format.mode === mode);
    const [a,b] = r.players;
    r.phase = "duelos";
    r.duelFormat = {selected};
    r.duels = [{a:a.id,b:b.id,trainers:r.players.map(p => p.id),picks:{},result:null}];
    for (const p of r.players) command(r, p, "duelTeam", {uids:p.party.slice(0,selected.size).map(m => m.uid)});
    const battle = r.duels[0].battle;
    assert.ok(battle.engine.sides.every(side => side.pokemon.every(mon => mon.level === 50)));
    for (const p of r.players) assert.deepEqual(p.party.map(mon => mon.level), [10,80,30,70]);
  }
});

test("actions define each player's period and an encounter keeps its starting period", () => {
  const {actionPeriod}=require("../public/world.js");
  assert.deepEqual([10,6,5,4,3,0].map(actionPeriod),["day","day","dusk","dusk","night","night"]);
  const r=lobby(2), [a,b]=r.players;
  command(r,a,"start",options);
  readTutorials(r);
  a.loc="biome1";a.actions=4;
  command(r,a,"explore");
  assert.equal(view(r,a).you.period,"night");
  assert.equal(view(r,a).you.enc.period,"dusk");
  assert.equal(view(r,a).you.enc.startedActions,4);
  assert.equal(view(r,b).you.period,"day");
});

test("research jobs are hired and worked at the same laboratory", () => {
  const r = lobby(2), [p] = r.players;
  command(r, p, "start", options);
  readTutorials(r);
  p.party = [rules.makeMon("abra", 22)];
  assert.throws(() => command(r, p, "hire", {job:"assistente-pesquisa"}));
  p.loc = "village3";
  command(r, p, "hire", {job:"assistente-pesquisa"});
  command(r, p, "work");
  assert.equal(p.money, 150);
  p.loc = "village4";
  assert.throws(() => command(r, p, "work"));
});
