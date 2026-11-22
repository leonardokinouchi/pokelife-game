const {randomInt} = require("node:crypto");
const {initFog, beginFog, moveFog, advanceFog, fogView} = require("./fog.cjs");

const keyboardGames = ["magnetic", "rhythm", "sorter"];
const cardGames = ["elements", "twentyOne", "claim"];
const arcadeGames = [...keyboardGames, ...cardGames, "fog"];
const durations = {magnetic:50000, rhythm:46000, sorter:45000};
const cardDuration = {elements:9000, twentyOne:12000, claim:8500};
const types = ["Fogo", "Água", "Planta"];
const beats = [2, 0, 1];
const gridSize = 5;
const rhythmWindow = 155;

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function schedule(kind) {
  const events = [];
  for (let at = kind === "magnetic" ? 2200 : 900; at < durations[kind] - 200; ) {
    const index = events.length;
    if (kind === "magnetic") {
      const danger = shuffle(Array.from({length:25}, (_, i) => i)).slice(0, Math.min(20, 8 + index));
      events.push({at, danger, warning:Math.max(520, 1450 - index * 45)});
      at += Math.max(950, 2700 - index * 83);
    } else {
      events.push({at, lane:randomInt(kind === "rhythm" ? 4 : 3)});
      at += kind === "rhythm" ? (index < 22 ? 680 : index < 49 ? 510 : 340) : Math.max(570, 1460 - index * 26);
    }
  }
  return events;
}

function marketCard() {
  return { type:types[randomInt(3)], value:randomInt(2, 7) };
}

function newArcade(room) {
  const kind = room.minigame;
  const game = {
    start:null, results:null, round:0, deadline:null, revealUntil:null, reveal:null,
    players:Object.fromEntries(room.players.map((p, i) => [p.id, {
      score:0, combo:0, cursor:0, cell:[12, 11, 13, 7, 17, 6, 8, 16, 18, 10, 14, 22][i],
      alive:true, movedAt:null, choice:null, standing:false, hand:[],
    }])),
  };
  if (kind === "fog") initFog(game);
  else if (keyboardGames.includes(kind)) game.events = schedule(kind);
  else if (kind === "elements") {
    const values = shuffle([2, 3, 4]);
    for (const p of Object.values(game.players)) p.hand = types.map((type, i) => ({type, value:values[i]}));
  } else if (kind === "twentyOne") {
    game.deck = shuffle(Array.from({length:104}, (_, i) => i % 13 + 1));
    for (const p of Object.values(game.players)) {
      p.hand = [game.deck.pop(), game.deck.pop()];
      p.standing = handValue(p.hand) === 21;
    }
  } else if (kind === "claim") game.table = Array.from({length:3}, marketCard);
  return game;
}

function beginArcade(room, now = Date.now()) {
  const game = room.arcade;
  const kind = room.minigame;
  if (kind === "fog") return beginFog(game, now);
  game.start = now + (kind === "rhythm" || kind === "sorter" ? 3000 : 0);
  game.deadline = game.start + (durations[kind] ?? cardDuration[kind]);
}

function handValue(hand) {
  const base = hand.reduce((sum, rank) => sum + Math.min(rank, 10), 0);
  return hand.includes(1) && base <= 11 ? base + 10 : base;
}

function finish(room) {
  const {arcade:game, minigame:kind} = room;
  const scores = room.players.map(p => {
    const entry = game.players[p.id];
    const value = handValue(kind === "twentyOne" ? entry.hand : []);
    return {id:p.id, score:kind === "twentyOne" ? (value > 21 ? -1 : value) : entry.score};
  }).sort((a,b) => b.score - a.score);
  game.results = scores.map(row => ({
    ...row, won:row.score > 0 && row.score === scores[0].score,
  }));
  for (const row of game.results.filter(row => row.won)) {
    const p = room.players.find(p => p.id === row.id);
    p.minigameWins = (p.minigameWins ?? 0) + 1;
  }
}

function resolveCards(room, now) {
  const {arcade:game, minigame:kind} = room;
  const entries = Object.entries(game.players);
  if (kind === "elements") {
    const played = entries.map(([id, p]) => {
      const index = p.choice ?? p.hand.findIndex(Boolean);
      const card = p.hand[index];
      p.hand[index] = null;
      return {id, card};
    });
    game.reveal = played.map(row => {
      const type = types.indexOf(row.card.type);
      const bonus = played.some(other => other.id !== row.id && types.indexOf(other.card.type) === beats[type]) ? 2 : 0;
      const points = row.card.value + bonus;
      game.players[row.id].score += points;
      return {...row, points};
    });
  } else if (kind === "twentyOne") {
    game.reveal = entries.map(([id, p]) => {
      const took = !p.standing && p.choice === 0;
      if (took) p.hand.push(game.deck.pop());
      const value = handValue(p.hand);
      if (!took || value >= 21 || game.round === 4) p.standing = true;
      return {id, took, points:value};
    });
  } else {
    const table = game.table;
    game.reveal = table.map((card, index) => {
      const picks = entries.filter(([, p]) => p.choice === index);
      const winner = picks.length === 1 ? picks[0][0] : null;
      if (winner) game.players[winner].score += card.value;
      return {card, winner, contested:picks.length > 1};
    });
    game.table = game.reveal.map(row => row.winner ? marketCard() :
      {...row.card, value:row.card.value + Number(row.contested)});
  }
  game.revealUntil = now + 1750;
}

function advanceCards(room, now) {
  const {arcade:game, minigame:kind} = room;
  const entries = Object.values(game.players);
  if (game.revealUntil !== null) {
    if (now < game.revealUntil) return false;
    if ((kind === "elements" && game.round === 2) ||
        (kind === "claim" && game.round === 3) ||
        (kind === "twentyOne" && entries.every(p => p.standing))) {
      finish(room);
    } else {
      game.round++;
      game.reveal = game.revealUntil = null;
      game.deadline = now + cardDuration[kind];
      for (const p of entries) p.choice = null;
    }
    return true;
  }
  const bot = game.players[room.practiceBot];
  let changed = false;
  if (bot && !bot.standing && bot.choice === null && now >= game.deadline - cardDuration[kind] + 1400 && now < game.deadline) {
    bot.choice = kind === "elements" ? shuffle([0,1,2].filter(i => bot.hand[i]))[0] :
      kind === "twentyOne" ? Number(handValue(bot.hand) >= 16) : randomInt(3);
    changed = true;
  }
  if (now < game.deadline && entries.some(p => !p.standing && p.choice === null)) return changed;
  resolveCards(room, now);
  return true;
}

function registerNote(p, hit, rhythm) {
  p.cursor++;
  p.combo = hit ? p.combo + 1 : 0;
  p.score += hit ? 10 + Math.min(rhythm ? 15 : 8, p.combo - 1) : 0;
}

function sorterEnd(game, index) {
  return game.events[index + 1]?.at ?? durations.sorter;
}

function advanceKeyboard(room, now) {
  const {arcade:game, minigame:kind} = room;
  const elapsed = now - game.start;
  const entries = Object.entries(game.players);
  let changed = false;
  if (kind === "magnetic") {
    while (game.events[game.round]?.at <= elapsed) {
      const event = game.events[game.round];
      const survivors = entries.filter(([, p]) => p.alive);
      for (const [id, p] of survivors) {
        if (id === room.practiceBot && game.round < 8 && event.danger.includes(p.cell))
          p.cell = Array.from({length:25}, (_, i) => i).find(i => !event.danger.includes(i));
        p.alive = !event.danger.includes(p.cell);
        p.score++;
      }
      game.round++;
      changed = true;
      if (survivors.filter(([, p]) => p.alive).length <= 1) {
        for (const [, p] of survivors) if (p.alive) p.score++;
        finish(room);
        return true;
      }
    }
  } else {
    for (const [id, p] of entries) {
      while (p.cursor < game.events.length) {
        const event = game.events[p.cursor];
        const expiry = kind === "rhythm" ? event.at + rhythmWindow : sorterEnd(game, p.cursor);
        const bot = id === room.practiceBot && elapsed >= event.at + 100;
        if (!bot && elapsed < expiry) break;
        registerNote(p, bot && p.cursor % 4 !== 3, kind === "rhythm");
        changed = true;
      }
    }
  }
  if (now >= game.deadline) {
    finish(room);
    return true;
  }
  return changed;
}

function advanceArcade(room, now = Date.now()) {
  const game = room.arcade;
  if (room.phase !== "minigame" || !game || game.start == null || game.results) return false;
  if (room.minigame === "fog") return advanceFog(room, now);
  return game.events ? advanceKeyboard(room, now) : advanceCards(room, now);
}

function arcadeAction(room, player, action, data, now = Date.now()) {
  const {arcade:game, minigame:kind} = room;
  const p = game.players[player.id];
  if (game.start == null || game.results || game.revealUntil !== null || now >= game.deadline)
    throw Error("Essa etapa já terminou.");
  if (now < game.start) throw Error("Aguarde a contagem regressiva.");
  if (kind === "fog" && action === "fogMove") moveFog(game, p, data, now);
  else if (kind === "magnetic" && action === "arcadeMove") {
    const delta = {up:[0,-1], down:[0,1], left:[-1,0], right:[1,0]}[data.direction];
    if (!Array.isArray(delta) || !p.alive) throw Error("Movimento indisponível.");
    if (p.movedAt != null && now - p.movedAt < 75) return;
    const x = p.cell % gridSize + delta[0], y = Math.floor(p.cell / gridSize) + delta[1];
    if (x >= 0 && x < gridSize && y >= 0 && y < gridSize) p.cell = y * gridSize + x;
    p.movedAt = now;
  } else if ((kind === "rhythm" || kind === "sorter") && action === "arcadeTap") {
    const rhythm = kind === "rhythm";
    const event = game.events[p.cursor];
    const elapsed = now - game.start;
    if (!Number.isInteger(data.lane) || data.lane < 0 || data.lane >= (rhythm ? 4 : 3))
      throw Error("Tecla inválida.");
    if (!event) return;
    if (elapsed < event.at - (rhythm ? rhythmWindow : 0)) {
      p.combo = 0;
      return;
    }
    if (elapsed < (rhythm ? event.at + rhythmWindow : sorterEnd(game, p.cursor)))
      registerNote(p, event.lane === data.lane, rhythm);
  } else if (cardGames.includes(kind) && action === "arcadePick") {
    const choice = data.choice;
    if (data.round !== game.round || p.choice !== null || p.standing || !Number.isInteger(choice) ||
        choice < 0 || choice >= (kind === "twentyOne" ? 2 : 3) || (kind === "elements" && !p.hand[choice]))
      throw Error("Essa escolha não está disponível.");
    p.choice = choice;
    advanceCards(room, now);
  } else throw Error("Comando indisponível.");
}

function arcadeView(room, player) {
  const {arcade:game, minigame:kind} = room;
  if (kind === "fog") return fogView(game, player.id);
  const you = game.players[player.id];
  const openHands = kind === "twentyOne";
  return {
    start:game.start, deadline:game.deadline, round:game.round, reveal:game.reveal,
    results:game.results, events:game.events, you, table:game.table,
    players:Object.entries(game.players).map(([id, p]) => ({
      id, cell:p.cell, alive:p.alive, score:p.score, ready:p.choice !== null || p.standing,
      ...(openHands ? {hand:p.hand, value:handValue(p.hand), standing:p.standing} : {}),
    })),
  };
}

module.exports = {arcadeGames, newArcade, beginArcade, advanceArcade, arcadeAction, arcadeView};
