const { leagueIsland, leaguePorts, hasLeagueAccess } = ExpeditionWorld;
const $ = (id) => document.getElementById(id);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const btn = (text, action, data = {}, kind = "", item) =>
  '<button class="' +
  kind +
  '" data-action="' +
  action +
  '" data-args="' +
  esc(JSON.stringify(data)) +
  '">' +
  (item ? itemArt(item) : "") +
  esc(text) +
  "</button>";
const opt = (value, text) =>
  '<option value="' + esc(value) + '">' + esc(text) + "</option>";
const panel = (title, body) =>
  '<section class="panel"><h3>' + esc(title) + "</h3>" + body + "</section>";
const select = (id, opts) =>
  '<select aria-label="' + id + '" id="' + id + '">' + opts + "</select>";
const v = (id) => $(id)?.value;
const locName = (id) => LOCATIONS.find((l) => l.id === id)?.name || id;
const phases = {
  actions: "Expedição",
  cards: "Cartas da rodada",

  minigame: "Minigame",
  duelos: "Duelos de treinadores",
  final: "Classificação final",
};
const practiceMode = location.pathname === "/test-minigames/play";
const testLobbyMode = new URLSearchParams(location.search).get("teste") === "1";
const sessionKey = practiceMode ? "auroraPractice" : testLobbyMode ? "auroraTestLobby" : "aurora";
let session = JSON.parse(sessionStorage.getItem(sessionKey) || "null"),
  state,
  mode = "create",
  busy = false,
  mapMounted = false,
  last = "",
  polling = false,
  sequence = 0,
  timer;
function toast(msg) {
  $("toast").textContent = msg;
  $("toast").hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => ($("toast").hidden = true), 3500);
}
let serverOffset = 0;
let clockRtt = Infinity;
function syncClock(clock, sentAt) {
  if (!clock) return;
  const rtt = Date.now() - sentAt;
  const sample = clock - sentAt - rtt / 2;
  if (!Number.isFinite(clockRtt)) serverOffset = sample;
  else if (rtt <= clockRtt + 50)
    serverOffset += Math.max(-12, Math.min(12, (sample - serverOffset) * .22));
  clockRtt = Math.min(rtt, clockRtt * 1.04 + 1);
}

const realtimeKinds = new Set(["magnetic", "race", "rhythm", "sorter"]);
const peerVisuals = new Map();
let peerRoom;

function gatherPeerIce(peer) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise(resolve => {
    function finish() {
      clearTimeout(timer);
      peer.removeEventListener("icegatheringstatechange", changed);
      resolve();
    }
    function changed() { if (peer.iceGatheringState === "complete") finish(); }
    const timer = setTimeout(finish, 2500);
    peer.addEventListener("icegatheringstatechange", changed);
  });
}

async function peerSignal(room, data = {}) {
  const response = await fetch("/api", {
    method:"POST", headers:{"Content-Type":"application/json"}, signal:AbortSignal.timeout(6000),
    body:JSON.stringify({...room.session, action:"peerSignal", round:room.round, kind:room.kind, ...data}),
  });
  if (!response.ok) throw Error("Sinalização indisponível.");
  return response.json();
}

function relayVisual(room, id, data, except) {
  const message = JSON.stringify({id, ...data});
  for (const [target, link] of room.links)
    if (target !== except && link.channel?.readyState === "open" && link.channel.bufferedAmount < 8192)
      link.channel.send(message);
}

function attachPeerChannel(room, id, link, channel) {
  if (channel.label !== "aurora-live") { channel.close(); return; }
  link.channel = channel;
  channel.onmessage = ({data}) => {
    if (peerRoom !== room || typeof data !== "string" || data.length > 240) return;
    let packet;
    try { packet = JSON.parse(data); } catch { return; }
    if (!packet || typeof packet !== "object") return;
    const actor = room.isHost ? id : packet.id;
    if (actor === room.you || !state?.players.some(p => p.id === actor)) return;
    if (!Number.isSafeInteger(packet.seq) || packet.seq <= (room.received.get(actor) ?? 0)) return;
    const visual = {seq:packet.seq};
    if (room.kind === "magnetic" && Number.isInteger(packet.cell) && packet.cell >= 0 && packet.cell < 25)
      visual.cell = packet.cell;
    else if (room.kind === "race" && ["jump","duck"].includes(packet.pose)) visual.pose = packet.pose;
    else if (["rhythm","sorter"].includes(room.kind) && Number.isInteger(packet.lane) &&
        packet.lane >= 0 && packet.lane < (room.kind === "rhythm" ? 4 : 3)) visual.lane = packet.lane;
    else return;
    room.received.set(actor, packet.seq);
    peerVisuals.set(actor, {...visual, at:Date.now() + serverOffset});
    if (room.isHost) relayVisual(room, actor, visual, actor);
  };
}

function createPeerLink(room, id, nonce) {
  room.links.get(id)?.peer.close();
  room.received.delete(id);
  const peer = new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
  const link = {peer, nonce};
  room.links.set(id, link);
  return link;
}

async function answerPeer(room, id, signal) {
  const link = createPeerLink(room, id, signal.nonce);
  const peer = link.peer;
  peer.ondatachannel = ({channel}) => attachPeerChannel(room, id, link, channel);
  try {
    await peer.setRemoteDescription(signal.offer);
    await peer.setLocalDescription(await peer.createAnswer());
    await gatherPeerIce(peer);
    if (peerRoom === room && room.links.get(id) === link)
      await peerSignal(room, {target:id, nonce:link.nonce, description:peer.localDescription});
  } catch {
    peer.close();
    if (room.links.get(id) === link) room.links.delete(id);
  }
}

async function refreshPeers(room) {
  if (peerRoom !== room) return;
  try {
    if (room.isHost) {
      const {links} = await peerSignal(room);
      if (peerRoom !== room) return;
      await Promise.all(Object.entries(links).filter(([id, signal]) =>
        room.links.get(id)?.nonce !== signal.nonce).map(([id, signal]) => answerPeer(room, id, signal)));
    } else {
      let link = room.links.get(room.host);
      if (!link || ["closed","failed"].includes(link.peer.connectionState) ||
          (link.channel.readyState !== "open" && Date.now() - link.started > 18000)) {
        const nonce = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2,"0")).join("");
        link = createPeerLink(room, room.host, nonce);
        link.started = Date.now();
        const peer = link.peer;
        attachPeerChannel(room, room.host, link, peer.createDataChannel("aurora-live", {ordered:false, maxRetransmits:0}));
        try {
          await peer.setLocalDescription(await peer.createOffer());
          await gatherPeerIce(peer);
          if (peerRoom !== room) return;
          await peerSignal(room, {nonce, description:peer.localDescription});
        } catch (error) { peer.close(); throw error; }
      } else if (!link.peer.remoteDescription) {
        const {link:signal} = await peerSignal(room);
        if (peerRoom === room && signal?.nonce === link.nonce && signal.answer)
          await link.peer.setRemoteDescription(signal.answer);
      }
    }
  } catch {
    // The game state and the official inputs still use the regular API.
  } finally {
    if (peerRoom === room) setTimeout(() => refreshPeers(room), room.isHost ? 850 : 700);
  }
}

function connectRealtime(s) {
  const key = session && !practiceMode && s.host && s.phase === "minigame" &&
    realtimeKinds.has(s.minigame) && !s.race?.winners && !s.arcade?.results &&
    window.RTCPeerConnection ? session.code + ":" + s.round + ":" + s.minigame : null;
  if ((peerRoom?.key ?? null) === key) return;
  const previous = peerRoom;
  peerRoom = null;
  if (previous) for (const link of previous.links.values()) link.peer.close();
  peerVisuals.clear();
  if (!key) return;
  const room = peerRoom = {key, session:{...session}, round:s.round, kind:s.minigame, host:s.host,
    you:s.you.id, isHost:s.host === s.you.id, links:new Map(), received:new Map(), seq:0};
  refreshPeers(room);
}

function predictReflex(action, data) {
  const s = state;
  if (s?.phase !== "minigame" || !realtimeKinds.has(s.minigame)) return;
  const now = Date.now() + serverOffset;
  const last = peerVisuals.get(s.you.id);
  let visual;
  if (action === "arcadeMove" && s.arcade?.you.alive && !s.arcade.results && now < s.arcade.deadline) {
    const delta = {up:-5, down:5, left:-1, right:1}[data.direction];
    const cell = last?.cell != null && now - last.at < 240 ? last.cell : s.arcade.you.cell;
    const next = cell + delta;
    if (!Number.isInteger(next) || next < 0 || next >= 25 || (Math.abs(delta) === 1 &&
        Math.floor(next / 5) !== Math.floor(cell / 5))) return;
    visual = {cell:next};
  } else if (action === "dodge" && s.race?.runners[s.you.id]?.alive && !s.race.winners && now >= s.race.startsAt) {
    visual = {pose:data.pose};
  } else if (action === "arcadeTap" && s.arcade?.start <= now && now < s.arcade?.deadline) {
    visual = {lane:data.lane};
  }
  if (!visual) return;
  peerVisuals.set(s.you.id, {...visual, at:now});
  if (peerRoom) relayVisual(peerRoom, s.you.id, {...visual, seq:++peerRoom.seq});
}

async function request(payload) {
  const sentAt = Date.now();
  const response = await fetch("/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...session, ...payload }),
  });
  const data = await response.json();
  syncClock(data.clock, sentAt);
  if (response.status === 403) {
    session = null;
    sessionStorage.removeItem(sessionKey);
    const expired = $("sessionEnded");
    if (!expired.open) expired.showModal();
  }
  if (!response.ok) throw Error(data.error || "Falha de conexão.");
  return data;
}
const cardArt = {
  tutorial: ["Tutorial", "city-pixel.png", "compass"],
  fatigue: ["Cansaço", "neve-pixel.png", "footprints"],
  lazy: ["Pokémon preguiçoso", "campo-pixel.png", "moon"],
  unhappy: ["Pokémon infeliz", "campo-pixel.png", "moon"],
  "cruel-trainer": ["Treinador do mal", "neve-pixel.png", "footprints"],
  "restart-kit": ["Kit de recomeço", "city-pixel.png", "compass"],
  "quiet-camp": ["Acampamento tranquilo", "floresta-pixel.png", "moon"],
  "dusk-expedition": ["Expedição ao entardecer", "lago-pixel.png", "compass"],
};
function renderCard(s) {
  const dialog = $("roundCard");
  if ($("evolutionScene").open) return;
  const card = s.roundCards?.active;
  if (!card) {
    if (dialog.open) dialog.close();
    delete dialog.dataset.card;
    renderEvolution(s);
    return;
  }
  if (dialog.dataset.card !== card.id) {
    dialog.dataset.card = card.id;
    const [title, art, icon] = cardArt[card.type];
    const text = {
      tutorial: "Vá ao posto de trabalho, escolha uma vaga e trabalhe no local indicado. Com seu primeiro salário, compre Poké Bolas e explore um bioma para tentar sua primeira captura.",
      fatigue: "Você percorreu mais de cinco trechos na última expedição. Comece esta rodada com duas ações a menos.",
      lazy: (card.name || "") + " passou a rodada sem batalhar com seu treinador. Perde 10 de felicidade e fica paralisado.",
      unhappy: card.name + " terminou a rodada passada com menos de 50 de felicidade. Se continuar abaixo de 50 ao fim desta rodada, ele pode fugir. Acaricie seu Pokémon para aumentar a felicidade.",
      "cruel-trainer": card.name + " fugiu por estar muito infeliz e saiu da sua coleção de Pokémon.",
      "restart-kit": "Você recebeu 1 Poké Bola para tentar uma nova captura. Este kit só pode ser recebido uma vez por partida.",
      "quiet-camp": "Faça carinho em dois Pokémon diferentes da sua equipe nesta rodada. O segundo ganha 10 de felicidade extra.",
      "dusk-expedition": "Comece uma exploração com 4 ou 5 ações restantes e conclua o encontro nesta rodada para ganhar 1 Poké Bola.",
    };
    dialog.innerHTML = '<div class="card-art" style="background-image:url(scenes/' + art +
      ')"><span class="card-round">Rodada ' + s.round + ' · Carta ' + (s.roundCards.read + 1) + ' de ' +
      s.roundCards.total + '</span></div><div class="card-copy"><span class="card-seal">' +
      uiIcon(icon) + '</span><small>' + esc(s.you.name) + '</small><h2 id="cardTitle">' + title +
      '</h2><p>' + esc(text[card.type]) + '</p>' +
      btn("Continuar", "card", {id:card.id}, "primary") + '</div>';
    if (dialog.open) dialog.querySelector("button").focus();
  }
  if (!dialog.open) dialog.showModal();
}
$("roundCard").oncancel = event => event.preventDefault();
$("roundCard").onclick = event => {
  const card = state?.roundCards?.active;
  if (event.target.closest("button") || !card || $("roundCard").dataset.card !== card.id) return;
  const bounds = $("roundCard").getBoundingClientRect();
  if (event.clientX >= bounds.left &&
      event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom)
    act("card", { id: card.id });
};

let battlePlayback = false;
let queuedBattleState;
function setState(s, afterPlayback = false) {
  if (battlePlayback) {
    queuedBattleState = s;
    return;
  }
  if (state?.alphabet?.startsAt && s.alphabet?.startsAt === state.alphabet.startsAt &&
      (s.alphabet.turn !== state.alphabet.turn || (!state.alphabet.winners && s.alphabet.winners)))
    playNotes(s.alphabet.last?.name ? [[520,710,.12],[710,880,.15]] : [[240,105,.22]]);
  const before = state?.you.enc?.battle || (!state?.duel?.result && state?.duel?.battle);
  const after = s.you.enc?.battle || (!state?.duel?.result && s.duel?.battle);
  const terminalEvents = state?.you.enc?.battle && !s.you.enc &&
    /Vitória|derrotada/.test(s.you.notice) ? s.you.lastBattle : null;
  const events = before && (after?.timeline || terminalEvents)?.filter(event => event.index >= before.timelineLength);
  if (!afterPlayback && events?.length && !$("arena").hidden) {
    battlePlayback = true;
    $("arena").inert = true;
    playBattleEvents(events).finally(() => {
      battlePlayback = false;
      $("arena").inert = false;
      setState(s, true);
      const queued = queuedBattleState;
      queuedBattleState = null;
      if (queued) setState(queued);
    });
    return;
  }
  connectRealtime(s);
  playPairFeedback(state?.pairGame, s.pairGame);
  const soloEnd =
    state?.you.enc?.battle &&
    !s.you.enc &&
    /Vitória|derrotada/.test(s.you.notice);
  const duelEnd = state?.duel?.battle && !state.duel.result && s.duel?.result;
  if (soloEnd || duelEnd) {
    const won = soloEnd
      ? s.you.notice.startsWith("Vitória")
      : (s.duel.won ?? s.duel.result.startsWith(s.you.name + " venceu"));
    battleEnding(won, soloEnd ? s.you.notice : s.duel.result);
    if (soloEnd && state.you.enc.type === "elite" && s.phase === "actions" && !s.you.done) {
      drawer = "facility";
      activeFacility = "gym";
    }
  }
  if (state && s.phase !== "final" && s.phase !== "cards" && state.phase !== "cards" &&
      (state.phase !== s.phase || state.round !== s.round))
    cinematic(
      "phase",
      "Rodada " + s.round + " · " + (phases[s.phase] || "Expedição"),
      1500,
    );
  const previous = state;
  if (previous?.code === s.code && previous.you.id === s.you.id) {
    const resolved = s.offers.find(offer => offer.from === s.you.id && !isPendingTrade(offer) &&
      previous.offers.some(old => old.id === offer.id && isPendingTrade(old)));
    if (resolved) toast("Proposta " + tradeLabels[resolved.status].toLocaleLowerCase("pt-BR") + ".");
  }
  state = s;
  const signature = JSON.stringify(s);
  if (signature !== last) {
    last = signature;
    render();
    renderCard(s);
    renderMoveLesson(s);
  }
}

function renderMoveLesson(s) {
  const dialog = $("moveLesson");
  const lesson = s.you.moveLesson;
  if (!lesson || s.phase !== "actions" || document.querySelector(".ending") ||
      $("roundCard").open || $("evolutionScene").open) {
    if (dialog.open) dialog.close();
    return;
  }
  const key = lesson.uid + ":" + lesson.move;
  if (dialog.open && dialog.dataset.lesson === key) return;
  dialog.dataset.lesson = key;
  const choice = { uid: lesson.uid, move: lesson.move };
  const details = move => [
    moveTypes[move.type] || move.type, moveCategories[move.category] || move.category,
    "Poder " + (move.basePower || "—"), "Precisão " + (move.accuracy === true ? "Não falha" : move.accuracy + "%"),
    move.pp + " PP", move.shortDesc,
  ].filter(Boolean).join(" · ");
  const name = move => '<span class="lesson-move" title="' + esc(details(move)) +
    '" tabindex="0" aria-description="' + esc(details(move)) + '">' + esc(move.name) + '</span>';
  dialog.innerHTML = '<h2 id="moveLessonTitle">Aprender golpe</h2><p>' +
    esc(lesson.pokemon) + ' quer aprender ' + name(lesson) +
    '. Escolha o slot a substituir.</p><div class="move-lesson-options">' +
    lesson.known.map((move, index) => '<article><small>Slot ' + (index + 1) + '</small>' +
      name(move) + btn("Substituir", "resolveMove", {...choice, replace:move.id}) + '</article>').join("") +
    '</div><footer>' + btn("Não aprender", "resolveMove", {...choice, replace:null}) + '</footer>';
  if (!dialog.open) dialog.showModal();
  dialog.querySelector("button").focus();
}
$("moveLesson").oncancel = (event) => event.preventDefault();

const seenEvolutions = new Set(JSON.parse(sessionStorage.getItem("auroraSeenEvolutions") || "[]"));

function renderEvolution(s) {
  const dialog = $("evolutionScene");
  if (dialog.open || $("roundCard").open || document.querySelector(".ending")) return;
  const event = s.you.evolutions?.find(({ id }) => !seenEvolutions.has(id));
  if (!event) return;
  const lesson = $("moveLesson");
  if (lesson.open) lesson.close();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = reduced ? 0 : 2300;
  dialog.style.setProperty("--evolution-duration", duration + "ms");
  dialog.classList.toggle("evolving", !reduced);
  dialog.innerHTML = '<div class="evolution-backdrop" aria-hidden="true">' +
    '<div class="evolution-ring"></div><div class="evolution-flash"></div>' +
    '<div class="evolution-before">' + sprite(event.before) + '</div>' +
    '<div class="evolution-after">' + sprite(event.after) + '</div></div>' +
    '<h2 id="evolutionTitle" aria-live="polite">' +
    esc(event.before.name) + ' está evoluindo!</h2>' +
    '<button type="button" hidden>Continuar</button>';
  const button = dialog.querySelector("button");
  dialog.showModal();
  updateMusic();
  const reveal = () => {
    dialog.classList.remove("evolving");
    dialog.classList.add("evolved");
    $("evolutionTitle").textContent = event.before.name + " evoluiu para " + event.after.name + "!";
    button.hidden = false;
    button.focus();
  };
  if (duration) setTimeout(reveal, duration);
  else reveal();
  button.onclick = () => {
    seenEvolutions.add(event.id);
    sessionStorage.setItem("auroraSeenEvolutions", JSON.stringify([...seenEvolutions].slice(-128)));
    dialog.classList.remove("evolved");
    dialog.close();
    renderCard(state);
    renderMoveLesson(state);
  };
}
$("evolutionScene").oncancel = (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  if (!button.hidden) button.click();
};

async function act(action, data = {}) {
  if (busy || battlePlayback) return;
  predictReflex(action, data);
  busy = true;
  sequence++;
  try {
    const out = await request({ action, ...data });
    if (out.token) {
      session = { token: out.token, code: out.state.code };
      sessionStorage.setItem(sessionKey, JSON.stringify(session));
    }
    if (action === "catch")
      await animateCapture(data.ball, out.caught);
    if (action === "heal" && activeFacility === "center") await showHealing(out.state.you.party);
    if (["pet", "box", "item", "unequip"].includes(action) && $("pokemonDetails").open) $("pokemonDetails").close();
    if (action === "move" && out.state.you.loc === leagueIsland) {
      drawer = "facility";
      activeFacility = "gym";
    }
    if (action === "shop" || action === "leaveShop") shopCart.clear();
    if (action === "offer" || action === "counter") {
      tradeDrafts.delete(data.to);
      if (tradePartner === data.to) {
        tradeDraft = {give:[], want:[]};
        tradeCounter = tradeConfirm = "";
      }
      tradeScreen = "";
      toast(action === "counter" ? "Contraproposta enviada." : "Oferta enviada.");
    }
    if (out.tradeNotice) {
      tradeConfirm = "";
      tradeTab = "history";
      if (out.tradeNotice === "Troca concluída.") tradeScreen = "";
      toast(out.tradeNotice);
    }
    setState(out.state);

  } catch (e) {
    if ($("tradeDialog").open) {
      $("tradeFeedback").textContent = e.message;
    } else toast(e.message);
  } finally {
    busy = false;
  }
}
async function poll() {
  if (!session || busy || polling) return;
  polling = true;
  const issued = sequence;
  try {
    const out = await request({action:"state"});
    if (sequence === issued && !busy && out?.state) setState(out.state);
  } catch (e) {
    toast(e.message);
  } finally {
    polling = false;
  }
}
const invite = new URLSearchParams(location.search).get("sala");
if (testLobbyMode) {
  document.title = "Lobby de teste · Expedição Aurora";
  document.querySelector(".intro h1").textContent = "Lobby de teste";
  document.querySelector(".intro > p").textContent = "Crie uma sala de teste ou entre com o código de um amigo.";
}
function switchMode(m) {
  mode = m;
  document
    .querySelectorAll(".tab")
    .forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  $("codeRow").hidden = m === "create";
  $("gateAvatars").hidden = m === "join";
  $("roomCode").required = m === "join";
  $("gateSubmit").textContent =
    m === "join" ? "Entrar na sala" : "Criar minha sala";
}
if (invite) {
  switchMode("join");
  $("roomCode").value = invite.toUpperCase().slice(0, 5);
}
$("gateForm").onsubmit = (e) => {
  e.preventDefault();
  act(mode, {
    name: v("trainer"),
    code: v("roomCode").trim().toUpperCase(),
    avatar: mode === "create" ? $("gateAvatars").querySelector(":checked")?.value : undefined,
    testLobby: testLobbyMode,
  });
};
function trainerSprite(avatar, className, alt = "") {
  const id = Object.hasOwn(ExpeditionWorld.avatars, avatar) ? avatar : "mar";
  return '<img class="' + className + '" src="trainers/' + id + '.png" alt="' + esc(alt) + '">';
}

$("gateAvatars").insertAdjacentHTML("beforeend",
  Object.entries(ExpeditionWorld.avatars).map(([id, name], index) =>
    '<label><input type="radio" name="avatar" value="' + id + '"' +
    (index ? '' : ' checked') + '><span>' + trainerSprite(id, "trainer-preview") +
    esc(name) + '</span></label>',
  ).join(""),
);

function room() {
  const s = state,
    p = s.you,
    host = p.id === s.host;
  const { avatars, maxPlayers, validPlayerCount } = ExpeditionWorld;
  const occupied = new Map(s.players.filter(q => q.id !== p.id).map(q => [q.avatar, q.name]));
  const canStart = validPlayerCount(s.players.length) && s.players.every(q => q.ready);
  return panel(
    "Sala " + s.code,
    '<div class="row"><span>' +
      s.players.length +
      " / " + maxPlayers + " treinadores</span>" +
      btn(s.testLobby ? "Copiar convite" : "Copiar código", "copy") +
      "</div>" +
      s.players
        .map(
          (q) =>
            '<div class="row roster"><b>' +
            trainerSprite(q.avatar, "trainer-preview") + esc(q.name) +
            "</b><span>" +
            (q.ready ? "Pronto" : "Preparando") +
            "</span></div>",
        )
        .join("") +
      '<fieldset class="avatar-picker"><legend>Personagem</legend>' +
      Object.entries(avatars)
        .map(([id, name]) => {
          const taken = occupied.has(id);
          return '<button type="button" aria-pressed="' + (p.avatar === id) +
            `" data-action="avatar" data-args='${JSON.stringify({ avatar: id })}'` +
            (taken ? ' disabled title="Em uso por ' + esc(occupied.get(id)) + '"' : "") + ">" +
            trainerSprite(id, "trainer-preview") + esc(name) +
            (taken ? '<small>Em uso</small>' : "") + "</button>";
        }).join("") + "</fieldset>" +
      (host && s.testLobby
        ? '<label>Minigame' + select("testKind", s.testOptions.map(id => opt(id, minigameNames[id])).join("")) + '</label>'
        : host
        ? '<div class="grid2"><label>Rodadas<input id="rounds" type="number" min="1" max="40" value="8"></label><label>Multiplicador de XP<input id="mult" type="number" min=".25" max="30" step=".25" value="3"></label></div><label>Minigame' +
          select("mini", opt("yes", "Ativado") + opt("no", "Desativado")) +
          "</label>"
        : "") +
      '<div class="btnline">' +
      btn(
        p.ready ? "Desmarcar pronto" : "Estou pronto",
        "ready",
        {},
        "primary",
      ) +
      (host ? '<button class="primary" data-action="start"' +
        (canStart ? "" : " disabled") + (s.testLobby ? ">Iniciar minigame</button>" : ">Iniciar expedição</button>") : "") +
      btn("Sair da sala", "leave") +
      '</div>' + (s.testLobby ? '<p class="note">O anfitrião escolhe o minigame. Todos devem estar prontos, em um grupo de 2, 4, 6, 8, 10 ou 12.</p>' :
        '<p class="note">A expedição começa com 2, 4, 6, 8, 10 ou 12 treinadores prontos.</p><details><summary>Como vencer</summary><p>Cada espécie registrada vale 3 pontos e cada captura shiny vale 10. Cada ₽ 200 no saldo final vale 1 ponto. Cada insígnia vale 10 e completar a Elite Four vale 40. Cada carinho vale 1 ponto e cada vitória em duelo ou minigame vale 5.</p></details>'),
  );
}
function bars(m) {
  return (
    '<div class="bars">HP <progress style="accent-color:' +
    (m.hp / m.maxhp <= 0.2
      ? "#e45656"
      : m.hp / m.maxhp <= 0.5
        ? "#e9c54b"
        : "#3b9964") +
    '" value="' +
    m.hp +
    '" max="' +
    m.maxhp +
    '"></progress><span>' +
    m.hp +
    "/" +
    m.maxhp +
    "</span></div>" +
    (m.xpNeeded != null
      ? '<div class="bars">XP <progress class="xp" value="' +
        (m.xpIntoLevel || 0) +
        '" max="' +
        (m.xpNeeded || 1) +
        '"></progress><span>' +
        m.xpIntoLevel +
        "/" +
        m.xpNeeded +
        "</span></div>"
      : "")
  );
}
function showMon(m, full = false) {
  const details = full ? ' data-pokemon-details="' + esc(m.uid) + '"' : "";
  return (
    '<div class="slot"><' + (full ? 'button type="button"' : "div") + ' class="battlecard"' + details + '>' +
    tokenMon(m) +
    "<div><b>" +
    esc(m.name) +
    "</b> · Nv. " +
    m.level +
    bars(m) +
    "</div></" + (full ? "button" : "div") + ">" +
    (full
      ? "<small>FELICIDADE " +
        m.happiness +
        " / 255" +
        (m.heldItem
          ? " · " + esc(state.shop[m.heldItem]?.name || m.heldItem)
          : "") +
        "</small>"
      : "") +
    "</div>"
  );
}
function actionsRemaining(p) {
  const count = Math.max(0, p.actions);
  return count + (count === 1 ? " ação restante" : " ações restantes");
}
function actionBalance(p) {
  return '<span class="action-balance">' + actionsRemaining(p) + '</span>';
}
function itemUseForm(p, id) {
  if (state.phase !== "actions" || p.done || p.enc) return "";
  const targets = [...p.party, ...p.box];
  const usable = Object.entries(p.items).filter(([item, qty]) =>
    qty > 0 && state.shop[item] && !item.endsWith("-ball"));
  if (!targets.length || !usable.length) return "";
  return '<details class="task" id="' + id + '"><summary>' +
    (p.eliteRun == null ? "Usar item" : "Usar item no intervalo") + '</summary>' +
    '<label>Item' + select(id + "Item", usable.map(([item, qty]) =>
      opt(item, state.shop[item].name + " ×" + qty)).join("")) + '</label>' +
    '<label>Pokémon' + select(id + "Mon", targets.map((m) => opt(m.uid, m.name)).join("")) +
    '</label>' + btn("Aplicar", "useItem", { form: id }) + '</details>';
}

function teamPanel() {
  const p = state.you;
  const canManage = state.phase === "actions" && !p.done && !p.enc;
  return panel("Equipe · " + p.party.length + "/6", p.party.map(m =>
    showMon(m, true) + (canManage ? '<div class="buttons">' +
      btn("Mover à box", "box", {uid:m.uid}) +
      (p.party[0] !== m ? btn("Liderar equipe", "lead", {uid:m.uid}) : "") +
      (p.actions ? btn("Acariciar · 1 ação · " + actionsRemaining(p), "pet", {uid:m.uid}) : "") +
      "</div>" : "")).join("") ||
    "<p>Você começa sem Pokémon. Trabalhe, compre uma Poké Bola e explore um bioma.</p>");
}

function bagPanel() {
  const p = state.you;
  const items = Object.entries(p.items).filter(([, quantity]) => quantity > 0);
  const cards = items.map(([id, quantity]) =>
    '<li class="bag-item" tabindex="0" data-item-summary="' + esc(id) + '">' +
    '<span class="bag-item-art">' + itemArt(id) + '</span><strong>' +
    esc(state.shop[id]?.name || id) + '</strong><span class="bag-quantity">× ' +
    quantity + '</span></li>').join("");
  return '<section class="personal-body"><div class="personal-section-head"><h3>Itens guardados</h3>' +
    '<span>' + items.length + (items.length === 1 ? ' tipo' : ' tipos') + '</span></div>' +
    (items.length ? '<ul class="bag-grid">' + cards + '</ul>' :
      '<p class="personal-empty">' + uiIcon("backpack") + 'Sua mochila está vazia.</p>') +
    itemUseForm(p, "bagUse") + '</section>';
}
function battleUI(b) {
  return (
    (b.foe ? showMon(b.foe) : "") +
    (b.own ? showMon(b.own) : "") +
    '<div class="buttons">' +
    b.choices
      .map((c) =>
        btn(c.label + (c.pp != null ? " (" + c.pp + " PP)" : ""), "fight", {
          cmd: c.command,
        }),
      )
      .join("") +
    "</div>" +
    (b.waiting ? "<p>Aguardando o adversário…</p>" : "") +
    '<div class="log">' +
    b.log.slice(-4).map(esc).join("<br>") +
    "</div>"
  );
}
function actions() {
  const p = state.you,
    e = p.enc;
  if (e) {
    let html = e.battle ? battleUI(e.battle) : showMon(e.wild);
    if (e.type === "wild")
      html +=
        '<div class="btnline">' +
        Object.entries(p.items)
          .filter(([id, n]) => id.endsWith("-ball") && n > 0)
          .map(([id, n]) =>
            btn(state.shop[id].name + " ×" + n, "catch", { ball: id }, "", id),
          )
          .join("") +
        btn("Fugir", "flee") +
        "</div>";
    return panel(
      e.type === "wild"
        ? "Encontro selvagem"
        : e.type === "gym"
          ? "Batalha de ginásio"
          : "Elite Four",
      html,
    );
  }
  const location = LOCATIONS.find((l) => l.id === p.loc);
  let html = "";
  if (p.loc === leagueIsland) {
    const { reason } = gymDetails(p);
    return panel(location.name, actionBalance(p) + (reason ? esc(reason) : btn("Desafiar Elite Four", "gym")));
  }
  if (p.actions) {
    if (location.kind === "biome")
      html += btn("Explorar " + location.name, "explore", {}, "primary");
    else {
      html +=
        '<div class="btnline">' +
        (p.needsHealing && p.money >= state.healCost ? btn("Curar equipe · ₽ " + state.healCost + " · 1 ação", "heal") : "") +
        (p.loc === "city" + (p.badges.length + 1)
          ? btn(
              "Desafiar ginásio · Nv. " + (p.badges.length + 1) * 10,
              "gym",
            )
          : "") +
        "</div>";
      html += btn("Abrir Loja Pokémon", "enterShop");
    }
    html += itemUseForm(p, "use");
  }
  return panel(location.name, actionBalance(p) + html);
}
function roster(q) {
  return (
    '<div class="slot"><div class="row"><b>' +
    esc(q.name) +
    "</b><b>₽ " +
    q.money +
    "</b></div><p>Equipe · " +
    (q.party.map((m) => esc(m.name) + " Nv. " + m.level).join(", ") ||
      "Vazia") +
    "</p><p>Box · " +
    (q.box.map((m) => esc(m.name)).join(", ") || "Vazia") +
    "</p><p>Mochila · " +
    (Object.entries(q.items)
      .filter(([, n]) => n)
      .map(([i, n]) => esc(state.shop[i]?.name || i) + " ×" + n)
      .join(", ") || "Vazia") +
    "</p></div>"
  );
}
const tradeLabels = {
  pending:"Pendente", accepted:"Concluída", declined:"Recusada",
  cancelled:"Cancelada", countered:"Substituída", invalid:"Inválida", expired:"Expirada",
};
let tradeContext = "", tradePartner = "", tradeTab = "received", tradeScreen = "";
let tradeAlertSignature = "";
const dismissedTradeAlerts = new Set();
let tradeDraft = {give:[], want:[]}, tradeCounter = "", tradeConfirm = "";
const tradeList = value => Array.isArray(value) ? value : [value];
const isPendingTrade = offer => !offer.status || offer.status === "pending";
const tradeKey = a => a.kind === "money" ? "money" : a.kind + ":" + a.id;
function tradeInventory(q) {
  return [
    ...(q.money > 0 ? [{kind:"money", qty:q.money}] : []),
    ...Object.entries(q.items).filter(([id, qty]) => qty > 0 && state.shop[id])
      .map(([id, qty]) => ({kind:"item", id, qty})),
    ...[...q.party, ...q.box].map((pokemon, index) => ({kind:"mon", id:pokemon.uid, pokemon,
      inParty:index < q.party.length})),
  ];
}
function tradeAssetTitle(a) {
  if (a.kind === "money") return "Moedas";
  if (a.kind === "item") return state.shop[a.id]?.name || a.id;
  return a.pokemon?.name || "Pokémon indisponível";
}
function tradeAssetCard(a, side) {
  const pokemon = a.pokemon;
  const remove = side ? btn("Remover", "tradeRemove", {side, key:tradeKey(a)}) : "";
  if (a.kind !== "mon") return '<li class="exchange-asset">' +
    (a.kind === "item" ? itemArt(a.id) : "") + '<strong>' + esc(tradeAssetTitle(a)) +
    '</strong><span>' + (a.kind === "money" ? "₽ " : "× ") + esc(a.qty) + '</span>' + remove + '</li>';
  const detail = pokemon ? '<details><summary>' + esc(pokemon.name) + '</summary><small>Nível ' +
    esc(pokemon.level) + (pokemon.types?.length ? ' · ' + esc(pokemon.types.join(" / ")) : '') +
    (pokemon.hp != null ? ' · HP ' + esc(pokemon.hp) + '/' + esc(pokemon.maxhp) : '') +
    '</small></details><small>' + (a.inParty ? 'Equipe' : 'Box') +
    (pokemon.shiny ? ' · ✦ Shiny' : '') + (a.evolves ? ' · Evolui na troca' : '') + '</small>' :
    '<strong>Pokémon indisponível</strong>';
  return '<li class="exchange-asset exchange-pokemon">' + (pokemon ? sprite(pokemon) : '') +
    '<div>' + detail + '</div>' + remove + '</li>';
}
function tradeAssetsView(assets, owner) {
  const inventory = new Map(tradeInventory(owner).map(a => [tradeKey(a), a]));
  return '<ul class="exchange-assets">' + tradeList(assets).map(a => {
    const current = a.kind === "mon" && inventory.get(tradeKey(a));
    return tradeAssetCard(a.pokemon || !current ? a : {...current, ...a});
  }).join("") + '</ul>';
}
function tradeEditor(side, title, owner) {
  const draft = tradeDraft[side];
  const inventory = tradeInventory(owner);
  return '<section class="exchange-side"><h4>' + title + '</h4><ul class="exchange-assets">' +
    draft.map(a => {
      const latest = inventory.find(b => tradeKey(b) === tradeKey(a));
      return tradeAssetCard(a.kind === "mon" && latest ? latest : a, side);
    }).join("") + '</ul>' +
    '<div class="exchange-add"><label>Bem<select id="tradeAsset-' + side + '">' +
    inventory.map(a => opt(tradeKey(a), tradeAssetTitle(a) + (a.kind === "money" ? "" :
      a.kind === "item" ? " ×" + a.qty : " · Nv. " + a.pokemon.level + (a.pokemon.shiny ? " ✦" : "")))).join("") +
    '</select></label><label>Qtd.<input id="tradeQty-' + side + '" type="number" min="1" step="1" value="1"></label>' +
    '<button data-action="tradeAdd" data-args=\'' + JSON.stringify({side}) + '\'' +
    (inventory.length ? '' : ' disabled') + '>Adicionar</button></div></section>';
}
const tradeCoins = assets => tradeList(assets).find(a => a.kind === "money")?.qty || 0;
function tradeWarning(outgoing, incoming) {
  const p = state.you;
  if (p.party.length && p.party.every(m => tradeList(outgoing).some(a => a.kind === "mon" && a.id === m.uid)) &&
    !tradeList(incoming).some(a => a.kind === "mon"))
    return '<p class="exchange-warning" role="status">Esta troca deixaria sua equipe vazia antes dos duelos.</p>';
  return "";
}
function tradeOfferCard(o) {
  const p = state.you, incoming = o.to === p.id;
  const give = incoming ? o.want : o.give, want = incoming ? o.give : o.want;
  const q = state.players.find(q => q.id === (incoming ? o.from : o.to));
  let actions = "";
  if (isPendingTrade(o)) {
    actions = incoming ? btn("Revisar e aceitar", "tradeReview", {id:o.id}, "primary") +
      btn("Contraproposta", "tradeCounter", {id:o.id}) + btn("Recusar", "decline", {id:o.id}) :
      btn("Cancelar oferta", "cancel", {id:o.id});
  }
  const blocked = p.tradeBlocked ? "Você está " + p.tradeBlocked + "." :
    q.tradeBlocked ? q.name + " está " + q.tradeBlocked + "." : "";
  return '<article class="exchange-offer" id="trade-offer-' + esc(o.id) + '"><header><strong>' + esc(q.name) + '</strong><span>' +
    tradeLabels[o.status || "pending"] + '</span></header>' +
    '<div class="exchange-terms"><section><h4>Você entrega</h4>' + tradeAssetsView(give, p) +
    '</section><section><h4>Você recebe</h4>' + tradeAssetsView(want, q) + '</section></div>' +
    (o.reason ? '<p class="exchange-warning">' + esc(o.reason) + '</p>' : '') +
    (tradeConfirm === o.id && isPendingTrade(o) ?
      '<div class="exchange-review"><strong>Saldo após a troca: ₽ ' + (p.money - tradeCoins(give) + tradeCoins(want)) +
      '</strong>' + tradeWarning(give, want) + '<div class="exchange-buttons">' +
      (blocked ? '<span role="status">' + esc(blocked) + '</span>' :
        btn("Aceitar troca", "accept", {id:o.id}, "primary")) +
      btn("Recusar", "decline", {id:o.id}) + btn("Voltar", "tradeBack") + '</div></div>' :
      '<div class="exchange-buttons">' + actions + '</div>') + '</article>';
}
const tradeDrafts = new Map();
let tradeProfileTab = "party";
let tradePage = 0;
function selectTradePartner(id) {
  if (id === tradePartner) return;
  if (tradePartner) tradeDrafts.set(tradePartner, {draft:tradeDraft, counter:tradeCounter});
  tradePartner = id;
  const saved = tradeDrafts.get(id);
  tradeDraft = saved?.draft || {give:[], want:[]};
  tradeCounter = saved?.counter || "";
  tradeConfirm = "";
  tradeTab = "received";
  tradeProfileTab = "party";
  tradePage = 0;
}
function trainerPokemonSlot(position, mon) {
  const description = 'Espaço ' + (position + 1) + (mon
    ? ': ' + mon.name + ' · Nv. ' + mon.level + (mon.shiny ? ' · Shiny' : '') : ' vazio');
  return '<div class="trainer-slot' + (mon ? ' trainer-slot-occupied' : '') + '" role="img" aria-label="' +
    esc(description) + '" title="' + esc(description) + '">' + boxSlotContents(mon) + '</div>';
}

function tradeProfile(q) {
  let content;
  if (tradeProfileTab === "party") {
    content = '<div class="pcGrid trainer-team">' + Array.from({length:6}, (_, index) =>
      trainerPokemonSlot(index, q.party[index])).join("") + '</div>';
  } else if (tradeProfileTab === "box") {
    tradePage = Math.min(tradePage, boxPageCount(q) - 1);
    content = boxPageMarkup(q, tradePage, trainerPokemonSlot, "tradePage");
  } else {
    const goods = Object.entries(q.items).filter(([, quantity]) => quantity > 0);
    content = goods.length ? '<ul class="trainer-items">' + goods.map(([id, quantity]) =>
      '<li>' + itemArt(id) + '<strong>' + esc(state.shop[id]?.name || id) +
      '</strong><span>× ' + quantity + '</span></li>').join("") + '</ul>' :
      '<p class="exchange-empty">Mochila vazia.</p>';
  }
  const tabs = [
    ["party", "Equipe", q.party.length + "/6"],
    ["box", "Box", q.box.length],
    ["bag", "Mochila", Object.values(q.items).filter(quantity => quantity > 0).length],
  ].map(([id, label, count]) =>
    '<button type="button" id="trainer-tab-' + id + '" data-action="tradeProfileTab" data-args="' +
    esc(JSON.stringify({id})) + '" aria-pressed="' + (id === tradeProfileTab) +
    '">' + label + ' <span>' + count + '</span></button>').join("");
  const badgeTitles = q.badges.map(rank => state.gyms[rank - 1]?.name || rank).join(", ");
  return '<section class="trainer-profile"><div class="trainer-identity">' +
    trainerSprite(q.avatar, "trainer-preview") + '<div><h3>' + esc(q.name) + '</h3><p>' +
    esc(state.jobs[q.job]?.name || "Sem emprego") + '</p></div></div>' +
    '<dl class="trainer-facts"><div><dt>Saldo</dt><dd>₽ ' + q.money.toLocaleString("pt-BR") +
    '</dd></div><div><dt>Insígnias</dt><dd>' + q.badges.length + ' / 8</dd></div></dl>' +
    (q.badges.length ? '<p class="trainer-badges">' + esc(badgeTitles) + '</p>' : '') +
    '<div class="exchange-tabs trainer-tabs" aria-label="Dados do treinador">' + tabs + '</div>' +
    '<div class="trainer-collection">' + content + '</div></section>';
}

function tradeInbox() {
  const p = state.you;
  const groups = {
    received:state.offers.filter(o => isPendingTrade(o) && o.to === p.id),
    sent:state.offers.filter(o => isPendingTrade(o) && o.from === p.id),
    history:state.offers.filter(o => !isPendingTrade(o)).reverse(),
  };
  const tabs = [["received","Recebidas"], ["sent","Enviadas"], ["history","Histórico"]]
    .map(([id, label]) => '<button data-action="tradeTab" data-args="' + esc(JSON.stringify({id})) +
      '" aria-pressed="' + (tradeTab === id) + '">' + label + ' · ' + groups[id].length + '</button>').join("");
  const offers = groups[tradeTab];
  return '<div class="exchange-tabs" aria-label="Caixa de ofertas">' + tabs + '</div>' +
    (offers.length ? offers.map(tradeOfferCard).join("") :
      '<p class="exchange-empty">Nenhuma oferta nesta aba.</p>');
}

function renderTrade(s) {
  const roster = $("tradeRoster"), alert = $("tradeAlert"), dialog = $("tradeDialog");
  const context = s.code + ":" + s.you.id + ":" + s.round;
  if (tradeContext !== context) {
    tradeContext = context;
    tradePartner = tradeScreen = tradeCounter = tradeConfirm = "";
    tradeTab = "received";
    tradeDrafts.clear();
    tradeDraft = {give:[], want:[]};
    dismissedTradeAlerts.clear();
  }
  const enabled = s.phase === "actions";
  roster.hidden = !enabled;
  $("hudOffers").hidden = !enabled;
  if (!enabled) tradeScreen = "";
  const received = s.offers.filter(o => isPendingTrade(o) && o.to === s.you.id);
  if (enabled) {
    const markup = s.players.filter(q => q.id !== s.you.id).map(q =>
        '<button type="button" id="trade-trainer-' + esc(q.id) +
        '" class="trade-trainer" data-action="tradePartner" data-args="' +
        esc(JSON.stringify({id:q.id})) + '" aria-label="Ver ficha de ' + esc(q.name) + '" title="' +
        esc(q.name) + '">' + trainerSprite(q.avatar, "trainer-preview") + '<span>' + esc(q.name) +
        '</span></button>').join("");
    updateRegion($("tradePlayers"), markup);
    $("hudOffers").querySelector("span").textContent = received.length ? "Ofertas (" + received.length + ")" : "Ofertas";
    updateTradeScroll();
  }
  const offer = enabled && received.find(o => !dismissedTradeAlerts.has(o.id));
  if (tradeAlertSignature !== offer?.id) {
    tradeAlertSignature = offer?.id;
    if (offer) {
      const sender = s.players.find(q => q.id === offer.from);
      alert.innerHTML = '<span role="status">' + esc(sender.name) + ' propôs uma troca.</span>' +
        btn("Ver proposta", "tradeOpenOffer", {id:offer.id}) +
        '<button type="button" aria-label="Dispensar aviso" data-action="tradeDismissAlert" data-args="' +
        esc(JSON.stringify({id:offer.id})) + '">×</button>';
    }
  }
  alert.hidden = !offer;
  if (!tradeScreen) {
    if (dialog.open) dialog.close();
    return;
  }
  const partner = s.players.find(q => q.id === tradePartner);
  let body, title, footer = "";
  if (tradeScreen === "inbox") {
    title = "Ofertas";
    body = tradeInbox();
  } else if (tradeScreen === "profile") {
    title = "Ficha do treinador";
    body = tradeProfile(partner);
    footer = btn("Propor troca", "tradeCompose", {}, "primary");
  } else {
    const counter = s.offers.find(o => o.id === tradeCounter && isPendingTrade(o));
    title = (tradeCounter ? "Contraproposta para " : "Proposta para ") + partner.name;
    body = '<div class="exchange-terms">' + tradeEditor("give", "Você entrega", s.you) +
      tradeEditor("want", "Você recebe", partner) + '</div>' + tradeWarning(tradeDraft.give, tradeDraft.want) +
      (tradeCounter && !counter ? '<p class="exchange-warning">A proposta original foi encerrada.</p>' : "");
    footer = btn("Voltar à ficha", "tradeProfile") +
      (tradeCounter ? btn("Descartar contraproposta", "tradeDiscard") : "") +
      '<button type="button" class="primary" data-action="tradeSend"' +
      (!tradeDraft.give.length || !tradeDraft.want.length || (tradeCounter && !counter) ? ' disabled' : '') + '>' +
      (tradeCounter ? 'Enviar contraproposta' : 'Enviar proposta') + '</button>';
  }
  dialog.dataset.view = tradeScreen;
  $("tradeTitle").textContent = title;
  updateRegion($("tradeBody"), body);
  updateRegion($("tradeFooter"), footer);
  $("tradeFooter").hidden = !footer;
  if (!dialog.open) dialog.showModal();
}

function updateRegion(region, markup) {
  if (region.dataset.markup === markup) return;
  region.innerHTML = markup;
  region.dataset.markup = markup;
}

$("tradeDialog").addEventListener("close", () => {
  if (!$("tradeDialog").open) tradeScreen = "";
});

function tradeInteraction(action, d) {
  if (state.phase !== "actions") return;
  $("tradeFeedback").textContent = "";
  if (action === "tradeClose") {
    tradeScreen = "";
  } else if (action === "tradeDismissAlert") {
    dismissedTradeAlerts.add(d.id);
  } else if (action === "tradeOpenOffer" || action === "tradeInbox") {
    tradeScreen = "inbox";
    tradeTab = "received";
    tradeConfirm = d.id || "";
    if (d.id) dismissedTradeAlerts.add(d.id);
  } else if (action === "tradeCompose") {
    tradeScreen = "table";
  } else if (action === "tradeProfile") {
    tradeScreen = "profile";
  } else if (action === "tradePartner") {
    selectTradePartner(d.id);
    tradeScreen = "profile";
  } else if (action === "tradeProfileTab") {
    tradeProfileTab = d.id;
    tradePage = 0;
  } else if (action === "tradePage") {
    tradePage = Math.max(0, tradePage + d.delta);
  } else if (action === "tradeTab") {
    tradeTab = d.id;
    tradeConfirm = "";
  } else if (action === "tradeAdd") {
    const owner = d.side === "give" ? state.you : state.players.find(q => q.id === tradePartner);
    const asset = tradeInventory(owner).find(a => tradeKey(a) === v("tradeAsset-" + d.side));
    if (!asset) return;
    const side = tradeDraft[d.side];
    const existing = side.find(a => tradeKey(a) === tradeKey(asset));
    if (asset.kind === "mon") {
      if (existing) {
        $("tradeFeedback").textContent = "Este Pokémon já está na proposta.";
        return;
      }
      side.push(asset);
    } else {
      const qty = Number(v("tradeQty-" + d.side));
      if (!Number.isSafeInteger(qty) || qty < 1 || qty + (existing?.qty || 0) > asset.qty) {
        $("tradeFeedback").textContent = "Quantidade superior ao disponível ou inválida.";
        return;
      }
      if (existing) existing.qty += qty;
      else side.push({...asset, qty});
    }
  } else if (action === "tradeRemove") {
    tradeDraft[d.side] = tradeDraft[d.side].filter(a => tradeKey(a) !== d.key);
  } else if (action === "tradeCounter") {
    const offer = state.offers.find(o => o.id === d.id && o.to === state.you.id && isPendingTrade(o));
    if (!offer) return;
    selectTradePartner(offer.from);
    tradeCounter = offer.id;
    tradeDraft = {give:structuredClone(tradeList(offer.want)), want:structuredClone(tradeList(offer.give))};
    tradeConfirm = "";
    tradeScreen = "table";
  } else if (action === "tradeReview") {
    tradeConfirm = d.id;
  } else if (action === "tradeDiscard") {
    tradeCounter = "";
    tradeDraft = {give:[], want:[]};
  } else if (action === "tradeBack") {
    tradeConfirm = "";
  } else if (action === "tradeSend") {
    const payload = {id:tradeCounter || undefined, to:tradePartner};
    for (const side of ["give", "want"])
      payload[side] = tradeDraft[side].map(({kind,id,qty}) => ({kind,id,qty}));
    act(tradeCounter ? "counter" : "offer", payload);
    return;
  }
  render();
  if (action === "tradePage") {
    const buttons = [...$("tradeBody").querySelectorAll('.pcNav button')];
    const preferred = buttons[d.delta > 0 ? 1 : 0];
    (preferred?.disabled ? buttons.find(button => !button.disabled) : preferred)?.focus({preventScroll:true});
  }
  if (["tradeCompose", "tradeProfile", "tradePartner", "tradeCounter", "tradeInbox", "tradeOpenOffer"].includes(action))
    $("tradeTitle").focus({preventScroll:true});
  if (d.id && (action === "tradeOpenOffer" || action === "tradeReview"))
    $("trade-offer-" + d.id)?.scrollIntoView({block:"nearest"});
}

function controls() {
  const s = state,
    p = s.you;
  if (p.done)
    return (
      panel(
        "Aguardando o grupo",
        s.players
          .map(
            (q) =>
              '<div class="row roster">' +
              esc(q.name) +
              "<b>" +
              (q.done ? "Concluído" : "Jogando") +
              "</b></div>",
          )
          .join("") + (s.phase === "actions"
            ? '<div class="summary-actions"><button data-drawer="box">Abrir Box</button></div>'
            : ""),
      )
    );
  if (s.phase === "actions") return actions();
  const d = s.duel;
  return (
    panel(
      "Duelo com " + d.opponent,
      d.result
        ? "<p>" +
            esc(d.result) +
            "</p>" +
            btn("Concluir rodada", "finish", {}, "primary")
        : battleUI(d.battle),
    )
  );
}
function render() {
  $("itemTooltip").hidden = true;
  const s = state,
    p = s.you;
  const active = document.activeElement?.id;
  const values = new Map(
    [...document.querySelectorAll("input[id]:not(#soundSettings input),select[id]")].map((el) => [
      el.id,
      el.value,
    ]),
  );
  const opened = [...document.querySelectorAll("details[open]")].map(
    (el) => el.id,
  );
  $("topStatus").textContent =
    "SALA " + s.code + " · " + s.players.length + " TREINADORES";
  if (s.phase === "lobby") {
    $("lobby").hidden = false;
    $("game").hidden = true;
    document.body.classList.remove("playing");
    previousPhase = "lobby";
    document.body.classList.add("in-room");
    $("gate").hidden = true;
    $("roomPanel").innerHTML = room();
  } else {
    $("lobby").hidden = true;
    $("game").hidden = false;
    renderWorld();
  }
  renderTrade(s);
  for (const [id, value] of values) {
    const el = $(id);
    if (
      el &&
      id !== "destination" &&
      (id !== "auctionBid" || Number(value) >= Number(el.min)) &&
      (!el.options || [...el.options].some((o) => o.value === value))
    )
      el.value = value;
  }
  if ($("labFields")) updateLabTotal();
  opened.forEach((id) => {
    if ($(id)) $(id).open = true;
  });
  if (active && !$("soundSettings").open) $(active)?.focus({ preventScroll: true });
  updateMusic(s);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.mode) {
    switchMode(b.dataset.mode);
    return;
  }
  let k = b.dataset.action;
  if (!k) return;
  const d = JSON.parse(b.dataset.args || "{}");
  if (k === "home") {
    sessionStorage.removeItem(sessionKey);
    if (practiceMode) window.top.location.assign("/test-minigames");
    else location.assign(testLobbyMode ? "/?teste=1" : "/");
    return;
  }
  if (k === "wireListen") {
    const text = state?.pairGame?.practiceSpeech;
    const { muted, effects } = gameAudio.preferences;
    if (!text || muted || !effects || !("speechSynthesis" in window)) return;
    const voice = new SpeechSynthesisUtterance(text);
    voice.lang = "pt-BR";
    voice.volume = effects / 100;
    speechSynthesis.cancel();
    speechSynthesis.speak(voice);
    return;
  }
  if (k === "leave") {
    request({ action: "leave" })
      .then(() => {
        sessionStorage.removeItem(sessionKey);
        location.assign(practiceMode ? "/test-minigames" : testLobbyMode ? "/?teste=1" : "/");
      })
      .catch((e) => toast(e.message));
    return;
  }
  if (k === "copy") {
    const invite = state.testLobby ? location.origin + "/?teste=1&sala=" + state.code : state.code;
    navigator.clipboard
      ?.writeText(invite)
      .then(() => toast(state.testLobby ? "Convite copiado." : "Código copiado."))
      .catch(() => toast(state.code));
    toast("Código da sala: " + state.code);
    return;
  }
  if (k === "start")
    Object.assign(d, state.testLobby ? {kind:v("testKind")} : {
      rounds: +v("rounds"),
      mult: +v("mult"),
      mini: v("mini") === "yes",
    });
  if (k === "modifyPokemon") {
    const fields = $("labFields");
    if (!fields || [...fields.querySelectorAll("input")].some(input => !input.reportValidity())) return;
    d.uid = v("labPokemon");
    d.nature = v("labNature");
    d.abilitySlot = v("labAbility");
    d.ivs = Object.fromEntries(labStats.map(([stat]) => [stat, Number(v("labIv-" + stat))]));
    d.evs = Object.fromEntries(labStats.map(([stat]) => [stat, Number(v("labEv-" + stat))]));
  }
  if (k === "useItem") {
    k = "item";
    d.item = v(d.form + "Item");
    d.uid = v(d.form + "Mon");
  }
  if (k === "duelTeam") d.uids = [...duelPicks];
  if (k === "equipHeld") {
    k = "item";
    d.item = v("pokemonHeldChoice");
  }
  if (k === "duelForfeit" && !window.confirm("Desistir do duelo? O outro lado vence.")) return;
  if (k === "groupMove" || k === "groupPick") {
    const battle = state.duel?.battle;
    if (busy || battlePlayback || !battle?.groups[d.slot]) return;
    groupDraft.slot = d.slot;
    groupDraft.move = k === "groupMove" ? d.move : "";
    if (k === "groupPick") {
      groupDraft.picks[d.slot] = d.command;
      const commands = battle.groups.map((group, index) => groupPick(group, index)?.command);
      const next = commands.findIndex(command => !command);
      if (next < 0) {
        act("fight", {cmd:commands.join(", "), turn:battle.turn, version:state.duel.commandVersion});
        return;
      }
      groupDraft.slot = next;
    }
    refreshGroupControls();
    return;
  }
  if (k === "fight" && state.phase === "duelos") {
    d.turn = state.duel.battle.turn;
    d.version = state.duel.commandVersion;
  }
  if (k === "dodge" && Date.now() + serverOffset < state.race.startsAt) return;
  if (k === "bid") d.amount = Number(v("auctionBid"));
  if (k === "arcadeSelect" || k === "arcadeConfirm") {
    selectArcadeCard(k === "arcadeSelect" ? d.choice : null);
    return;
  }
  if (k === "answer") {
    if (v("answer") === "") {
      toast("Digite um valor.");
      return;
    }
    k = "quiz";
    d.answer = +v("answer");
  }
  if (k.startsWith("trade")) {
    tradeInteraction(k, d);
    return;
  }
  if (k === "millionSkip") {
    finishMillionReveal();
    return;
  }
  act(k, d);
});
const shopCart = new Map();
const personalPanels = new Set(["team", "box", "bag", "profile"]);
let personalDrawer = "";
let drawer = "",
  activeFacility = "",
  shopItem = "",
  shopFilter = "all",
  shopMode = "buy",
  shopSearch = "",
  shopSort = "default",
  combatMenu = "move",
  oldBattle = null,
  previousPhase = "",
  previouslyDone = false,
  lastNotice = "";
const gameAudio = window.AuroraAudio;

function updateMusic(s = state) {
  let scene = "title";
  const ending = document.querySelector(".ending[data-music]");
  if (ending) scene = ending.dataset.music;
  else if ($("evolutionScene").open) scene = "evolution";
  else if (!s || s.phase === "lobby") scene = "title";
  else if (s.phase === "final") scene = "results";
  else if (s.phase === "minigame") {
    if (s.arcade?.results || s.million?.results || s.auction?.closed || s.pairGame?.finished ||
        (s.race && raceResultReady(s.race))) scene = "results";
    else if (s.minigame === "rhythm" && $("arcadeStage")) scene = "rhythm";
    else if (["race", "magnetic", "sorter"].includes(s.minigame)) scene = "arcade";
    else if (["fog", "darkAuction", "wires"].includes(s.minigame)) scene = "suspense";
    else scene = "puzzle";
  } else if (s.you.enc) {
    scene = ["gym", "elite"].includes(s.you.enc.type) ? "duel" : "battle";
  } else if (s.phase === "duelos" && (s.duel?.selection || (s.duel?.battle && !s.duel.result))) {
    scene = "duel";
  } else {
    const location = LOCATIONS.find(site => site.id === s.you.loc);
    const indoors = ["shop", "facility", "league"].includes(drawer);
    scene = s.phase !== "actions" || indoors || (location && location.kind !== "biome") ? "town" : "explore";
  }
  gameAudio.setScene(scene);
}

function tone(hit = false) {
  const audio = gameAudio.context;
  if (gameAudio.preferences.muted || audio?.state !== "running") return;
  try {
    const t = audio.currentTime,
      o = audio.createOscillator(),
      v = audio.createGain();
    o.type = hit ? "sawtooth" : "triangle";
    o.frequency.setValueAtTime(hit ? 210 : 620, t);
    o.frequency.exponentialRampToValueAtTime(hit ? 45 : 870, t + 0.09);
    v.gain.setValueAtTime(0.055, t);
    v.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(v).connect(gameAudio.effects);
    o.start();
    o.stop(t + 0.12);
  } catch {}
}
function uiIcon(name) {
  return '<svg class="hud-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<use href="#icon-' + name + '"></use></svg>';
}
const menuBtn = (id, label, icon) =>
  '<button data-drawer="' + id + '" aria-pressed="' + ((personalPanels.has(id) ? personalDrawer : drawer) === id) + '">' +
  uiIcon(icon) + esc(label) + '</button>';

function updateTradeScroll() {
  const list = $("tradePlayers");
  const max = Math.max(0, list.scrollWidth - list.clientWidth);
  const fraction = list.scrollWidth ? list.clientWidth / list.scrollWidth : 1;
  const thumb = $("tradeScrollTrack").firstElementChild;
  $("tradeScrollTrack").parentElement.hidden = max < 2;
  thumb.style.width = (100 * Math.min(1, fraction)) + "%";
  thumb.style.left = (max ? 100 * (1 - fraction) * list.scrollLeft / max : 0) + "%";
  $("tradeScrollBack").disabled = list.scrollLeft < 1;
  $("tradeScrollForward").disabled = list.scrollLeft >= max - 1;
}

function initializeScreen() {
  const trainers = $("tradePlayers");
  trainers.addEventListener("scroll", updateTradeScroll, {passive:true});
  new ResizeObserver(updateTradeScroll).observe(trainers);
  $("tradeScrollBack").onclick = () => trainers.scrollBy({left:-trainers.clientWidth * .7});
  $("tradeScrollForward").onclick = () => trainers.scrollBy({left:trainers.clientWidth * .7});
  $("content").addEventListener("input", (e) => {
    if (e.target.id !== "shopSearch") return;
    shopSearch = e.target.value;
    updateCatalog(true);
  });
  $("content").addEventListener("change", (e) => {
    if (e.target.id !== "shopSort") return;
    shopSort = e.target.value;
    updateCatalog(true);
  });
  for (const type of ["pointerover", "pointerout", "focusin", "focusout"])
    $("arena").addEventListener(type, updateMoveTooltip);
  $("evolutionScene").addEventListener("close", () => updateMusic());
  const soundSettings = $("soundSettings");
  const syncSoundSettings = () => {
    const { muted, music, effects } = gameAudio.preferences;
    $("soundMuted").checked = muted;
    $("musicVolume").value = music;
    $("effectsVolume").value = effects;
    $("musicLevel").textContent = music + "%";
    $("effectsLevel").textContent = effects + "%";
  };
  syncSoundSettings();
  document.addEventListener("pointerdown", gameAudio.unlock, {capture:true, passive:true});
  document.addEventListener("keydown", gameAudio.unlock, {capture:true});
  document.addEventListener("click", gameAudio.unlock, {capture:true});
  $("sound").onclick = $("postSound").onclick = $("hudSettings").onclick = () => {
    syncSoundSettings();
    soundSettings.showModal();
  };
  $("soundMuted").onchange = (event) => {
    gameAudio.update("muted", event.target.checked);
    if (event.target.checked) window.speechSynthesis?.cancel();
    syncSoundSettings();
  };
  for (const key of ["music", "effects"]) {
    $(key + "Volume").oninput = (event) => {
      gameAudio.update(key, event.target.valueAsNumber);
      if (key === "effects" && !event.target.valueAsNumber) window.speechSynthesis?.cancel();
      syncSoundSettings();
    };
  }
  $("fullscreen").onclick = $("hudFullscreen").onclick = () => {
    const task = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen?.();
    task?.catch(() => toast("Tela cheia indisponível."));
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    tone(b.dataset.action === "fight");
    if (b.dataset.qtyStep) {
      const quantity = $("qty");
      if (b.dataset.qtyStep === "up") quantity.stepUp();
      else quantity.stepDown();
    }
    if (b.dataset.shopMode || b.dataset.shopFilter) {
      if (b.dataset.shopMode) {
        shopMode = b.dataset.shopMode;
        shopFilter = "all";
      } else shopFilter = b.dataset.shopFilter;
      updateCatalog(true);
    }
    if (b.dataset.shopItem) {
      shopItem = b.dataset.shopItem;
      updateCatalog();
      $("shopCatalog").querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
    }
    if (b.dataset.enterLeague && !leagueEntryReason()) {
      if (state.you.loc === leagueIsland) {
        drawer = "facility";
        activeFacility = "gym";
        render();
        $("dismiss").focus();
      } else {
        act("move", { loc: leagueIsland });
      }
    }
    if (b.dataset.confirmFacility) {
      drawer = "facility";
      render();
      $("dismiss").focus();
    }
    if (b.dataset.cartAdd && !busy) addToShopCart(b.dataset.cartAdd === "sell");
    if (b.dataset.cartRemove && !busy) {
      shopCart.delete(b.dataset.cartRemove);
      renderShopCart();
    }
    if (b.hasAttribute("data-checkout") && shopCart.size)
      act("shop", { lines: [...shopCart.values()] });
    if (b.dataset.facility === "center" || b.dataset.facility === "post" ||
        b.dataset.facility === "lab") {
      activeFacility = b.dataset.facility;
      drawer = "facility";
      render();
      $("dismiss").focus();
    } else if (b.dataset.facility === "store") {
      activeFacility = "store";
      act("enterShop");
    } else if (b.dataset.facility) {
      activeFacility = activeFacility === b.dataset.facility ||
        b.dataset.facility === "close" ? "" : b.dataset.facility;
      render();
    }
    if (b.dataset.drawer && !busy) {
      const target = b.dataset.drawer;
      if (personalPanels.has(target)) {
        personalDrawer = personalDrawer === target ? "" : target;
        render();
        if (personalDrawer) $("personalTitle").focus({preventScroll:true});
      } else {
        const leavingShop = drawer === "shop";
        personalDrawer = "";
        activeFacility = "";
        drawer = target === drawer ? "" : target;
        if (leavingShop) act("leaveShop");
        else render();
      }
    }
    if (b.dataset.combat) {
      combatMenu = b.dataset.combat;
      render();
    }
    if (b.id === "dismissPersonal") {
      const target = personalDrawer;
      personalDrawer = "";
      render();
      $("dock").querySelector('[data-drawer="' + target + '"]')?.focus();
    }
    if (b.id === "dismiss") {
      if (drawer === "shop") {
        drawer = "local";
        activeFacility = "";
        act("leaveShop");
        return;
      }
      drawer = drawer === "facility" ? "local" : "";
      activeFacility = "";
      render();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || $("pokemonDetails").open || $("soundSettings").open || $("tradeDialog").open) return;
    if (personalDrawer) {
      const target = personalDrawer;
      personalDrawer = "";
      render();
      $("dock").querySelector('[data-drawer="' + target + '"]')?.focus();
    } else if (drawer) {
      if (drawer === "shop") {
        drawer = "local";
        activeFacility = "";
        act("leaveShop");
        return;
      }
      drawer = drawer === "facility" ? "local" : "";
      activeFacility = "";
      render();
    }
  });
}
function sprite(m, back = false) {
  return (
    '<img class="fighter" alt="' +
    esc(m.name) +
    '" src="https://play.pokemonshowdown.com/sprites/' +
    (back ? "ani-back" : "ani") + (m.shiny ? "-shiny" : "") +
    "/" +
    encodeURIComponent(m.spriteId || m.slug) +
    '.gif" onerror="if(!this.dataset.failed){this.dataset.failed=1;this.src=\'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/' +
    (m.shiny ? "shiny/" : "") + Number(m.pokemonId) +
    ".png'}else{this.hidden=true}\">"
  );
}
const moveTypes = {
  Normal: "Normal", Fire: "Fogo", Water: "Água", Electric: "Elétrico",
  Grass: "Planta", Ice: "Gelo", Fighting: "Lutador", Poison: "Veneno",
  Ground: "Terra", Flying: "Voador", Psychic: "Psíquico", Bug: "Inseto",
  Rock: "Pedra", Ghost: "Fantasma", Dragon: "Dragão", Dark: "Sombrio",
  Steel: "Aço", Fairy: "Fada",
};

const moveCategories = { Physical: "Físico", Special: "Especial", Status: "Status" };

function updateMoveTooltip(event) {
  const move = event.target.closest(".battle-move");
  const tooltip = $("battleMoveTooltip");
  if (!move || !tooltip || move.contains(event.relatedTarget)) return;
  const leaving = event.type === "pointerout" || event.type === "focusout";
  const active = leaving
    ? $("arena").querySelector(event.type === "pointerout" ? ".battle-move:focus-visible" : ".battle-move:hover")
    : move;
  tooltip.hidden = !active;
  if (active) tooltip.textContent = active.dataset.moveDetails;
}

const battleStats = {
  atk:["ATQ","Ataque"], def:["DEF","Defesa"], spa:["ATQ ESP","Ataque Especial"],
  spd:["DEF ESP","Defesa Especial"], spe:["VEL","Velocidade"],
  accuracy:["PREC","Precisão"], evasion:["EVA","Evasão"],
};

function battleEffectChips(effects = [], kind = "effect") {
  return effects.map(({id, label, layers}) => '<span class="battle-chip ' + kind +
    (id === "confusion" ? " confused" : "") + '">' +
    esc(label) + (layers ? " ×" + layers : "") + '</span>').join("");
}

function battleBoostChips(boosts = {}) {
  return Object.entries(boosts).map(([id, stage]) => {
    const [short, name] = battleStats[id] || [id, id];
    const value = (stage > 0 ? "+" : "") + stage;
    return '<span class="battle-chip ' + (stage > 0 ? "buff" : "debuff") +
      '" title="' + esc(name + " " + value) + '">' + esc(short + " " + value) + '</span>';
  }).join("");
}

let groupDraft = {key:"", slot:0, move:"", picks:{}};
let activeLineup = "";
async function playBattleEvents(events) {
  const arena = $("arena");
  const report = arena.querySelector(".battle-report .message");
  const history = $("battleLog");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pause = ms => new Promise(resolve => setTimeout(resolve, reduced ? 0 : ms));
  for (const event of events) {
    const unit = arena.querySelector('[data-battle-unit="' + CSS.escape(event.position) + '"]');
    const hud = arena.querySelector('[data-battle-position="' + CSS.escape(event.position) + '"]');
    if (event.text) {
      if (report) report.textContent = event.text;
      if (history) {
        const follow = history.scrollHeight - history.scrollTop - history.clientHeight < 8;
        const line = document.createElement("li");
        line.textContent = event.text;
        history.append(line);
        if (follow) history.scrollTop = history.scrollHeight;
      }
    }
    if (event.kind === "move") {
      if (unit && !unit.hidden && !reduced) {
        const offset = unit.classList.contains("own") ? 26 : -26;
        unit.animate([{translate:"0 0"}, {translate:offset + "px -14px", offset:.45},
          {translate:"0 0"}], {duration:260, easing:"ease-out"});
      }
      await pause(260);
    } else if (event.kind === "-damage" || event.kind === "-heal") {
      const bar = hud?.querySelector("progress");
      if (bar && event.hp !== null) {
        const hp = Math.round(bar.max * event.hp);
        const readout = bar.nextElementSibling;
        if (readout) readout.textContent = hp + "/" + bar.max;
        if (reduced) bar.value = hp;
        else animateHP(bar, bar.value, hp);
      }
      if (event.kind === "-damage" && unit && !unit.hidden && !reduced) {
        tone(true);
        unit.animate([{filter:"brightness(1)"}, {filter:"brightness(2.4)"}, {filter:"brightness(1)"}],
          {duration:200});
      }
      await pause(300);
    } else if (event.kind === "faint") {
      if (unit && !unit.hidden && !reduced)
        unit.animate([{opacity:1, translate:"0 0"}, {opacity:0, translate:"0 28px"}], {duration:230, fill:"forwards"});
      await pause(230);
      if (unit) unit.hidden = true;
      if (hud) hud.hidden = true;
    } else if (event.mon && unit) {
      unit.innerHTML = sprite(event.mon, unit.classList.contains("own"));
      unit.hidden = false;
      if (hud) {
        hud.hidden = false;
        hud.querySelector(".vitals-heading strong").textContent = event.mon.name;
        const bar = hud.querySelector("progress");
        const hp = event.hp ?? 1;
        bar.max = event.mon.maxhp;
        bar.value = Math.round(bar.max * hp);
        bar.nextElementSibling.textContent = bar.value + "/" + bar.max;
      }
      await pause(180);
    }
  }
}

function groupPick(group, index) {
  const enabled = group.options.filter(option => !option.disabled);
  return enabled.find(option => option.command === groupDraft.picks[index]) ||
    (enabled.length === 1 && enabled[0].command === "pass" ? enabled[0] : null);
}

function refreshGroupControls() {
  $("groupControls").innerHTML = renderGroupControls(state.duel.battle);
  const battle = state.duel.battle;
  const affected = battle.groups[groupDraft.slot]?.options
    .filter(option => groupDraft.move && option.moveKey === groupDraft.move)
    .flatMap(option => option.target ? [option.target.uid] : option.affected || []) || [];
  for (const hud of $("arena").querySelectorAll("[data-battle-hp]"))
    hud.classList.toggle("target-preview", affected.includes(hud.dataset.battleHp));
  $("groupControls").querySelector('.dual-target:not(:disabled), [aria-pressed="true"]')?.focus({preventScroll:true});
}

function renderGroupControls(battle) {
  const duel = state.duel;
  if (!battle || !duel) return "";
  const key = [state.code, state.round, battle.turn, duel.commandVersion, battle.groups.map(g => Boolean(g.forced)).join(",")].join(":");
  if (groupDraft.key !== key) groupDraft = {key, slot:0, move:"", picks:{}};
  const groups = battle.groups;
  const waiting = (duel.trainers || []).filter(t => !battle.readySides.includes(t.side));
  const pending = waiting.map(t => state.players.find(p => p.id === t.id)?.name).filter(Boolean);
  const partner = duel.trainers?.find(t => t.ally && t.id !== state.you.id);
  const partnerName = state.players.find(p => p.id === partner?.id)?.name;
  const partnerStatus = partnerName ? '<p>' + esc(partnerName) +
    (waiting.includes(partner) ? ' está escolhendo.' : ' está pronto.') + '</p>' : '';
  if (!groups.length) return '<p>' +
    esc(pending.length ? "Aguardando " + pending.join(", ") : "Resolvendo o turno…") + '</p>';
  const slot = groups[groupDraft.slot] ? groupDraft.slot : Math.max(0, groups.findIndex((g,i) => !groupPick(g,i)));
  groupDraft.slot = slot;
  const group = groups[slot];
  const tabs = groups.map((g,i) => '<button type="button" data-action="groupMove" data-args="' +
    esc(JSON.stringify({slot:i, move:""})) + '" aria-pressed="' + (slot === i) + '"><b>' + esc(g.name) +
    '</b><small>' + esc(groupPick(g,i)?.label || (g.forced ? "Troca obrigatória" : "Escolher ação")) +
    '</small></button>').join("");
  const moves = new Map();
  for (const option of group.options) {
    if (option.name) moves.set(option.moveKey || option.name, option);
  }
  const menu = [...moves.values()].map(move => {
    const detail = [moveTypes[move.type] || move.type, moveCategories[move.category] || move.category,
      move.pp == null ? "" : move.pp + "/" + move.maxpp + " PP",
      move.basePower ? "Poder " + move.basePower : "",
      typeof move.accuracy === "number" ? "Precisão " + move.accuracy + "%" : "", move.shortDesc].filter(Boolean).join(" · ");
    return battleMoveButton({...move, label:move.name}, "groupMove", {slot, move:move.moveKey}, detail);
  }).join("");
  const targets = group.options.filter(option => combatMenu === "move" && groupDraft.move && option.moveKey === groupDraft.move);
  if (targets.length) return renderTargetGrid(battle, slot, targets);
  const other = group.options.filter(option => !option.name && !option.disabled);
  return '<div class="dual-commands"><div class="dual-command-grid" aria-label="Pokémon sob seu controle">' + tabs +
    '</div>' + (combatMenu === "move" && menu ? '<h3 class="dual-active-name">Golpes de ' + esc(group.name) +
      '</h3><div class="dual-command-grid dual-moves" aria-label="Golpes">' + menu + '</div>' : '') +
    (combatMenu === "switch" && other.length ? '<div class="dual-command-grid" aria-label="Trocas">' + other.map(option =>
      option.kind === "switch" && groups.some((g,i) => i !== slot && groupPick(g,i)?.command === option.command)
        ? '<button type="button" disabled>' + esc(option.label) + ' · Já selecionado</button>'
        : btn(option.kind === "switch" ? "Trocar · " + option.label : option.label, "groupPick", {slot, command:option.command})).join("") +
      '</div>' : '') +
    partnerStatus + '</div>';
}

function battleMoveButton(move, action, args, details) {
  return '<button type="button" class="battle-move" data-action="' + action + '" data-args="' +
    esc(JSON.stringify(args)) + '" data-type="' + esc(move.type || "") + '"' +
    (move.disabled ? ' disabled' : '') + ' data-move-details="' + esc(details) +
    '" aria-description="' + esc(details) + '"><strong>' + esc(move.label) + '</strong>' +
    (move.pp != null ? '<span>' + move.pp + '/' + move.maxpp + ' PP</span>' : '') + '</button>';
}

function renderTargetGrid(battle, slot, options) {
  const fixed = options.find(option => !option.target);
  const slots = battle.arenaSlots.flatMap((row, side) => Array.from({length:2}, (_, index) => {
    const mon = row[index]?.hp > 0 ? row[index] : null;
    const target = mon && options.find(option => option.target?.uid === mon.uid);
    const affected = mon && fixed?.affected?.includes(mon.uid);
    const choice = target || (affected ? fixed : null);
    return '<button type="button" class="dual-target" data-action="groupPick" data-args="' +
      esc(JSON.stringify({slot, command:choice?.command})) + '"' +
      (choice ? '' : ' disabled') + '><small>' + (side ? "Seu lado" : "Rival") + ' ' +
      (index + 1) + '</small><strong>' + esc(mon?.name || "Vazio") + '</strong><small>' +
      (affected ? (fixed.affected.length > 1 ? "Atingido junto" : "Alvo do golpe") :
        target ? "Alvo válido" : "Fora do alcance") + '</small></button>';
  })).join("");
  return '<div class="dual-target-panel"><b>' + esc(options[0].name) + '</b><p>' +
    (fixed ? "O alcance deste golpe é fixo." : "Escolha uma posição para atingir.") +
    '</p><div class="dual-target-grid' + (fixed ? ' fixed-range' : '') + '" aria-label="Posições da arena">' + slots +
    '</div><footer>' + btn("Voltar aos golpes", "groupMove", {slot, move:""}) +
    (fixed ? btn("Usar golpe", "groupPick", {slot, command:fixed.command}, "primary") : '') +
    '</footer></div>';
}

function arenaView(b, e) {
  const foe = b?.foe || e.wild,
    own = b?.own,
    p = state.you;
  const teamBattle = b && b.mode !== "singles";
  const ownActive = teamBattle ? b.arenaSlots[1] : [own];
  const foeActive = teamBattle ? b.arenaSlots[0] : [foe];
  const active = [...ownActive, ...foeActive].filter(Boolean);
  const changed = (m) => oldBattle?.[m.uid] > m.hp;
  const hit = active
    .filter(Boolean)
    .filter(changed)
    .map((m) => m.uid);
  if (hit.length && !b?.timeline) tone(true);
  const lineup = (b?.ownActive || [own]).map(mon => mon?.uid || "").join(":");
  if (!oldBattle || lineup !== activeLineup) combatMenu = b ? "move" : "items";
  activeLineup = lineup;
  const glitter = new Set(active.filter(m => m?.shiny && !Object.hasOwn(oldBattle || {}, m.uid))
    .map(m => m.uid));
  oldBattle = Object.fromEntries(
    active.map((m) => [m.uid, m.hp]),
  );
  const unit = (m, side, index) =>
    m
      ? '<div class="unit ' +
        side + (teamBattle ? " group-slot-" + index : "") +
        (!b?.timeline && hit.includes(m.uid) ? " impact" : "") +
        '" data-battle-unit="' + esc(m.position || "") + '"' + (!m.hp ? " hidden" : "") + '>' +
        sprite(m, side === "own") +
        (glitter.has(m.uid) ? '<span class="shiny-sparkles" aria-hidden="true"><i>✦</i><i>✧</i><i>✦</i><i>✧</i><i>✦</i></span>' : '') +
        "</div>"
      : "";
  const vitals = (m, side, index) => {
    if (!m) return "";
    const status = statusName(m);
    const types = (m.types || []).map(type => moveTypes[type] || type).join(" · ");
    const effects = battleEffectChips(m.effects) + battleBoostChips(m.boosts) +
      battleEffectChips(b?.field?.[side], "side");
    return '<div class="vitals ' + side + '-hud' + (teamBattle ? ' group-slot-' + index : '') +
      '" data-battle-hp="' + esc(m.uid) + '" data-battle-position="' + esc(m.position || "") + '"' +
      (!m.hp ? " hidden" : "") + '><div class="vitals-heading"><strong>' +
      esc(m.name) + '</strong><span>Nv. ' + m.level + '</span></div>' +
      (m.shiny ? '<span class="shiny-badge">✦ Shiny</span>' : '') +
      (status ? '<span class="combatStatus">' + esc(status) + '</span>' : '') +
      bars(m) + (types ? '<div class="battle-types">' + esc(types) + '</div>' : '') +
      (effects ? '<div class="battle-chips">' + effects + '</div>' : '') + '</div>';
  };
  const choices = b?.choices || [];
  const forcedSwitch = choices.length ? choices.every(c => c.kind === "switch") :
    (b?.groups || []).some(group => group.forced);
  if (forcedSwitch)
    combatMenu = "switch";
  const list =
    combatMenu === "items"
      ? (e && b && p.items.potion
          ? btn("Poção ×" + p.items.potion, "battlePotion")
          : "") +
        (e?.type === "wild"
          ? Object.entries(p.items)
              .filter(([k, n]) => k.endsWith("-ball") && n > 0)
              .map(([k, n]) =>
                btn(state.shop[k].name + " ×" + n, "catch", { ball: k }, "", k),
              )
              .join("")
          : "")
      : choices
          .filter((c) => c.kind === combatMenu)
          .map((c) => {
            if (c.kind !== "move") return btn(c.label, "fight", { cmd: c.command });
            const type = moveTypes[c.type] || c.type || "—";
            const category = moveCategories[c.category] || "—";
            const accuracy = c.accuracy === true ? "Não falha" :
              c.accuracy != null ? c.accuracy + "%" : "—";
            const details = type + " · " + category + " | Poder " + (c.basePower || "—") +
              " | Precisão " + accuracy + (c.priority ? " | Prioridade " + c.priority : "");
            return battleMoveButton(c, "fight", {cmd:c.command}, details);
          })
          .join("");
  const tab = (id, name, enabled) =>
    '<button data-combat="' +
    id +
    '" aria-pressed="' +
    (combatMenu === id) +
    '"' + (enabled ? "" : " disabled") + '>' +
    name +
    "</button>";
  const field = b?.field;
  const fieldChips = [
    ...[field?.weather, field?.terrain].filter(Boolean).map(label => ({label})),
    ...(field?.effects || []),
  ];
  const history = b?.log || [];
  return (
    '<div class="arenaTitle">' +
    esc(
      e?.type === "wild"
        ? "Encontro selvagem"
        : e?.type === "gym"
          ? "Ginásio"
          : e
            ? "Elite Four"
            : "Duelo · " + state.duel.opponent,
    ) +
    '</div><div class="field' + (teamBattle ? " group-field" : "") + '">' +
    (fieldChips.length ? '<div class="battle-field-effects" aria-label="Efeitos de campo">' +
      battleEffectChips(fieldChips) + '</div>' : '') +
    foeActive.map((m,i) => unit(m,"foe",i) + vitals(m,"foe",i)).join("") +
    ownActive.map((m,i) => unit(m,"own",i) + vitals(m,"own",i)).join("") +
    '</div><div class="console"><div class="battle-report"><h3>Histórico da batalha</h3><p class="message" role="status">' +
    esc(history.at(-1) || (foe ? "Um " + foe.name + " apareceu!" : "Duelo")) +
    '</p><ol id="battleLog" tabindex="0" aria-label="Eventos da batalha">' +
    (history.length ? history : [foe ? "Um " + foe.name + " apareceu!" : "A batalha começou."])
      .map(line => '<li>' + esc(line) + '</li>').join("") +
    '</ol></div><div class="battle-controls"><div class="battleTabs">' +
    tab("move", "Battle", !!b && !forcedSwitch) + tab("switch", "Switch", !!b) +
    tab("items", "Bag", !!e && !forcedSwitch) +
    (e?.type === "wild" ? btn("Run", "flee") : !e ? btn("Run", "duelForfeit") :
      '<button type="button" disabled>Run</button>') +
    (teamBattle ? '</div><div class="moves" id="groupControls">' + renderGroupControls(b) :
      '</div><div class="moves">' +
      (b?.waiting ? '<p>Aguardando o adversário…</p>' : list || '<p>Nenhuma opção disponível.</p>')) +
    '</div></div></div><div id="battleMoveTooltip" class="battle-move-tooltip" role="tooltip" hidden></div>'
  );
}
const minigameNames = {
  alphabet: "ABC-Pokémon",
  market: "Pedido do mercado", auction: "Leilão", race: "Corrida de sobrevivência",
  darkAuction: "Leilão no Escuro",
  million: "Show do Milhão - 999.000",
  pokemonQuiz: "Quem é esse Pokémon?",
  wires: "Cortes do Xurkitree", guess: "Adivinha",
  magnetic: "Campo Magnético", rhythm: "Ritmo do Toxtricity", sorter: "Esteira da Pokébola",
  fog: "Hyperbeam in the Fog",
  elements: "Três Cartas", twentyOne: "21 da Equipe Rocket", claim: "Par ou Roubo",
};
const miniInstructions = {
  alphabet: "Na sua vez, digite em até 12 segundos um Pokémon com a letra do centro. Acerte para avançar a letra e passar a vez no sentido horário. Sem resposta válida, você sai e a próxima pessoa tenta a mesma letra. Cada nome só vale uma vez.",
  market: "Calcule o total da compra e envie sua resposta. Um acerto rende ₽ 180.",
  auction: "Há um lote a menos que o número de treinadores. Dê um lance ou passe. Ao comprar um Pokémon, você sai da disputa. Sem lances, o jogo sorteia o lote entre quem ainda não comprou, por até ₽ 1.",
  darkAuction: "Há um lote a menos que o número de treinadores. Você vê só a silhueta até a venda. Ao comprar um Pokémon, você sai da disputa. Sem lances, o jogo sorteia o lote entre quem ainda não comprou, por até ₽ 1.",
  race: "Aperte quando o obstáculo chegar à marca. Os obstáculos ficam mais próximos e exigem mais precisão. Um choque elimina você. Se mais de um jogador chegar ao fim, eles empatam.",
  million: "Responda a cinco perguntas em 45 segundos. Mais acertos valem o primeiro lugar. Em caso de empate, quem terminar mais rápido fica na frente. Os três primeiros dividem ₽ 1.000.",
  pokemonQuiz: "Identifique cinco Pokémon pelas silhuetas em 45 segundos. Quem acertar mais vence. Em caso de empate, quem terminar mais rápido fica na frente. Até três jogadores dividem ₽ 1.000.",
  wires: "Em dupla, cortem quatro fios na ordem indicada em até 60 segundos. Uma pessoa lê o manual e repassa as instruções por voz. A outra vê e corta os fios. Um corte errado, fora da janela ou o fim do tempo provoca um choque.",
  guess: "Uma pessoa lê as fitas das Butterfree e repassa as pistas. Só as Butterfree shiny carregam pistas verdadeiras. A outra pessoa digita o nome do Pokémon. Vocês têm 60 segundos e a primeira dupla a acertar ganha.",
  magnetic: "Use as setas ou WASD para fugir das casas marcadas antes da descarga. Sobreviva por até 50 segundos.",
  fog: "Segure as setas ou WASD para voar e ajustar a mira. Quando o tempo acabar, a névoa se dissipa e todos disparam. A arena encolhe a cada disparo. Seja o último a sobreviver.",
  rhythm: "Aperte A, S, K ou L quando a nota da coluna cruzar a linha. Os combos dão pontos extras. A faixa dura 46 segundos.",
  sorter: "Separe as bolas antes que caiam. Use 1 para Poké Bola, 2 para Grande Bola e 3 para Ultra Bola. A esteira acelera durante 45 segundos.",
  elements: "Escolha uma carta por mão. Fogo vence Planta, Planta vence Água, Água vence Fogo. Receba +2 se tiver vantagem contra pelo menos um adversário. Cada carta é usada uma vez.",
  twentyOne: "Clique em Pedir carta ou Parar, ou use 1 e 2. Você tem 12 segundos por decisão. O Ás vale 1 ou 11. Ganha quem chegar mais perto de 21 sem estourar.",
  claim: "Escolha uma carta da mesa. Se só você tentar pegá-la, ganha seus pontos. Se mais alguém escolher a mesma, ela fica na mesa valendo mais na próxima rodada. São quatro rodadas.",
};
let raceFrame = 0;
const raceExitDelay = 900;
const raceResultReady = race => race.winners &&
  Date.now() + serverOffset >= (race.endedAt || 0) + raceExitDelay;

function raceDistance(elapsed) {
  const time = Math.max(0, elapsed);
  const rampDuration = 45000;
  const accelerating = Math.min(time, rampDuration);
  return time + .75 * (accelerating ** 2 / (2 * rampDuration) + time - accelerating);
}

function visibleRaceObstacles(race, elapsed, width) {
  if (elapsed < 0) return [];
  const travel = raceDistance(elapsed);
  const finishTravel = race.endedAt ? raceDistance(race.endedAt - race.startsAt) : travel;
  const edge = 40 / width * 100;
  const right = 100 + edge;
  return race.obstacles.flatMap((obstacle, index) => {
    const crossing = raceDistance(obstacle.at);
    const left = 24 + (crossing - travel) * .052;
    const finishLeft = 24 + (crossing - finishTravel) * .052;
    return left >= -edge && left <= right && finishLeft <= right
      ? [{ ...obstacle, index, left }]
      : [];
  });
}

function renderRaceObstacles(layer, obstacles) {
  const existing = new Map(Array.from(layer.children, node => [Number(node.dataset.index), node]));
  for (const obstacle of obstacles) {
    let node = existing.get(obstacle.index);
    if (node) {
      existing.delete(obstacle.index);
    } else {
      node = document.createElement("span");
      node.className = "race-obstacle";
      node.dataset.index = obstacle.index;
      node.dataset.type = obstacle.type;
      layer.append(node);
    }
    node.style.left = obstacle.left + "%";
  }
  for (const node of existing.values()) node.remove();
}

function renderRace(s) {
  const race = s.race;
  const p = s.you;
  if (raceResultReady(race)) {
    const names = s.players.filter(q => race.winners.includes(q.id)).map(q => esc(q.name));
    return '<div class="mini-result"><strong>' +
      (names.length === 1 ? names[0] + ' venceu!' : 'Empate · ' + names.join(', ')) +
      '</strong><p>' + (p.done ? 'Aguardando o grupo…' :
        btn("Continuar", "raceContinue", {}, "primary")) + '</p></div>';
  }
  return '<div id="raceTrack" class="race-track"><div class="race-landscape" aria-hidden="true">' +
      '<i></i><i></i><i></i></div><div id="raceCountdown" aria-live="polite"></div>' +
    s.players.map(q => '<div class="race-lane' + (race.runners[q.id].alive ? '' : ' eliminated') +
      '" data-runner="' + esc(q.id) + '"><span class="runner-name">' + esc(q.name) + '</span>' +
      '<img class="race-runner" data-race-avatar="' +
      esc(Object.hasOwn(ExpeditionWorld.avatars, q.avatar) ? q.avatar : "mar") +
      '" src="trainers/' + esc(Object.hasOwn(ExpeditionWorld.avatars, q.avatar) ? q.avatar : "mar") +
      '-side0.png" alt="">' +
      '<span class="race-mark" aria-hidden="true"></span><div class="race-obstacles" aria-hidden="true"></div></div>').join("") +
    '</div><div class="race-controls">' +
    btn("↑ Pular", "dodge", {pose:"jump"}, "primary") +
    btn("↓ Abaixar", "dodge", {pose:"duck"}) +
    '<p hidden>Eliminado · acompanhe a corrida</p></div>';

}

function animateRace() {
  const track = $("raceTrack"), race = state?.race;
  if (!track || !race || state.phase !== "minigame") {
    raceFrame = 0;
    return;
  }
  const now = Date.now() + serverOffset;
  if (raceResultReady(race)) {
    raceFrame = 0;
    renderMinigame(state);
    updateMusic();
    return;
  }
  const elapsed = now - race.startsAt;
  const travel = raceDistance(elapsed);
  const width = Math.max(1, track.clientWidth);
  const obstacles = visibleRaceObstacles(race, elapsed, width);
  const offset = travel * .065 % (2 * width);
  track.style.setProperty("--race-landscape", -offset + "px");
  track.style.setProperty("--race-ground", -travel * .27 + "px");
  track.classList.toggle("hazard-near", !race.winners &&
    obstacles.some(obstacle => elapsed >= obstacle.at - (obstacle.earlyMs ?? 370) &&
      elapsed < obstacle.at + (obstacle.lateMs ?? 190)));
  const counter = $("raceCountdown");
  const value = elapsed < 0 ? String(Math.max(1,Math.ceil(-elapsed / 1000))) :
    elapsed < 480 ? "Já!" : "";
  if (counter.textContent !== value) counter.textContent = value;
  track.classList.toggle("race-ready", elapsed >= 0);
  for (const lane of track.querySelectorAll(".race-lane")) {
    const runner = race.runners[lane.dataset.runner];
    const fallen = !runner.alive;
    lane.classList.toggle("eliminated", fallen);
    const predicted = peerVisuals.get(lane.dataset.runner);
    const showPrediction = predicted?.pose && now - predicted.at < 360;
    const pose = fallen ? "fall" : showPrediction ? predicted.pose : runner.poseUntil > now ? runner.pose : "";
    const stamp = fallen ? runner.eliminatedAt : showPrediction ? predicted.at : runner.poseAt;
    if (lane.dataset.pose !== pose || lane.dataset.poseStamp !== String(stamp)) {
      lane.style.setProperty("--pose-delay", -Math.max(0, now - (stamp || now)) + "ms");
      lane.dataset.pose = pose;
      lane.dataset.poseStamp = stamp;
    }
    const image = lane.querySelector(".race-runner");
    const step = elapsed < 0 || race.winners || pose ? 0 : [0, 1, 0, 2][
      Math.floor(travel / 95) % 4
    ];
    const spritePath = "trainers/" + image.dataset.raceAvatar + "-side" + step + ".png";
    if (image.getAttribute("src") !== spritePath) image.src = spritePath;
    renderRaceObstacles(lane.querySelector(".race-obstacles"), obstacles);
  }
  const controls = document.querySelector(".race-controls");
  const eliminated = !race.runners[state.you.id].alive;
  for (const button of controls.querySelectorAll("button")) {
    button.hidden = eliminated;
    button.disabled = !!race.winners || elapsed < 0;
  }
  controls.querySelector("p").hidden = !eliminated;
  raceFrame = requestAnimationFrame(animateRace);
}
document.addEventListener("keydown", event => {
  if ($("soundSettings").open || !["ArrowUp","ArrowDown"].includes(event.key) || event.repeat ||
      state?.phase !== "minigame" || !state.race || state.race.winners ||
      !state.race.runners[state.you.id].alive || Date.now() + serverOffset < state.race.startsAt ||
      !$("roundDraw").hidden) return;
  event.preventDefault();
  act("dodge", {pose: event.key === "ArrowUp" ? "jump" : "duck"});
});
let drawKey = "", drawTimer;

function spinRoulette(draw, options, selected, heading, onDone) {
  const winner = options.findIndex(([id]) => id === selected);
  if (winner < 0) { onDone(); return; }
  const step = 360 / options.length;
  const stop = 5 * 360 - winner * step;
  const colors = ["#1c5c47", "#753d5a", "#285573", "#79562a", "#4f4381", "#963f35", "#536125", "#784471",
    "#286777", "#80512c", "#485c91", "#8b424e", "#3f6650", "#655085"];
  const sectors = options.map((_, i) => colors[i % colors.length] + " " + i * step + "deg " + (i + 1) * step + "deg");
  const spinMs = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 3200;
  draw.innerHTML = '<div class="draw-card roulette-card"><h2>' + esc(heading) + '</h2>' +
    '<div class="roulette" aria-hidden="true"><div class="roulette-pointer"></div>' +
    '<div class="roulette-wheel' + (options.length > 10 ? ' roulette-wheel-numbered' :
      options.length > 6 ? ' roulette-wheel-dense' : '') +
    '" style="--stop:' + stop + 'deg;--spin-duration:' + spinMs +
    'ms;--wheel:conic-gradient(from ' + (-step / 2) + 'deg,' + sectors.join(",") + ')">' +
    options.map(([, name], index) =>
      '<div class="roulette-sector" style="--angle:' + index * step + 'deg"><span>' +
      (options.length > 10 ? index + 1 : esc(name)) + '</span></div>').join("") +
    '</div><div class="roulette-hub"></div></div>' +
    '<div class="roulette-result">Girando a roleta…</div></div>';
  draw.hidden = false;
  drawTimer = setTimeout(() => {
    draw.querySelector(".roulette-card").classList.add("roulette-settled");
    draw.querySelector(".roulette-result").textContent = options[winner][1];
    drawTimer = setTimeout(onDone, 1800);
  }, spinMs);
}

function drawRound(s) {
  const draw = $("roundDraw");
  const key = s.code + ":" + s.round + ":" + s.phase;
  if (key === drawKey) return;
  clearTimeout(drawTimer);
  drawKey = key;
  draw.hidden = true;
  $("minigameScreen").inert = false;
  $("duelTeamScreen").inert = false;
  $("arena").inert = false;
  $("overlay").inert = false;
  if (s.testLobby) return;
  if (s.phase === "minigame") {
    $("minigameScreen").inert = true;
    const options = (s.minigameOptions ?? [s.minigame]).map(id => [id, minigameNames[id]]);
    spinRoulette(draw, options, s.minigame, "Sorteio de minigame", () => {
      draw.hidden = true;
      $("minigameScreen").inert = false;
    });
    return;
  }
  if (s.phase !== "duelos" || !s.pairs?.length) return;
  $("arena").inert = true;
  $("overlay").inert = true;
  $("duelTeamScreen").inert = true;
  const names = new Map(s.players.map(p => [p.id, p.name]));
  const showPairs = () => {
    const result = '<div class="pair-reveal">' + s.pairs.map(members => {
      const team = side => members.filter((_, i) => i % 2 === side).map(id => esc(names.get(id))).join(" + ");
      return '<p><b>' + team(0) + '</b><span>VS</span><b>' + team(1) + '</b></p>';
    }).join("") + '</div>';
    draw.innerHTML = '<div class="draw-card"><h2>Duplas da rodada</h2>' +
      (s.duelFormat ? '<p>' + esc(s.duelFormat.selected.label) + '</p>' : '') +
      '<div class="draw-reel" aria-hidden="true"><div>' +
      s.players.map(p => '<span>' + esc(p.name) + '</span>').join("") +
      '</div></div>' + result + '</div>';
    draw.hidden = false;
    drawTimer = setTimeout(() => {
      draw.hidden = true;
      $("arena").inert = false;
      $("overlay").inert = false;
      $("duelTeamScreen").inert = false;
    }, 3300);
  };
  if (s.duelFormat?.options.length)
    spinRoulette(draw, s.duelFormat.options.map(f => [f.id, f.label]),
      s.duelFormat.selected.id, "Sorteio do tipo de duelo", showPairs);
  else showPairs();
}

let millionRevealedKey;

function millionScorebar(score, total) {
  return '<span class="million-progress" aria-hidden="true"><i style="width:' +
    score / total * 100 + '%"></i></span><span class="million-score">' + score + '/' + total + '</span>';
}

function renderPokemonSilhouette(silhouette) {
  return '<div class="pokemon-quiz-stage" role="img" aria-label="Silhueta de um Pokémon a identificar">' +
    '<div class="pokemon-quiz-art" aria-hidden="true" style="--angle:' + silhouette.angle +
    'deg;--flip-x:' + silhouette.flipX + ';--flip-y:' + silhouette.flipY + '">' +
    sprite(silhouette) + '</div>' + silhouette.spots.map(spot =>
      '<i aria-hidden="true" style="--x:' + spot.x + '%;--y:' + spot.y + '%;--size:' + spot.size +
      '%;--tilt:' + (spot.x * 3) + 'deg"></i>'
    ).join("") + '</div>';
}

function renderMillion(s) {
  const quiz = s.million;
  if (quiz.results) {
    if (millionRevealedKey !== quiz.deadline && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return '<div class="million-board million-reveal" id="millionReveal">' +
        '<div class="million-check" aria-live="polite"></div><div class="million-players">' +
        s.players.map(p => '<div class="million-player"><div class="million-character">' +
          trainerSprite(p.avatar, "million-avatar") + '<span class="million-stamp" hidden></span></div>' +
          '<strong>' + esc(p.name) + '</strong>' + millionScorebar(0, quiz.total) + '</div>').join("") +
        '</div>' + btn("Pular contagem", "millionSkip") + '</div>';
    }
    const players = new Map(s.players.map(p => [p.id, p]));
    return '<div class="million-board"><h3>Classificação</h3><ol class="million-ranking">' +
      quiz.results.map(({id, score, prize}) =>
        '<li' + (id === s.you.id ? ' class="million-you"' : '') + '>' +
        trainerSprite(players.get(id)?.avatar, "million-avatar") + '<strong>' + esc(players.get(id)?.name) +
        '</strong>' + millionScorebar(score, quiz.total) + ' <b>' +
        (prize ? '₽ ' + prize : '—') + '</b></li>').join("") +
      '</ol><details><summary>Ver gabarito</summary><ol>' + quiz.review.map(q =>
        '<li>' + (q.silhouette ? '<span class="pokemon-quiz-answer">' +
          sprite({...q.silhouette, name: "", shiny: false}) + '</span>' : '<strong>' + esc(q.prompt) + '</strong><br>') +
        esc(q.correct) +
        (q.selected === q.correct ? ' <span aria-label="Você acertou">✓</span>' :
          ' <small>· ' + (q.selected ? 'Sua resposta: ' + esc(q.selected) : 'Sem resposta') + '</small>') +
        '</li>').join("") + '</ol></details>' +
      (s.you.done ? '<p>Aguardando o grupo…</p>' : btn("Continuar", "millionContinue", {}, "primary")) + '</div>';
  }
  return '<div class="million-board"><div class="million-status"><span>' +
    (quiz.question ? (quiz.question.silhouette ? 'Rodada ' : 'Pergunta ') + (quiz.index + 1) + ' de ' + quiz.total : 'Respostas enviadas') +
    '</span><span id="millionClock"></span></div>' +
    (quiz.question ? (quiz.question.silhouette ? renderPokemonSilhouette(quiz.question.silhouette) :
      '<h3>' + esc(quiz.question.prompt) + '</h3>') + '<div class="million-choices">' +
      quiz.question.choices.map((choice, index) => btn(String.fromCharCode(65 + index) + " · " + choice,
        "millionAnswer", { index: quiz.index, choice: index })).join("") + '</div>' :
      '<p>Aguardando os demais jogadores…</p>') + '</div>';
}

function finishMillionReveal() {
  millionRevealedKey = state.million.deadline;
  $("millionReveal")?.remove();
  renderMinigame(state);
}

function animateMillionReveal(reveal, s) {
  const quiz = s.million;
  const heading = reveal.querySelector(".million-check");
  const outcomes = new Map(quiz.results.map(result => [result.id, result.checks]));
  const cards = [...reveal.querySelectorAll(".million-player")].map((card, index) => ({
    checks: outcomes.get(s.players[index].id),
    stamp: card.querySelector(".million-stamp"),
    bar: card.querySelector(".million-progress i"),
    score: card.querySelector(".million-score"),
    points: 0,
  }));

  function checkQuestion(index) {
    if (!reveal.isConnected || state.phase !== "minigame" || state.million?.deadline !== quiz.deadline) return;
    if (index === quiz.total) {
      finishMillionReveal();
      return;
    }
    const question = quiz.review[index];
    heading.textContent = (question.silhouette ? "Rodada " : "Pergunta ") +
      (index + 1) + " de " + quiz.total + " · " + question.correct;
    for (const card of cards) {
      const correct = card.checks[index];
      card.points += Number(correct);
      card.stamp.hidden = false;
      card.stamp.dataset.correct = correct;
      card.stamp.textContent = correct ? "Fez o básico" : "Burro";
      card.stamp.getAnimations().forEach(animation => animation.cancel());
      card.stamp.animate([
        { transform: "translate(-50%, -50%) rotate(-13deg) scale(1.8)", opacity: 0 },
        { transform: "translate(-50%, -50%) rotate(-8deg) scale(.9)", opacity: 1, offset: .65 },
        { transform: "translate(-50%, -50%) rotate(-8deg) scale(1)", opacity: 1 },
      ], { duration: 310, easing: "ease-out" });
      card.bar.style.width = card.points / quiz.total * 100 + "%";
      card.score.textContent = card.points + "/" + quiz.total;
    }
    setTimeout(checkQuestion, 1050, index + 1);
  }

  setTimeout(checkQuestion, 350, 0);
}

function updateMiniClock(clock, deadline) {
  if (!clock.isConnected) return;
  const seconds = Math.max(0, Math.ceil((deadline - Date.now() - serverOffset) / 1000));
  clock.textContent = seconds + " s";
  clock.classList.toggle("urgent", seconds <= 10);
  if (seconds > 0) setTimeout(() => updateMiniClock(clock, deadline), 200);
}

const wireColors = {
  vermelho:"#fe626e", azul:"#72a9ff", amarelo:"#ffd65f", verde:"#7ce48f",
  roxo:"#bd95ff", laranja:"#ff9855", rosa:"#ffa2d8",
};
const pairLabels = { won:"Venceu", shock:"Levou choque", timeout:"Tempo esgotado", lost:"Outra dupla acertou primeiro" };

function playPairFeedback(previous, current) {
  if (!previous || !current || !current.deadline) return;
  if (current.status !== previous.status) {
    if (current.status === "won") playNotes([[523,659,.12], [659,784,.14], [784,1047,.23]]);
    else if (current.status === "shock" || current.status === "timeout")
      playNotes([[110,64,.22], [170,52,.24], [120,48,.3]]);
  } else if ((current.progress ?? 0) > (previous.progress ?? 0)) {
    playNotes([[780,300,.1], [520,660,.12]]);
  } else if ((current.captured?.length ?? current.hints?.length ?? 0) > (previous.captured?.length ?? previous.hints?.length ?? 0) ||
      current.messages.length > previous.messages.length) {
    playNotes([[620,860,.105]]);
  } else if (current.lastGuessAt && current.lastGuessAt !== previous.lastGuessAt) {
    playNotes([[350,160,.14]]);
  }
}

function clueButterfreeSprite(shiny) {
  return '<img class="butterfree-sprite" alt="Butterfree" width="54" height="46" ' +
    'src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/' +
    (shiny ? 'shiny/' : '') + '12.png">';
}

let guessSpeciesOptions;
let guessSpeciesRequest;
function loadGuessSpecies() {
  if (guessSpeciesOptions !== undefined || guessSpeciesRequest) return;
  guessSpeciesRequest = fetch("/api/guide/species").then(response => {
    if (!response.ok) throw Error("Pokédex indisponível.");
    return response.json();
  }).then(species => {
    const names = new Set(species.map(pokemon => pokemon.name));
    guessSpeciesOptions = [...names].map(name => '<option value="' + esc(name) + '"></option>').join("");
    const list = $("pairGuessSpecies");
    if (list) list.innerHTML = guessSpeciesOptions;
  }).catch(() => {
    // Guess by typing if the catalog is unavailable.
  });
}

function renderClueButterfree(game) {
  const caught = new Set(game.captured);
  const pending = game.butterflies.filter(clue => !caught.has(clue.id));
  const captured = game.butterflies.filter(clue => caught.has(clue.id));
  return (pending.length ? '<div class="butterfree-grove" aria-label="Butterfree com fitas">' + pending.map(clue =>
    '<div class="butterfree-flight" data-course="' + clue.course + '" style="--phase:-' + clue.phase +
    'ms;--speed:' + clue.speed + 'ms"><button type="button" class="butterfree-clue" data-action="pairCatch"' +
    ' data-args="' + esc(JSON.stringify({butterfly:clue.id})) + '">' +
    clueButterfreeSprite(clue.shiny) +
    '<span>' + esc(clue.text) + '</span></button></div>').join("") +
    '</div>' : '') +
    (captured.length ? '<ul class="wire-checklist">' + captured.map(clue =>
      '<li class="butterfree-caught">' + clueButterfreeSprite(clue.shiny) + '<span>' + esc(clue.text) + '</span>' +
      (game.messages.some(m => m.index === clue.id) ? ' <small>Enviada</small>' :
        btn("Enviar pista", "pairRelay", {index:clue.id}, "primary")) + '</li>').join("") + '</ul>' : '');
}

function renderPairGame(s) {
  const game = s.pairGame;
  const wires = s.minigame === "wires";
  const name = id => s.players.find(player => player.id === id)?.name;
  const failed = game.status === "shock" || (wires && game.status === "timeout");
  const active = game.status === "playing" && !game.finished;
  const xurkitree = {name:"Xurkitree", slug:"xurkitree", pokemonId:796};
  const result = game.finished ? '<ul class="pair-results">' +
    game.results.map(team => '<li><b>' + esc(name(team.guide)) + ' &amp; ' + esc(name(team.actor)) +
      '</b><span>' + esc(pairLabels[team.status]) + '</span></li>').join("") + '</ul>' +
    (s.you.done ? '<p>Aguardando o grupo…</p>' : btn("Continuar", "pairContinue", {}, "primary")) :
    '<p>Aguardando as outras duplas…</p>';
  const status = '<div class="pair-status"><span>Dupla com <b>' + esc(name(game.partner)) +
    '</b></span>' + (active ? '<strong id="pairClock" aria-label="Tempo restante"></strong>' : '') + '</div>';
  if (!active) return '<div class="pair-mini' + (failed ? ' pair-shock' : '') + '">' + status +
    (wires || game.pokemon ? '<div class="pair-pokemon">' + sprite(wires ? xurkitree : game.pokemon) + '</div>' : '') +
    '<h3>' + esc(failed ? "Choque do Xurkitree!" : pairLabels[game.status]) + '</h3>' +
    (game.pokemon ? '<p>Era <strong>' + esc(game.pokemon.name) + '</strong>.</p>' : '') + result + '</div>';

  const messages = '<ol class="pair-messages" aria-label="Pistas recebidas">' +
    game.messages.map(message => '<li>' + esc(message.text) + '</li>').join("") +
    '</ol>';
  let board;
  if (wires && game.guide) {
    board = '<ol class="wire-checklist">' + game.instructions.map((step, index) =>
      '<li data-step="' + (index < game.progress ? "done" : index === game.progress ? "current" : "next") +
      '">' + esc(step) + '</li>').join("") + '</ol>';
  } else if (wires) {
    board = '<div class="wire-board">' + game.wires.map(wire => {
      const cut = game.cuts.includes(wire.id);
      return '<div class="wire-slot' + (cut ? ' wire-cut' : '') + '" style="--wire:' + wireColors[wire.color] +
        ';--thickness:' + ({fino:3, médio:6, grosso:10}[wire.thickness]) + 'px">' +
        '<button type="button" data-action="pairCut" data-args="' +
        esc(JSON.stringify({wire:wire.id, index:game.progress})) + '" aria-label="' +
        esc((cut ? "Cortado: " : "Cortar: ") + wire.color + " " + wire.thickness) + '"' +
        (cut ? ' disabled' : '') + '><i></i><span>' + (wire.id + 1) + '</span></button>' +
        '<small>' + esc(wire.color) + '<br>' + esc(wire.thickness) + '</small></div>';
    }).join("") + '</div>' + (game.practiceSpeech
      ? ("speechSynthesis" in window ? btn("Ouvir o Rival", "wireListen", {}, "primary") :
        '<p>O treino por voz precisa da síntese de fala do navegador.</p>')
      : '<p>Combine os cortes por voz com sua dupla.</p>');
  } else if (game.guide && game.butterflies) {
    board = renderClueButterfree(game);
  } else if (game.guide) {
    board = (game.hints.length < game.total ? '<div class="paper-field"><i></i><i></i>' +
      '<div class="paper-flight" style="--paper-delay:-' + (game.paper % 1600) + 'ms">' +
      btn("Pegar papel", "pairCatch", {paper:game.paper}, "flying-paper") + '</div></div>' : '') +
      '<ol class="wire-checklist">' + game.hints.map((hint, index) => '<li>' + esc(hint) +
        (game.messages.some(m => m.index === index) ? ' <small>Enviada</small>' :
          btn("Enviar pista", "pairRelay", {index}, "primary")) + '</li>').join("") + '</ol>';
  } else {
    board = (game.messages.length ? messages : '<p>Aguardando as pistas da sua dupla…</p>') +
      '<form id="pairGuessForm"><label for="pairGuessName">Nome do Pokémon</label>' +
      '<div><input id="pairGuessName" list="pairGuessSpecies" maxlength="60" autocomplete="off" required>' +
      '<datalist id="pairGuessSpecies">' + (guessSpeciesOptions ?? '') + '</datalist>' +
      '<button type="submit" class="primary">Adivinhar</button></div></form>' +
      (game.lastGuessAt ? '<p role="status">Ainda não. Pode tentar de novo!</p>' : '');
  }
  return '<div class="pair-mini">' + status +
    (wires ? '<div class="pair-pokemon pair-live">' + sprite(xurkitree) + '</div>' : '') +
    '<h3>' + (wires ? (game.guide ? "Manual de cortes" : "Painel de fios") :
      game.guide ? (game.butterflies ? "Fitas das Butterfree" : "Pegue os papéis") : "Qual é o Pokémon?") + '</h3>' +
    (wires ? '<p class="pair-progress">' + game.progress + ' de ' + game.total + ' cortes corretos</p>' : '') +
    board + '</div>';
}

document.addEventListener("submit", event => {
  if (event.target.id !== "pairGuessForm") return;
  event.preventDefault();
  const name = v("pairGuessName")?.trim();
  if (name) act("pairGuess", {name});
});

function renderAuction(s) {
  const a = s.auction;
  if (!a) return '<div class="mini-result">Preparando os lotes…</div>';
  const name = id => s.players.find(p => p.id === id)?.name;
  const purchases = new Map(a.results.map(result => [result.winner, result]));
  if (a.closed) {
    return '<div class="auction-board auction-summary"><h3>Compras do leilão</h3>' +
      a.results.map(result => '<div class="auction-purchase">' + sprite(result.pokemon) +
        '<div><strong>' + esc(result.pokemon.name) + '</strong><br>' + esc(name(result.winner)) +
        '</div><b>₽ ' + result.amount + '</b></div>').join("") +
      (s.you.done ? '<p>Aguardando o grupo…</p>' : btn("Continuar", "auctionContinue", {}, "primary")) + '</div>';
  }

  const p = s.you;
  const result = a.reveal ? a.results.at(-1) : null;
  const lot = a.lot + (a.reveal ? 0 : 1);
  const pokemon = a.pokemon;
  const canBid = !a.reveal && !purchases.has(p.id) && !a.passed.includes(p.id) && a.leader !== p.id;
  const bid = p.money > a.amount
    ? '<label>Seu lance<input type="number" id="auctionBid" min="' + (a.amount + 1) +
      '" max="' + p.money + '" value="' + (a.amount + 1) + '" inputmode="numeric"></label>' +
      btn("Dar lance", "bid", {lot:a.lot}, "primary")
    : '<p>Seu saldo não cobre o lance.</p>';
  const controls = a.reveal ? '' : canBid ? bid + btn("Passar", "auctionPass", {lot:a.lot}) :
    '<p>' + (purchases.has(p.id) ? "Você já comprou seu Pokémon." :
      a.leader === p.id ? "Você está na liderança." : "Você passou neste lote.") + '</p>';

  return '<div class="auction-grid"><div class="auction-lot' + (a.hidden ? ' auction-silhouette' : '') +
    '"><span>Lote ' + lot + ' de ' + a.total + '</span>' + (pokemon ? sprite(pokemon) : '') +
    (a.hidden ? '<strong>Pokémon misterioso</strong>' : pokemon ?
      '<strong>' + esc(pokemon.name) + '</strong><span>Nível ' + pokemon.level +
      (pokemon.shiny ? ' · Shiny' : '') + '</span>' : '') + '</div>' +
    '<div class="auction-board"><div aria-live="polite" class="auction-price"><small>' +
    (result ? "Vendido" : 'Maior lance <span id="auctionClock"></span>') + '</small><strong>' +
    (result ? "₽ " + result.amount : a.amount ? "₽ " + a.amount : "—") + '</strong><span>' +
    esc(result ? name(result.winner) : name(a.leader) || "Aguardando o primeiro lance") +
    (result?.automatic ? ' · Venda automática' : '') + '</span></div>' +
    '<div class="auction-players">' + s.players.map(q =>
      '<div><b>' + esc(q.name) + '</b><span>' +
      (purchases.has(q.id) ? 'Comprou ' + esc(purchases.get(q.id).pokemon.name) :
        a.leader === q.id ? "Líder" : a.passed.includes(q.id) ? "Passou" : "Na disputa") +
      '</span></div>').join("") + '</div><div class="auction-actions"><strong>Saldo · ₽ ' + p.money +
    '</strong>' + controls + '</div></div></div>';
}

const arcadeDirections = {ArrowUp:"up", w:"up", ArrowDown:"down", s:"down",
  ArrowLeft:"left", a:"left", ArrowRight:"right", d:"right"};
const arcadeKeys = {rhythm:["A","S","K","L"], sorter:["1","2","3"]};
const arcadeBalls = ["poke-ball", "great-ball", "ultra-ball"];
const arcadeBallNames = ["Poké Bola", "Grande Bola", "Ultra Bola"];
let arcadeSelected = null;
let arcadeSelectionKey = "";

function selectArcadeCard(choice) {
  const game = state?.arcade;
  if (!game || game.events || !game.start || game.results || game.reveal || game.you.standing ||
      game.you.choice !== null || Date.now() + serverOffset >= game.deadline ||
      !$("roundDraw").hidden || $("soundSettings").open || busy) return;
  if (choice === null) {
    if (arcadeSelected !== null) act("arcadePick", {choice:arcadeSelected, round:game.round});
  } else if (document.querySelector('[data-arcade-choice="' + choice + '"]')) {
    arcadeSelected = choice;
    for (const button of document.querySelectorAll("[data-arcade-choice]"))
      button.setAttribute("aria-pressed", String(Number(button.dataset.arcadeChoice) === choice));
    $("arcadeConfirm").disabled = false;
  }
}

document.addEventListener("keydown", event => {
  const game = state?.arcade;
  if ($("soundSettings").open || !game?.start || game.results || game.reveal || !$("roundDraw").hidden || event.altKey ||
      event.ctrlKey || event.metaKey || event.target.matches("input,textarea,select,[contenteditable]")) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (state.minigame === "magnetic" && Object.hasOwn(arcadeDirections, key)) {
    event.preventDefault();
    if (game.you.alive && Date.now() + serverOffset < game.deadline)
      act("arcadeMove", {direction:arcadeDirections[key]});
  } else if (arcadeKeys[state.minigame]) {
    const lane = arcadeKeys[state.minigame].indexOf(key.toUpperCase());
    if (lane < 0 || event.repeat) return;
    event.preventDefault();
    const now = Date.now() + serverOffset;
    if (now >= game.start && now < game.deadline) act("arcadeTap", {lane});
  } else if (state.minigame === "twentyOne" && ["1", "2"].includes(key) && !event.repeat) {
    event.preventDefault();
    if (!game.you.standing && game.you.choice === null && Date.now() + serverOffset < game.deadline)
      act("arcadePick", {choice:Number(key) - 1, round:game.round});
  } else if (!game.events && (["1", "2", "3", "Enter"].includes(key)) && !event.repeat &&
      (key !== "Enter" || arcadeSelected !== null)) {
    event.preventDefault();
    selectArcadeCard(key === "Enter" ? null : Number(key) - 1);
  }
});

function renderKeyboardArcade(s) {
  let content;
  if (s.minigame === "magnetic") {
    content = '<div class="arcade-grid" aria-label="Arena magnética">' +
      Array.from({length:25}, () => '<i></i>').join("") + s.players.map(p =>
        '<div class="arcade-trainer" data-id="' + esc(p.id) + '" title="' + esc(p.name) + '">' +
        trainerSprite(p.avatar, "", p.name) + '<small>' + esc(p.name) + '</small></div>').join("") + '</div>' +
      '<div class="arcade-keys">' + [["↑","up"],["←","left"],["↓","down"],["→","right"]].map(([label,direction]) =>
        btn(label, "arcadeMove", {direction})).join("") + '</div>';
  } else if (s.minigame === "rhythm") {
    content = '<div class="arcade-rhythm" aria-label="Pistas do ritmo"><div class="arcade-hit-line"></div>' +
      arcadeKeys.rhythm.map((key, lane) => '<div class="arcade-lane" style="--lane:' + lane + '" data-key="' + key + '">' +
        Array.from({length:5}, () => '<i hidden></i>').join("") + '</div>').join("") + '</div>' +
      '<div class="arcade-keys">' + arcadeKeys.rhythm.map((key, lane) => btn(key, "arcadeTap", {lane})).join("") + '</div>';
  } else {
    content = '<div class="arcade-machine"><div class="arcade-belt" aria-label="Esteira">' +
      Array.from({length:3}, () => '<div class="arcade-ball" hidden>' +
        arcadeBalls.map(ball => '<span>' + itemArt(ball) + '</span>').join("") + '</div>').join("") +
      '</div><div class="arcade-chute" aria-hidden="true"></div></div>' +
      '<div class="arcade-keys">' + arcadeBallNames.map((label, lane) =>
        btn((lane + 1) + " · " + label, "arcadeTap", {lane}, "", arcadeBalls[lane])).join("") + '</div>';
  }
  return '<section class="arcade-panel" id="arcadeStage"><div class="arcade-hud"><strong></strong>' +
    '<output class="arcade-feedback" aria-hidden="true"></output><span></span></div>' +
    '<div class="arcade-countdown" role="status" hidden></div>' + content + '</section>';
}

function animateKeyboardArcade(stage, initial) {
  const {start, events} = initial.arcade;
  const kind = initial.minigame;
  const stats = stage.querySelector(".arcade-hud strong");
  const timer = stage.querySelector(".arcade-hud span");
  const feedback = stage.querySelector(".arcade-feedback");
  const countdown = stage.querySelector(".arcade-countdown");
  const controls = [...stage.querySelectorAll('[data-action="arcadeTap"]')];
  const cells = [...stage.querySelectorAll(".arcade-grid > i")];
  const figures = new Map([...stage.querySelectorAll(".arcade-trainer")].map(node => [node.dataset.id, node]));
  const lanes = [...stage.querySelectorAll(".arcade-lane")].map(node => [...node.children]);
  const balls = [...stage.querySelectorAll(".arcade-ball")];
  const tones = [180, 294, 392, 523];
  let nextSound = events.findIndex(event => event.at >= Date.now() + serverOffset - start);
  if (nextSound < 0) nextSound = events.length;
  let cursor = initial.arcade.you.cursor;
  let score = initial.arcade.you.score;
  let wave = initial.arcade.round;
  let lastFeedback = 0;
  let sortedBall = null;

  function frame() {
    const game = state?.arcade;
    if (!stage.isConnected || state?.phase !== "minigame" || game?.start !== start || game.results) return;
    const now = Date.now() + serverOffset;
    const elapsed = now - start;
    for (const [index, button] of controls.entries()) {
      const pressed = game.players.some(p => {
        const visual = peerVisuals.get(p.id);
        return visual?.lane === index && now - visual.at < 160;
      });
      button.classList.toggle("arcade-key-pressed", pressed);
    }
    const starting = elapsed < 0;
    const number = starting ? String(Math.min(3, Math.ceil(-elapsed / 1000))) : "";
    if (countdown.textContent !== number) countdown.textContent = number;
    countdown.hidden = !starting;
    for (const button of controls) button.disabled = starting || now >= game.deadline;
    const cursorChanged = game.you.cursor > cursor;
    const scored = game.you.score > score;
    if (cursorChanged) {
      feedback.textContent = scored ? "+" + (game.you.score - score) : "Errou";
      feedback.dataset.hit = String(scored);
      lastFeedback = now;
      if (kind === "sorter" && scored && events[cursor])
        sortedBall = {event:events[cursor], index:cursor, at:elapsed};
    }
    feedback.classList.toggle("visible", now - lastFeedback < 420);
    const seconds = Math.max(0, Math.ceil((game.deadline - Math.max(now, start)) / 1000));
    const clock = seconds + " s";
    if (timer.textContent !== clock) timer.textContent = clock;
    timer.classList.toggle("urgent", seconds <= 8);
    const summary = kind === "magnetic" ? (game.you.alive ? game.players.filter(p => p.alive).length + " na arena" : "Eliminado") :
      game.you.score + " pontos · Combo " + game.you.combo;
    if (stats.textContent !== summary) stats.textContent = summary;
    if (kind === "magnetic") {
      const event = events[game.round];
      const warning = event && elapsed >= event.at - event.warning;
      const strike = events[game.round - 1];
      const firing = strike && elapsed >= strike.at && elapsed - strike.at < 270;
      cells.forEach((cell, index) => {
        cell.classList.toggle("arcade-danger", Boolean(warning && event.danger.includes(index)));
        cell.classList.toggle("arcade-strike", Boolean(firing && strike.danger.includes(index)));
      });
      for (const p of game.players) {
        const figure = figures.get(p.id);
        figure.classList.toggle("arcade-eliminated", !p.alive);
        const predicted = peerVisuals.get(p.id);
        const cell = predicted?.cell != null && now - predicted.at < 240 ? predicted.cell : p.cell;
        if (figure.dataset.cell !== String(cell)) {
          figure.style.left = (cell % 5 * 20 + 10) + "%";
          figure.style.top = (Math.floor(cell / 5) * 20 + 10) + "%";
          figure.dataset.cell = cell;
        }
        figure.classList.toggle("arcade-self", p.id === state.you.id);
      }
      if (game.round > wave) {
        playNotes([[110,48,.15]]);
        wave = game.round;
      }
    } else if (kind === "rhythm") {
      const slots = [0,0,0,0];
      for (let i = game.you.cursor; i < events.length && events[i].at <= elapsed + 1200; i++) {
        const event = events[i];
        const dot = lanes[event.lane][slots[event.lane]++];
        if (!dot) continue;
        dot.hidden = false;
        dot.style.top = (83 - (event.at - elapsed) * .063) + "%";
      }
      for (let i = 0; i < lanes.length; i++)
        for (let j = slots[i]; j < lanes[i].length; j++) lanes[i][j].hidden = true;
      stage.classList.toggle("arcade-beat", events[nextSound - 1] && elapsed - events[nextSound - 1].at < 110);
      while (events[nextSound]?.at <= elapsed) {
        const event = events[nextSound++];
        if (elapsed - event.at < 95) gameAudio.rhythmNote(tones[event.lane], nextSound - 1);
      }
    } else {
      const visible = [];
      for (let i = game.you.cursor; i < Math.min(events.length, game.you.cursor + 2); i++) {
        const event = events[i];
        const end = events[i + 1]?.at ?? game.deadline - start;
        if (elapsed >= event.at - 115 && elapsed < end + 120)
          visible.push({lane:event.lane, x:8 + 84 * (elapsed - event.at) / (end - event.at), active:elapsed >= event.at});
      }
      if (sortedBall && elapsed - sortedBall.at < 260) {
        const end = events[sortedBall.index + 1]?.at ?? game.deadline - start;
        const progress = (elapsed - sortedBall.at) / 260;
        const x = 8 + 84 * (sortedBall.at - sortedBall.event.at) / (end - sortedBall.event.at);
        visible.push({lane:sortedBall.event.lane, x:x + progress * 8, exit:progress});
      }
      balls.forEach((ball, i) => {
        const item = visible[i];
        ball.hidden = !item;
        if (!item) return;
        ball.dataset.lane = item.lane;
        ball.dataset.active = Boolean(item.active);
        ball.style.left = item.x + "%";
        ball.style.setProperty("--roll", item.x * 3 + "deg");
        ball.style.setProperty("--drop", (item.exit ?? 0) * 70 + "px");
        ball.style.setProperty("--fade", 1 - (item.exit ?? 0));
      });
    }
    if (cursorChanged) {
      if (scored) playNotes([[520,760,.08]]);
      else if (game.you.combo === 0 && kind === "sorter") playNotes([[220,115,.09]]);
      cursor = game.you.cursor;
      score = game.you.score;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function arcadeCard(card) {
  const art = {Fogo:"fire-stone", Água:"water-stone", Planta:"leaf-stone"}[card.type];
  return '<span class="arcade-card" data-type="' + esc(card.type) + '">' +
    '<b>' + card.value + '</b><span aria-hidden="true">' + itemArt(art) + '</span><small>' + esc(card.type) + '</small></span>';
}

function renderCardArcade(s) {
  const game = s.arcade;
  const kind = s.minigame;
  const name = id => s.players.find(p => p.id === id)?.name;
  const key = game.start + ":" + game.round;
  if (arcadeSelectionKey !== key) {
    arcadeSelectionKey = key;
    arcadeSelected = null;
  }
  let board;
  if (kind === "twentyOne") {
    board = '<div class="arcade-hands">' + game.players.map(p => '<div data-bust="' + (p.value > 21) +
      '"><b>' + esc(name(p.id)) + '</b><span>' + p.hand.map((rank, index) =>
        '<i class="' + (game.reveal?.find(row => row.id === p.id)?.took && index === p.hand.length - 1 ? 'arcade-dealt' : '') +
        '">' + ([,"A",2,3,4,5,6,7,8,9,10,"J","Q","K"][rank]) + '<small aria-hidden="true">◆</small></i>').join("") +
      '</span><strong>' + (p.value > 21 ? p.value + " · Estourou" : p.value + (p.standing ? " · Parou" : "")) +
      '</strong></div>').join("") + '</div>';
  } else if (game.reveal) {
    board = '<div class="arcade-cards arcade-reveal">' + game.reveal.map((row, index) => '<div style="--deal:' +
      Math.min(index, 6) * 45 + 'ms" data-contested="' + !!row.contested + '">' + arcadeCard(row.card) +
      '<small>' + esc(kind === "elements" ? name(row.id) + " · +" + row.points :
            row.winner ? name(row.winner) + " · +" + row.card.value :
              row.contested ? "Disputada · +1" : "Sem escolha") + '</small></div>').join("") + '</div>';
  } else board = '';
  const canChoose = !game.reveal && !game.you.standing && game.you.choice === null;
  const cards = kind === "twentyOne" ? ["Pedir carta","Parar"] : kind === "elements" ? game.you.hand : game.table;
  const choices = !canChoose ? '' : kind === "twentyOne" ?
    '<div class="arcade-cards">' + cards.map((label, choice) =>
      btn((choice + 1) + " · " + label, "arcadePick", {choice, round:game.round}, choice === 0 ? "primary" : "")
    ).join("") + '</div>' : '<div class="arcade-cards">' + cards.map((card, choice) => card ?
    '<button type="button" data-action="arcadeSelect" data-arcade-choice="' + choice + '" data-args="' +
    esc(JSON.stringify({choice})) + '" aria-pressed="' + (arcadeSelected === choice) + '">' +
    '<kbd>' + (choice + 1) + '</kbd>' + arcadeCard(card) + '</button>' : '').join("") +
    '</div><button type="button" id="arcadeConfirm" class="primary" data-action="arcadeConfirm"' +
    (arcadeSelected === null ? ' disabled' : '') + '>Confirmar <kbd>↵</kbd></button>';
  const status = kind === "twentyOne" || game.reveal ? '' : '<p>' +
    game.players.filter(p => p.ready).length + ' de ' + game.players.length + ' escolheram · ' + game.you.score + ' pontos</p>';
  return '<section class="arcade-panel"><div class="arcade-hud"><strong>' +
    (game.reveal ? "Cartas reveladas" : kind === "elements" ? "Mão " + (game.round + 1) + " de 3" :
      kind === "claim" ? "Rodada " + (game.round + 1) + " de 4" : "Mesa aberta") +
    '</strong>' + (!game.reveal ? '<span id="arcadeClock"></span>' : '') + '</div>' +
    board + choices + status + (!canChoose && !game.reveal ? '<p>Aguardando a mesa…</p>' : '') + '</section>';
}

function renderArcade(s) {
  const game = s.arcade;
  if (s.minigame === "fog" && !game.results) return renderFog();
  if (!game.results) return game.events ? renderKeyboardArcade(s) : renderCardArcade(s);
  const players = new Map(s.players.map(p => [p.id, p]));
  return '<section class="arcade-panel arcade-finish"><h3>Resultado</h3><ol class="arcade-results">' + game.results.map(row => {
    const p = players.get(row.id);
    return '<li data-winner="' + row.won + '">' + trainerSprite(p.avatar, "") + '<b>' + esc(p.name) + '</b><span>' +
      (row.score < 0 ? "Estourou" : row.score + (s.minigame === "fog" ? " rodada(s) sobrevivida(s)" :
        s.minigame === "magnetic" ? " · Sobrevivência" : " pontos")) +
      (row.won ? ' · Venceu' : '') + '</span></li>';
  }).join("") + '</ol>' + (s.you.done ? '<p>Aguardando o grupo…</p>' :
    btn("Continuar", "arcadeContinue", {}, "primary")) + '</section>';
}

function renderAlphabet(s) {
  const game = s.alphabet;
  const players = new Map(s.players.map(p => [p.id, p]));
  const active = players.get(game.active);
  const canAnswer = !game.winners && game.active === s.you.id;
  const announcement = game.last && (game.last.name
    ? players.get(game.last.id).name + " acertou: " + game.last.name
    : players.get(game.last.id).name + " ficou sem tempo.");
  const winner = game.winners?.map(id => players.get(id).name).join(" e ");
  return '<section class="abc-panel"><div class="abc-board"><div class="abc-ring" aria-label="Ordem no sentido horário">' +
    game.order.map((id, i) => {
      const angle = i * Math.PI * 2 / game.order.length;
      const p = players.get(id);
      return '<div class="abc-seat" style="--x:' + (50 + Math.sin(angle) * 42) +
        '%;--y:' + (50 - Math.cos(angle) * 42) + '%" data-status="' +
        (game.eliminated.includes(id) ? "out" : (game.winners ?? [game.active]).includes(id) ? "active" : "waiting") +
        '" title="' + esc(p.name) + '">' + trainerSprite(p.avatar, "") + '<span>' + esc(p.name) + '</span></div>';
    }).join("") + '</div><div class="abc-center"><span id="abcTimer"></span>' +
    '<strong class="abc-letter">' + (game.winners ? "✦" : esc(game.letter)) + '</strong>' +
    '<span aria-live="polite">' + (winner ? esc(winner) : canAnswer ? "Sua vez" : esc(active.name)) + '</span></div></div>' +
    '<div class="abc-letters" aria-label="Letras da partida">' + game.letters.map(letter =>
      '<span' + (letter === game.letter && !game.winners ? ' aria-current="true"' : '') + '>' + letter + '</span>').join("") +
    '</div><p class="abc-last" role="status">' + esc(announcement) + '</p>' +
    (canAnswer ? '<form id="alphabetForm"><label for="alphabetName">Pokémon com ' + esc(game.letter) + '</label>' +
      '<div><input id="alphabetName" maxlength="60" autocomplete="off" spellcheck="false" required>' +
      '<button type="submit" class="primary" disabled>Responder</button></div></form>' :
      game.winners ? (s.you.done ? '<p>Aguardando o grupo…</p>' :
        btn("Continuar", "alphabetContinue", {}, "primary")) :
        '<p>' + (game.eliminated.includes(s.you.id) ? "Você foi eliminado. Acompanhe a partida." : "Aguardando sua vez…") + '</p>') +
    '</section>';
}

let focusedAlphabetTurn;
function animateAlphabet(timer, game) {
  const input = $("alphabetName");
  const button = $("alphabetForm")?.querySelector("button");
  function tick() {
    if (!timer.isConnected || timer.closest("[hidden]")) return;
    if (game.winners) {
      timer.textContent = game.winners.length > 1 ? "Empate" : "Vencedor";
      return;
    }
    const now = Date.now() + serverOffset;
    const countdown = now < game.startsAt;
    const seconds = Math.max(0, Math.ceil(((countdown ? game.startsAt : game.deadline) - now) / 1000));
    const text = countdown ? String(Math.min(3, seconds)) : seconds + " s";
    if (timer.textContent !== text) timer.textContent = text;
    timer.classList.toggle("abc-countdown", countdown);
    if (button) button.disabled = countdown || seconds === 0;
    const turnKey = game.startsAt + ":" + game.turn;
    if (input && !countdown && seconds > 0 && focusedAlphabetTurn !== turnKey) {
      focusedAlphabetTurn = turnKey;
      input.focus({preventScroll:true});
    }
    setTimeout(tick, 90);
  }
  tick();
}

document.addEventListener("submit", event => {
  if (event.target.id !== "alphabetForm") return;
  event.preventDefault();
  const game = state?.alphabet;
  const name = v("alphabetName")?.trim();
  if (name && game && !event.target.querySelector("button").disabled)
    act("alphabetAnswer", {name, turn:game.turn});
});

function renderMinigame(s) {
  const p = s.you;
  const screen = $("minigameScreen");
  screen.hidden = s.phase !== "minigame";
  if (screen.hidden) return;
  if (s.million?.results && $("millionReveal") && millionRevealedKey !== s.million.deadline) return;
  screen.dataset.game = s.minigame;
  if (s.minigame === "race" && s.race && !raceResultReady(s.race) && $("raceTrack")) return;
  if (s.arcade?.events && !s.arcade.results && $("arcadeStage")) return;
  if (s.minigame === "fog" && !s.arcade.results && $("fogStage")) return;
  const title = minigameNames[s.minigame];
  let content;
  if (s.miniReady && s.miniReady.length < s.players.length) {
    content = '<div class="mini-tutorial"><p>' + esc(miniInstructions[s.minigame]) +
      '</p>' + (s.minigame === "race"
        ? '<div class="race-keys"><div><kbd>↑</kbd><b>Pular</b><span>Tronco no chão</span></div>' +
          '<div><kbd>↓</kbd><b>Abaixar</b><span>Barreira suspensa</span></div></div>' +
          '<p class="race-touch-hint">No celular, toque em Pular ou Abaixar.</p>'
        : '') + '<div class="auction-players">' + s.players.map(q =>
      '<div><b>' + esc(q.name) + '</b><span>' +
      (s.miniReady.includes(q.id) ? "Pronto" : "Lendo") + '</span></div>').join("") +
      '</div>' + (s.miniReady.includes(p.id) ? '<p>Aguardando o grupo…</p>' :
      btn("Pronto", "miniReady", {}, "primary")) + '</div>';
  } else if (s.minigame === "race") {
    content = renderRace(s);
  } else if (s.million) {
    content = renderMillion(s);
  } else if (s.pairGame) {
    content = renderPairGame(s);
  } else if (s.arcade) {
    content = renderArcade(s);
  } else if (s.alphabet) {
    content = renderAlphabet(s);
  } else if (s.minigame === "market") {
    content = p.done
      ? '<div class="mini-result"><strong>' + esc(p.notice) + '</strong><p>Aguardando o grupo…</p></div>'
      : '<div class="market-ticket"><div class="market-question"><strong>' +
        s.quiz.a + ' × ' + s.quiz.b + '</strong><p>Qual é o total da compra?</p></div>' +
        '<label>Total em ₽<input id="answer" type="number" min="0" inputmode="numeric"></label>' +
        btn("Responder", "answer", {}, "primary") + '</div>';
  } else content = renderAuction(s);
  screen.innerHTML = '<div class="mini-shell"><div class="mini-heading"><span>Rodada ' + s.round +
    '</span><h2>' + esc(title) + '</h2></div>' + content + '</div>';
  if ($("pairGuessSpecies")) loadGuessSpecies();
  const clock = $("millionClock");
  if (clock) updateMiniClock(clock, s.million.deadline);
  const auctionClock = $("auctionClock");
  if (auctionClock) updateMiniClock(auctionClock, s.auction.deadline);
  const pairClock = $("pairClock");
  if (pairClock) updateMiniClock(pairClock, s.pairGame.deadline);
  const arcadeClock = $("arcadeClock");
  if (arcadeClock) updateMiniClock(arcadeClock, s.arcade.deadline);
  const abcTimer = $("abcTimer");
  if (abcTimer) animateAlphabet(abcTimer, s.alphabet);
  const arcadeStage = $("arcadeStage");
  if (arcadeStage) animateKeyboardArcade(arcadeStage, s);
  if ($("fogStage")) animateFog($("fogStage"));
  const reveal = $("millionReveal");
  if (reveal) animateMillionReveal(reveal, s);
  if ($("raceTrack") && !raceFrame) raceFrame = requestAnimationFrame(animateRace);
}

let duelDraftKey = "";
let duelPicks = [];
let duelDraftSending = false, duelDraftQueued = false;

function lineupTrainer(s, trainer, multi) {
  const player = s.players.find(p => p.id === trainer.id);
  const own = trainer.id === s.you.id;
  const locked = Boolean(s.duel.selection.picked);
  const picks = own ? duelPicks : trainer.selected || [];
  const status = own ? (locked ? "Pronto" : "Você") :
    trainer.ready ? "Pronto" : trainer.ally ? "Escolhendo" : "Rival";
  const size = s.duel.selection.size;
  const slots = Array.from({length:6}, (_, index) => {
    const mon = player.party[index];
    const order = mon ? picks.indexOf(mon.uid) + 1 : 0;
    const text = mon ? '<b>' + esc(mon.name) + '</b>' : (multi ? "Slot " + (index + 1) : "Espaço livre");
    const mark = '<span class="lineup-slot-mark">' + (multi ? uiIcon("ball") : index + 1) + '</span>';
    const sprite = mon ? tokenMon(mon) : "";
    const orderBadge = order ? '<span class="lineup-order" aria-label="Ordem ' + order + '">' + order + '</span>' : "";
    const contents = mark + sprite + '<span class="lineup-slot-name">' + text + '</span>' + orderBadge;
    if (own && mon) return '<li class="lineup-slot lineup-slot-own"><button type="button" data-duel-pick="' + esc(mon.uid) +
      '" data-focus="pick-' + esc(mon.uid) + '" aria-pressed="' + Boolean(order) + '"' +
      (locked ? ' disabled' : '') + '>' + contents + '</button><button type="button" class="lineup-summary" ' +
      ' data-pokemon-details="' + esc(mon.uid) + '" data-focus="summary-' + esc(mon.uid) +
      '" aria-label="Resumo de ' + esc(mon.name) + '">' + uiIcon("info") + '</button></li>';
    return '<li class="lineup-slot"><div class="lineup-static' + (order ? ' picked' : '') +
      (mon ? '' : ' empty') + '">' + contents + '</div></li>';
  }).join("");
  return '<article class="lineup-trainer"><div class="lineup-person">' + uiIcon("trainer") +
    '<h3>' + esc(player.name) + '</h3><span class="lineup-status">' + status + '</span></div>' +
    (multi ? '<p class="lineup-limit"><span>Escolha <b>' + size + '</b> de 6</span></p>' :
      '<div class="lineup-limit">' + uiIcon("lineup") + '<b>' + (own ? "Seu time" : "Time adversário") +
      '</b><span>' + size + (size === 1 ? ' espaço' : ' espaços') + '</span></div>') +
    '<ol class="lineup-roster">' + slots + '</ol></article>';
}

function renderDuelTeam(s) {
  const screen = $("duelTeamScreen");
  const selection = s.phase === "duelos" && s.duel?.selection;
  screen.hidden = !selection;
  if (!selection) return;
  const multi = s.duelFormat.selected.mode === "multi";
  const key = s.code + ":" + s.round + ":" + s.you.id;
  if (duelDraftKey !== key) {
    duelDraftKey = key;
    duelPicks = [];
    duelDraftSending = duelDraftQueued = false;
  }
  if (selection.picked) duelPicks = [...selection.picked];
  else if (multi && !duelDraftSending) duelPicks = [...selection.draft];
  const focus = screen.contains(document.activeElement) ? document.activeElement.dataset.focus : "";
  const locked = Boolean(selection.picked);
  const allyTeam = selection.trainers[0].ally ? "A" : "B";
  const side = (members, rival) => '<section class="lineup-side' + (rival ? ' lineup-rivals' : '') + '">' +
    (multi ? '<h3 class="lineup-banner">Equipe ' + (rival ? (allyTeam === "A" ? "B" : "A") : allyTeam) + '</h3>' : '') +
    members.map(trainer => lineupTrainer(s, trainer, multi)).join("") + '</section>';
  const allies = selection.trainers.filter(trainer => trainer.ally)
    .sort((a, b) => Number(b.id === s.you.id) - Number(a.id === s.you.id));
  const rivals = selection.trainers.filter(trainer => !trainer.ally);
  const format = multi ? "2v2 Dupla" : s.duelFormat.selected.label;
  const confirm = locked
    ? '<button type="button" data-action="duelEdit" data-focus="confirm">Editar equipe</button>'
    : '<button type="button" class="primary" data-action="duelTeam" data-focus="confirm"' +
      (duelPicks.length === selection.size && !duelDraftSending ? '' : ' disabled') + '>' +
      uiIcon("check") + 'Confirmar equipe</button>';
  const instruction = locked ? "Aguardando os outros treinadores." :
    multi ? "Cada jogador escolhe " + selection.size + " Pokémon. Seu aliado acompanha a seleção." :
      "Clique para marcar ou desmarcar. A ordem dos cliques define a entrada.";
  screen.dataset.format = multi ? "multi" : "solo";
  updateRegion(screen, '<div class="duel-team-shell"><header class="duel-team-heading">' +
    uiIcon("ball") + '<div><h2>Escalar equipe</h2><p>' + esc(format) + ' · Nível ' +
    selection.level + ' no duelo</p></div><strong aria-live="polite">' + duelPicks.length + ' / ' +
    selection.size + '</strong></header><div class="lineup-match">' + side(allies, false) +
    '<div class="lineup-versus" aria-hidden="true"><b>VS</b></div>' + side(rivals, true) + '</div>' +
    '<footer class="duel-team-footer"><p role="status">' + uiIcon("info") + esc(instruction) + '</p>' +
    '<div>' + (!multi && !locked ? '<button type="button" data-duel-clear data-focus="clear"' +
    (duelPicks.length ? '' : ' disabled') + '>Limpar</button>' : '') + confirm + '</div></footer></div>');
  if (focus) screen.querySelector('[data-focus="' + CSS.escape(focus) + '"]')?.focus({preventScroll:true});
}

async function syncDuelDraft() {
  if (duelDraftSending) return;
  const key = duelDraftKey;
  duelDraftSending = true;
  renderDuelTeam(state);
  while (duelDraftQueued && key === duelDraftKey && state?.duel?.selection && !state.duel.selection.picked) {
    duelDraftQueued = false;
    await act("duelDraft", {round:state.round, uids:[...duelPicks]});
  }
  if (key !== duelDraftKey) return;
  duelDraftSending = duelDraftQueued = false;
  renderDuelTeam(state);
}

$("duelTeamScreen").addEventListener("click", event => {
  const button = event.target.closest("[data-duel-pick], [data-duel-clear]");
  const selection = state?.duel?.selection;
  if (!button || !selection || selection.picked || (busy && !duelDraftSending)) return;
  const uid = button.dataset.duelPick;
  if (!uid) duelPicks = [];
  else if (duelPicks.includes(uid)) duelPicks = duelPicks.filter(id => id !== uid);
  else if (duelPicks.length < selection.size) duelPicks.push(uid);
  else {
    toast("Desmarque um Pokémon para escolher outro.");
    return;
  }
  if (state.duelFormat.selected.mode === "multi") {
    duelDraftQueued = true;
    if (!duelDraftSending) {
      void syncDuelDraft();
      return;
    }
  }
  renderDuelTeam(state);
});

const worldPeriods = { day: ["☀", "Dia"], dusk: ["◒", "Tarde"], night: ["☾", "Noite"] };
const worldLighting = [
  [.03,.56], [.04,.52], [.06,.46], [.10,.38],
  [.22,.14], [.18,.05], [.08,0], [.045,0], [.025,0], [.012,0], [0,0],
];
function setWorldLight(element, actions) {
  const [warm, night] = worldLighting[Math.max(0, Math.min(10, actions))] || worldLighting[10];
  element.style.setProperty("--world-warm", warm);
  element.style.setProperty("--world-night", night);
}

function renderWorld() {
  const s = state,
    p = s.you;
  const period = p.period || ExpeditionWorld.actionPeriod(p.actions);
  const [periodIcon, periodLabel] = worldPeriods[period];
  setWorldLight($("game"), p.actions);
  document.body.classList.add("playing");
  const phaseChanged = s.phase !== previousPhase;
  if (phaseChanged) {
    drawer = s.phase === "actions" ? "" : "phase";
    if (s.phase === "actions" && p.eliteRun != null && !p.enc) {
      drawer = "facility";
      activeFacility = "gym";
    }
    personalDrawer = "";
    shopCart.clear();
  }
  if (s.phase === "actions" && p.done && (phaseChanged || !previouslyDone)) {
    drawer = "phase";
    personalDrawer = "";
    activeFacility = "";
  }
  previousPhase = s.phase;
  previouslyDone = p.done;
  if (p.notice !== lastNotice) {
    lastNotice = p.notice;
    if (p.notice && !p.notice.startsWith("Trabalho concluído.")) toast(p.notice);
  }
  $("gameHead").innerHTML =
    '<div class="turn"><small>Rodada</small><b>' +
    s.round +
    "<sub> / " +
    s.rounds +
    '</sub></b></div><div class="turnName"><b>' +
    phases[s.phase] +
    "</b><span>" +
    p.actions +
    ' ações · <span class="world-period"><i aria-hidden="true">' + periodIcon + "</i> " + periodLabel + "</span> · " +
    p.badges.length +
    " insígnias</span>" +
    (s.phase === "actions" && p.quietCamp
      ? "<span>Acampamento tranquilo · " +
        (p.quietCamp.complete ? "Concluído" : (p.quietCamp.first ? "1/2" : "0/2")) + "</span>" : "") +
    (s.phase === "actions" && p.duskExpedition
      ? "<span>Expedição ao entardecer · " +
        (p.duskExpedition.complete ? "Concluída" : "Explore com 4 ou 5 ações") + "</span>" : "") +
    "</div>";
  if (!mapMounted) {
    WorldMap.mount($("map"), (id) => {
      if (id === leagueIsland) {
        const { phase, you } = state;
        if (you.loc !== leagueIsland &&
            (!leaguePorts.includes(you.loc) || phase !== "actions" || you.done || you.enc)) return;
        drawer = "league";
        activeFacility = "";
        render();
        $("dismiss").focus();
      } else if (state.phase === "actions" && !state.you.done && !state.you.enc) {
        activeFacility = "";
        if (id === state.you.loc) {
          drawer = "local";
          render();
        } else {
          drawer = "";
          render();
          act("move", { loc: id });
        }
      }
    });
    mapMounted = true;
  }
  WorldMap.update(p.loc, s.players,
    s.phase === "actions" && !p.done && !p.enc && p.eliteRun == null && p.actions > 0, s.gyms);
  const canReorder = s.phase === "actions" && !p.enc && !p.moveLesson;
  updateRegion($("partyRail"),
    '<div class="party-heading"><span>' + uiIcon("ball") + '</span><small>Equipe</small></div>' +
    Array.from({ length: 6 }, (_, i) => {
      const m = p.party[i];
      const slot = ' data-slot="' + i + '" data-team="party"';
      if (!m) return '<span class="rail-empty"' + slot + ' aria-hidden="true">' + uiIcon("ball") + '</span>';
      const drag = canReorder ? ' draggable="true" data-mon="' + esc(m.uid) + '"' : "";
      return '<button type="button"' + slot + drag + ' data-pokemon-details="' + esc(m.uid) + '" aria-label="' +
        esc(m.name) + '">' + tokenMon(m) +
        '<progress aria-label="HP" value="' + m.hp + '" max="' + m.maxhp + '"></progress>' +
        "</button>";
    }).join(""));
  $("partyRail").hidden = false;
  $("dock").innerHTML =
    '<span class="dock-crest" aria-hidden="true">' + uiIcon("ball") + '</span>' +
    menuBtn(
      s.phase === "actions" && !p.done ? "local" : "phase",
      s.phase === "actions" && !p.done ? locName(p.loc) : phases[s.phase],
      s.phase === "actions" ? "map-pin" : "flag",
    ) +
    menuBtn("box", "Box", "archive") +
    menuBtn("bag", "Mochila", "backpack") +
    menuBtn("profile", "Perfil", "contact-round");
  renderMinigame(s);
  renderDuelTeam(s);
  drawRound(s);
  if (s.duel?.selection) {
    $("overlay").hidden = true;
    $("arena").hidden = true;
    $("personalOverlay").hidden = true;
    document.body.classList.remove("fighting");
    return;
  }
  if ((practiceMode || s.testLobby) && s.phase === "final") {
    const screen = $("minigameScreen");
    screen.hidden = false;
    screen.innerHTML = '<div class="mini-result"><h2>Treino concluído</h2>' +
      (p.notice ? '<p>' + esc(p.notice) + '</p>' : '') +
      (s.testLobby ? (p.id === s.host ? btn("Voltar à sala", "reopenTestLobby", {}, "primary") :
        '<p>Aguardando o anfitrião voltar à sala.</p>') + btn("Sair", "home") :
        '<p>Escolha um minigame no menu para jogar de novo.</p>') + '</div>';
    return;
  }
  if (s.phase === "final") {
    $("overlay").hidden = true;
    $("arena").hidden = true;
    renderPersonalPanel();
    $("map").inert = true;
    renderFinalScoreboard(s);
    return;
  }
  if (s.phase === "minigame") {
    $("arena").hidden = true;
    $("overlay").hidden = true;
    return;
  }
  if (s.phase === "cards") {
    renderPersonalPanel();
    $("overlay").hidden = true;
    $("arena").hidden = true;
    return;
  }
  const e = p.enc,
    b = e?.battle || (!s.duel?.result ? s.duel?.battle : null);
  $("arena").hidden = !(e || b);
  document.body.classList.toggle("fighting", !!(e || b));
  if (e || b) {
    const previous = oldBattle;
    const history = $("battleLog");
    const scroll = history && history.scrollHeight - history.scrollTop - history.clientHeight > 8
      ? history.scrollTop : null;
    setWorldLight($("arena"), e?.startedActions ?? (e ? p.actions : 10));
    $("arena").innerHTML = arenaView(b, e);
    const log = $("battleLog");
    log.scrollTop = scroll ?? log.scrollHeight;
    const active = [...(b?.ownActive || [b?.own]), ...(b?.foeActive || [b?.foe || e?.wild])];
    for (const m of active) {
      if (!m || previous?.[m.uid] == null) continue;
      const hud = $("arena").querySelector('[data-battle-hp="' + CSS.escape(m.uid) + '"]');
      if (!b?.timeline) animateHP(hud?.querySelector("progress"), previous[m.uid], m.hp);
    }

    $("overlay").hidden = true;
    drawer = "";
    personalDrawer = "";
    renderPersonalPanel();
    return;
  }
  if (oldBattle && s.phase === "duelos") drawer = "phase";
  oldBattle = null;
  if (p.shopVisit && s.phase === "actions") drawer = "shop";
  renderPersonalPanel();
  $("overlay").classList.toggle("visit", ["local", "league"].includes(drawer));
  $("overlay").classList.toggle("facility-full", ["shop", "facility"].includes(drawer));
  $("overlay").hidden = !drawer;
  if (!drawer) return;
  if (drawer === "phase" || drawer === "local")
    $("content").innerHTML = drawer === "local" ? locationScene() : controls();
  else if (drawer === "league") $("content").innerHTML = leagueScene();
  else if (drawer === "shop") {
    const pos = $("shopCatalog")?.scrollTop || 0;
    const search = $("shopSearch");
    const editingSearch = search && document.activeElement === search;
    $("content").innerHTML = shopScreen();
    updateCatalog();
    $("shopCatalog").scrollTop = pos;
    if (editingSearch) {
      $("shopSearch").focus({ preventScroll: true });
      $("shopSearch").setSelectionRange(search.selectionStart, search.selectionEnd, search.selectionDirection);
    }
  }
  else if (drawer === "facility") {
    const scroll = $("postJobs")?.scrollTop || 0;
    const selectedPokemon = v("labPokemon");
    $("content").innerHTML = facilityScreen();
    if ($("labPokemon")) {
      if ([...$("labPokemon").options].some(option => option.value === selectedPokemon))
        $("labPokemon").value = selectedPokemon;
      updateLabEditor();
    }
    const jobs = $("postJobs");
    if (jobs) jobs.scrollTop = scroll;
  }
}

const personalViews = {
  profile: ["Perfil de treinador", "contact-round", () => profile()],
  box: ["Box Pokémon", "archive", () => boxScreen()],
  bag: ["Mochila", "backpack", bagPanel],
  team: ["Equipe", "ball", teamPanel],
};

function renderPersonalPanel() {
  const open = Boolean(personalDrawer);
  const overlay = $("personalOverlay"), content = $("personalContent");
  const viewChanged = overlay.dataset.view !== personalDrawer;
  overlay.hidden = !open;
  overlay.dataset.view = personalDrawer;
  $("overlay").inert = open;
  $("map").inert = open;
  if (!open) {
    updateRegion(content, "");
    return;
  }
  const [title, icon, body] = personalViews[personalDrawer];
  updateRegion($("personalTitle"), uiIcon(icon) + '<span>' + title + '</span>');
  updateRegion(content, body());
  if (viewChanged) content.scrollTop = 0;
}

initializeScreen();
poll();
function pollNext() {
  poll().finally(() => setTimeout(pollNext, state?.duel?.selection && state.duelFormat?.selected.mode === "multi" ? 400 : state?.minigame === "race" ? 85 :
    state?.arcade?.events || state?.minigame === "fog" ? 150 : state?.pairGame || state?.arcade || state?.alphabet ? 350 : 1100));
}
setTimeout(pollNext, 1100);

function cinematic(kind, text, ms) {
  const el = document.createElement("div");
  el.className = "cinematic " + kind;
  el.innerHTML = "<strong>" + esc(text) + "</strong>";
  document.body.append(el);
  return new Promise((resolve) =>
    setTimeout(() => {
      el.remove();
      resolve();
    }, ms),
  );
}
const captureSounds = {
  throw: [[270, 820, .24]],
  draw: [[880, 1480, .1], [1150, 330, .22]],
  land: [[160, 62, .11]],
  shake: [[420, 240, .12]],
  escape: [[230, 1250, .24], [530, 800, .13]],
  caught: [[523, 523, .14], [659, 659, .14], [784, 784, .14], [1047, 1047, .28]],
};

function playCaptureSound(effect) {
  playNotes(captureSounds[effect]);
}

function playNotes(notes) {
  const audio = gameAudio.context;
  if (gameAudio.preferences.muted || audio?.state !== "running") return;
  notes.forEach(([from, to, duration], index) => {
    const start = audio.currentTime + index * .085;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(.075, start + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain).connect(gameAudio.effects);
    oscillator.start(start);
    oscillator.stop(start + duration);
  });
}

async function animateCapture(item, caught) {
  const foe = $("arena").querySelector(".foe .fighter");
  const unit = $("arena").querySelector(".foe");
  const target = unit?.getBoundingClientRect();
  const x = target ? target.left + target.width / 2 : innerWidth * .69;
  const y = target ? target.top + target.height / 2 : innerHeight * .35;
  const drop = target ? target.height * .54 : 45;
  const fromX = innerWidth * .20 - x;
  const fromY = innerHeight * .68 - y;
  const stage = document.createElement("div");
  const art = '<img src="items/' + encodeURIComponent(item) + '.png" alt="">';
  stage.className = "capture-stage";
  stage.style.setProperty("--capture-x", x + "px");
  stage.style.setProperty("--capture-y", y + "px");
  stage.innerHTML = '<div class="capture-ball"><span>' + art + '</span><span>' +
    art + '</span></div><div class="capture-flash"></div>' +
    '<div class="capture-stars" aria-hidden="true">✦ <b>✧</b> ✦</div>' +
    '<strong class="capture-result" role="status" hidden></strong>';
  document.body.append(stage);

  const ball = stage.querySelector(".capture-ball");
  const flash = stage.querySelector(".capture-flash");
  const stars = stage.querySelector(".capture-stars");
  const result = stage.querySelector(".capture-result");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const animate = (element, frames, duration, options = {}) =>
    element.animate(frames, { duration, fill: "forwards", ...options });
  const move = (x, y, rotation = 0) =>
    `translate(${x}px, ${y}px) rotate(${rotation}deg)`;
  const absorbed = { opacity: 0, transform: "scale(.04)", filter: "brightness(3) sepia(1) saturate(5)" };
  const visible = { opacity: 1, transform: "scale(1)" };
  const pulse = () => animate(flash, [
    { opacity: 0, scale: .25 }, { opacity: .95, scale: 1 }, { opacity: 0, scale: 1.45 },
  ], 320);
  let pull, release;

  try {
    if (!reduced) {
      playCaptureSound("throw");
      await animate(ball, [
        { transform: move(fromX, fromY, -210) },
        { transform: move(fromX * .37, -Math.max(48, innerHeight * .11), 110), offset: .58 },
        { transform: move(0, 0, 360) },
      ], 470, { easing: "ease-out" }).finished;

      ball.classList.add("open");
      playCaptureSound("draw");
      pulse();
      if (foe) {
        pull = animate(foe, [
          visible,
          { ...absorbed, opacity: .92, transform: "scale(.65)", offset: .42 },
          absorbed,
        ], 340, { easing: "ease-in" });
        await pull.finished;
      } else await wait(340);
      ball.classList.remove("open");
      await animate(ball, [
        { transform: move(0, 0) },
        { transform: move(0, drop), offset: .65 },
        { transform: move(0, drop - 12), offset: .82 },
        { transform: move(0, drop) },
      ], 380).finished;
      playCaptureSound("land");
      await wait(180);

      for (let shake = 0; shake < 3; shake++) {
        const direction = shake === 1 ? -1 : 1;
        playCaptureSound("shake");
        await animate(ball, [
          { transform: move(0, drop) },
          { transform: move(-5 * direction, drop, -23 * direction) },
          { transform: move(5 * direction, drop, 16 * direction) },
          { transform: move(0, drop) },
        ], 250, { easing: "ease-in-out" }).finished;
        await wait(165);
      }

      if (caught) {
        stars.style.top = y + drop - 16 + "px";
        animate(stars, [
          { opacity: 0, transform: "translate(-50%, 0) scale(.5)" },
          { opacity: 1, transform: "translate(-50%, -32px) scale(1.2)" },
          { opacity: 0, transform: "translate(-50%, -45px) scale(1)" },
        ], 660);
      } else {
        ball.classList.add("open");
        flash.style.top = y + drop + "px";
        pulse();
        animate(ball, [{ opacity: 1 }, { opacity: 0 }], 280);
        if (foe) {
          release = animate(foe, [
            { ...absorbed, transform: `translateY(${drop}px) scale(.04)` },
            { opacity: 1, transform: "translateY(-18px) scale(.7)", offset: .6 },
            visible,
          ], 440, { easing: "ease-out" });
        }
      }
    } else {
      ball.style.transform = move(0, drop);
    }
    playCaptureSound(caught ? "caught" : "escape");
    result.textContent = caught ? "Capturado!" : "Escapou da bola!";
    result.hidden = false;
    await wait(reduced ? 650 : 850);
  } finally {
    release?.cancel();
    pull?.cancel();
    stage.remove();
  }
}

function animateHP(bar, from, to) {
  if (!bar) return;
  const start = performance.now();
  function frame(t) {
    if (!bar.isConnected) return;
    const k = Math.min(1, (t - start) / 260);
    bar.value = from + (to - from) * k;
    const ratio = bar.value / bar.max;
    bar.style.accentColor =
      ratio <= 0.2 ? "#ed5555" : ratio <= 0.5 ? "#ecc550" : "#459e66";
    if (k < 1) requestAnimationFrame(frame);
  }
  frame(start);
}
function battleEnding(won, message) {
  const stage = $("arena").cloneNode(true);
  stage.removeAttribute("id");
  stage.className = "ending";
  stage.dataset.music = won ? "victory" : "defeat";
  stage.hidden = false;
  stage.querySelector(".console")?.remove();
  document.body.append(stage);
  updateMusic();
  setTimeout(() => {
    const box = document.createElement("div");
    box.className = "resultBox";
    box.innerHTML =
      "<h2>" +
      (won ? "Vitória!" : "Fim da batalha") +
      "</h2><p>" +
      esc(message) +
      "</p><button>Continuar</button>";
    stage.append(box);
    box.querySelector("button").onclick = () => {
      stage.remove();
      updateMusic();
      renderEvolution(state);
      renderMoveLesson(state);
    };
    box.querySelector("button").focus();
  }, 1100);
}
function fullFacility(title, body, footer = "", theme = activeFacility, portrait = "") {
  const image = portrait ? '<img src="' + esc(portrait) + '" alt="">' : "";
  return '<section class="facility-screen" data-theme="' + esc(theme) +
    '" aria-label="' + esc(title) + '"><aside><div class="npc-portrait" aria-hidden="true">' +
    image + '</div></aside><div class="facility-body">' + body + '</div>' +
    '<div class="facility-footer">' + footer + '</div></section>';
}

const shopFilters = [
  ["all", "Todos", "grid"], ["heal", "Poções", "map-lab"], ["balls", "Bolas", "ball"],
  ["stones", "Pedras", "gem"], ["evolution", "Evolução", "dna"], ["berry", "Bagas", "berry"],
  ["combat", "Combate", "swords"], ["held", "Equipáveis", "backpack"],
];
const shopSorts = [
  ["default", "Ordem da loja"], ["name", "Nome (A–Z)"],
  ["priceAsc", "Menor preço"], ["priceDesc", "Maior preço"],
];
const shopSearchKey = (value) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");

function shopScreen() {
  const work = workOption(state.you, "store", true);
  return '<section class="shop-screen" data-theme="store" aria-labelledby="shopTitle">' +
    '<div class="shop-heading">' + uiIcon("ball") + '<h2 id="shopTitle">Loja de Itens</h2>' +
    '<span class="action-balance">' + uiIcon("tag") + actionsRemaining(state.you) + '</span></div>' +
    '<div class="shop-layout"><aside class="shop-reception">' +
    '<img src="npc/loja.png" alt="Atendente da loja"><div class="shop-speech"><strong>Olá!</strong><p>Escolha os itens que quer comprar ou vender.</p></div>' +
    '</aside><div class="shop-catalog-panel"><div class="shop-filter-chips" aria-label="Categorias">' +
    shopFilters.map(([id, label, icon]) =>
      '<button type="button" data-shop-filter="' + id + '">' + uiIcon(icon) + label + '</button>',
    ).join("") + '</div><div class="catalog-tools">' +
    '<label>' + uiIcon("search") + '<input id="shopSearch" type="search" aria-label="Buscar item" placeholder="Buscar item..." value="' +
    esc(shopSearch) + '"></label><label>' + uiIcon("sort") + '<select id="shopSort" aria-label="Ordenar itens">' +
    shopSorts.map(([id, label]) =>
      '<option value="' + id + '"' + (id === shopSort ? ' selected' : '') + '>' + label + '</option>'
    ).join("") +
    '</select></label></div><div id="shopCatalog" class="catalog" aria-label="Itens da loja"></div></div>' +
    '<div class="shop-cart-panel"><div class="shop-modes" aria-label="Modo do catálogo">' +
    '<button type="button" data-shop-mode="buy">' + uiIcon("cart") + 'Compra</button>' +
    '<button type="button" data-shop-mode="sell">' + uiIcon("tag") + 'Venda</button></div>' +
    '<section class="shop-cart" id="shopCart" aria-label="Carrinho"></section></div></div>' +
    '<div class="facility-footer shop-footer"><strong class="shop-balance">' + uiIcon("wallet") + 'Saldo <span>₽ ' +
    state.you.money.toLocaleString("pt-BR") + '</span></strong><span id="selectedShopItem"></span>' +
    '<div class="shop-quantity"><label for="qty">Quantidade</label>' +
    '<div class="quantity-control"><button type="button" data-qty-step="down" aria-label="Diminuir quantidade">−</button>' +
    '<input id="qty" type="number" min="1" max="99" value="1">' +
    '<button type="button" data-qty-step="up" aria-label="Aumentar quantidade">+</button></div></div>' +
    '<button type="button" data-cart-add="buy">' + uiIcon("cart") + 'Adicionar compra</button>' +
    '<button type="button" data-cart-add="sell">' + uiIcon("tag") + 'Adicionar venda (50%)</button>' +
    '<button type="button" class="primary" id="shopCheckout" data-checkout disabled>' + uiIcon("check") + 'Confirmar · 1 ação</button>' +
    '</div>' + (work ? '<div class="facility-footer shop-work">' + work + '</div>' : '') + '</section>';
}

function updateCatalog(resetScroll = false) {
  const catalog = $("shopCatalog");
  if (!catalog) return;
  const selling = shopMode === "sell";
  const query = shopSearchKey(shopSearch.trim());
  const price = (item) => selling ? Math.floor(item.price / 2) : item.price;
  const entries = Object.entries(state.shop).filter(([id, item]) => {
    if (selling && !state.you.items[id]) return false;
    if (query && !shopSearchKey(item.name).includes(query)) return false;
    if (shopFilter === "all") return true;
    if (shopFilter === "heal") return id === "potion";
    if (shopFilter === "balls") return id.endsWith("-ball");
    if (shopFilter === "stones") return id.endsWith("-stone") || item.category === "megaStone";
    if (shopFilter === "evolution") return item.category === "evolution" && !id.endsWith("-stone");
    if (shopFilter === "held") return item.held && !item.category && !id.endsWith("-stone");
    return item.category === shopFilter;
  });
  if (shopSort === "name") entries.sort(([, a], [, b]) => a.name.localeCompare(b.name, "pt-BR"));
  if (shopSort === "priceAsc") entries.sort(([, a], [, b]) => price(a) - price(b));
  if (shopSort === "priceDesc") entries.sort(([, a], [, b]) => price(b) - price(a));
  if (!entries.some(([id]) => id === shopItem)) shopItem = entries[0]?.[0] || "";
  const selected = state.shop[shopItem];
  const pos = resetScroll ? 0 : catalog.scrollTop;
  catalog.innerHTML = entries.map(([id, item]) =>
    '<button type="button" data-shop-item="' + esc(id) + '" data-item-summary="' + esc(id) + '" aria-pressed="' + (id === shopItem) +
    '">' + itemArt(id) + '<span><b>' + esc(item.name) + '</b><small>Na mochila · ' +
    (state.you.items[id] || 0) + '</small></span><strong>₽ ' +
    price(item).toLocaleString("pt-BR") + '</strong></button>'
  ).join("") || '<p>' + (selling ? 'Nenhum item da mochila nesta seleção.' : 'Nenhum item encontrado.') + '</p>';
  catalog.scrollTop = pos;
  for (const button of $("overlay").querySelectorAll("[data-shop-filter], [data-shop-mode]"))
    button.setAttribute("aria-pressed", String(button.dataset.shopFilter === shopFilter || button.dataset.shopMode === shopMode));
  $("selectedShopItem").innerHTML = selected ? itemArt(shopItem) + '<b>' + esc(selected.name) + '</b>' : "";
  $("overlay").querySelector('[data-cart-add="buy"]').disabled = !selected;
  $("overlay").querySelector('[data-cart-add="sell"]').disabled = !(state.you.items[shopItem] > 0);
  renderShopCart();
}

function addToShopCart(sell) {
  const qty = Number(v("qty"));
  if (!shopItem || !Number.isInteger(qty) || qty < 1 || qty > 99)
    return toast("Escolha um item e uma quantidade de 1 a 99.");
  const key = (sell ? "sell:" : "buy:") + shopItem;
  const count = (shopCart.get(key)?.qty || 0) + qty;
  if (count > 99) return toast("Limite de 99 unidades por item e operação.");
  if (sell && count > (state.you.items[shopItem] || 0))
    return toast("Você não tem unidades suficientes para vender.");
  if (!shopCart.has(key) && shopCart.size >= 60) return toast("Carrinho cheio.");
  shopCart.set(key, { item: shopItem, qty: count, sell });
  renderShopCart();
}

function renderShopCart() {
  const cart = $("shopCart");
  if (!cart) return;
  const scroll = cart.querySelector(".shop-cart-lines")?.scrollTop || 0;
  let purchases = 0, sales = 0, stockOk = true;
  const rows = [...shopCart].map(([key, { item, qty, sell }]) => {
    const { name, price } = state.shop[item];
    const subtotal = qty * (sell ? Math.floor(price / 2) : price);
    if (sell) {
      sales += subtotal;
      if (qty > (state.you.items[item] || 0)) stockOk = false;
    } else purchases += subtotal;
    return '<li>' + itemArt(item) + '<div><strong>' + esc(name) + '</strong><small>' +
      (sell ? "Venda" : "Compra") + ' ×' + qty + ' · ₽ ' + subtotal +
      '</small></div><button type="button" data-cart-remove="' + esc(key) +
      '" aria-label="' + esc("Remover " + (sell ? "venda de " : "compra de ") + name) + '">×</button></li>';
  }).join("");
  const net = purchases - sales;
  const message = !stockOk ? "Estoque insuficiente para a venda." :
    net > state.you.money ? "Saldo insuficiente." :
    !state.you.actions ? "Sem ações disponíveis." : "";
  cart.innerHTML = '<h3>' + uiIcon("cart") + 'Carrinho</h3><ul class="shop-cart-lines">' + rows + '</ul>' +
    (!rows ? '<div class="shop-empty-cart">' + uiIcon("backpack") +
      '<p>Seu carrinho está vazio.</p></div>' : '') +
    '<div class="shop-cart-totals">' + (rows ? '<span>Compras · ₽ ' + purchases.toLocaleString("pt-BR") +
    '</span><span>Vendas · ₽ ' + sales.toLocaleString("pt-BR") + '</span>' : '') +
    '<strong>' + (net < 0 ? "A receber" : "A pagar") + '<span>₽ ' +
    Math.abs(net).toLocaleString("pt-BR") + '</span></strong></div>' +
    (message ? '<p class="shop-cart-message" role="status">' + message + '</p>' : '');
  $("shopCheckout").disabled = !rows || Boolean(message);
  cart.querySelector(".shop-cart-lines").scrollTop = scroll;
}
function gymDetails(p) {
  const next = p.badges.length + 1;
  const elite = p.loc === leagueIsland;
  const index = elite ? 8 + (p.elite >= 4 ? 3 : (p.eliteRun ?? 0)) : Number(p.loc.slice(4)) - 1;
  return {
    gym: state.gyms[index],
    reason: elite && !hasLeagueAccess(p) ? "Conquiste as 8 insígnias" :
      elite && p.elite >= 4 ? "Liga concluída" :
      !elite && p.loc !== "city" + next ? "Este ginásio não é seu próximo desafio" :
      p.done || (!p.actions && p.eliteRun == null) ? "Sem ações disponíveis" :
      !p.party.some(m => m.hp > 0) ? "Leve um Pokémon apto" : "",
  };
}

function pokemonCenter(p) {
  const seal = '<i class="center-ball-seal" aria-hidden="true"></i>';
  const team = Array.from({ length: 6 }, (_, index) => {
    const m = p.party[index];
    if (!m) return '<li class="center-mon center-vacant">' + seal + '<b>Vaga livre</b></li>';
    const status = statusName(m);
    const fraction = m.hp / m.maxhp;
    const hpColor = fraction <= .2 ? "#ce4a58" : fraction <= .5 ? "#bb811f" : "#3eaa57";
    return '<li class="center-mon"><button type="button" class="center-mon-main" data-pokemon-details="' +
      esc(m.uid) + '" aria-label="Ver detalhes de ' + esc(m.name) + '">' + sprite(m) +
      '<div><strong>' + esc(m.name) + '</strong><span>Nv. ' + m.level + '</span>' +
      (status ? '<span class="center-status">' + esc(status) + '</span>' : '') +
      '</div></button><div class="center-hp"><b>HP</b><progress aria-label="HP de ' +
      esc(m.name) + '" style="accent-color:' + hpColor + '" data-health="' + esc(m.uid) +
      '" value="' + m.hp + '" max="' + m.maxhp + '"></progress><span data-hp-text="' +
      esc(m.uid) + '">' + m.hp + ' / ' + m.maxhp + '</span></div></li>';
  }).join("");
  const canHeal = p.needsHealing;
  const message = !p.party.length ? "Traga sua equipe para receber atendimento." :
    canHeal ? "Posso recuperar o HP, os PP e as condições de status da sua equipe." :
    "Sua equipe está pronta para voltar à expedição.";
  const work = workOption(p, "center");
  const canAfford = p.money >= state.healCost;
  return '<section class="center-screen" data-theme="center" aria-labelledby="centerTitle">' +
    '<div class="center-heading">' + seal + '<span aria-hidden="true" class="center-emblem">+</span>' +
    '<h2 id="centerTitle">Centro Pokémon</h2></div>' +
    '<div class="center-layout"><aside class="center-reception">' +
    '<img src="npc/centro.png" alt="Atendente do Centro Pokémon">' +
    '<p>' + message + '</p></aside><div class="center-care">' +
    '<div class="center-team-heading"><h3>' + seal + 'Sua equipe</h3><span>' + p.party.length +
    '/6 Pokémon</span></div><ul class="center-team">' + team + '</ul>' +
    '<div class="center-treatment"><strong class="center-balance">Saldo · ₽ ' +
    p.money.toLocaleString("pt-BR") + '</strong>' + actionBalance(p) +
    '<button type="button" class="center-heal" data-action="heal"' +
    (canHeal && canAfford && !p.done && p.actions > 0 ? '' : ' disabled') +
    '><span aria-hidden="true">+</span><strong>Curar equipe</strong><small>₽ ' + state.healCost +
    ' · 1 ação</small></button>' +
    (canHeal && !canAfford ? '<p class="center-balance-warning">Saldo insuficiente para a cura.</p>' : '') +
    '</div>' +
    '</div></div>' + (work ? '<footer class="center-work">' + work + '</footer>' : '') + '</section>';
}

function elitePanel(p, gym, reason) {
  const complete = p.elite >= 4;
  const interval = p.eliteRun != null;
  const wins = complete ? 4 : (p.eliteRun ?? 0);
  const steps = state.gyms.slice(8).map((leader, index) => {
    const status = index < wins ? "Vencido" : index === wins ? "Próximo" : "Pendente";
    return '<li class="elite-step' + (index < wins ? ' won' : index === wins ? ' current' : '') +
      '"' + (index === wins ? ' aria-current="step"' : '') + '>' +
      '<span class="elite-step-number">' + (index < wins ? '✓' : index + 1) +
      '</span><div><b>' + esc(leader.name) + '</b><small>' + status + '</small></div></li>';
  }).join("");
  const portrait = gym.portrait ? '<img src="npc/lideres/' +
    encodeURIComponent(gym.portrait) + '.png" alt="">' : "";
  const challenge = reason ? '<p class="elite-unavailable">' + esc(reason) + '</p>' :
    btn(interval ? "Próxima batalha" : "Iniciar sequência · 1 ação", "gym", {}, "primary");
  return '<section class="elite-screen" aria-labelledby="eliteTitle"><div class="elite-frame">' +
    '<div class="elite-header"><div class="elite-heading"><span class="elite-crest" aria-hidden="true"><i></i></span>' +
    '<div><small>Ilha da Liga</small><h2 id="eliteTitle">Elite Four</h2></div></div>' + actionBalance(p) +
    '</div>' +
    '<ol class="elite-steps" aria-label="Etapas da Elite Four">' + steps + '</ol>' +
    (complete ? '<p class="elite-complete">Você venceu os quatro adversários.</p>' :
      '<div class="elite-match"><div class="elite-portrait">' + portrait + '</div><div class="elite-lineup">' +
      '<div class="elite-match-heading"><small>' + (interval ? "Intervalo · Batalha " : "Primeira batalha · ") +
      (interval ? (wins + 1) + " de 4" : "1 de 4") + '</small><h3>' + esc(gym.name) + '</h3></div>' +
      '<p>' + gym.size + ' Pokémon · Nível de referência ' + gym.level + '</p></div></div>' +
      '<footer class="elite-actions">' + (interval ?
        '<p>' + uiIcon("backpack") + 'Use itens da Mochila neste intervalo sem gastar ações.</p>' : '') +
      '<div>' + (interval ? btn("Encerrar sequência", "abandonElite", {}, "elite-abandon") +
        '<button type="button" data-drawer="bag">' + uiIcon("backpack") +
        'Abrir Mochila</button>' : '') + challenge + '</div></footer>') +
    '</div></section>';
}

const labStats = [
  ["hp", "HP"], ["atk", "Ataque"], ["def", "Defesa"],
  ["spa", "Atq. especial"], ["spd", "Def. especial"], ["spe", "Velocidade"],
];

function laboratoryFields(mon, lab) {
  const abilityOptions = lab.abilities[mon.pokemonId] || {};
  const natureOptions = lab.natures.map(({ name, plus, minus }) => {
    const label = stat => labStats.find(([id]) => id === stat)?.[1];
    return opt(name, name + (plus ? " (+" + label(plus) + " / −" + label(minus) + ")" : ""));
  }).join("");
  const field = (id, max, value, label) =>
    '<input type="number" id="' + id + '" min="0" max="' + max + '" step="1" required value="' +
    value + '" aria-label="' + label + '">';
  return '<div class="lab-options"><label>Natureza' + select("labNature", natureOptions) +
    '</label><label>Habilidade' + select("labAbility", Object.entries(abilityOptions)
      .map(([slot, name]) => opt(slot, name + (slot === "H" ? " · Oculta" : ""))).join("")) +
    '</label></div><div class="lab-stat-list"><table><thead><tr><th scope="col">Atributo</th>' +
    '<th scope="col">Atual</th><th scope="col">IV</th><th scope="col">EV</th></tr></thead><tbody>' +
    labStats.map(([stat, label]) =>
      '<tr><th scope="row">' + label + '</th><td>' + mon.stats[stat] + '</td><td>' +
      field("labIv-" + stat, 31, mon.ivs[stat], "IV de " + label) + '</td><td>' +
      field("labEv-" + stat, 252, mon.evs?.[stat] || 0, "EV de " + label) + '</td></tr>',
    ).join("") + '</tbody></table></div><p id="labEvTotal"></p><p>Felicidade atual · ' +
    mon.happiness + ' / 255</p>';
}

function updateLabEditor() {
  const lab = state.laboratory;
  const container = $("labFields");
  if (!lab || !container) return;
  const p = state.you;
  const mon = [...p.party, ...p.box].find(m => m.uid === v("labPokemon"));
  if (!mon) return;
  container.innerHTML = laboratoryFields(mon, lab);
  $("labNature").value = mon.nature || "Serious";
  $("labAbility").value = String(mon.abilitySlot ?? 0);
  if (!$("labAbility").value) $("labAbility").selectedIndex = 0;
  updateLabTotal();
}

function updateLabTotal() {
  const output = $("labEvTotal");
  if (!output) return;
  const total = labStats.reduce((sum, [stat]) => sum + Number(v("labEv-" + stat) || 0), 0);
  output.textContent = total + " / 510 EVs";
  const p = state.you;
  $("labSubmit").disabled = total > 510 || p.money < state.laboratory.cost ||
    p.done || !p.actions || p.eliteRun != null;
}
$("content").addEventListener("change", e => {
  if (e.target.id === "labPokemon") updateLabEditor();
});
$("content").addEventListener("input", e => {
  if (e.target.id.startsWith("labEv-")) updateLabTotal();
});

function laboratoryScreen(p) {
  const lab = state.laboratory;
  const pokemon = [...p.party, ...p.box];
  if (!lab) return "";
  const notice = p.money < lab.cost ? "Saldo insuficiente para modificar." :
    !p.actions || p.done ? "Sem ações disponíveis." : "";
  return '<section class="lab-screen" aria-labelledby="labTitle"><div class="lab-heading">' +
    '<h2 id="labTitle">Laboratório</h2><span>' + esc(locName(p.loc)) + '</span>' + actionBalance(p) + '</div>' +
    '<div class="lab-layout"><aside><img src="npc/laboratorio.png" alt="Cientista do laboratório">' +
    '<p>Cada modificação reduz a felicidade do Pokémon em ' + lab.happinessLoss +
    ' pontos, até o mínimo de zero.</p></aside><div class="lab-editor">' +
    (pokemon.length ? '<label>Pokémon' + select("labPokemon",
      pokemon.map(m => opt(m.uid, m.name + " · Nv. " + m.level + (p.party.includes(m) ? "" : " · Box"))).join("")) +
      '</label><div id="labFields"></div>' : '<p>Capture um Pokémon para modificar seus atributos.</p>') +
    '<details id="labJobs" class="lab-jobs"><summary>Vagas do laboratório</summary>' + jobBoard(p, "lab") + '</details>' +
    '</div></div><footer class="lab-footer"><strong>Saldo · ₽ ' + p.money.toLocaleString("pt-BR") + '</strong>' +
    (notice ? '<p>' + notice + '</p>' : '') +
    (pokemon.length ? '<button type="button" id="labSubmit" data-action="modifyPokemon">Modificar · ₽ ' +
      lab.cost.toLocaleString("pt-BR") + ' · 1 ação</button>' : '') +
    workOption(p, "lab") + '</footer></section>';
}

function facilityScreen() {
  const p = state.you;
  if (activeFacility === "post") return jobPost(p);
  if (activeFacility === "center") return pokemonCenter(p);
  if (activeFacility === "lab") return laboratoryScreen(p);
  const {gym, reason} = gymDetails(p);
  if (p.loc === leagueIsland) return elitePanel(p, gym, reason);
  return fullFacility("Ginásio · " + gym.name, '<div class="gym-opponent"><small>Ginásio</small>' +
    '<h2>' + esc(gym.name) + '</h2><p>' +
    (gym.type ? 'Tipo ' + esc(moveTypes[gym.type] || gym.type) + ' · ' : '') +
    'Nível de referência ' + gym.level + ' · ' + gym.size + ' Pokémon</p></div>',
    actionBalance(p) + (reason ? '<p>' + esc(reason) + '</p>' : btn("Desafiar · 1 ação", "gym", {}, "primary")),
    "gym", gym.portrait ? "npc/lideres/" + encodeURIComponent(gym.portrait) + ".png" : "");
}

async function showHealing(party) {
  const bars = [...$("content").querySelectorAll("[data-health]")];
  for (const bar of bars) {
    const mon = party.find(m => m.uid === bar.dataset.health);
    if (!mon) continue;
    animateHP(bar, bar.value, mon.hp);
    bar.parentElement.querySelector("[data-hp-text]").textContent = mon.hp + " / " + mon.maxhp;
  }
  const audio = gameAudio.context;
  if (!gameAudio.preferences.muted && audio?.state === "running") {
    [523, 659, 784, 1047].forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const start = audio.currentTime + index * 0.085;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.065, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.15);
      oscillator.connect(gain).connect(gameAudio.effects);
      oscillator.start(start);
      oscillator.stop(start + 0.16);
    });
  }
  if (bars.length) await new Promise(resolve => setTimeout(resolve, 480));
}
const facilityNames = {
  center: "Centro Pokémon", store: "Loja", post: "Posto de trabalho", lab: "Laboratório",
};

function jobPost(p) {
  return '<section class="post-screen" data-theme="post" aria-labelledby="postTitle">' +
    '<header class="post-heading"><span class="post-medallion">' + uiIcon("map-post") + '</span>' +
    '<h2 id="postTitle">Quadro de empregos</h2><span class="post-location">' + uiIcon("map-pin") +
    esc(locName(p.loc)) + '</span>' + actionBalance(p) + '</header>' +
    '<div class="post-layout"><aside class="post-reception">' +
    '<img src="npc/posto.png" alt="Atendente do Posto de Trabalho"><span class="post-medallion">' +
    uiIcon("ball") + '</span></aside>' +
    '<div class="post-vacancies">' + jobBoard(p) + '</div></div>' +
    '<div class="post-ornament" aria-hidden="true"><span class="post-medallion">' + uiIcon("ball") + '</span></div></section>';
}

function jobBoard(p, facility) {
  const jobs = Object.entries(state.jobs).filter(([,job]) => !facility || job.facility === facility);
  if (!jobs.length) return "";
  return '<div class="job-board" id="postJobs" tabindex="0" role="region" aria-label="Vagas disponíveis">' +
    jobs.map(([id, job]) => {
    const place = job.place || p.loc;
    const active = p.job === id && p.jobLocation === place;
    const workplace = job.facility === "lab" && !state.laboratory ? "Vilas com laboratório" : job.place ? locName(place) :
      facilityNames[job.facility] + " de " + locName(place);
    const requirement = job.requirement;
    const qualified = p.party.filter(mon => requirement.eligible.includes(mon.uid));
    const teamSlots = requirement.requiredPokemon ? '<div class="job-team-slots" aria-hidden="true">' +
      Array.from({length:requirement.requiredPokemon}, (_, index) => qualified[index] ?
        tokenMon(qualified[index]) : '<span class="job-team-empty">+</span>').join("") + '</div>' : '';
    const progress = requirement.target
      ? '<progress aria-label="Progresso do requisito de XP" value="' +
        Math.min(requirement.current, requirement.target) + '" max="' + requirement.target + '"></progress>'
      : "";
    const label = p.job ? "Trocar · 1 ação" : "Assumir · 1 ação";
    const action = active ? '<small class="post-current">Emprego atual</small>' :
      requirement.met && (job.facility !== "lab" || state.laboratory) ? btn(label, "hire", { job: id }) :
      '<button type="button" disabled>' + label + '</button>';
    const icons = { store:"map-post", center:"map-center", wild:"footprints", lab:"map-lab" };
    const heading = '<div class="post-job-title">' + uiIcon(icons[job.facility]) +
      '<b>' + esc(job.name) + '</b></div>';
    return '<article data-job="' + id + '">' +
      heading + '<span>Grau ' + (job.rank + 1) + ' · ' + esc(workplace) + '</span><strong class="job-pay">₽ ' + job.pay + '</strong>' +
      '<div class="post-requirement">' + (requirement.text === "Nenhum" ? "" :
        '<small>' + esc(requirement.text) + '</small>') + teamSlots + progress + '</div>' + action + '</article>';
  }).join("") + '</div>';
}

function workOption(p, facility, showIcons = false) {
  const job = state.jobs[p.job];
  return job && p.jobLocation === p.loc && job.facility === facility
    ? '<p>' + (showIcons ? uiIcon("person") : '') + esc(job.name) + ' · ₽ ' + job.pay + ' por ação</p>' +
      (job.requirement.met ? (showIcons
          ? '<button type="button" data-action="work" data-args="{}">' + uiIcon("map-post") + 'Trabalhar · 1 ação</button>'
          : btn("Trabalhar · 1 ação", "work")) :
        '<button type="button" disabled>Trabalhar</button><small>' + esc(job.requirement.text) + '</small>')
    : "";
}

function leagueEntryReason() {
  const p = state.you;
  if (!hasLeagueAccess(p)) return "São necessárias 8 insígnias · " + p.badges.length + "/8";
  if (state.phase !== "actions" || p.done || p.enc) return "Aguarde a próxima fase de ações.";
  if (p.loc === leagueIsland) return "";
  if (!leaguePorts.includes(p.loc)) return "O barco para a Ilha da Liga sai de " + leaguePorts.map(locName).join(" ou ") + ".";
  return "";
}

function leagueScene() {
  const reason = leagueEntryReason();
  const onIsland = state.you.loc === leagueIsland;
  return '<section class="destination league"><h2>Ilha da Liga · Elite Four</h2><small>' +
    actionsRemaining(state.you) + '</small>' +
    '<button type="button" class="building league-entrance" data-enter-league="true"' +
    (reason ? ' disabled aria-describedby="league-entry-reason"' : '') + '><b>' +
    (onIsland ? 'Entrar na Elite Four' : 'Confirmar entrada · 1 ação') + '</b></button>' +
    (reason ? '<p id="league-entry-reason">' + esc(reason) + '</p>' : '') +
    '</section>';
}

const labVillageScenes = {
  village3: "vila-das-flores-laboratorio.png",
  village4: "vila-da-geada-laboratorio.png",
  village6: "vila-das-cinzas-laboratorio.png",
};

function biomeActions(p) {
  const vacancy = state.jobs[p.job];
  let work = "";
  if (Object.values(state.jobs).some(job => job.place === p.loc)) {
    const reason = vacancy?.place !== p.loc || p.jobLocation !== p.loc
      ? "Assuma uma vaga deste bioma no Posto de trabalho."
      : vacancy.requirement.met ? "" : vacancy.requirement.text;
    const button = '<button type="button" class="biome-action biome-work" data-action="work"' +
      (reason ? ' disabled' : '') + '>' + uiIcon("map-post") + 'Trabalhar</button>';
    work = reason ? '<span class="biome-work-locked" tabindex="0" aria-label="Trabalhar indisponível" ' +
      'aria-describedby="biomeWorkHint">' + button +
      '<span id="biomeWorkHint" class="biome-work-hint" role="tooltip">' + esc(reason) + '</span></span>' : button;
  }
  return '<div class="biome-actions" aria-label="Ações do local">' +
    '<button type="button" class="biome-action biome-explore" data-action="explore">' +
    uiIcon("compass") + 'Explorar</button>' + work + '</div>';
}

function locationScene() {
  const p = state.you;
  if (p.loc === leagueIsland) return leagueScene();
  const location = LOCATIONS.find((site) => site.id === p.loc);
  const town = location.kind !== "biome";
  const titles = {
    ...facilityNames,
    gym: "Ginásio",
  };
  const building = (id) =>
    '<button class="building ' + id + '" data-facility="' + id + '"><b>' +
    esc(titles[id]) + "</b></button>";
  const labScene = labVillageScenes[location.id];
  if (labScene) return '<section class="destination lab-village" data-village="' + location.id +
    '" style="background-image:url(scenes/' + labScene + ')"><h2>' + esc(location.name) +
    '</h2><small>' + actionsRemaining(p) + '</small><div class="lab-village-buildings">' +
    building("center") + building("lab") + building("store") + '</div></section>';
  const gym = location.kind === "city" ? building("gym") : "";
  const facility = activeFacility;
  const townArt = location.kind === "city" ? "city-pixel.png" : "village-pixel.png";
  const biomeArt = location.biome === "caverna" ? "cave-pixel.png" : location.biome + "-pixel.png";
  const art = town ? townArt : biomeArt;
  return '<section class="destination ' + (town ? "town " + location.kind : "wild") +
    '" style="background-image:url(scenes/' + art + ')"><h2>' + esc(location.name) +
    "</h2><small>" + actionsRemaining(p) + "</small>" +
    (town ? building("center") + building("store") + gym +
      (location.kind === "city" ? building("post") : "") : biomeActions(p)) +
    (town && facility ? '<section class="job-panel facility-panel" aria-labelledby="facility-title">' +
      '<div class="job-panel-heading"><h3 id="facility-title">' + esc(titles[facility]) + '</h3>' +
      '<button type="button" data-facility="close" aria-label="Cancelar">×</button>' +
      '</div><div class="facility-actions"><button type="button" data-confirm-facility="true">' +
      'Confirmar entrada</button></div></section>' : '') + '</section>';
}


function showItemSummary(event) {
  const entry = event.target.closest("[data-item-summary]");
  const tooltip = $("itemTooltip");
  if (!entry || entry.contains(event.relatedTarget)) return;
  if (event.type === "pointerout" || event.type === "focusout") {
    tooltip.hidden = true;
    return;
  }
  const id = entry.dataset.itemSummary;
  const item = state?.shop[id];
  const summary = item?.summary || (id === "master-ball" ? "Captura garantida de um Pokémon selvagem." : "");
  if (!summary) return;
  tooltip.querySelector("strong").textContent = item?.name || "Master Ball";
  tooltip.querySelector("span").textContent = summary;
  tooltip.hidden = false;
  const rect = entry.getBoundingClientRect();
  const left = event.type === "pointerover" ? event.clientX + 12 : rect.left;
  const top = event.type === "pointerover" ? event.clientY + 16 : rect.bottom + 6;
  tooltip.style.left = Math.max(8, Math.min(left, innerWidth - tooltip.offsetWidth - 8)) + "px";
  tooltip.style.top = (top + tooltip.offsetHeight <= innerHeight - 8
    ? top : Math.max(8, rect.top - tooltip.offsetHeight - 6)) + "px";
}
for (const type of ["pointerover", "pointerout", "focusin", "focusout"])
  document.addEventListener(type, showItemSummary);
document.addEventListener("scroll", () => { $("itemTooltip").hidden = true; }, true);
