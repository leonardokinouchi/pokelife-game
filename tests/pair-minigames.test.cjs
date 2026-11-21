const assert = require("node:assert/strict");
const test = require("node:test");
const { player, newRoom, view, command, startMinigame, eligibleMinigames } = require("../game.cjs");
const { advancePairGame, pairAction } = require("../pair-minigames.cjs");

function play(kind, count = 4) {
  const players = Array.from({length:count}, (_, i) => player("Treinador " + (i + 1)));
  const room = newRoom("TEST1", players[0]);
  room.players = players;
  startMinigame(room, () => eligibleMinigames(count).indexOf(kind));
  for (const p of players) command(room, p, "miniReady");
  return room;
}

test("pair minigames are only eligible for compatible player counts", () => {
  for (const count of [0, 1, 3, 5]) assert.ok(!eligibleMinigames(count).includes("wires") && !eligibleMinigames(count).includes("guess"));
  for (const count of [2, 4, 6, 8, 10, 12]) assert.ok(["wires", "guess"].every(kind => eligibleMinigames(count).includes(kind)));
});

test("wires separate the roles and enforce order, timing, progress and timeout", () => {
  const room = play("wires", 6);
  const [winning, shocked, idle] = room.pairGame.teams;
  const get = id => room.players.find(p => p.id === id);
  const guide = get(winning.guide);
  const actor = get(winning.actor);
  const { deadline } = room.pairGame;
  assert.equal(view(room, guide).pairGame.wires, undefined);
  assert.equal(view(room, actor).pairGame.instructions, undefined);
  assert.equal(new Set(winning.wires.map(w => w.thickness)).size, 3);
  assert.throws(() => pairAction(room, actor, "pairRelay", {index:0}, deadline - 59000));
  assert.throws(() => pairAction(room, guide, "pairCut", {index:0, wire:0}, deadline - 59000));
  pairAction(room, guide, "pairRelay", {index:0}, deadline - 59000);
  assert.equal(view(room, actor).pairGame.messages.length, 1);
  assert.equal(view(room, get(idle.actor)).pairGame.messages.length, 0);
  const [first, timed] = shocked.instructions;
  pairAction(room, get(shocked.actor), "pairCut", {index:0, wire:first.wire}, deadline - 58000);
  pairAction(room, get(shocked.actor), "pairCut", {index:1, wire:timed.wire}, deadline - 50000);
  assert.equal(shocked.status, "shock");
  const window = winning.instructions[1];
  for (const [index, step] of winning.instructions.entries()) {
    const seconds = index === 0 ? 58 : window.max - index;
    pairAction(room, actor, "pairCut", {index, wire:step.wire}, deadline - seconds * 1000);
  }
  assert.equal(winning.status, "won");
  assert.equal(room.pairGame.finished, false);
  assert.equal(advancePairGame(room, deadline), true);
  assert.equal(advancePairGame(room, deadline + 1), false);
  assert.equal(idle.status, "timeout");
  assert.equal(actor.minigameWins, 1);
  assert.equal(guide.minigameWins, 1);
});

test("Adivinha only releases collected clues to the partner and ends on the first correct guess", () => {
  const room = play("guess");
  const [team, other] = room.pairGame.teams;
  const playerById = id => room.players.find(p => p.id === id);
  const guide = playerById(team.guide);
  const actor = playerById(team.actor);
  const now = room.pairGame.deadline - 53000;
  assert.deepEqual(view(room, guide).pairGame.hints, []);
  assert.equal(view(room, actor).pairGame.hints, undefined);
  assert.equal(view(room, actor).pairGame.pokemon, undefined);
  assert.throws(() => pairAction(room, guide, "pairRelay", {index:0}, now));
  const paper = team.paper;
  pairAction(room, guide, "pairCatch", {paper}, now);
  assert.throws(() => pairAction(room, guide, "pairCatch", {paper}, now));
  pairAction(room, guide, "pairRelay", {index:0}, now);
  assert.equal(view(room, actor).pairGame.messages[0].text, team.hints[0]);
  assert.equal(view(room, playerById(other.actor)).pairGame.messages.length, 0);
  pairAction(room, actor, "pairGuess", {name:"errado"}, now);
  assert.equal(room.pairGame.finished, false);
  pairAction(room, actor, "pairGuess", {name:" " + team.answer.toUpperCase() + " "}, now + 400);
  assert.equal(team.status, "won");
  assert.equal(other.status, "lost");
  assert.equal(view(room, actor).pairGame.pokemon.name, team.answer);
  assert.throws(() => pairAction(room, playerById(other.actor), "pairGuess", {name:other.answer}, now + 800));
});
