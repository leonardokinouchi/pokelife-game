let boxPage = 0,
  selectedMon = "";
function profile() {
  const p = state.you;
  const job = state.jobs[p.job];
  const progress = p.jobProgress[p.job] || 0;
  const place = job?.place ? locName(p.jobLocation) :
    facilityNames[job?.facility] + " de " + locName(p.jobLocation);
  return panel(
    "Perfil de treinador",
    '<div class="balance"><small>SALDO</small><strong>₽ ' +
      p.money.toLocaleString("pt-BR") +
      "</strong>" + trainerSprite(p.avatar, "trainer-preview") +
      "<span>" + esc(p.name) + "</span><span>" +
      (job ? esc(job.name + " · " + place) + " · " +
        progress + " XP" : "Sem profissão") +
      "</span></div><h3>Insígnias · " +
      p.badges.length +
      '/8</h3><div class="badgeCase">' +
      [
        "Folha",
        "Maré",
        "Faísca",
        "Punho",
        "Espectro",
        "Geada",
        "Brasa",
        "Dragão",
      ]
        .map(
          (n, i) =>
            '<figure class="' +
            (p.badges.includes(i + 1) ? "earned" : "locked") +
            '"><img src="badges/' +
            (i + 1) +
            '.png" alt=""><figcaption>' +
            n +
            "</figcaption></figure>",
        )
        .join("") +
      "</div>",
  );
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
function boxScreen() {
  const p = state.you,
    stored = new Map(p.box.map((m) => [m.boxSlot, m]));
  const pages = p.boxCapacity / 30;
  boxPage = Math.min(boxPage, pages - 1);
  function slot(team, n, m) {
    return (
      '<button class="pcSlot" data-team="' +
      team +
      '" data-slot="' +
      n +
      '" ' +
      (m
        ? 'draggable="true" data-mon="' +
          m.uid +
          '" title="' +
          esc(m.name) +
          '"'
        : 'aria-label="Espaço vazio"') +
      ">" +
      (m ? tokenMon(m) + "<small>" + esc(m.name) + "</small>" : "·") +
      "</button>"
    );
  }
  const m = [...p.party, ...p.box].find((m) => m.uid === selectedMon),
    first = Array.from({ length: 30 }, (_, i) => boxPage * 30 + i).find(
      (i) => !stored.has(i),
    );
  return panel(
    "Armazenamento Pokémon",
    '<div class="pcNav"><button data-page="-1" ' +
      (!boxPage ? "disabled" : "") +
      ">Anterior</button><b>Box " +
      (boxPage + 1) +
      ' / ' + pages + '</b><button data-page="1" ' +
      (boxPage === pages - 1 ? "disabled" : "") +
      '>Próxima</button></div><div class="pcGrid">' +
      Array.from({ length: 30 }, (_, i) =>
        slot("box", boxPage * 30 + i, stored.get(boxPage * 30 + i)),
      ).join("") +
      '</div><h3>Equipe</h3><div class="pcGrid">' +
      Array.from({ length: 6 }, (_, i) => slot("party", i, p.party[i])).join(
        "",
      ) +
      "</div>" +
      (m
        ? '<div class="pcMenu"><b>' +
          esc(m.name) +
          " · Nv. " +
          m.level +
          "</b>" +
          bars(m) +
          btn(
            p.party.includes(m) ? "Guardar na box" : "Colocar na equipe",
            "box",
            { uid: m.uid, slot: p.party.includes(m) ? first : undefined },
          ) +
          "<button data-clear-mon>Fechar opções</button></div>"
        : ""),
  );
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
document.addEventListener("contextmenu", (e) => {
  const c = e.target.closest(".pcSlot[data-mon]");
  if (c) {
    e.preventDefault();
    selectedMon = c.dataset.mon;
    render();
  }
});
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.page) {
    boxPage = Math.max(0, Math.min(state.you.boxCapacity / 30 - 1, boxPage + Number(b.dataset.page)));
    selectedMon = "";
    render();
  } else if (b.hasAttribute("data-clear-mon") || b.matches(".pcSlot")) {
    selectedMon = b.dataset.mon || "";
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
