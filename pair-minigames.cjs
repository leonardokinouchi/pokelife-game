const { randomInt } = require("node:crypto");
const { silhouetteSpecies } = require("./rules.cjs");

const isPairMinigame = kind => kind === "wires" || kind === "guess";
const normalize = name => name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const colors = ["vermelho", "azul", "amarelo", "verde", "roxo", "laranja", "rosa"];
const thicknesses = ["fino", "médio", "grosso"];
const clues = [
  ["Charizard", "É do tipo Fogo e Voador.", "Tem duas asas e uma cauda em chamas.", "É a última evolução de Charmander."],
  ["Blastoise", "É do tipo Água.", "Parece uma tartaruga grande.", "Tem dois canhões no casco."],
  ["Venusaur", "É do tipo Planta e Venenoso.", "Tem uma flor enorme nas costas.", "É a última evolução de Bulbasaur."],
  ["Pikachu", "É do tipo Elétrico.", "Tem bochechas vermelhas.", "Sua cauda parece um raio."],
  ["Eevee", "É do tipo Normal.", "É pequeno e tem uma gola de pelos.", "Pode evoluir em oito Pokémon diferentes."],
  ["Snorlax", "É do tipo Normal.", "É grande e pesado.", "É conhecido por dormir bloqueando caminhos."],
  ["Gengar", "É do tipo Fantasma e Venenoso.", "Tem um sorriso enorme.", "É a última evolução de Gastly."],
  ["Machamp", "É do tipo Lutador.", "Tem quatro braços.", "É a última evolução de Machop."],
  ["Onix", "É do tipo Pedra e Terra.", "É grande e vive em túneis.", "Parece uma serpente feita de pedras."],
  ["Lapras", "É do tipo Água e Gelo.", "É grande e tem casco nas costas.", "Pode transportar pessoas sobre a água."],
  ["Ditto", "É do tipo Normal.", "Tem um corpo rosa e amorfo.", "Pode se transformar em outros Pokémon."],
  ["Jigglypuff", "É do tipo Normal e Fada.", "É rosa e redondo.", "Seu canto faz os ouvintes dormirem."],
  ["Dragonite", "É do tipo Dragão e Voador.", "Tem corpo alaranjado e asas pequenas.", "É a última evolução de Dratini."],
  ["Gyarados", "É do tipo Água e Voador.", "Parece uma serpente longa e azul.", "Evolui de Magikarp."],
  ["Scizor", "É do tipo Inseto e Aço.", "Tem corpo vermelho e pinças grandes.", "Evolui de Scyther com um Revestimento Metálico."],
  ["Ampharos", "É do tipo Elétrico.", "É amarelo e tem pescoço comprido.", "A esfera na cauda brilha como um farol."],
  ["Sudowoodo", "É do tipo Pedra.", "Gosta de ficar parado.", "Imita a aparência de uma árvore."],
  ["Tyranitar", "É do tipo Pedra e Sombrio.", "Tem uma armadura verde e espinhos.", "É a última evolução de Larvitar."],
  ["Blaziken", "É do tipo Fogo e Lutador.", "Tem pernas fortes e solta chamas pelos pulsos.", "É a última evolução de Torchic."],
  ["Swampert", "É do tipo Água e Terra.", "É robusto e tem nadadeiras na cabeça.", "É a última evolução de Mudkip."],
  ["Gardevoir", "É do tipo Psíquico e Fada.", "Seu corpo lembra um vestido branco.", "É uma das evoluções de Kirlia."],
  ["Sableye", "É do tipo Sombrio e Fantasma.", "É pequeno e vive em cavernas.", "Tem pedras preciosas no lugar dos olhos."],
  ["Metagross", "É do tipo Aço e Psíquico.", "Tem quatro pernas e um X no rosto.", "É a última evolução de Beldum."],
  ["Lucario", "É do tipo Lutador e Aço.", "Tem um espinho no peito.", "Pode sentir a aura de outros seres."],
  ["Garchomp", "É do tipo Dragão e Terra.", "Parece um tubarão terrestre.", "É a última evolução de Gible."],
  ["Rotom", "Sua forma normal é do tipo Elétrico e Fantasma.", "É pequeno e parece feito de plasma.", "Pode possuir eletrodomésticos."],
  ["Emolga", "É do tipo Elétrico e Voador.", "Tem bochechas amarelas.", "Parece um esquilo-voador."],
  ["Volcarona", "É do tipo Inseto e Fogo.", "Parece uma mariposa com asas alaranjadas.", "Evolui de Larvesta."],
  ["Greninja", "É do tipo Água e Sombrio.", "Parece um sapo ninja.", "Usa a língua como cachecol."],
  ["Sylveon", "É do tipo Fada.", "Tem laços e longas fitas.", "É uma evolução de Eevee."],
  ["Talonflame", "É do tipo Fogo e Voador.", "Parece um falcão de peito alaranjado.", "É a última evolução de Fletchling."],
  ["Mimikyu", "É do tipo Fantasma e Fada.", "Vive escondido sob um pano.", "Seu disfarce imita Pikachu."],
  ["Decidueye", "Sua forma de Alola é do tipo Planta e Fantasma.", "Parece uma coruja de capuz.", "Dispara penas como flechas."],
  ["Corviknight", "É do tipo Voador e Aço.", "Parece um corvo grande com armadura escura.", "Transporta passageiros em Galar."],
  ["Dubwool", "É do tipo Normal.", "Tem lã branca com manchas escuras.", "Evolui de Wooloo."],
  ["Tinkaton", "É do tipo Fada e Aço.", "É rosa e carrega uma arma enorme.", "Sua arma é um martelo de metal."],
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

function newPairGame(room) {
  const players = room.practiceBot
    ? [room.players.find(p => p.id === room.practiceBot), room.players.find(p => p.id !== room.practiceBot)]
    : shuffle(room.players);
  const kind = room.minigame;
  const species = kind === "guess" ? new Map(silhouetteSpecies().map(p => [p.name, p])) : null;
  const [answer, ...hints] = species ? clues[randomInt(clues.length)] : [];
  return {
    deadline: null, finished: false,
    teams: Array.from({length: players.length / 2}, (_, i) => ({
      guide:players[i * 2].id, actor:players[i * 2 + 1].id, status:"playing", messages:[],
      ...(kind === "wires" ? wirePuzzle() : {
        answer, pokemon:species.get(answer), hints, caught:0, paper:randomInt(0x100000), lastGuessAt:null,
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
  if (action === "pairRelay" && guide) {
    const index = data.index;
    const allowed = room.minigame === "wires" ? index === team.cuts.length :
      Number.isInteger(index) && index >= 0 && index < team.caught;
    if (!allowed) throw Error("Essa instrução ainda não está disponível.");
    const text = room.minigame === "wires" ? team.instructions[index].text : team.hints[index];
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
    if (data.paper !== team.paper || team.caught >= team.hints.length) throw Error("Esse papel já voou.");
    team.caught++;
    team.paper++;
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
    ...base, progress:team.cuts.length, total:team.instructions.length,
    ...(guide ? { instructions:team.instructions.map(step => step.text) } : { wires:team.wires, cuts:team.cuts }),
  };
  return {
    ...base, lastGuessAt:team.lastGuessAt,
    ...(guide ? { paper:team.paper, hints:team.hints.slice(0, team.caught), total:team.hints.length } : {}),
    ...(game.finished ? { pokemon:team.pokemon } : {}),
  };
}

function practicePair(room, now = Date.now()) {
  const game = room.pairGame;
  if (!game.deadline || game.finished || now >= game.deadline) return false;
  const team = game.teams[0];
  if (team.status !== "playing") return false;
  const bot = room.players.find(p => p.id === room.practiceBot);
  if (room.minigame === "wires") {
    const index = team.cuts.length;
    if (team.messages.some(message => message.index === index)) return false;
    pairAction(room, bot, "pairRelay", {index}, now);
  } else {
    const index = team.caught;
    if (index >= team.hints.length || now < game.deadline - 60000 + index * 3500) return false;
    pairAction(room, bot, "pairCatch", {paper:team.paper}, now);
    pairAction(room, bot, "pairRelay", {index}, now);
  }
  return true;
}

module.exports = { isPairMinigame, newPairGame, advancePairGame, pairAction, pairView, practicePair };
