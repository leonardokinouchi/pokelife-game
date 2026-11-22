const assert = require("node:assert/strict");
const test = require("node:test");
const { player, newRoom, startMinigame, command, view } = require("../game.cjs");
const { answerAlphabet, advanceAlphabet } = require("../alphabet.cjs");

test("ABC starts with a countdown, circles the ten letters and eliminates players on timeouts", () => {
  const players = ["Ana", "Bia", "Caio", "Davi"].map(name => player(name));
  const room = newRoom("TEST3", players[0]);
  room.players = players;
  startMinigame(room, "alphabet");
  for (const p of players) command(room, p, "miniReady");
  const game = room.alphabet;
  const current = () => players.find(p => p.id === game.order[game.index]);
  const state = () => view(room, players[0]).alphabet;
  const reply = (name, now = game.deadline - 1000) =>
    answerAlphabet(room, current(), {name, turn:game.turn}, now);
  assert.ok(game.startsAt > Date.now());
  assert.deepEqual(state().letters, ["A","B","C","D","F","G","M","P","S","T"]);
  assert.throws(() => reply("Abra", game.startsAt - 1), /vez/);
  assert.throws(() => reply("Pikachu"), /começa com A/);
  const startIndex = game.index;
  for (const [i, name] of ["Abra","Bulbasaur","Charmander","Ditto","Flareon","Gastly","Meowth","Pikachu","Squirtle","Tauros"].entries()) {
    assert.equal(game.index, (startIndex + i) % players.length);
    reply(name);
  }
  assert.equal(state().letter, "A");
  assert.throws(() => reply("abra"), /já foi usado/);
  const late = current().id;
  assert.equal(advanceAlphabet(room, game.deadline), true);
  assert.deepEqual(game.eliminated, [late]);
  assert.equal(state().letter, "A");
  assert.notEqual(current().id, late);
  advanceAlphabet(room, game.deadline + 12000);
  assert.equal(game.winners.length, 1);
  const winner = players.find(p => p.id === game.winners[0]);
  assert.equal(winner.minigameWins, 1);
  assert.equal(advanceAlphabet(room, game.deadline + 24000), false);
  for (const p of players) command(room, p, "alphabetContinue");
  assert.equal(room.phase, "duelos");
});
