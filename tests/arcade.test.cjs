const assert = require("node:assert/strict");
const test = require("node:test");
const {player, newRoom, command, view, startMinigame, minigames} = require("../game.cjs");
const {advanceArcade, arcadeAction} = require("../arcade.cjs");

function play(kind) {
  const players = [player("Ana"), player("Bia")];
  const room = newRoom("TEST1", players[0]);
  room.players = players;
  startMinigame(room, () => minigames.indexOf(kind));
  assert.equal(room.arcade.start, null);
  for (const p of players) command(room, p, "miniReady");
  return {room, game:room.arcade, players};
}

test("magnetic arena validates movement and ranks the last survivor", () => {
  const {room,game,players:[a,b]} = play("magnetic");
  assert.equal(game.deadline - game.start, 50000);
  arcadeAction(room,a,"arcadeMove",{direction:"right"},game.start + 100);
  assert.equal(game.players[a.id].cell,13);
  assert.throws(() => arcadeAction(room,a,"arcadeMove",{direction:"diagonal"},game.start + 180));
  const event = game.events[0];
  event.danger = [game.players[b.id].cell];
  advanceArcade(room,game.start + event.at);
  assert.deepEqual(game.results.map(row => [row.id,row.won]), [[a.id,true],[b.id,false]]);
});

for (const [kind,duration] of [["rhythm",46000],["sorter",45000]]) {
  test(kind + " scores timed responses, resets combos on misses and ends on time", () => {
    const {room,game,players:[a,b]} = play(kind);
    assert.equal(game.deadline - game.start,duration);
    for (const [index,event] of game.events.slice(0,3).entries()) {
      advanceArcade(room,game.start + event.at);
      arcadeAction(room,a,"arcadeTap",{lane:index === 2 ? (event.lane + 1) % 3 : event.lane},game.start + event.at);
    }
    assert.equal(game.players[a.id].score,21);
    assert.equal(game.players[a.id].combo,0);
    advanceArcade(room,game.deadline);
    assert.deepEqual(game.results.map(row => [row.id,row.won]), [[a.id,true],[b.id,false]]);
    assert.equal(advanceArcade(room,game.deadline), false);
  });
}

test("three cards keeps choices secret, awards type advantage and spends the chosen card", () => {
  const {room,game,players:[a,b]} = play("elements");
  const initial = game.players[a.id].hand[0].value;
  arcadeAction(room,a,"arcadePick",{choice:0,round:0},game.start + 5);
  const opponent = view(room,b).arcade.players.find(p => p.id === a.id);
  assert.equal(opponent.ready,true);
  assert.equal(opponent.choice,undefined);
  assert.equal(opponent.hand,undefined);
  arcadeAction(room,b,"arcadePick",{choice:2,round:0},game.start + 6);
  assert.equal(game.players[a.id].score,initial + 2);
  assert.equal(game.players[a.id].hand[0],null);
  advanceArcade(room,game.revealUntil);
  assert.throws(() => arcadeAction(room,a,"arcadePick",{choice:0,round:1},game.deadline - 1));
  for (let round = 1; round <= 2; round++) {
    advanceArcade(room,game.deadline);
    advanceArcade(room,game.revealUntil);
  }
  assert.equal(game.results.length,2);
});

test("21 uses flexible aces, hides the deck and excludes busts from victory", () => {
  const {room,game,players:[a,b]} = play("twentyOne");
  Object.assign(game.players[a.id], {hand:[1,7],standing:false});
  Object.assign(game.players[b.id], {hand:[10,9],standing:false});
  game.deck.push(9,9);
  assert.equal(view(room,b).arcade.players[0].value,18);
  assert.equal(view(room,b).arcade.deck,undefined);
  for (const p of [a,b]) arcadeAction(room,p,"arcadePick",{choice:0,round:0},game.start + 10);
  assert.equal(view(room,b).arcade.players[0].value,17);
  assert.equal(view(room,b).arcade.players[1].value,28);
  advanceArcade(room,game.revealUntil);
  advanceArcade(room,game.deadline);
  advanceArcade(room,game.revealUntil);
  assert.deepEqual(game.results.map(row => [row.score,row.won]), [[17,true],[-1,false]]);
});

test("Par ou Roubo carries contested cards over and resolves four rounds", () => {
  const {room,game,players:[a,b]} = play("claim");
  const value = game.table[0].value;
  for (const p of [a,b]) arcadeAction(room,p,"arcadePick",{choice:0,round:0},game.start + 5);
  assert.equal(game.reveal[0].contested,true);
  assert.equal(game.table[0].value,value + 1);
  advanceArcade(room,game.revealUntil);
  arcadeAction(room,a,"arcadePick",{choice:0,round:1},game.deadline - 1);
  advanceArcade(room,game.deadline);
  assert.equal(game.players[a.id].score,value + 1);
  advanceArcade(room,game.revealUntil);
  for (let round = 2; round <= 3; round++) {
    advanceArcade(room,game.deadline);
    advanceArcade(room,game.revealUntil);
  }
  assert.deepEqual(game.results.map(row => row.won),[true,false]);
  for (const p of [a,b]) command(room,p,"arcadeContinue");
  assert.equal(room.phase,"duelos");
});
