/* Public world coordinates are measured in pixels on the region artwork. */
(() => {
  const width = 760;
  const height = 480;
  const art = new URL(
    "region.png",
    document.currentScript?.src || document.baseURI,
  ).href;
  const { edges, routeBetween, avatars, leagueIsland, leaguePorts, hasLaboratory } = ExpeditionWorld;
  const groups = {
    city: [
      ["Porto Aurora", 137, 199],
      ["Campo Dourado", 240, 222],
      ["Costa Serena", 313, 188],
      ["Monte Azul", 495, 154],
      ["Mirante Boreal", 589, 153],
      ["Ponte Clara", 394, 309],
      ["Cidade Âmbar", 503, 280],
      ["Caldeira Rubra", 620, 350],
    ],
    village: [
      ["Vila da Enseada", 96, 222],
      ["Vila dos Cedros", 206, 152],
      ["Vila das Flores", 274, 250],
      ["Vila da Geada", 529, 134],
      ["Vila do Vale", 444, 284],
      ["Vila das Cinzas", 561, 347],
    ],
    league: [["Ilha da Liga", 350, 102]],
    biome: [
      ["Prado Solar", 195, 219, "campo"],
      ["Bosque dos Cedros", 240, 163, "floresta"],
      ["Gruta do Eco", 175, 172, "caverna"],
      ["Praia das Marés", 132, 354, "praia"],
      ["Lago de Jade", 288, 183, "lago"],
      ["Serra da Geada", 535, 104, "neve"],
      ["Vulcão Rubro", 605, 317, "vulcao"],
      ["Distrito Antigo", 421, 298, "cidade"],
    ],
  };
  const locations = Object.entries(groups).flatMap(([kind, entries]) =>
    entries.map(([name, x, y, biome], index) => ({
      id: kind + (index + 1),
      kind,
      name,
      x,
      y,
      ...(biome ? { biome } : {}),
    })),
  );
  window.LOCATIONS = locations;
  const sites = new Map(locations.map((site) => [site.id, site]));
  const markers = new Map();
  let canMove = false;
  const labels = { city: "Cidade", village: "Vila", biome: "Bioma", league: "Elite Four" };
  const colors = { city: 0xe7804e, village: 0xffdc89, biome: 0x85cfa0, league: 0xffdf77 };
  let game,
    host,
    layer,
    scene,
    selected,
    hovered,
    occupants = [];
  const buttons = new Map();
  let hint;
  let gyms = [];

  function markerPosition(id, slot) {
    const { x, y } = sites.get(id);
    return {
      left: (100 * (x + (slot % 4 - 1.5) * 10)) / width + "%",
      top: (100 * (y - 8 - Math.floor(slot / 4) * 15)) / height + "%",
    };
  }

  const spriteFrames = {
    down: ["", "-walk1", "-walk2"],
    up: ["-up0", "-up1", "-up2"],
    right: ["-side0", "-side1", "-side2"],
  };

  function routeDirection(from, to) {
    const a = sites.get(from), b = sites.get(to);
    if (!a || !b || a === b) return "down";
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "left" : "right";
    return dy < 0 ? "up" : "down";
  }

  function showTrainerFrame(marker, direction, step = 0) {
    const facing = direction === "left" ? "right" : direction;
    const frames = marker.spriteFrames[facing];
    const frame = frames[step]?.complete && frames[step].naturalWidth ? frames[step] : frames[0];
    const src = frame.getAttribute("src");
    marker.image.dataset.direction = direction;
    if (marker.image.getAttribute("src") !== src) marker.image.src = src;
  }

  function syncPlayers() {
    for (const [id, marker] of markers) {
      if (occupants.some((player) => player.id === id)) continue;
      marker.animation?.cancel();
      marker.image.remove();
      markers.delete(id);
    }
    const slots = new Map();
    for (const player of occupants) {
      const slot = slots.get(player.loc) || 0;
      slots.set(player.loc, slot + 1);
      const position = markerPosition(player.loc, slot);
      const latest = player.travel?.at(-1)?.step || 0;
      let marker = markers.get(player.id);
      if (!marker) {
        const image = document.createElement("img");
        image.className = "world-trainer";
        host.append(image);
        const travel = player.travel || [];
        const direction = routeDirection(travel.at(-1)?.from || travel.at(-2)?.loc, player.loc);
        marker = { image, step: latest, loc: player.loc, slot, direction };
        markers.set(player.id, marker);
      }
      const { image } = marker;
      const avatar = Object.hasOwn(avatars, player.avatar) ? player.avatar : "mar";
      if (marker.avatar !== avatar) {
        marker.avatar = avatar;
        marker.spriteFrames = Object.fromEntries(
          Object.entries(spriteFrames).map(([direction, suffixes]) => [direction, suffixes.map(suffix => {
            const frame = new Image();
            frame.src = "trainers/" + avatar + suffix + ".png";
            return frame;
          })]),
        );
        showTrainerFrame(marker, marker.direction);
      }
      image.alt = image.title = player.name;
      if (latest > marker.step) {
        const stops = player.travel.filter(({ step }) => step > marker.step);
        const directions = stops.map(({from, loc}, index) =>
          routeDirection(from || (index ? stops[index - 1].loc : marker.loc), loc));
        marker.direction = directions.at(-1);
        const frames = [
          markerPosition(marker.loc, marker.slot),
          ...stops.map(({ loc }) => markerPosition(loc, slot)),
        ];
        marker.animation?.cancel();
        marker.animation = image.animate(
          frames.map((frame, i) => ({ ...frame, offset: i / (frames.length - 1) })),
          { duration: Math.min(1400, 430 * stops.length) },
        );
        const movement = marker.animation;
        const updateStep = () => {
          if (marker.animation !== movement || !image.isConnected) return;
          const time = movement.currentTime || 0;
          const duration = movement.effect.getComputedTiming().duration;
          const segment = Math.min(directions.length - 1, Math.floor(time / duration * directions.length));
          showTrainerFrame(marker, directions[segment], [0, 1, 0, 2][Math.floor(time / 85) % 4]);
          if (movement.playState === "running") requestAnimationFrame(updateStep);
        };
        movement.onfinish = () => showTrainerFrame(marker, marker.direction);
        requestAnimationFrame(updateStep);
      }
      Object.assign(image.style, position);
      Object.assign(marker, { step: latest, loc: player.loc, slot });
    }
  }

  function facilityHint(icon, label) {
    const row = document.createElement("div");
    row.className = "map-hint-facility";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS(svg.namespaceURI, "use");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "map-hint-icon " + icon);
    use.setAttribute("href", "#icon-map-" + icon);
    svg.append(use);
    const name = document.createElement("span");
    name.textContent = label;
    row.append(svg, name);
    return row;
  }

  function showHint(reachable) {
    const site = sites.get(hovered);
    hint.hidden = !site;
    if (!site) return;
    const title = document.createElement("strong");
    title.textContent = site.name;
    hint.replaceChildren(title);
    if (site.kind === "city" || site.kind === "village") {
      const services = document.createElement("div");
      services.className = "map-hint-services";
      services.append(facilityHint("store", "Loja"), facilityHint("center", "Centro Pokémon"));
      if (site.kind === "city") services.append(facilityHint("post", "Posto de Trabalho"));
      if (hasLaboratory(site.id)) services.append(facilityHint("lab", "Laboratório"));
      hint.append(services);
      if (site.kind === "city") {
        const gym = gyms[Number(site.id.slice(4)) - 1];
        const row = facilityHint("gym", gym ? "Ginásio · " + gym.name : "Ginásio");
        row.classList.add("map-hint-gym");
        if (gym) {
          const details = document.createElement("small");
          const type = moveTypes[gym.type] || gym.type;
          details.textContent = [type, "Nv. " + gym.level, gym.size + " Pokémon"].filter(Boolean).join(" · ");
          row.lastElementChild.append(details);
        }
        hint.append(row);
      }
    } else {
      const description = document.createElement("div");
      description.textContent = site.id === leagueIsland
        ? "Elite Four · 8 insígnias" : site.kind === "biome" ? "Explorar · Pokémon selvagens" : "";
      if (description.textContent) hint.append(description);
    }
    const visitors = occupants.filter(player => player.loc === site.id).length;
    const status = [reachable.includes(site.id) ? "Viajar" : "",
      visitors ? visitors + " em visita" : ""].filter(Boolean).join(" · ");
    if (status) {
      const note = document.createElement("small");
      note.className = "map-hint-note";
      note.textContent = status;
      hint.append(note);
    }
    const x = site.x / width * host.clientWidth;
    const y = site.y / height * host.clientHeight;
    const rail = document.getElementById("partyRail");
    const railEdge = rail?.getBoundingClientRect().left - host.getBoundingClientRect().left;
    const right = rail && !rail.hidden && railEdge > hint.offsetWidth + 10
      ? Math.min(host.clientWidth, railEdge) : host.clientWidth;
    hint.style.left = Math.max(5, Math.min(x - hint.offsetWidth / 2, right - hint.offsetWidth - 5)) + "px";
    const above = y - hint.offsetHeight - 15;
    hint.style.top = Math.max(5, Math.min(above >= 5 ? above : y + 15,
      host.clientHeight - hint.offsetHeight - 5)) + "px";
  }

  function refresh() {
    if (!host) return;
    const reachable = canMove ? locations
      .filter(({ id }) => (id !== leagueIsland || leaguePorts.includes(selected)) && routeBetween(selected, id))
      .map(({ id }) => id) : [];
    for (const [id, button] of buttons) {
      button.setAttribute("aria-pressed", String(id === selected));
      button.disabled = id !== selected && !reachable.includes(id);
      button.style.pointerEvents = button.disabled ? "none" : "";
    }
    showHint(reachable);
    syncPlayers();
    if (!layer) return;
    layer.clear();
    layer.lineStyle(1, 0xe4dcc0, 0.75);
    for (const [a, b] of edges) {
      const from = sites.get(a), to = sites.get(b);
      layer.lineBetween(from.x, from.y, to.x, to.y);
    }
    for (const site of locations) {
      const { x, y, id } = site;
      const active = selected === id;
      const isHovered = hovered === id;
      const n = occupants.filter((player) => player.loc === id).length;
      const r = isHovered || active ? 6 : 4;
      if (active) {
        layer.lineStyle(2, 0xfffae3, 1).strokeCircle(x, y, 11);
        layer.lineStyle(1, 0x22403c, 1).strokeCircle(x, y, 12);
      }
      layer.fillStyle(0x213d39).fillCircle(x, y + 1, r + 1);
      layer.fillStyle(colors[site.kind]).fillCircle(x, y, r);
      layer.fillStyle(0xfff6d6).fillRect(x - 1, y - 2, 2, 2);
      if (n) {
        layer.fillStyle(0x183d40).fillCircle(x + 6, y - 5, 4);
        layer.fillStyle(0xfff6d6).fillCircle(x + 6, y - 5, 2);
      }
    }
  }

  function destroy() {
    if (game) game.destroy(true);
    game = scene = layer = null;
    host?.remove();
    host = null;
    buttons.clear();
    markers.clear();
    hovered = null;
  }

  function mount(container, onSelect) {
    destroy();
    container =
      typeof container === "string"
        ? document.querySelector(container)
        : container;
    if (!container) throw new Error("Contêiner do mapa ausente.");
    host = document.createElement("div");
    host.style.cssText =
      "position:relative;width:100%;aspect-ratio:760/480;overflow:hidden;isolation:isolate;background:#257fa5 url('" +
      art +
      "') center/100% 100%;image-rendering:pixelated;";
    container.append(host);
    const canvasHost = document.createElement("div");
    canvasHost.style.cssText = "position:absolute;inset:0;pointer-events:none";
    host.append(canvasHost);
    hint = document.createElement("div");
    hint.id = "worldMapHint";
    hint.className = "map-hint";
    hint.setAttribute("role", "tooltip");
    hint.hidden = true;
    host.append(hint);
    for (const site of locations) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", labels[site.kind] + " · " + site.name);
      const marker = document.createElement("div");
      marker.className = "map-marker";
      marker.style.left = (100 * site.x) / width + "%";
      marker.style.top = (100 * site.y) / height + "%";
      button.setAttribute("aria-describedby", hint.id);
      marker.onpointerenter = button.onfocus = () => {
        hovered = site.id;
        refresh();
      };
      marker.onpointerleave = button.onblur = () => {
        hovered = null;
        refresh();
      };
      button.onclick = () => onSelect?.(site.id);
      marker.append(button);
      host.append(marker);
      buttons.set(site.id, button);
    }
    const P = window.Phaser;
    if (P) {
      const currentHost = host;
      game = new P.Game({
        type: P.CANVAS,
        width,
        height,
        parent: canvasHost,
        transparent: true,
        pixelArt: true,
        audio: { noAudio: true },
        banner: false,
        fps: { target: 24 },
        input: { keyboard: false, mouse: false, touch: false },
        scene: {
          preload() {
            this.load.image("region", art);
          },
          create() {
            if (currentHost !== host) return;
            scene = this;
            this.add.image(0, 0, "region").setOrigin(0);
            layer = this.add.graphics();
            Object.assign(this.game.canvas.style, {
              width: "100%",
              height: "100%",
              display: "block",
            });
            refresh();
          },
        },
      });
    } else {
      for (const [id, button] of buttons) {
        button.style.background =
          "#" + colors[locations.find((s) => s.id === id).kind].toString(16);
        button.style.border = "2px solid #254740";
      }
    }
    refresh();
    return game;
  }

  window.WorldMap = {
    mount,
    destroy,
    update(id, players = [], allowTravel = false, gymDetails = []) {
      canMove = allowTravel;
      gyms = gymDetails;
      selected = typeof id === "string" ? id : id?.id;
      occupants = Array.isArray(players)
        ? players
        : Object.values(players || {});
      refresh();
    },
  };
})();
