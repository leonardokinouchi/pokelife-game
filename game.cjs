const { randomInt, randomUUID } = require("node:crypto");
const rules = require("./rules.cjs");
const { BattleSession } = require("./battle.cjs");
const { isQuiz, newMillion, millionOptions, recordAnswer, advanceMillion, millionView } = require("./million.cjs");
const { isPairMinigame, newPairGame, pairAction, pairView, practicePair } = require("./pair-minigames.cjs");
const { arcadeGames, newArcade, beginArcade, arcadeAction, arcadeView } = require("./arcade.cjs");
const minigames = ["market", "auction", "race", "million", "darkAuction", "pokemonQuiz", "wires", "guess", ...arcadeGames];
const eligibleMinigames = count => minigames.filter(kind => !isPairMinigame(kind) || validPlayerCount(count));
const isAuction = kind => kind === "auction" || kind === "darkAuction";
const auctionDuration = 10000;
const auctionRevealDuration = 1800;

const { actionPeriod, neighbors, avatars, validPlayerCount, leagueIsland, leaguePorts, hasLeagueAccess, hasLaboratory } = require("./public/world.js");

const BIOMES = [
  "campo",
  "floresta",
  "caverna",
  "praia",
  "lago",
  "neve",
  "vulcao",
  "cidade",
];
const WORK_XP = 100;
const careers = [
  { facility:"store", types:["normal","electric"], labels:["Normal","Elétrico"], levels:[0,15,30],
    ranks:[["vendedor","Vendedor",100],["gerente","Gerente",165],["administrador","Administrador da loja",220]] },
  { facility:"center", types:["fairy","psychic"], labels:["Fada","Psíquico"], levels:[0,15,30],
    happiness:[0,100,150],
    ranks:[["auxiliar","Auxiliar de enfermagem",100],["enfermeiro","Enfermeiro",165],["chefe-enfermagem","Chefe de enfermagem",220]] },
  { place:"biome1", types:["normal","grass"], labels:["Normal","Planta"], levels:[1,15,30],
    ranks:[["cuidador","Cuidador do prado",130],["criador","Criador de campo",180],["especialista-criacao","Especialista em criação",230]] },
  { place:"biome2", types:["bug","poison"], labels:["Inseto","Venenoso"], levels:[1,18,35],
    ranks:[["lenhador","Lenhador",145],["guarda-florestal","Guarda florestal",190],["guardiao-bosque","Guardião do bosque",240]] },
  { place:"biome3", types:["rock","ground"], labels:["Pedra","Terra"], levels:[1,18,35],
    ranks:[["minerador","Minerador",145],["supervisor-mineracao","Supervisor de mineração",190],["mestre-mineracao","Mestre de mineração",240]] },
  { place:"biome4", types:["water","flying"], labels:["Água","Voador"], levels:[1,18,35],
    ranks:[["guarda-costeiro","Guarda costeiro",140],["patrulheiro","Patrulheiro costeiro",185],["comandante-costeiro","Comandante costeiro",235]] },
  { place:"biome5", types:["water","dragon"], labels:["Água","Dragão"], levels:[1,18,35],
    ranks:[["pescador","Pescador",140],["mestre-pescador","Mestre pescador",185],["especialista-lago","Especialista do lago",235]] },
  { place:"biome6", types:["ice","steel"], labels:["Gelo","Aço"], levels:[1,20,40],
    ranks:[["guia","Guia de montanha",150],["guia-senior","Guia sênior",200],["chefe-expedicao","Chefe de expedição",250]] },
  { place:"biome7", types:["fire","rock"], labels:["Fogo","Pedra"], levels:[1,22,45],
    ranks:[["vigia","Vigia do vulcão",150],["inspetor","Inspetor vulcânico",210],["chefe-vulcanico","Chefe de segurança vulcânica",260]] },
  { place:"biome8", types:["fighting","dark"], labels:["Lutador","Sombrio"], levels:[1,20,40],
    ranks:[["tecnico","Técnico de campo",145],["engenheiro","Engenheiro de manutenção",195],["engenheiro-chefe","Engenheiro-chefe",245]] },
  { facility:"lab", types:["psychic","ghost"], labels:["Psíquico","Fantasma"], levels:[1,22,45],
    ranks:[["assistente-pesquisa","Assistente de pesquisa",150],["pesquisador","Pesquisador de campo",210],["pesquisador-chefe","Pesquisador-chefe",260]] },
];

const JOBS = Object.fromEntries(careers.flatMap(career => career.ranks.map(([id, name, pay], rank) => {
  const urban = ["center", "store"].includes(career.facility);
  return [id, {
    name, pay, rank, facility: career.facility || "wild", place: career.place,
    types: career.types, labels: career.labels, level: career.levels[rank],
    happiness: career.happiness?.[rank] || 0,
    prior: rank ? career.ranks[rank - 1][0] : null,
    target: rank === 2 ? 400 : urban ? 500 : 600,
    limit: rank === 2 ? 1 : pay >= 200 ? 2 : null,
  }];
})));

function jobRequirement(p, job) {
  const current = job.prior ? p.jobProgress[job.prior] || 0 : 0;
  const target = job.prior ? job.target : 0;
  const pokemon = !job.level || p.party.some(mon => mon.hp > 0 &&
    mon.level >= job.level && mon.happiness >= job.happiness &&
    mon.types.some(type => job.types.includes(type)));
  const text = [
    target ? target + " XP em " + JOBS[job.prior].name + " (" + current + "/" + target + ")" : "",
    job.level ? "Pokémon apto de " + job.labels.join(" ou ") + " · Nv. " + job.level + "+" +
      (job.happiness ? " · felicidade " + job.happiness + "+" : "") : "",
  ].filter(Boolean).join(" • ");
  return { met: current >= target && pokemon, current, target, text: text || "Nenhum" };
}

function workCount(r, p, id) {
  return p.workRound?.round === r.round ? p.workRound.shifts[id] || 0 : 0;
}

const HEAL_COST = 100;
const LAB_COST = 1500;
const LAB_HAPPINESS_LOSS = 100;
const SHOP = {
  "poke-ball": { name: "Poké Bola", price: 100 },
  "great-ball": { name: "Grande Bola", price: 250 },
  "ultra-ball": { name: "Ultra Bola", price: 500 },
  potion: { name: "Poção", price: 80 },
  ...Object.fromEntries(
    Object.entries({
      fire: "Fogo",
      water: "Água",
      thunder: "Trovão",
      leaf: "Folha",
      moon: "Lua",
      sun: "Sol",
      shiny: "Brilho",
      dusk: "Crepúsculo",
      dawn: "Alvorecer",
      ice: "Gelo",
    }).map(([id, n]) => [id + "-stone", { name: "Pedra de " + n, price: 700 }]),
  ),
};
const { Dex } = require("@pkmn/sim");
const evolutionRules = require("./data/rules.json").evolution;
const evolutionItems = new Set(evolutionRules.map(rule => rule.heldItem).filter(Boolean));
for (const id of evolutionItems)
  SHOP[id] = { name: Dex.items.get(id).name || id, price: 650, held: true };
for (const id of new Set(evolutionRules.filter(rule => rule.trigger === "use-item").map(rule => rule.item).filter(Boolean))) {
  const name = Dex.items.get(id.replaceAll("-", "")).name || id.replaceAll("-", " ");
  SHOP[id] = { ...SHOP[id], name: SHOP[id]?.name || name, price: SHOP[id]?.price || 700, category: "evolution" };
}
for (const item of Dex.items.all())
  if (item.megaStone)
    SHOP[item.id] = { name: item.name, price: 1600, category: "megaStone", held: true };
const battleItems = {
  berry: [
    ["oranberry", "Baga Oran", 100],
    ["sitrusberry", "Baga Sitrus", 200],
    ["pechaberry", "Baga Pecha", 100],
    ["cheriberry", "Baga Cheri", 100],
    ["chestoberry", "Baga Chesto", 100],
    ["rawstberry", "Baga Rawst", 100],
    ["aspearberry", "Baga Aspear", 100],
    ["persimberry", "Baga Persim", 120],
    ["lumberry", "Baga Lum", 250],
  ],
  combat: [
    ["leftovers", "Restos", 900],
    ["lifeorb", "Orbe da Vida", 1000],
    ["focussash", "Faixa Foco", 700],
    ["choiceband", "Faixa da Escolha", 1000],
    ["choicespecs", "Óculos da Escolha", 1000],
    ["choicescarf", "Cachecol da Escolha", 1000],
    ["rockyhelmet", "Capacete Rochoso", 900],
    ["assaultvest", "Colete de Assalto", 950],
    ["eviolite", "Mineral Evolutivo", 900],
    ["heavydutyboots", "Botas Reforçadas", 800],
    ["expertbelt", "Cinto de Especialista", 800],
    ["blacksludge", "Lodo Negro", 850],
  ],
};
for (const [category, items] of Object.entries(battleItems))
  for (const [id, name, price] of items)
    SHOP[id] = { name, price, category, held: true };
const itemSprites = require("./data/item-sprites.json");
const itemSummaries = {
  "poke-ball": "Usada para capturar Pokémon selvagens.",
  "great-ball": "Aumenta a chance de captura em relação à Poké Bola.",
  "ultra-ball": "Aumenta a chance de captura em relação à Grande Bola.",
  potion: "Recupera até 20 PV de um Pokémon ferido.",
  oranberry: "Quando equipado, recupera 10 PV ao chegar à metade da vida ou menos. Consumo único.",
  sitrusberry: "Quando equipado, recupera ¼ dos PV máximos ao chegar à metade da vida ou menos. Consumo único.",
  leftovers: "Quando equipado, recupera 1/16 dos PV máximos ao final de cada turno da batalha.",
};
for (const [id, item] of Object.entries(SHOP)) {
  item.sprite = Object.hasOwn(itemSprites, id);
  const data = Dex.items.get(id.replaceAll("-", ""));
  const megaForms = Object.values(data.megaStone || {});
  item.summary = itemSummaries[id] || (megaForms.length
    ? "Permite a Mega Evolução para " + megaForms.join(" ou ") + " quando equipada ao Pokémon compatível."
    : item.category === "evolution" ? "Use em um Pokémon compatível para evoluí-lo." : data.shortDesc || data.desc || (item.held ? "Item para equipar em um Pokémon." : "Item da mochila."));
}

function evolutionListener(player) {
  return (before, after) => {
    (player.evolutions ??= []).push({ id: randomUUID(), before, after });
    player.evolutions = player.evolutions.slice(-16);
  };
}

function evoContext(p) {
  return {
    timeOfDay: (p.enc?.period || actionPeriod(p.actions)) === "night" ? "night" : "day",
    onEvolution: evolutionListener(p),
    multiplayer: true,
    party: p.party,
  };
}
const LEADERS = [
  { name: "Veltri Salgue", portrait: "veltri", team: ["budew", "roselia"] },
  { name: "Nália Maralto", portrait: "nalia", team: ["poliwag", "wartortle"] },
  { name: "Távik Fulgor", portrait: "tavik", team: ["flaaffy", "magnemite", "raichu"] },
  { name: "Rudena Ferral", portrait: "rudena", team: ["hitmontop", "machoke", "lucario"] },
  { name: "Sélvara Brum", portrait: "selvara", team: ["mismagius", "banette", "haunter", "gengar"] },
  { name: "Nevaris Vell", portrait: "nevaris", team: ["froslass", "abomasnow", "sneasel", "glaceon"] },
  { name: "Zafren Rubral", portrait: "zafren", team: ["torkoal", "magmortar", "talonflame", "rapidash", "arcanine"] },
  { name: "Dárvion Escarpa", portrait: "darvion", team: ["flygon", "altaria", "haxorus", "gabite", "dragonite"] },
  { name: "Elaris Vetra", portrait: "elaris", team: ["slowking", "reuniclus", "gothitelle", "gallade", "espeon", "gardevoir"] },
  { name: "Noxél Varne", portrait: "noxel", team: ["mandibuzz", "weavile", "bisharp", "hydreigon", "umbreon", "absol"] },
  { name: "Orvélio Trama", portrait: "orvelio", team: ["skarmory", "magnezone", "scizor", "aggron", "steelix", "metagross"] },
  { name: "Kaelvor Duna", portrait: "kaelvor", team: ["dragalge", "noivern", "kommo-o", "dragapult", "salamence", "garchomp"] },
];
const check = (test, msg) => {
  if (!test) throw Error(msg);
};
const deposit = (p, m) => {
  if (p.party.length < 6) {
    delete m.boxSlot;
    p.party.push(m);
  } else {
    m.boxSlot = freeSlot(p);
    p.box.push(m);
  }
  if (!p.dex.includes(m.speciesId)) p.dex.push(m.speciesId);
};
const boxCapacity = p => p.boxCapacity ?? 900;
function freeSlot(p) {
  const occupied = new Set(p.box.map((m) => m.boxSlot));
  for (let i = 0; i < boxCapacity(p); i++) if (!occupied.has(i)) return i;
  throw Error("As boxes estão cheias.");
}
const all = (p) => [...p.party, ...p.box];
const captureBalls = ["poke-ball", "great-ball", "ultra-ball"];
const learningMon = (p) => all(p).find((m) => m.pendingMoves?.length);
const mon = (p, id) => {
  let m = all(p).find((m) => m.uid === id);
  check(m, "Pokémon indisponível.");
  return m;
};
function player(name, avatar = "mar") {
  return {
    id: randomUUID(),
    name,
    token: randomUUID(),
    money: 0,
    items: {},
    party: [],
    box: [],
    dex: [],
    shinyCaught: 0,
    petsGiven: 0,
    job: null,
    jobLocation: null,
    jobProgress: {},
    avatar: Object.hasOwn(avatars, avatar) ? avatar : "mar",
    travel: [],
    travelStep: 0,
    walks: 0,
    battled: false,
    actions: 10,
    loc: "city1",
    badges: [],
    elite: 0,
    ready: false,
    done: false,
    wins: 0,
    minigameWins: 0,
    notice: "",
    enc: null,
  };
}
const leaderBaseLevel = (index) => Math.min(90, (index + 1) * 10);
function rollGymLevels() {
  return LEADERS.map(({ team }, index) =>
    team.map(() => leaderBaseLevel(index) + randomInt(-3, 3)));
}
function gymLevels(r) {
  return r.gymLevels ??= rollGymLevels();
}

function newRoom(code, p) {
  return {
    code,
    host: p.id,
    round: 1,
    rounds: 8,
    mult: 3,
    mini: true,
    phase: "lobby",
    cards: [],
    cardIndex: 0,
    players: [p],
    gymLevels: rollGymLevels(),
    offers: [],
    duels: [],
    logs: [],
  };
}
function say(r, msg) {
  r.logs.push(msg);
  r.logs = r.logs.slice(-12);
}
function points(p) {
  return {
    colecao: p.dex.length * 3,
    shinys: (p.shinyCaught || 0) * 10,
    riqueza: Math.floor(p.money / 200),
    liga: p.badges.length * 10 + (p.elite >= 4 ? 40 : 0),
    carentesco: p.petsGiven ?? 0,
    duelos: (p.wins ?? 0) * 5,
    minigames: (p.minigameWins ?? 0) * 5,
  };
}
function needsHealing(mon) {
  return mon.hp < mon.maxhp || Boolean(mon.status) ||
    mon.moves.some(move => {
      const { id, pp } = Dex.moves.get(move);
      return mon.pp?.[id] < pp;
    });
}
function moveLessonDetails(id) {
  const { name, type, category, basePower, accuracy, pp, shortDesc } = Dex.moves.get(id);
  return { id, name, type, category, basePower, accuracy, pp, shortDesc };
}

function view(r, p) {
  const other = (q) => ({
    id: q.id,
    name: q.name,
    ready: q.ready,
    done: q.done,
    loc: q.loc,
    avatar: q.avatar,
    travel: q.travel,
    actions: q.actions,
    money: q.money,
    party: q.party,
    box: q.box,
    boxCapacity: boxCapacity(q),
    items: q.items,
    badges: q.badges,
    elite: q.elite,
    registered: q.dex.length,
    shinyCaught: q.shinyCaught || 0,
    petsGiven: q.petsGiven ?? 0,
    points: points(q),
    wins: q.wins,
    minigameWins: q.minigameWins ?? 0,
  });
  const { enc, token, escapedPokemon, unhappyPokemon, ...rest } = p;
  const learning = learningMon(p);
  const duel = duelFor(r, p);
  const members = duel ? duelMembers(duel) : [];
  const position = members.indexOf(p.id);
  return {
    code: r.code,
    cards: r.cards.slice(0, r.cardIndex + 1),
    cardCount: r.cards.length,
    activeCard: r.phase === "cards" ? r.cards[r.cardIndex].id : null,
    host: r.host,
    phase: r.phase,
    round: r.round,
    rounds: r.rounds,
    mult: r.mult,
    mini: r.mini,
    logs: r.logs,
    gyms: LEADERS.map((leader, i) => ({ ...leader, level: leaderBaseLevel(i), levels: gymLevels(r)[i] })),
    jobs: Object.fromEntries(Object.entries(JOBS).map(([id, job]) => [id, {
      name: job.name,
      facility: job.facility,
      place: job.place,
      pay: job.pay,
      rank: job.rank,
      limit: job.limit,
      shifts: workCount(r, p, id),
      requirement: jobRequirement(p, job),
    }])),
    shop: SHOP,
    healCost: HEAL_COST,
    laboratory: hasLaboratory(p.loc) ? {
      cost: LAB_COST,
      happinessLoss: LAB_HAPPINESS_LOSS,
      natures: rules.laboratoryNatures,
      abilities: Object.fromEntries(
        [...new Map(all(p).map(mon => [mon.pokemonId, mon]))]
          .map(([id, mon]) => [id, rules.laboratoryAbilities(mon)]),
      ),
    } : null,
    players: r.players.map(other),
    you: {
      ...rest,
      needsHealing: p.party.some(needsHealing),
      period: actionPeriod(p.actions),
      moveLesson: learning ? {
        uid: learning.uid,
        pokemon: learning.name,
        move: learning.pendingMoves[0],
        ...moveLessonDetails(learning.pendingMoves[0]),
        known: learning.moves.map(moveLessonDetails),
      } : null,
      enc: enc && {
        type: enc.type,
        startedActions: enc.startedActions,
        period: enc.period,
        wild: enc.wild,
        battle: enc.battle?.view("p1"),
      },
    },
    offers: r.offers.filter(o => o.from === p.id || o.to === p.id),
    duel: duel && {
      opponent: members.filter((_, index) => index % 2 !== position % 2)
        .map(id => r.players.find(q => q.id === id).name).join(" e "),
      result: duel.result,
      won: duel.winners?.includes(p.id),
      selection: duel.picks && !duel.battle && !duel.result ? {
        size: r.duelFormat.selected.size,
        leads: r.duelFormat.selected.mode === "doubles" ? 2 : 1,
        picked: duel.picks[p.id] || null,
        trainers: members.map((id, index) => ({
          id, ally: index % 2 === position % 2, ready: Object.hasOwn(duel.picks, id),
        })),
      } : null,
      battle: duel.battle?.view("p" + (position + 1)),
    },
    pairs: r.phase === "duelos" ? r.duels.map(duelMembers) : [],
    duelFormat: r.phase === "duelos" ? r.duelFormat : null,
    minigame: r.phase === "minigame" ? r.minigame || "market" : null,
    miniReady: r.phase === "minigame" ? r.miniReady : null,
    race: r.phase === "minigame" && r.minigame === "race" ? r.race : null,
    auction: r.phase === "minigame" && isAuction(r.minigame) ? auctionView(r) : null,
    minigameOptions: r.phase === "minigame" ? eligibleMinigames(r.players.length) : null,
    pairGame: r.phase === "minigame" && isPairMinigame(r.minigame) ? pairView(r, p) : null,
    arcade: r.phase === "minigame" && arcadeGames.includes(r.minigame) ? arcadeView(r, p) : null,
    million: r.phase === "minigame" && isQuiz(r.minigame) ? millionView(r.million, p) : null,
    quiz: r.phase === "minigame" && (!r.minigame || r.minigame === "market") && !p.done
      ? { a: p.quiz.a, b: p.quiz.b } : null,
  };
}
function addCard(r, p, type, target) {
  r.cards.push({
    id: randomUUID(), owner: p.id, type, target: target?.uid, name: target?.name,
  });
}

function beginRound(r, roll = randomInt) {
  r.cards = [];
  r.cardIndex = 0;
  for (const p of r.players) {
    p.actions = 10;
    if (r.round === 1) {
      addCard(r, p, "tutorial");
    } else {
      for (const pokemon of p.escapedPokemon || []) addCard(r, p, "cruel-trainer", pokemon);
      delete p.escapedPokemon;
      for (const pokemon of all(p)) {
        if (pokemon.happiness < 50 && p.unhappyPokemon?.some(warning => warning.uid === pokemon.uid))
          addCard(r, p, "unhappy", pokemon);
      }
      delete p.unhappyPokemon;
      if (p.walks > 5 && roll(100) < 80) addCard(r, p, "fatigue");
      if (!p.battled && p.party.length && roll(100) < 20)
        addCard(r, p, "lazy", p.party[roll(p.party.length)]);
      if (!p.restartKitUsed && !p.party.length && !p.box.length && p.money < SHOP["poke-ball"].price &&
          !captureBalls.some(ball => p.items[ball] > 0) && roll(100) < 50)
        addCard(r, p, "restart-kit");
      if (p.party.length >= 2 && roll(100) < 40) addCard(r, p, "quiet-camp");
      if (roll(100) < 20) addCard(r, p, "dusk-expedition");
    }
    p.walks = 0;
    p.battled = false;
  }
  r.phase = r.cards.length ? "cards" : "actions";
}

function resolveCard(r, p, id) {
  const card = r.cards[r.cardIndex];
  check(card.owner === p.id && card.id === id, "Aguarde o destinatário da carta.");
  if (card.type === "fatigue") p.actions -= 2;
  if (card.type === "lazy") {
    const target = p.party.find((m) => m.uid === card.target);
    target.happiness = Math.max(0, target.happiness - 10);
    target.status = "par";
  }
  if (card.type === "unhappy") {
    const target = all(p).find((m) => m.uid === card.target);
    if (target?.happiness < 50) target.unhappyWarningOwner = p.id;
  }
  if (card.type === "restart-kit" && !p.restartKitUsed) {
    grantPokeBall(p);
    p.restartKitUsed = true;
  }
  if (card.type === "quiet-camp") p.quietCamp = { first: null, complete: false };
  if (card.type === "dusk-expedition") p.duskExpedition = { complete: false };
  if (++r.cardIndex === r.cards.length) {
    r.phase = r.afterCards || "actions";
    delete r.afterCards;
  }
}

function next(r) {
  if (!r.players.every((p) => p.done)) return;
  for (const p of r.players) p.done = false;
  if (r.phase === "actions") {
    r.cards = [];
    r.cardIndex = 0;
    for (const p of r.players) {
      delete p.quietCamp;
      delete p.duskExpedition;
      for (const m of all(p)) {
        if (m.happiness >= 50) delete m.unhappyWarningOwner;
        m.happiness = Math.max(0, m.happiness - 2);
        if (m.happiness >= 50) continue;
        if (m.unhappyWarningOwner === p.id && randomInt(100) < 100 - m.happiness) {
          p.party = p.party.filter((x) => x !== m);
          p.box = p.box.filter((x) => x !== m);
          (p.escapedPokemon ??= []).push({ uid: m.uid, name: m.name });
          say(r, m.name + " fugiu de " + p.name + ".");
        } else {
          (p.unhappyPokemon ??= []).push({ uid: m.uid, name: m.name });
        }
      }
    }
    r.phase = r.round >= r.rounds ? "final" : "trocas";
  }
  else if (r.phase === "trocas") {
    r.offers = [];
    if (r.mini) startMinigame(r);
    else pair(r);
  } else if (r.phase === "minigame") {
    if (r.practiceBot) r.phase = "final";
    else pair(r);
  }
  else if (r.phase === "duelos") {
    if (r.round === r.rounds) {
      r.phase = "final";
      return;
    }
    r.round++;
    r.duels = [];
    beginRound(r);
  }
}
function startMinigame(r, roll = randomInt) {
  r.phase = "minigame";
  const options = eligibleMinigames(r.players.length);
  r.minigame = options[roll(options.length)];
  r.miniReady = [];
  delete r.race;
  delete r.million;
  delete r.auction;
  delete r.pairGame;
  delete r.arcade;
  if (arcadeGames.includes(r.minigame)) {
    r.arcade = newArcade(r);
    return;
  }
  if (isPairMinigame(r.minigame)) {
    r.pairGame = newPairGame(r);
    return;
  }
  if (isQuiz(r.minigame)) {
    r.million = newMillion(r.players, r.minigame);
    return;
  }
  if (r.minigame === "race") return;
  if (r.minigame === "market") {
    for (const p of r.players)
      p.quiz = { a: randomInt(4, 19), b: randomInt(2, 10) };
    return;
  }
  r.auction = newAuction(r);
}

function startRace(r, now) {
  let at = 1800;
  const obstacles = Array.from({length: 36}, (_, index) => {
    const obstacle = {
      at,
      type: randomInt(2) === 0 ? "jump" : "duck",
      earlyMs: Math.max(130, 370 - index * 8),
      lateMs: Math.max(80, 190 - index * 4),
    };
    at += Math.max(480, 1720 - index * 42);
    return obstacle;
  });
  r.race = {
    startsAt: now + 3000, obstacles, index: 0,
    runners: Object.fromEntries(r.players.map(p => [p.id, { alive: true }])),
    winners: null,
  };
}

function advanceRace(r, now = Date.now()) {
  const race = r.phase === "minigame" && r.race;
  if (!race || race.winners) return false;
  let changed = false;
  while (race.index < race.obstacles.length) {
    const obstacle = race.obstacles[race.index];
    const crossingAt = race.startsAt + obstacle.at;
    const bot = race.runners[r.practiceBot];
    const botDodgeAt = crossingAt - 140;
    if (bot?.alive && race.index < 4 && bot.cleared !== race.index && now >= botDodgeAt) {
      const player = r.players.find(p => p.id === r.practiceBot);
      raceAction(r, player, "dodge", {pose: obstacle.type}, botDodgeAt);
      changed = true;
    }
    const impactAt = crossingAt + (obstacle.lateMs ?? 190);
    if (now < impactAt) break;
    const survivors = Object.entries(race.runners).filter(([, runner]) => runner.alive);
    for (const [, runner] of survivors) {
      if (runner.cleared !== race.index) {
        runner.alive = false;
        runner.eliminatedAt = impactAt;
      }
    }
    race.index++;
    changed = true;
    const left = survivors.filter(([, runner]) => runner.alive);
    if (left.length <= 1 || race.index === race.obstacles.length) {
      race.winners = (left.length ? left : survivors).map(([id]) => id);
      for (const p of r.players) {
        if (race.winners.includes(p.id)) p.minigameWins = (p.minigameWins ?? 0) + 1;
      }
      race.endedAt = impactAt;
      break;
    }
  }
  return changed;
}

function raceAction(r, p, action, data, now) {
  const race = r.race;
  if (race.winners) {
    check(action === "raceContinue", "A corrida acabou.");
    p.done = true;
    next(r);
    return;
  }
  const runner = race.runners[p.id];
  check(action === "dodge" && runner.alive, "Você está fora da corrida.");
  check(now >= race.startsAt, "Aguarde a largada.");
  check(data.pose === "jump" || data.pose === "duck", "Comando inválido.");
  const obstacle = race.obstacles[race.index];
  const delta = now - race.startsAt - obstacle.at;
  if (delta >= -(obstacle.earlyMs ?? 370) && delta < (obstacle.lateMs ?? 190) && data.pose === obstacle.type)
    runner.cleared = race.index;
  runner.pose = data.pose;
  runner.poseAt = now;
  runner.poseUntil = now + 360;
}

function advancePractice(r) {
  if (!r.practiceBot || r.phase !== "minigame") return;
  const bot = r.players.find(p => p.id === r.practiceBot);
  const human = r.players.find(p => p.id !== bot.id);
  if (r.miniReady.length < r.players.length || bot.done) return;
  if (arcadeGames.includes(r.minigame)) {
    if (r.arcade.results && human.done) {
      command(r, bot, "arcadeContinue");
      return true;
    }
    return false;
  }
  if (isPairMinigame(r.minigame)) {
    if (r.pairGame.finished && human.done) {
      command(r, bot, "pairContinue");
      return true;
    }
    return practicePair(r);
  }
  if (isQuiz(r.minigame)) {
    const quiz = r.million;
    const entry = quiz.entries[bot.id];
    if (quiz.results && human.done) command(r, bot, "millionContinue");
    if (!quiz.results && entry.finishedAt == null) {
      for (const question of quiz.questions) {
        const options = millionOptions(question);
        const choice = randomInt(2) === 0 ? question.answer : options[randomInt(options.length)];
        recordAnswer(quiz, entry, choice, quiz.deadline - 12000);
      }
      advanceMillion(r);
    }
    return;
  }
  if (r.minigame === "market" && human.done)
    command(r, bot, "quiz", {answer:0});
  if (r.minigame === "race" && r.race.winners && human.done)
    command(r, bot, "raceContinue");
  if (!isAuction(r.minigame)) return;
  const auction = r.auction;
  if (auction.results.length === auction.lots.length) {
    if (human.done) {
      command(r, bot, "auctionContinue");
      return true;
    }
    return false;
  }
  if (auction.deadline == null || auction.results.some(result => result.winner === bot.id) ||
      auction.leader === bot.id || auction.passed.includes(bot.id)) return false;
  const amount = Math.min(bot.money, auction.amount + 10);
  const lot = auction.results.length;
  command(r, bot, amount > auction.amount && amount <= 90 ? "bid" : "auctionPass", {lot, amount});
  return true;
}

function newAuction(r) {
  const levels = r.players.flatMap(p => {
    const team = p.party.length ? p.party : p.box;
    return team.length ? [team.reduce((sum, m) => sum + m.level, 0) / team.length] : [];
  });
  const average = levels.length ? levels.reduce((sum, level) => sum + level, 0) / levels.length : 5;
  return {
    lots: r.players.map(() => rules.auctionPokemon(average)),
    results: [], amount: 0, leader: null, passed: [], deadline: null, nextAt: null,
  };
}

function auctionView(r) {
  const auction = r.auction;
  if (!auction.lots) return null;
  const {results, amount, leader, passed, deadline, nextAt} = auction;
  const total = auction.lots.length;
  const lot = results.length;
  const reveal = nextAt != null;
  const pokemon = reveal ? results.at(-1).pokemon : deadline != null ? auction.lots[lot] : null;
  const hidden = !!pokemon && !reveal && r.minigame === "darkAuction";
  return {
    total, lot, amount, leader, passed, deadline, reveal, hidden,
    closed: lot === total && !reveal,
    pokemon: hidden ? { spriteId: pokemon.spriteId, slug: pokemon.slug, pokemonId: pokemon.pokemonId } : pokemon,
    results,
  };
}

function eligibleBidders(r) {
  const winners = new Set(r.auction.results.map(result => result.winner));
  return r.players.filter(p => !winners.has(p.id));
}

function settleAuctionLot(r, now) {
  const auction = r.auction;
  const eligible = eligibleBidders(r);
  const winner = auction.leader ? eligible.find(p => p.id === auction.leader) : eligible[randomInt(eligible.length)];
  const amount = auction.leader ? auction.amount : Math.min(1, winner.money);
  const pokemon = auction.lots[auction.results.length];
  if (winner.party.length >= 6 && winner.box.length >= boxCapacity(winner))
    winner.boxCapacity = boxCapacity(winner) + 30;
  deposit(winner, pokemon);
  winner.money -= amount;
  if (auction.leader) winner.minigameWins = (winner.minigameWins ?? 0) + 1;
  auction.results.push({ winner: winner.id, pokemon, amount, automatic: !auction.leader });
  auction.deadline = null;
  auction.nextAt = now + auctionRevealDuration;
}

function advanceAuction(r, now = Date.now()) {
  if (r.phase !== "minigame" || !isAuction(r.minigame)) return false;
  const previous = r.auction;
  if (!previous.lots) {
    const auction = r.auction = newAuction(r);
    auction.lots[0] = previous.pokemon;
    if (previous.closed && previous.leader) {
      auction.results.push({ winner: previous.leader, pokemon: previous.pokemon, amount: previous.amount, automatic: false });
      for (const p of r.players) p.done = false;
    } else if (!previous.closed) {
      Object.assign(auction, {amount: previous.amount, leader: previous.leader, passed: previous.passed});
    }
    advanceAuction(r, now);
    return true;
  }
  const auction = r.auction;
  if (r.miniReady && r.miniReady.length < r.players.length) return false;
  if (auction.deadline != null) {
    if (now < auction.deadline) return false;
    settleAuctionLot(r, now);
    return true;
  }
  if (auction.nextAt != null && now < auction.nextAt) return false;
  if (auction.results.length === auction.lots.length) {
    if (auction.nextAt == null) return false;
    auction.nextAt = null;
    return true;
  }
  if (auction.results.length) Object.assign(auction, { amount: 0, leader: null, passed: [] });
  auction.nextAt = null;
  if (eligibleBidders(r).length === 1) settleAuctionLot(r, now);
  else auction.deadline = now + auctionDuration;
  return true;
}

function auctionAction(r, p, action, data) {
  const auction = r.auction;
  if (auction.results.length === auction.lots.length && auction.nextAt == null) {
    check(action === "auctionContinue", "O leilão acabou.");
    p.done = true;
    next(r);
    return;
  }
  const eligible = eligibleBidders(r);
  check(auction.deadline != null && Date.now() < auction.deadline &&
    data.lot === auction.results.length, "Este lote já foi encerrado.");
  check(eligible.includes(p), "Você já comprou um Pokémon.");
  check(auction.leader !== p.id && !auction.passed.includes(p.id), "Aguarde os outros lances.");
  if (action === "bid") {
    check(Number.isSafeInteger(data.amount) && data.amount > auction.amount &&
      data.amount <= p.money, "O lance deve superar o atual e caber no seu saldo.");
    auction.amount = data.amount;
    auction.leader = p.id;
  } else {
    check(action === "auctionPass", "Escolha um lance ou passe.");
    auction.passed.push(p.id);
  }
  if (eligible.every(q => q.id === auction.leader || auction.passed.includes(q.id)))
    settleAuctionLot(r, Date.now());
}

const duelFormats = [
  { id:"solo1", label:"1v1 Solo · 1 Pokémon", mode:"solo", players:2, size:1 },
  { id:"solo3", label:"1v1 Solo · 3 Pokémon", mode:"solo", players:2, size:3 },
  { id:"dual4", label:"1v1 Dual · 4 Pokémon", mode:"doubles", players:2, size:4 },
  { id:"multi4", label:"2v2 Dual · 4 Pokémon por time", mode:"multi", players:4, size:2 },
];

function eligibleDuelFormats(players) {
  return duelFormats.filter(format => players.length % format.players === 0 &&
    players.every(p => p.party.length >= format.size));
}

const duelMembers = duel => duel.trainers || [duel.a, duel.b];
const duelFor = (r, p) => r.duels.find(duel => duelMembers(duel).includes(p.id));

function pair(r) {
  r.phase = "duelos";
  const options = eligibleDuelFormats(r.players);
  const format = options.length ? options[randomInt(options.length)] : duelFormats[0];
  r.duelFormat = { selected: format, options };
  const ps = [...r.players];
  for (let i = ps.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [ps[i], ps[j]] = [ps[j], ps[i]];
  }
  r.duels = [];
  for (let i = 0; i < ps.length; i += format.players) {
    // The simulator groups p1 with p3 and p2 with p4 in Multi Battles.
    const participants = ps.slice(i, i + format.players);
    const [a, b] = participants;
    const d = { a: a.id, b: b.id, trainers: participants.map(p => p.id), result: null };
    r.duels.push(d);
    if (participants.every(p => p.party.length)) d.picks = {};
    else payout(r, d, participants.filter(p => p.party.length));
  }
}
function selectDuelTeam(r, duel, player, action, uids) {
  const members = duelMembers(duel);
  if (action === "duelEdit") {
    delete duel.picks[player.id];
    return;
  }
  check(action === "duelTeam" && !Object.hasOwn(duel.picks, player.id), "Confirme sua escalação.");
  const format = r.duelFormat.selected;
  check(Array.isArray(uids) && uids.length === format.size &&
    new Set(uids).size === format.size &&
    uids.every(uid => player.party.some(mon => mon.uid === uid)),
  "Escolha " + format.size + " Pokémon diferentes da sua equipe.");
  const picks = { ...duel.picks, [player.id]: [...uids] };
  if (!members.every(id => Object.hasOwn(picks, id))) {
    duel.picks = picks;
    return;
  }
  const teams = Object.fromEntries(members.map((id, index) => {
    const trainer = r.players.find(p => p.id === id);
    const team = structuredClone(picks[id].map(uid => trainer.party.find(mon => mon.uid === uid)));
    team.forEach(rules.heal);
    return ["p" + (index + 1), team];
  }));
  duel.battle = new BattleSession({ ...teams, mode:format.mode });
  delete duel.picks;
  for (const id of members) r.players.find(p => p.id === id).battled = true;
}

function payout(r, d, winners) {
  d.winners = winners.map(p => p.id);
  d.result = winners.length
    ? winners.map(p => p.name).join(" e ") + (winners.length === 1
      ? " venceu e ganhou ₽ 250." : " venceram e ganharam ₽ 250 cada.")
    : d.battle ? "O duelo terminou empatado." : "Empate sem equipes disponíveis.";
  for (const winner of winners) {
    winner.money += 250;
    winner.wins++;
  }
  say(r, d.result);
}
function applyXP(r, p, target, activeUid) {
  const recipients = p.party.filter(mon => mon.level < 100);
  const active = p.party.find(mon => mon.uid === activeUid) || p.party.find(mon => mon.hp > 0);
  if (!active || !recipients.length) return "";
  const total = rules.battleXP(active, target, r.mult);
  const share = Math.floor(total / recipients.length);
  const remainder = total % recipients.length;

  return recipients.map((mon, index) => {
    const amount = share + (index < remainder ? 1 : 0);
    if (!amount) return "";
    const result = rules.addXP(mon, amount, evoContext(p));
    if (!p.dex.includes(mon.speciesId)) p.dex.push(mon.speciesId);
    return " " + mon.name + " recebeu " + result.xp + " XP." +
      (result.levels ? " Nível " + mon.level + "!" : "") +
      (result.evolution ? " Evoluiu para " + result.evolution + "!" : "");
  }).join("");
}
function grantPokeBall(p) {
  p.items["poke-ball"] = (p.items["poke-ball"] || 0) + 1;
}

function closeEncounter(p, message) {
  const encounter = p.enc;
  const mission = p.duskExpedition;
  if (mission && !mission.complete && encounter.type === "wild" && encounter.period === "dusk") {
    grantPokeBall(p);
    mission.complete = true;
    message += " Expedição ao entardecer concluída! Você recebeu 1 Poké Bola.";
  }
  p.notice = message;
  p.enc = null;
}

function finishEncounter(r, p) {
  const enc = p.enc,
    v = enc.battle.view("p1");
  if (!v.ended) return;
  const won = v.winner === "p1";
  let message = "Sua equipe foi derrotada.";
  if (won) {
    const money = enc.type === "gym" ? 350 : 0;
    p.money += money;
    message = "Vitória!" + (money ? " Você ganhou ₽ " + money + "." : "") +
      applyXP(r, p, enc.target, v.own?.uid);
    if (enc.type === "gym") {
      p.badges.push(enc.rank);
      message += " Insígnia conquistada!";
    }
    if (enc.type === "elite") {
      p.eliteRun = (p.eliteRun ?? 0) + 1;
      if (p.eliteRun === 4) {
        delete p.eliteRun;
        p.elite = 4;
        p.money += 1400;
        message += " Elite Four concluída! Você ganhou ₽ 1400 e garantiu 40 pontos.";
      } else {
        message += " Use a Mochila antes do próximo desafio, se precisar.";
      }
    }
  }
  if (!won && enc.type === "elite") {
    delete p.eliteRun;
    message += " A sequência foi encerrada.";
  }
  closeEncounter(p, message);
}
function takeAction(r, p, k, d) {
  const eliteInterval = p.eliteRun != null;
  check(
    !p.done && !p.enc && (p.actions > 0 || eliteInterval || k === "item"),
    "Conclua o encontro ou avance o turno.",
  );
  const town = /^(city|village)/.test(p.loc);
  if (k === "work") {
    const job = JOBS[p.job];
    check(job && p.jobLocation === p.loc, "Visite seu local de trabalho.");
    const requirement = jobRequirement(p, job);
    check(requirement.met, requirement.text);
    const shifts = workCount(r, p, p.job);
    check(job.limit === null || shifts < job.limit, "Limite de turnos pagos atingido neste cargo.");
    if (p.workRound?.round !== r.round) p.workRound = {round:r.round, shifts:{}};
    p.workRound.shifts[p.job] = shifts + 1;
    const xp = shifts < 2 ? WORK_XP : 0;
    p.jobProgress[p.job] = (p.jobProgress[p.job] || 0) + xp;
    p.money += job.pay;
    p.notice = "Trabalho concluído. Você ganhou ₽ " + job.pay + " e " + xp + " XP.";
  } else if (k === "modifyPokemon") {
    check(hasLaboratory(p.loc), "Visite um laboratório.");
    check(p.money >= LAB_COST, "Saldo insuficiente para a modificação.");
    const m = mon(p, d.uid);
    rules.modifyTraining(m, d);
    p.money -= LAB_COST;
    m.happiness = Math.max(0, m.happiness - LAB_HAPPINESS_LOSS);
    p.notice = m.name + " foi modificado no laboratório.";
  } else if (k === "heal") {
    check(town, "Visite um centro Pokémon.");
    check(p.party.some(needsHealing), "Nenhum Pokémon precisa se recuperar.");
    check(p.money >= HEAL_COST, "Saldo insuficiente para curar a equipe.");
    p.money -= HEAL_COST;
    p.party.forEach((m) => rules.heal(m));
    p.notice = "Equipe recuperada.";
  } else if (k === "shop") {
    check(p.shopVisit === p.loc, "Entre na loja primeiro.");
    check(town, "Loja indisponível.");
    const lines = d.lines ?? [{ item: d.item, qty: d.qty, sell: Boolean(d.sell) }];
    check(Array.isArray(lines) && lines.length > 0 && lines.length <= 60, "Carrinho inválido.");
    const purchases = new Map(), sales = new Map();
    let total = 0;
    for (const line of lines) {
      check(line && Object.hasOwn(SHOP, line.item) && typeof line.sell === "boolean", "Item inválido.");
      const qty = Number(line.qty);
      check(Number.isInteger(qty) && qty >= 1 && qty <= 99, "Quantidade inválida.");
      const items = line.sell ? sales : purchases;
      const count = (items.get(line.item) || 0) + qty;
      check(count <= 99, "Limite de 99 unidades por item e operação.");
      items.set(line.item, count);
      const price = SHOP[line.item].price;
      total += qty * (line.sell ? -Math.floor(price / 2) : price);
    }
    for (const [id, qty] of sales)
      check((p.items[id] || 0) >= qty, "Estoque insuficiente para vender " + SHOP[id].name + ".");
    check(p.money >= total, "Saldo insuficiente.");
    for (const [id, qty] of sales) p.items[id] -= qty;
    for (const [id, qty] of purchases) p.items[id] = (p.items[id] || 0) + qty;
    p.money -= total;
    p.notice = "Transação concluída.";
  } else if (k === "explore") {
    check(p.loc.startsWith("biome"), "Escolha um bioma.");
    const level = Math.max(
      2,
      Math.min(100, (p.party[0]?.level || 3) + randomInt(-2, 3)),
    );
    const period = actionPeriod(p.actions);
    const wild = rules.encounter(BIOMES[Number(p.loc.slice(5)) - 1], level, undefined, period);
    const team = p.party.filter((m) => m.hp > 0);
    p.enc = {
      type: "wild",
      period,
      startedActions: p.actions,
      wild,
      target: wild,
      battle: team.length
        ? new BattleSession({ p1: team, p2: [wild], cpu: true })
        : null,
    };
  } else if (k === "gym") {
    const rank = p.badges.length + 1,
      elite = rank === 9;
    check(
      elite ? p.loc === leagueIsland : p.loc === "city" + rank,
      elite ? "Visite a Ilha da Liga." : "Visite a próxima cidade da Liga.",
    );
    check(
      p.elite < 4 && p.party.some((m) => m.hp > 0),
      "É preciso ter uma equipe apta e um desafio disponível.",
    );
    const leaderIndex = elite ? 8 + (p.eliteRun ?? 0) : rank - 1;
    const levels = gymLevels(r)[leaderIndex];
    const team = LEADERS[leaderIndex].team.map((species, index) =>
      rules.createMon(species, levels[index]));
    p.enc = {
      type: elite ? "elite" : "gym",
      period: actionPeriod(p.actions),
      startedActions: p.actions,
      rank,
      target: team.at(-1),
      battle: new BattleSession({
        p1: p.party.filter((m) => m.hp > 0),
        p2: team,
        cpu: true,
      }),
    };
    if (elite) p.eliteRun ??= 0;
  } else if (k === "pet") {
    const m = mon(p, d.uid);
    const camp = p.quietCamp;
    let bonus = 0;
    if (camp && !camp.complete && p.party.includes(m)) {
      if (camp.first === null) camp.first = m.uid;
      else if (camp.first !== m.uid) {
        camp.complete = true;
        bonus = 10;
      }
    }
    m.happiness = Math.min(255, m.happiness + 25 + bonus);
    p.petsGiven = (p.petsGiven ?? 0) + 1;
    if (!p.dex.includes(m.speciesId)) p.dex.push(m.speciesId);
    p.notice = m.name + " ficou mais feliz.";
    if (bonus) p.notice += " Acampamento tranquilo concluído!";
  } else if (k === "item") {
    const m = mon(p, d.uid);
    check(Object.hasOwn(SHOP, d.item) && (p.items[d.item] || 0) > 0, "Item indisponível.");
    if (d.item === "potion") {
      check(m.hp > 0 && m.hp < m.maxhp, "Escolha um Pokémon ferido.");
      m.hp = Math.min(m.maxhp, m.hp + 20);
    } else if (SHOP[d.item]?.held) {
      if (m.heldItem) p.items[m.heldItem] = (p.items[m.heldItem] || 0) + 1;
      m.heldItem = d.item;
    } else {
      check(
        SHOP[d.item].category === "evolution" &&
          rules.evolve(m, "use-item", { ...evoContext(p), item: d.item }),
        "Esse item não evolui este Pokémon.",
      );
      if (!p.dex.includes(m.speciesId)) p.dex.push(m.speciesId);
    }
    p.items[d.item]--;
    p.notice = "Item utilizado.";
  } else throw Error("Ação desconhecida.");
  if (!eliteInterval && k !== "item") p.actions--;
}
function asset(p, a) {
  check(a && ["money", "item", "mon"].includes(a.kind), "Oferta inválida.");
  if (a.kind === "mon") {
    mon(p, a.id);
    return;
  }
  check(Number.isSafeInteger(a.qty) && a.qty > 0, "Quantidade inválida.");
  check(
    a.kind === "money"
      ? p.money >= a.qty
      : Object.hasOwn(SHOP, a.id) && (p.items[a.id] || 0) >= a.qty,
    "Saldo ou estoque insuficiente.",
  );
}
function transfer(p, q, a) {
  if (a.kind === "money") {
    p.money -= a.qty;
    q.money += a.qty;
  } else if (a.kind === "item") {
    p.items[a.id] -= a.qty;
    q.items[a.id] = (q.items[a.id] || 0) + a.qty;
  } else {
    const m = mon(p, a.id);
    p.party = p.party.filter((x) => x !== m);
    p.box = p.box.filter((x) => x !== m);
    return m;
  }
}
const pendingOffer = o => !o.status || o.status === "pending";
function tradeSide(owner, value) {
  const list = Array.isArray(value) ? value : [value];
  check(list.length, "Inclua pelo menos um bem de cada lado.");
  const keys = new Set();
  return list.map(a => {
    asset(owner, a);
    const key = a.kind === "money" ? "money" : a.kind + ":" + a.id;
    check(!keys.has(key), "Junte os bens repetidos em uma única entrada.");
    keys.add(key);
    if (a.kind !== "mon") return {kind:a.kind, id:a.kind === "item" ? a.id : undefined, qty:a.qty};
    const m = mon(owner, a.id);
    const {name, level, shiny, slug, spriteId, pokemonId, speciesId, types} = m;
    return {kind:"mon", id:a.id, inParty:owner.party.includes(m),
      pokemon:{name, level, shiny, slug, spriteId, pokemonId, speciesId, types}};
  });
}
function tradeTerms(from, to, give, want, preview = false) {
  const terms = [tradeSide(from, give), tradeSide(to, want)];
  for (const [index, owner] of [from, to].entries()) {
    const outgoing = terms[index].filter(a => a.kind === "mon");
    const incoming = terms[1-index].filter(a => a.kind === "mon");
    check(all(owner).length - outgoing.length + incoming.length <= boxCapacity(owner) + 6, "Equipe e boxes cheias.");
    if (preview) {
      const counterparts = incoming.length ? incoming.map(a => a.pokemon.speciesId) : [undefined];
      for (const a of outgoing)
        a.evolves = counterparts.some(tradeSpeciesId =>
          rules.evolve(structuredClone(mon(owner, a.id)), "trade", {tradeSpeciesId}));
    }
  }
  return terms;
}
function negotiate(r, p, action, d) {
  const original = r.offers.find(o => o.id === d.id && pendingOffer(o));
  if (action === "offer" || action === "counter") {
    if (action === "counter") check(original?.to === p.id, "Contraproposta indisponível.");
    const q = r.players.find(q => q.id === (action === "counter" ? original.from : d.to) && !q.done && q !== p);
    check(q, "Jogador indisponível.");
    check(r.offers.filter(o => pendingOffer(o) && o.from === p.id).length < 12, "Limite de 12 ofertas pendentes.");
    const [give, want] = tradeTerms(p, q, d.give, d.want, true);
    const proposal = {id:randomUUID(), from:p.id, to:q.id, give, want, status:"pending"};
    if (original && action === "counter") {
      original.status = "countered";
      proposal.replaces = original.id;
    }
    r.offers.push(proposal);
    return;
  }
  check(original && [original.from, original.to].includes(p.id), "Oferta indisponível.");
  if (action === "cancel" || action === "decline") {
    check(p.id === (action === "cancel" ? original.from : original.to), "Ação indisponível.");
    original.status = action === "cancel" ? "cancelled" : "declined";
    return;
  }
  check(action === "accept" && p.id === original.to, "Somente o destinatário pode aceitar.");
  const q = r.players.find(q => q.id === original.from);
  check(!q.done, "O jogador encerrou as trocas.");
  check(!learningMon(q), "O outro treinador está escolhendo um golpe.");
  let give, want;
  try {
    [give, want] = tradeTerms(q, p, original.give, original.want);
  } catch (error) {
    original.status = "invalid";
    original.reason = error.message;
    return {tradeNotice:"Oferta inválida. " + error.message};
  }
  const received = give.map(a => transfer(q, p, a)).filter(Boolean);
  const returned = want.map(a => transfer(p, q, a)).filter(Boolean);
  const receivedSpecies = received.map(m => m.speciesId);
  const returnedSpecies = returned.map(m => m.speciesId);
  for (const [owner, incoming, outgoing] of [[p, received, returnedSpecies], [q, returned, receivedSpecies]]) {
    for (const m of incoming) {
      deposit(owner, m);
      (outgoing.length ? outgoing : [undefined]).some(tradeSpeciesId => rules.evolve(m, "trade", {
        tradeSpeciesId, onEvolution:evolutionListener(owner),
      }));
      if (!owner.dex.includes(m.speciesId)) owner.dex.push(m.speciesId);
    }
  }
  original.status = "accepted";
  return {tradeNotice:"Troca concluída."};
}
function execute(r, p, k, d = {}) {
  const phase = r.phase;
  if (phase === "lobby") {
    if (k === "avatar") {
      check(Object.hasOwn(avatars, d.avatar), "Personagem indisponível.");
      check(!r.players.some((q) => q !== p && q.avatar === d.avatar), "Esse personagem já está em uso.");
      if (p.avatar !== d.avatar) {
        p.avatar = d.avatar;
        p.ready = false;
      }
      return;
    }
    if (k === "ready") {
      p.ready = !p.ready;
      return;
    }
    check(k === "start" && p.id === r.host, "Apenas o anfitrião inicia.");
    check(
      validPlayerCount(r.players.length),
      "A expedição exige de 2 a 12 treinadores, em número par.",
    );
    check(r.players.every((q) => q.ready), "Todos os treinadores devem estar prontos.");
    check(new Set(r.players.map((q) => q.avatar)).size === r.players.length,
      "Cada treinador precisa de um personagem diferente.");
    check(
      Number.isInteger(d.rounds) &&
        d.rounds >= 1 &&
        d.rounds <= 40 &&
        Number.isFinite(d.mult) &&
        d.mult >= 0.25 &&
        d.mult <= 30,
      "Configuração inválida.",
    );
    r.rounds = d.rounds;
    r.mult = d.mult;
    r.mini = !!d.mini;
    beginRound(r);
    return;
  }
  if (phase === "cards") {
    check(k === "card", "Aguarde a leitura das cartas.");
    resolveCard(r, p, d.id);
    return;
  }
  if (phase === "actions" || phase === "trocas") {
    const learning = learningMon(p);
    if (k === "resolveMove") {
      check(learning && learning.uid === d.uid &&
        rules.resolveMove(learning, d.move, d.replace), "Escolha de golpe inválida.");
      return;
    }
    check(!learning, "Decida se quer aprender o novo golpe primeiro.");
  }
  if (phase === "actions" && p.eliteRun != null && !p.enc) {
    if (k === "abandonElite") {
      delete p.eliteRun;
      p.notice = "Você encerrou a sequência da Elite Four.";
      return;
    }
    check(k === "gym" || k === "item", "Continue ou encerre a sequência da Elite Four.");
  }
  if (k === "finish") {
    check(
      !p.done &&
        !p.enc &&
        ["actions", "trocas", "duelos"].includes(phase),
      "Ainda há uma etapa pendente.",
    );
    if (phase === "duelos")
      check(
        duelFor(r, p)?.result,
        "Complete seu duelo.",
      );
    if (phase === "trocas") {
      for (const o of r.offers)
        if (pendingOffer(o) && [o.from, o.to].includes(p.id)) {
          o.status = "cancelled";
          o.reason = "Um treinador encerrou as negociações.";
        }
    }
    p.shopVisit = null;
    p.done = true;
    next(r);
    return;
  }
  if (k === "box" && (phase === "actions" || phase === "trocas")) {
    check(!p.enc, "Termine o encontro.");
    const m = mon(p, d.uid),
      wasParty = p.party.includes(m);
    const target = d.target || (wasParty ? "box" : "party");
    check(["box", "party"].includes(target), "Destino inválido.");
    const slot = d.slot ?? (target === "box" ? freeSlot(p) : p.party.length);
    check(
      Number.isInteger(slot) &&
        slot >= 0 &&
        slot < (target === "box" ? boxCapacity(p) : 6),
      "Espaço indisponível.",
    );
    const dest =
      target === "box"
        ? p.box.find((x) => x.boxSlot === slot)
        : p.party[slot];
    if (dest === m) return;
    const origin = p.party.indexOf(m),
      oldSlot = m.boxSlot;
    const remove = (x) => {
      p.party = p.party.filter((v) => v !== x);
      p.box = p.box.filter((v) => v !== x);
    };
    remove(m);
    if (dest) remove(dest);
    function place(x, team, n) {
      if (team) {
        delete x.boxSlot;
        p.party.splice(Math.min(n, p.party.length), 0, x);
      } else {
        x.boxSlot = n;
        p.box.push(x);
      }
    }
    if (dest && wasParty && target === "party") {
      if (origin < slot) {
        place(dest, true, origin);
        place(m, true, slot);
      } else {
        place(m, true, slot);
        place(dest, true, origin);
      }
    } else {
      place(m, target === "party", slot);
      if (dest) place(dest, wasParty, wasParty ? origin : oldSlot);
    }
    return;
  }
  check(!p.done, "Aguardando os outros jogadores.");
  if (phase === "actions") {
    if (k === "leaveShop") {
      p.shopVisit = null;
      return;
    }
    if (k === "enterShop") {
      check(
        !p.enc && /^(city|village)/.test(p.loc),
        "Não há loja neste local.",
      );
      if (p.shopVisit === p.loc) return;
      check(p.actions > 0, "Sem ações disponíveis.");
      p.shopVisit = p.loc;
      return;
    }
    if (k === "move") {
      check(!p.enc, "Termine o encontro antes de viajar.");
      if (d.loc === leagueIsland) {
        check(leaguePorts.includes(p.loc), "Embarque em Costa Serena ou Monte Azul para viajar à Ilha da Liga.");
        check(hasLeagueAccess(p), "Conquiste as 8 insígnias para entrar na Ilha da Liga.");
      } else {
        check(neighbors(p.loc).includes(d.loc), "Escolha um destino ligado por uma rota.");
      }
      p.shopVisit = null;
      p.walks++;
      const from = p.loc;
      p.loc = d.loc;
      p.travel = [...p.travel, { from, loc: d.loc, step: ++p.travelStep }].slice(-10);
      return;
    }
    if (k === "hire") {
      check(!p.enc && Object.hasOwn(JOBS, d.job), "Emprego indisponível.");
      const job = JOBS[d.job];
      const city = /^city[1-8]$/.test(p.loc);
      check(job.facility === "lab" ? hasLaboratory(p.loc) : city || job.place === p.loc,
        "Visite um posto de trabalho ou o local da vaga.");
      const requirement = jobRequirement(p, job);
      check(requirement.met, requirement.text);
      const place = job.place || p.loc;
      check(p.job !== d.job || p.jobLocation !== place, "Você já ocupa esta vaga.");
      check(p.actions > 0, "Sem ações para assumir a vaga.");
      p.actions--;
      p.job = d.job;
      p.jobLocation = place;
      p.notice = "Novo emprego: " + job.name + ".";
      return;
    }
    if (k === "lead") {
      check(!p.enc, "Termine o encontro.");
      const index = p.party.findIndex((m) => m.uid === d.uid);
      check(index >= 0, "Pokémon fora da equipe.");
      p.party.unshift(p.party.splice(index, 1)[0]);
      return;
    }
    if (["fight", "catch", "flee", "battlePotion"].includes(k)) {
      const e = p.enc;
      check(e, "Encontro encerrado.");
      if (k === "fight") {
        check(e.battle, "Sem equipe para lutar.");
        e.battle.choose("p1", d.cmd);
        finishEncounter(r, p);
        return;
      }
      if (k === "battlePotion") {
        check(
          p.items.potion > 0 && e.battle?.canUseItem("p1"),
          "Poção indisponível.",
        );
        const active = e.battle.engine.p1.active[0];
        check(
          active.hp > 0 && active.hp < active.maxhp,
          "O Pokémon precisa estar ferido.",
        );
        active.heal(20);
        p.items.potion--;
        e.battle.cpuTurnAfterItem("p1");
        finishEncounter(r, p);
        return;
      }
      check(e.type === "wild", "Ação exclusiva de encontros selvagens.");
      if (k === "flee") {
        closeEncounter(p, "Você escapou.");
        return;
      }
      check(
        captureBalls.includes(d.ball) &&
          (p.items[d.ball] || 0) > 0,
        "Poké Bola indisponível.",
      );
      check(
        !e.battle || e.battle.canUseItem("p1"),
        "Troque o Pokémon desmaiado antes de lançar a bola.",
      );
      check(p.party.length < 6 || p.box.length < boxCapacity(p), "Equipe e boxes cheias.");
      p.items[d.ball]--;
      const caught = rules.capture(e.wild, d.ball);
      if (caught) {
        deposit(p, e.wild);
        if (e.wild.shiny) p.shinyCaught = (p.shinyCaught || 0) + 1;
        closeEncounter(p, e.wild.name + " capturado!");
      } else {
        p.notice = "O Pokémon escapou da bola.";
        if (e.battle) {
          e.battle.cpuTurnAfterItem("p1");
          finishEncounter(r, p);
        }
      }
      return { caught };
    }
    takeAction(r, p, k, d);
    return;
  }
  if (phase === "trocas") return negotiate(r, p, k, d);
  if (phase === "minigame") {
    if (r.miniReady && r.miniReady.length < r.players.length) {
      check(k === "miniReady", "Todos precisam confirmar o tutorial.");
      if (!r.miniReady.includes(p.id)) r.miniReady.push(p.id);
      if (r.minigame === "race" && r.miniReady.length === r.players.length)
        startRace(r, Date.now());
      if (isQuiz(r.minigame) && r.miniReady.length === r.players.length)
        r.million.deadline = Date.now() + 45000;
      if (isPairMinigame(r.minigame) && r.miniReady.length === r.players.length)
        r.pairGame.deadline = Date.now() + 60000;
      if (arcadeGames.includes(r.minigame) && r.miniReady.length === r.players.length)
        beginArcade(r);
      if (isAuction(r.minigame)) advanceAuction(r);
      return;
    }
    if (r.minigame === "race") {
      raceAction(r, p, k, d, Date.now());
      return;
    }
    if (isAuction(r.minigame)) {
      auctionAction(r, p, k, d);
      return;
    }
    if (isPairMinigame(r.minigame)) {
      if (r.pairGame.finished) {
        check(k === "pairContinue", "O minigame terminou.");
        p.done = true;
        next(r);
      } else pairAction(r, p, k, d);
      return;
    }
    if (arcadeGames.includes(r.minigame)) {
      if (r.arcade.results) {
        check(k === "arcadeContinue", "O minigame terminou.");
        p.done = true;
        next(r);
      } else arcadeAction(r, p, k, d);
      return;
    }
    if (isQuiz(r.minigame)) {
      const quiz = r.million;
      if (quiz.results) {
        check(k === "millionContinue", "O quiz terminou.");
        p.done = true;
        next(r);
        return;
      }
      const now = Date.now();
      const entry = quiz.entries[p.id];
      check(now < quiz.deadline, "O tempo acabou.");
      check(k === "millionAnswer" && d.index === entry.answers.length &&
        d.index < quiz.questions.length && Number.isInteger(d.choice) && d.choice >= 0,
        "Alternativa indisponível.");
      const choice = millionOptions(quiz.questions[d.index])[d.choice];
      check(choice !== undefined, "Alternativa indisponível.");
      recordAnswer(quiz, entry, choice, now);
      advanceMillion(r, now);
      return;
    }
    check(k === "quiz", "Responda ao desafio.");
    const ok = Number(d.answer) === p.quiz.a * p.quiz.b;
    if (ok) {
      p.money += 180;
      p.minigameWins = (p.minigameWins ?? 0) + 1;
    }
    p.notice = ok ? "Resposta certa! ₽ 180." : "Resposta incorreta.";
    p.shopVisit = null;
    p.done = true;
    next(r);
    return;
  }
  if (phase === "duelos") {
    const t = duelFor(r, p);
    if (t?.picks && !t.battle && !t.result) {
      selectDuelTeam(r, t, p, k, d.uids);
      return;
    }
    check(k === "fight" && t?.battle && !t.result, "Duelo indisponível.");
    const members = duelMembers(t);
    const side = "p" + (members.indexOf(p.id) + 1);
    t.battle.choose(side, d.cmd);
    const v = t.battle.view(side);
    if (v.ended) {
      const winningSide = v.winner ? (Number(v.winner.slice(1)) - 1) % 2 : -1;
      const winners = members.filter((_, index) => index % 2 === winningSide)
        .map(id => r.players.find(q => q.id === id));
      payout(r, t, winners);
    }
    return;
  }
  throw Error("Partida encerrada.");
}
function command(r, p, k, d = {}) {
  const remaining = p.actions,
    phase = r.phase;
  const result = execute(r, p, k, d);
  if (phase === "actions" && p.enc?.battle) p.battled = true;
  if (phase !== "actions" || r.phase !== "actions" || p.done) return result;
  if (p.actions < remaining) {
    p.pendingStatus = p.party
      .filter((m) => m.hp > 0 && ["psn", "tox", "brn"].includes(m.status))
      .map((m) => ({ uid: m.uid, status: m.status }));
  }
  if (!p.enc && p.eliteRun == null && p.pendingStatus) {
    for (const tick of p.pendingStatus) {
      const m = p.party.find((m) => m.uid === tick.uid);
      if (m && m.status === tick.status)
        m.hp = Math.max(
          0,
          m.hp -
            Math.max(1, Math.floor(m.maxhp / (m.status === "brn" ? 16 : 8))),
        );
    }
    delete p.pendingStatus;
  }
  if (!p.enc && p.eliteRun == null && p.actions === 0 && !learningMon(p)) {
    p.shopVisit = null;
    p.done = true;
    next(r);
  }
  return result;
}
module.exports = { minigames, eligibleMinigames, eligibleDuelFormats, advancePractice, advanceRace, advanceAuction, startMinigame, beginRound, newRoom, player, view, command };
