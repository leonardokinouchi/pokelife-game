const { randomInt } = require("node:crypto");
const { silhouetteSpecies } = require("./rules.cjs");

const turnMs = 12000;
const normalize = value => value.normalize("NFD").replace(/\p{Diacritic}/gu, "")
  .toLowerCase().replace(/[^a-z0-9]/g, "");
const byName = new Map(silhouetteSpecies().map(pokemon => [normalize(pokemon.name), pokemon.name]));
const groups = new Map();
for (const [key, name] of byName) {
  const letter = key[0].toUpperCase();
  if (!groups.has(letter)) groups.set(letter, []);
  groups.get(letter).push(name);
}
const letters = [...groups].sort(([a, namesA], [b, namesB]) =>
  namesB.length - namesA.length || a.localeCompare(b)).slice(0, 10).map(([letter]) => letter).sort();

function newAlphabet(players) {
  return {
    order:players.map(p => p.id), index:randomInt(players.length), letterIndex:0,
    startsAt:null, deadline:null, turn:0, used:[], eliminated:[], winners:null, last:null,
  };
}

function beginAlphabet(game, now = Date.now()) {
  game.startsAt = now + 3000;
  game.deadline = game.startsAt + turnMs;
}

function finishAlphabet(room) {
  const game = room.alphabet;
  game.winners = game.order.filter(id => !game.eliminated.includes(id));
  for (const p of room.players.filter(p => game.winners.includes(p.id)))
    p.minigameWins = (p.minigameWins ?? 0) + 1;
}

function nextTurn(game, now) {
  do {
    game.index = (game.index + 1) % game.order.length;
  } while (game.eliminated.includes(game.order[game.index]));
  game.deadline = now + turnMs;
  game.turn++;
}

function answerAlphabet(room, p, data, now = Date.now()) {
  const game = room.alphabet;
  if (game.winners || game.startsAt == null || now < game.startsAt || now >= game.deadline ||
      data.turn !== game.turn || game.order[game.index] !== p.id) throw Error("Não é sua vez.");
  if (typeof data.name !== "string" || data.name.length > 60) throw Error("Digite um nome de Pokémon.");
  const key = normalize(data.name);
  const name = byName.get(key);
  if (!name || key[0].toUpperCase() !== letters[game.letterIndex])
    throw Error("Digite um Pokémon que começa com " + letters[game.letterIndex] + ".");
  if (game.used.includes(name)) throw Error("Esse Pokémon já foi usado.");
  game.used.push(name);
  game.last = {id:p.id, name};
  for (let i = 0; i < letters.length; i++) {
    game.letterIndex = (game.letterIndex + 1) % letters.length;
    if (groups.get(letters[game.letterIndex]).some(candidate => !game.used.includes(candidate))) {
      nextTurn(game, now);
      return;
    }
  }
  finishAlphabet(room);
}

function advanceAlphabet(room, now = Date.now()) {
  const game = room.alphabet;
  if (room.phase !== "minigame" || room.minigame !== "alphabet" || !game?.startsAt ||
      game.winners || now < game.startsAt) return false;
  let changed = false;
  while (now >= game.deadline) {
    const id = game.order[game.index];
    game.last = {id};
    game.eliminated.push(id);
    if (game.eliminated.length >= game.order.length - 1) {
      finishAlphabet(room);
      return true;
    }
    nextTurn(game, game.deadline);
    changed = true;
  }
  if (game.order[game.index] === room.practiceBot && game.turn < 6 && now >= game.deadline - turnMs + 1800) {
    const options = groups.get(letters[game.letterIndex]).filter(name => !game.used.includes(name));
    const player = room.players.find(p => p.id === room.practiceBot);
    answerAlphabet(room, player, {turn:game.turn, name:options[randomInt(options.length)]}, now);
    return true;
  }
  return changed;
}

function alphabetView(game) {
  const {order, index, startsAt, deadline, turn, eliminated, winners, last, letterIndex} = game;
  return {order, active:order[index], startsAt, deadline, turn, eliminated, winners, last, letters, letter:letters[letterIndex]};
}

module.exports = {newAlphabet, beginAlphabet, answerAlphabet, advanceAlphabet, alphabetView};
