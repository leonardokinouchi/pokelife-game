const { randomInt } = require("node:crypto");
const { silhouetteSpecies, info } = require("./rules.cjs");

const isPairMinigame = kind => kind === "wires" || kind === "guess";
const normalize = name => name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const colors = ["vermelho", "azul", "amarelo", "verde", "roxo", "laranja", "rosa"];
const thicknesses = ["fino", "médio", "grosso"];
// Pokédex: nome, geração, altura em dm, peso em hg, cor e estágio.
const clueSpecies = [
  ["Charizard", 1, 17, 905, 8, 3],
  ["Blastoise", 1, 16, 855, 2, 3],
  ["Venusaur", 1, 20, 1000, 5, 3],
  ["Pikachu", 1, 4, 60, 10, 2],
  ["Eevee", 1, 3, 65, 3, 1],
  ["Snorlax", 1, 21, 4600, 1, 3],
  ["Gengar", 1, 15, 405, 7, 3],
  ["Machamp", 1, 16, 1300, 4, 3],
  ["Onix", 1, 88, 2100, 4, 1],
  ["Lapras", 1, 25, 2200, 2, 0],
  ["Ditto", 1, 3, 40, 7, 0],
  ["Jigglypuff", 1, 5, 55, 6, 2],
  ["Dragonite", 1, 22, 2100, 3, 3],
  ["Gyarados", 1, 65, 2350, 2, 3],
  ["Scizor", 2, 18, 1180, 8, 3],
  ["Ampharos", 2, 14, 615, 10, 3],
  ["Sudowoodo", 2, 12, 380, 3, 3],
  ["Tyranitar", 2, 20, 2020, 5, 3],
  ["Blaziken", 3, 19, 520, 8, 3],
  ["Swampert", 3, 15, 819, 2, 3],
  ["Gardevoir", 3, 16, 484, 9, 3],
  ["Sableye", 3, 5, 110, 7, 0],
  ["Metagross", 3, 16, 5500, 2, 3],
  ["Lucario", 4, 12, 540, 2, 3],
  ["Garchomp", 4, 19, 950, 2, 3],
  ["Rotom", 4, 3, 3, 8, 0],
  ["Emolga", 5, 4, 50, 9, 0],
  ["Volcarona", 5, 16, 460, 9, 3],
  ["Greninja", 6, 15, 400, 2, 3],
  ["Sylveon", 6, 10, 235, 6, 3],
  ["Talonflame", 6, 12, 245, 8, 3],
  ["Mimikyu", 7, 2, 7, 10, 0],
  ["Decidueye", 7, 16, 366, 3, 3],
  ["Corviknight", 8, 22, 750, 7, 3],
  ["Dubwool", 8, 13, 430, 9, 3],
  ["Tinkaton", 9, 7, 1128, 6, 3],
  ["Bulbasaur", 1, 7, 69, 5, 1],
  ["Squirtle", 1, 5, 90, 2, 1],
  ["Vulpix", 1, 6, 99, 3, 1],
  ["Growlithe", 1, 7, 190, 3, 1],
  ["Psyduck", 1, 8, 196, 10, 1],
  ["Abra", 1, 9, 195, 3, 1],
  ["Slowpoke", 1, 12, 360, 6, 1],
  ["Cubone", 1, 4, 65, 3, 1],
  ["Staryu", 1, 8, 345, 3, 1],
  ["Magikarp", 1, 9, 100, 8, 1],
  ["Aerodactyl", 1, 18, 590, 7, 0],
  ["Mewtwo", 1, 20, 1220, 7, 0],
  ["Chikorita", 2, 9, 64, 5, 1],
  ["Cyndaquil", 2, 5, 79, 10, 1],
  ["Totodile", 2, 6, 95, 2, 1],
  ["Togepi", 2, 3, 15, 9, 1],
  ["Marill", 2, 4, 85, 2, 2],
  ["Umbreon", 2, 10, 270, 1, 3],
  ["Steelix", 2, 92, 4000, 4, 3],
  ["Houndoom", 2, 14, 350, 1, 3],
  ["Treecko", 3, 5, 50, 5, 1],
  ["Mudkip", 3, 4, 76, 2, 1],
  ["Lotad", 3, 5, 26, 5, 1],
  ["Flygon", 3, 20, 820, 5, 3],
  ["Milotic", 3, 62, 1620, 6, 3],
  ["Absol", 3, 12, 470, 9, 0],
  ["Piplup", 4, 4, 52, 2, 1],
  ["Shinx", 4, 5, 95, 2, 1],
  ["Drifloon", 4, 4, 12, 7, 1],
  ["Croagunk", 4, 7, 230, 2, 1],
  ["Zorua", 5, 7, 125, 4, 1],
  ["Axew", 5, 6, 180, 5, 1],
  ["Noivern", 6, 15, 850, 7, 3],
  ["Rockruff", 7, 5, 92, 3, 1],
  ["Wooloo", 8, 6, 60, 9, 1],
  ["Pawmi", 9, 3, 25, 10, 1],
];

function shuffle(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function wirePuzzle() {
  const gauges = shuffle([...thicknesses, ...Array.from({length:4}, () => thicknesses[randomInt(3)])]);
  const wires = shuffle(colors).map((color, id) => ({id, color, thickness:gauges[id]}));
  const group = shuffle(wires.slice(0, -1));
  const first = group[0];
  const timed = group.find(wire => wire.id > 0 && wire !== first);
  const anchor = wires[timed.id - 1];
  const third = group.find(wire => wire !== first && wire !== timed);
  const last = wires.at(-1);
  const windowStart = randomInt(18, 33);
  return { wires, cuts: [], instructions: [
    { wire:first.id, text:"Corte o fio " + first.color + " " + first.thickness + "." },
    { wire:timed.id, min:windowStart, max:windowStart + 10,
      text:"Corte o fio à direita do " + anchor.color + " entre " + windowStart + " e " + (windowStart + 10) + " segundos restantes." },
    { wire:third.id, text:"Corte o " + (third.id + 1) + "º fio da esquerda, contando também os já cortados." },
    { wire:last.id, text:"Corte o último fio da direita." },
  ] };
}

const typeNames = {
  normal:"Normal", fire:"Fogo", water:"Água", electric:"Elétrico", grass:"Planta",
  ice:"Gelo", fighting:"Lutador", poison:"Venenoso", ground:"Terra", flying:"Voador",
  psychic:"Psíquico", bug:"Inseto", rock:"Pedra", ghost:"Fantasma", dragon:"Dragão",
  dark:"Sombrio", steel:"Aço", fairy:"Fada",
};
const colorNames = ["", "preta", "azul", "marrom", "cinza", "verde", "rosa", "roxa", "vermelha", "branca", "amarela"];
const stageNames = ["Não possui evolução.", "Está no estágio evolutivo inicial.",
  "Está no estágio evolutivo intermediário.", "Está no estágio evolutivo final."];
const measurement = value => (value / 10).toLocaleString("pt-BR");

function pokemonClues(pokemon, generation, height, weight, color, stage) {
  const types = info({pokemonId:pokemon.pokemonId}).types;
  const wrongType = shuffle(Object.keys(typeNames).filter(type => !types.includes(type)))[0];
  const wrongGeneration = generation % 9 + 1;
  const wrongColor = shuffle(colorNames.slice(1).filter(name => name !== colorNames[color]))[0];
  return {
    hints: shuffle([
      "Tipo: " + types.map(type => typeNames[type]).join(" e ") + ".",
      "É da " + generation + "ª geração.",
      "Mede " + measurement(height) + " m de altura.",
      "Pesa " + measurement(weight) + " kg.",
      "Sua cor principal é " + colorNames[color] + ".",
      stageNames[stage],
    ]).slice(0, 3),
    falseHints: shuffle([
      "Tem o tipo " + typeNames[wrongType] + ".",
      "É da " + wrongGeneration + "ª geração.",
      "Mede " + measurement(height + 7) + " m de altura.",
      "Pesa " + measurement(weight + 17) + " kg.",
      "Sua cor principal é " + wrongColor + ".",
      stageNames[(stage + 1) % stageNames.length],
    ]).slice(0, 4),
  };
}

function clueButterfree(hints, falseHints) {
  return shuffle([
    ...hints.map(text => ({text, shiny:true})),
    ...falseHints.map(text => ({text, shiny:false})),
  ]).map((clue, id) => ({
    ...clue, id, course:randomInt(4), phase:randomInt(0, 6400), speed:randomInt(4800, 8200),
  }));
}

function newPairGame(room) {
  const players = room.practiceBot
    ? [room.players.find(p => p.id === room.practiceBot), room.players.find(p => p.id !== room.practiceBot)]
    : shuffle(room.players);
  const kind = room.minigame;
  const species = kind === "guess" ? new Map(silhouetteSpecies().map(p => [p.name, p])) : null;
  const [answer, ...attributes] = species ? clueSpecies[randomInt(clueSpecies.length)] : [];
  const pokemon = species?.get(answer);
  const clues = pokemon ? pokemonClues(pokemon, ...attributes) : null;
  return {
    deadline: null, finished: false,
    teams: Array.from({length: players.length / 2}, (_, i) => ({
      guide:players[i * 2].id, actor:players[i * 2 + 1].id, status:"playing", messages:[],
      ...(kind === "wires" ? wirePuzzle() : {
        answer, pokemon, hints:clues.hints, butterflies:clueButterfree(clues.hints, clues.falseHints),
        captured:[], lastGuessAt:null,
      }),
    })),
  };
}

function finish(room) {
  room.pairGame.finished = true;
  for (const team of room.pairGame.teams.filter(team => team.status === "won")) {
    for (const p of room.players.filter(p => p.id === team.guide || p.id === team.actor))
      p.minigameWins = (p.minigameWins ?? 0) + 1;
  }
}

function advancePairGame(room, now = Date.now()) {
  const game = room.pairGame;
  if (room.phase !== "minigame" || !isPairMinigame(room.minigame) ||
    !game.deadline || game.finished || now < game.deadline) return false;
  for (const team of game.teams) if (team.status === "playing") team.status = "timeout";
  finish(room);
  return true;
}

function pairAction(room, player, action, data, now = Date.now()) {
  const game = room.pairGame;
  const team = game.teams.find(t => t.guide === player.id || t.actor === player.id);
  const guide = team.guide === player.id;
  if (!game.deadline || game.finished || now >= game.deadline || team.status !== "playing")
    throw Error("A tentativa da sua dupla terminou.");
  if (room.minigame === "guess" && action === "pairRelay" && guide) {
    const index = data.index;
    const butterfly = team.butterflies?.find(clue => clue.id === index);
    const allowed = team.butterflies ? butterfly && team.captured.includes(index) :
      Number.isInteger(index) && index >= 0 && index < team.caught;
    if (!allowed) throw Error("Essa instrução ainda não está disponível.");
    const text = butterfly?.text ?? team.hints[index];
    if (!team.messages.some(message => message.index === index)) team.messages.push({index, text});
  } else if (room.minigame === "wires" && action === "pairCut" && !guide) {
    if (data.index !== team.cuts.length || !team.wires.some(w => w.id === data.wire) || team.cuts.includes(data.wire))
      throw Error("Esse corte não está disponível.");
    const step = team.instructions[team.cuts.length];
    const seconds = Math.ceil((game.deadline - now) / 1000);
    if (step.wire !== data.wire || (step.min != null && (seconds < step.min || seconds > step.max))) {
      team.status = "shock";
    } else {
      team.cuts.push(data.wire);
      if (team.cuts.length === team.instructions.length) team.status = "won";
    }
    if (game.teams.every(t => t.status !== "playing")) finish(room);
  } else if (room.minigame === "guess" && action === "pairCatch" && guide) {
    if (team.butterflies) {
      if (!team.butterflies.some(clue => clue.id === data.butterfly) || team.captured.includes(data.butterfly))
        throw Error("Essa Butterfree já saiu de voo.");
      team.captured.push(data.butterfly);
    } else {
      if (data.paper !== team.paper || team.caught >= team.hints.length) throw Error("Esse papel já voou.");
      team.caught++;
      team.paper++;
    }
  } else if (room.minigame === "guess" && action === "pairGuess" && !guide) {
    if (typeof data.name !== "string" || !data.name.trim() || data.name.length > 60) throw Error("Digite um nome de Pokémon.");
    if (team.lastGuessAt != null && now - team.lastGuessAt < 350) throw Error("Aguarde um instante antes de tentar de novo.");
    team.lastGuessAt = now;
    if (normalize(data.name) === normalize(team.answer)) {
      team.status = "won";
      for (const other of game.teams) if (other !== team) other.status = "lost";
      finish(room);
    }
  } else throw Error("Essa ação pertence ao outro papel da dupla.");
}

function pairView(room, player) {
  const game = room.pairGame;
  const team = game.teams.find(t => t.guide === player.id || t.actor === player.id);
  const guide = team.guide === player.id;
  const base = { guide, partner:guide ? team.actor : team.guide, deadline:game.deadline,
    finished:game.finished, status:team.status, messages:team.messages,
    results:game.finished ? game.teams.map(({guide, actor, status}) => ({guide, actor, status})) : null };
  if (room.minigame === "wires") return {
    ...base, messages:[], progress:team.cuts.length, total:team.instructions.length,
    ...(room.practiceBot === team.guide && !guide && game.deadline && team.status === "playing"
      ? { practiceSpeech:team.instructions[team.cuts.length].text } : {}),
    ...(guide ? { instructions:team.instructions.map(step => step.text) } : { wires:team.wires, cuts:team.cuts }),
  };
  return {
    ...base, lastGuessAt:team.lastGuessAt,
    ...(guide ? team.butterflies ? {
      butterflies:team.butterflies,
      captured:team.captured,
    } : {paper:team.paper, hints:team.hints.slice(0, team.caught), total:team.hints.length} : {}),
    ...(game.finished ? { pokemon:team.pokemon } : {}),
  };
}

function practicePair(room, now = Date.now()) {
  const game = room.pairGame;
  if (!game.deadline || game.finished || now >= game.deadline) return false;
  const team = game.teams[0];
  if (team.status !== "playing") return false;
  const bot = room.players.find(p => p.id === room.practiceBot);
  if (room.minigame !== "guess") return false;
  if (team.butterflies) {
    const index = team.captured.length;
    const next = team.butterflies.find(clue => clue.shiny && !team.captured.includes(clue.id));
    if (!next || now < game.deadline - 60000 + index * 3500) return false;
    pairAction(room, bot, "pairCatch", {butterfly:next.id}, now);
    pairAction(room, bot, "pairRelay", {index:next.id}, now);
    return true;
  }
  const index = team.caught;
  if (index >= team.hints.length || now < game.deadline - 60000 + index * 3500) return false;
  pairAction(room, bot, "pairCatch", {paper:team.paper}, now);
  pairAction(room, bot, "pairRelay", {index}, now);
  return true;
}

module.exports = { isPairMinigame, newPairGame, advancePairGame, pairAction, pairView, practicePair };
