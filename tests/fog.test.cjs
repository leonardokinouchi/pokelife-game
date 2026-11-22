const test = require("node:test");
const assert = require("node:assert/strict");
const {newArcade, beginArcade, advanceArcade, arcadeAction, arcadeView} = require("../arcade.cjs");

function roomWith(count) {
  const room = {
    phase:"minigame", minigame:"fog",
    players:Array.from({length:count}, (_, i) => ({id:String(i)})),
  };
  room.arcade = newArcade(room);
  beginArcade(room, 1000);
  return room;
}

test("fog hides opponents before revealing simultaneous shots", () => {
  const room = roomWith(3), game = room.arcade;
  const [a,b,c] = room.players;
  Object.assign(game.players[a.id], {x:2,y:2,direction:"right"});
  Object.assign(game.players[b.id], {x:5,y:2.2,direction:"left"});
  Object.assign(game.players[c.id], {x:9,y:7,direction:"up"});
  const hidden = arcadeView(room, c);
  assert.equal(hidden.players, undefined);
  assert.equal(hidden.reveal, null);
  assert.equal(hidden.remaining, 3);
  assert.equal(advanceArcade(room, game.deadline - 1), false);
  assert.equal(advanceArcade(room, game.deadline), true);
  assert.deepEqual(arcadeView(room, c).reveal.map(p => p.hit), [true,true,false]);
  advanceArcade(room, game.revealUntil);
  assert.deepEqual(game.results.map(p => p.won), [true,false,false]);
  assert.equal(game.results[0].id, c.id);
  assert.equal(c.minigameWins, 1);
});

test("fog moves continuously until release and shrinks even with two survivors", () => {
  const room = roomWith(3), game = room.arcade;
  room.players.forEach((p,i) => Object.assign(game.players[p.id], {x:12,y:i,direction:"right"}));
  advanceArcade(room, game.deadline);
  advanceArcade(room, game.revealUntil);
  assert.ok(game.size < 13);
  const size = game.size;
  const p = room.players[0];
  assert.throws(() => arcadeAction(room, p, "fogMove", {round:0,direction:"left"}, game.start));
  assert.throws(() => arcadeAction(room, p, "fogMove", {round:1,direction:"upLeft"}, game.start));
  const x = game.players[p.id].x;
  arcadeAction(room, p, "fogMove", {round:1,direction:"left"}, game.start);
  assert.equal(game.players[p.id].x, x);
  arcadeAction(room, p, "fogMove", {round:1,direction:null}, game.start + 500);
  assert.ok(Math.abs(game.players[p.id].x - (x - 1.6)) < 1e-9);
  assert.equal(game.players[p.id].motion, null);
  game.players[room.players[2].id].alive = false;
  Object.assign(game.players["0"], {x:0,y:0,direction:"up"});
  Object.assign(game.players["1"], {x:10,y:10,direction:"right"});
  advanceArcade(room, game.deadline);
  advanceArcade(room, game.revealUntil);
  assert.ok(game.size < size);
  assert.equal(game.round, 2);
  assert.equal(game.results, null);
});
