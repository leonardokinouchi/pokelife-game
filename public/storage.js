let boxPage = 0;

function openPokemonDetails(uid) {
  const mon = [...state.you.party, ...state.you.box].find(pokemon => pokemon.uid === uid);
  if (!mon) return;
  const dialog = $("pokemonDetails");
  const selection = state.duel?.selection;
  const duel = selection?.summaries?.[uid];
  const stats = {hp:"PV", atk:"Ataque", def:"Defesa", spa:"Ataque Esp.", spd:"Defesa Esp.", spe:"Velocidade"};
  const itemName = id => state.shop[id]?.name || id.replaceAll("-", " ");
  const canChangeItem = state.phase === "actions" && !state.you.done && !state.you.enc;
  const heldChoices = Object.entries(state.you.items).filter(([id, count]) =>
    count > 0 && state.shop[id]?.held && id !== mon.heldItem);
  const heldControls = canChangeItem ? '<section class="pokemon-held-controls" aria-label="Equipamento">' +
    (heldChoices.length ? '<label>Item da Mochila' + select("pokemonHeldChoice", heldChoices.map(([id, count]) =>
      opt(id, itemName(id) + " ×" + count)).join("")) + '</label>' +
      btn(mon.heldItem ? "Trocar item" : "Equipar item", "equipHeld", {uid:mon.uid}) : "") +
    (mon.heldItem ? btn("Remover item", "unequip", {uid:mon.uid}) : "") + '</section>' : "";
  const evolutions = state.you.evolutionsByPokemon?.[mon.pokemonId] || [];
  const canPet = state.phase === "actions" && !state.you.done && !state.you.enc && state.you.actions > 0 &&
    state.you.eliteRun == null;
  const inBoxPanel = personalDrawer === "box" && (state.phase === "actions" || state.phase === "resumo") &&
    !state.you.enc;
  const inParty = state.you.party.includes(mon);
  const roomToMove = inParty ? state.you.box.length < state.you.boxCapacity : state.you.party.length < 6;
  const transfer = inBoxPanel ? (roomToMove
    ? btn(inParty ? "Guardar na Box" : "Colocar na equipe", "box", {uid:mon.uid})
    : '<small>' + (inParty ? "Box cheia." : "Equipe cheia. Arraste sobre um Pokémon para trocar.") + '</small>') : "";
  const requirements = rule => [
    rule.minimum_level && "Nível " + rule.minimum_level,
    rule.item && "Usar " + itemName(rule.item),
    rule.trigger === "trade" && "Trocar" + (rule.tradeTarget ? " por " + rule.tradeTarget : ""),
    rule.heldItem && "Equipar " + itemName(rule.heldItem),
    rule.minimum_happiness && "Felicidade " + rule.minimum_happiness + "+",
    rule.time_of_day && ({day:"Durante o dia", dusk:"Durante a tarde", night:"Durante a noite"}[rule.time_of_day] || rule.time_of_day),
    rule.gender_id && (rule.gender_id === 1 ? "Fêmea" : "Macho"),
    rule.knownMove && "Conhecer " + rule.knownMove.replaceAll("-", " "),
    rule.knownType && "Conhecer golpe de " + (moveTypes[rule.knownType[0].toUpperCase() + rule.knownType.slice(1)] || rule.knownType),
    rule.partyType && "Ter na equipe um Pokémon do tipo " + (moveTypes[rule.partyType[0].toUpperCase() + rule.partyType.slice(1)] || rule.partyType),
    rule.parentParty && "Ter " + rule.parentParty + " na equipe",
    rule.relative_physical_stats !== undefined &&
      ["Ataque menor que Defesa", "Ataque igual à Defesa", "Ataque maior que Defesa"][rule.relative_physical_stats + 1],
    rule.region_id && "Região específica",
    rule.needs_overworld_rain && "Evoluir sob chuva",
    rule.usedMove && "Usar " + rule.usedMove.replaceAll("-", " ") + " " + (rule.minimum_move_count || 1) + " vez(es)",
    rule.minimum_damage_taken && "Receber " + rule.minimum_damage_taken + " de dano",
  ].filter(Boolean).join(" · ");
  const hp = duel ? duel.stats.hp : mon.hp;
  const maxhp = duel ? duel.stats.hp : mon.maxhp;
  const types = mon.types.map(type => {
    const key = type[0].toUpperCase() + type.slice(1);
    return '<span data-type="' + esc(type) + '">' + esc(moveTypes[key] || type) + '</span>';
  }).join("");
  dialog.innerHTML = '<header class="pokemon-summary-hero"><div class="pokemon-details-sprite">' + tokenMon(mon) +
    '</div><div class="pokemon-summary-identity"><p>' +
    (duel ? "Nível " + selection.level + " no duelo" : "Nível " + mon.level) +
    '</p><h2 id="pokemonDetailsTitle">' + esc(mon.name) + '</h2><div class="pokemon-summary-types">' +
    types + '</div><div class="pokemon-summary-health"><progress aria-label="PV" value="' + hp +
    '" max="' + maxhp + '"></progress><b>' + hp + ' / ' + maxhp + ' PV</b></div></div>' +
    '<form method="dialog"><button aria-label="Fechar">×</button></form></header>' +
    '<div class="pokemon-details-info"><section class="pokemon-summary-panel"><h3>Atributos</h3><dl class="pokemon-detail-stats">' +
    Object.entries(stats).map(([key,label]) => {
      const value = (duel?.stats || mon.stats)[key];
      return '<div><dt>' + label + '</dt><dd>' + value + '</dd></div>';
    }).join("") + '</dl><dl class="pokemon-detail-stats pokemon-summary-traits">' +
    '<div><dt>Natureza</dt><dd>' + esc(mon.nature || "Neutra") +
    '</dd></div><div><dt>Habilidade</dt><dd>' + esc(mon.ability || "—") +
    '</dd></div><div><dt>Felicidade</dt><dd>' + mon.happiness + '/255</dd></div></dl>' +
    '<section class="pokemon-summary-equipment"><h3>Item equipado</h3><div>' +
    (mon.heldItem ? itemArt(mon.heldItem) : "") +
    '<b>' + esc(mon.heldItem ? itemName(mon.heldItem) : "Nenhum") + '</b></div>' + heldControls + '</section></section>' +
    '<section class="pokemon-summary-panel"><h3>Golpes</h3><ul class="pokemon-summary-moves">' +
      (duel ? duel.moves.map(move => {
        const accuracy = move.accuracy === true ? "Não falha" : "Precisão " + move.accuracy + "%";
        const attributes = [moveTypes[move.type], moveCategories[move.category],
          move.basePower && "Poder " + move.basePower, accuracy, move.pp + " PP"];
        return '<li><b>' + esc(move.name) + '</b><small>' + esc(attributes.filter(Boolean).join(" · ")) +
          '</small>' + (move.shortDesc ? '<small>' + esc(move.shortDesc) + '</small>' : '') + '</li>';
      }) : mon.moves.map((move, index) => '<li><small aria-hidden="true">' + (index + 1) + '</small><b>' +
        esc(move.replace(/(^|-)(\w)/g, (_, __, c) => " " + c.toUpperCase()).trim()) + '</b></li>')).join("") +
      '</ul>' + (duel ? "" : '<h3>Evoluções</h3>' + (evolutions.length ? '<ul class="pokemon-summary-evolutions">' +
        evolutions.map(rule => '<li><b>' + esc(rule.name) + '</b><small>' +
        esc(requirements(rule) || (rule.trigger === "level-up" ? "Ao subir de nível" : "Condição especial")) +
        '</small></li>').join("") + '</ul>' : '<p>Sem evoluções registradas.</p>')) +
      '</section></div>' + (canPet || transfer ? '<footer class="pokemon-details-actions">' + transfer +
      (canPet ? btn("Acariciar · 1 ação", "pet", {uid:mon.uid}, "primary") : "") + '</footer>' : "");
  dialog.showModal();
}
function profile() {
  const p = state.you;
  const job = state.jobs[p.job];
  const place = job?.place ? locName(p.jobLocation) :
    facilityNames[job?.facility] + " de " + locName(p.jobLocation);
  const badges = ["Folha", "Maré", "Faísca", "Punho", "Espectro", "Geada", "Brasa", "Dragão"];
  return '<section class="personal-body"><div class="personal-identity">' +
    trainerSprite(p.avatar, "trainer-preview") + '<h3>' + esc(p.name) + '</h3></div>' +
    '<dl class="profile-facts"><div><dt>' + uiIcon("wallet") + ' Saldo</dt><dd>₽ ' +
    p.money.toLocaleString("pt-BR") + '</dd></div><div><dt>Emprego</dt><dd>' +
    (job ? esc(job.name) + '</dd><dd class="profile-job-place">' + esc(place) + ' · ' +
      (p.jobProgress[p.job] || 0) + ' XP' : 'Sem emprego') + '</dd></div></dl>' +
    '<div class="personal-section-head"><h3>Insígnias</h3><span>' + p.badges.length + ' / 8</span></div>' +
    '<div class="badgeCase">' + badges.map((name, i) => {
      const earned = p.badges.includes(i + 1);
      return '<figure class="' + (earned ? "earned" : "locked") + '"><img src="badges/' + (i + 1) +
        '.png" alt=""><figcaption>' + name + '<span class="sr-only">' +
        (earned ? " (conquistada)" : " (bloqueada)") + '</span></figcaption></figure>';
    }).join("") + '</div></section>';
}
function statusName(m) {
  return !m.hp
    ? "Desmaiado"
    : {
        psn: "Veneno",
        tox: "Veneno grave",
        brn: "Queimadura",
        par: "Paralisia",
        slp: "Sono",
        frz: "Congelado",
      }[m.status] || "";
}
function tokenMon(m) {
  return (
    '<span class="monToken ' +
    (!m.hp ? "knocked" : esc(m.status || "")) +
    '">' +
    sprite(m) +
    (statusName(m) ? "<small>" + statusName(m) + "</small>" : "") +
    "</span>"
  );
}
const boxPageSize = 30;
const boxPageCount = (trainer) => Math.max(1, Math.ceil(trainer.boxCapacity / boxPageSize));
function boxPageMarkup(trainer, page, slot, action) {
  const pages = boxPageCount(trainer);
  const stored = new Map(trainer.box.map((mon) => [mon.boxSlot, mon]));
  const button = (delta, label, disabled) => '<button type="button" ' +
    (action ? 'data-action="' + action + '" data-args="' + esc(JSON.stringify({delta})) + '"' :
      'data-page="' + delta + '"') + (disabled ? ' disabled' : '') + '>' + label + '</button>';
  const slots = Array.from({length:boxPageSize}, (_, index) => {
    const position = page * boxPageSize + index;
    return slot(position, stored.get(position));
  });
  return '<div class="pcNav">' + button(-1, '‹ <span>Anterior</span>', page === 0) +
    '<b aria-live="polite">Box ' + (page + 1) + ' / ' + pages + '</b>' +
    button(1, '<span>Próxima</span> ›', page >= pages - 1) +
    '</div><div class="pcGrid">' + slots.join("") + '</div>';
}
function boxSlotContents(mon) {
  return mon ? tokenMon(mon) + '<small>' + esc(mon.name) + '</small>' : uiIcon("ball");
}
function boxScreen() {
  const p = state.you;
  boxPage = Math.min(boxPage, boxPageCount(p) - 1);
  const canDrag = state.phase === "actions" && !p.enc && !p.moveLesson;
  function slot(n, m) {
    return '<button type="button" class="pcSlot" data-team="box" data-slot="' + n + '" ' +
      (m ? 'data-mon="' + esc(m.uid) + '" data-pokemon-details="' + esc(m.uid) + '" title="' +
        esc(m.name) + '"' + (canDrag ? ' draggable="true"' : "") : 'aria-label="Espaço vazio"') +
      '>' + boxSlotContents(m) + '</button>';
  }
  return '<section class="box-group">' +
    '<div class="personal-section-head"><h3>Armazenamento</h3><span>' + p.box.length +
    ' / ' + p.boxCapacity + '</span></div>' +
    boxPageMarkup(p, boxPage, slot) + '</section>';
}
function itemArt(id) {
  const available = state.shop[id]?.sprite || id === "master-ball";
  return available
    ? '<img class="itemArt" alt="" src="items/' + encodeURIComponent(id) + '.png">'
    : '<span class="itemArt item-fallback" aria-hidden="true">◇</span>';
}
function trainerCard(q) {
  const mons = (list) =>
    '<ul class="summary-mons">' + list.map((m) =>
      '<li class="cardMon">' + tokenMon(m) + '<div><strong>' + esc(m.name) +
      '</strong><small>Nv. ' + m.level + ' · HP ' + m.hp + '/' + m.maxhp +
      '</small></div></li>',
    ).join("") + '</ul>';
  const items = Object.entries(q.items).filter(([, amount]) => amount > 0);
  const hasOnlyBox = !q.party.length && q.box.length > 0;
  return '<article class="trainerCard"><header>' +
    trainerSprite(q.avatar, "summary-avatar") + '<strong>' + esc(q.name) +
    '</strong><b>' + q.money.toLocaleString("pt-BR") + ' ₽</b></header>' +
    '<div class="cardScroll"><h4>Equipe · ' + q.party.length + '/6</h4>' +
    (q.party.length ? mons(q.party) : '<p class="summary-empty">Equipe vazia</p>') +
    '<details id="summary-box-' + esc(q.id) + '"' + (hasOnlyBox ? " open" : "") +
    '><summary>Box · ' + q.box.length + '</summary>' +
    (q.box.length ? mons(q.box) : '<p class="summary-empty">Box vazia</p>') +
    '</details><details id="summary-bag-' + esc(q.id) + '"><summary>Mochila · ' + items.length +
    '</summary>' + (items.map(([id, amount]) =>
      '<div class="cardItem">' + itemArt(id) + esc(state.shop[id]?.name || id) +
      ' ×' + amount + '</div>',
    ).join("") || '<p class="summary-empty">Mochila vazia</p>') + '</details></div></article>';
}
function trainerGrid() {
  return (
    '<div class="trainerGrid">' +
    state.players.map(trainerCard).join("") +
    "</div>"
  );
}
function gymHint() {
  const p = state.you,
    i =
      p.loc === ExpeditionWorld.leagueIsland
        ? 8 + Math.min(3, p.elite)
        : Number(p.loc.slice(4)) - 1,
    g = state.gyms?.[i];
  return g
    ? '<span class="gymHint">Líder ' +
        esc(g.name) +
        " · Nv. " +
        g.level +
        "<br>" +
        g.team.map(esc).join(" · ") +
        "</span>"
    : "";
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.pokemonDetails) {
    openPokemonDetails(b.dataset.pokemonDetails);
    return;
  }
  if (b.dataset.page) {
    boxPage = Math.max(0, Math.min(boxPageCount(state.you) - 1, boxPage + Number(b.dataset.page)));
    render();
  }
});
const pokemonDragType = "application/x-aurora-pokemon";
const pokemonDropTarget = ".pcSlot,#partyRail [data-slot]";

document.addEventListener("dragstart", (e) => {
  const source = e.target.closest('[draggable="true"][data-mon]');
  if (!source) return;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData(pokemonDragType, source.dataset.mon);
});
document.addEventListener("dragover", (e) => {
  const slot = e.target.closest(pokemonDropTarget);
  if (!slot || !e.dataTransfer.types.includes(pokemonDragType)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  slot.classList.add("pokemon-drop-target");
});
document.addEventListener("dragleave", (e) => {
  const slot = e.target.closest(pokemonDropTarget);
  if (slot && !slot.contains(e.relatedTarget)) slot.classList.remove("pokemon-drop-target");
});
document.addEventListener("dragend", () => {
  document.querySelectorAll(".pokemon-drop-target").forEach(slot => slot.classList.remove("pokemon-drop-target"));
});
document.addEventListener("drop", (e) => {
  const slot = e.target.closest(pokemonDropTarget);
  const uid = e.dataTransfer.getData(pokemonDragType);
  if (!slot || !uid) return;
  e.preventDefault();
  slot.classList.remove("pokemon-drop-target");
  if (slot.dataset.mon === uid) return;
  act("box", {
    uid,
    target: slot.dataset.team,
    slot: Number(slot.dataset.slot),
  });
});
