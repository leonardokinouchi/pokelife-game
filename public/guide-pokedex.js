(() => {
  const get = id => document.getElementById(id);
  const search = get("dexSearch");
  const biomeFilter = get("dexBiome");
  const periodFilter = get("dexPeriod");
  const rarityFilter = get("dexRarity");
  const forms = get("dexForms");
  const rows = get("dexRows");
  const status = get("dexStatus");
  const previous = get("dexPrev");
  const next = get("dexNext");
  const download = get("dexExport");
  const labels = {day:"Dia", dusk:"Tarde", night:"Noite"};
  const rarity = {common:"Comum", uncommon:"Incomum", rare:"Raro"};
  const key = "auroraSpawnCatalogDraft";
  const pageSize = 24;
  let page = 0, catalog, draft = {}, names = new Map();

  const formatSlug = slug => slug.split("-").map(part => part[0].toUpperCase() + part.slice(1)).join(" ");
  const withEdits = row => ({...row, ...draft[row.id]});

  function render() {
    const query = normalize(search.value.trim());
    const filtered = catalog.species.map(withEdits).filter(row =>
      (forms.checked || row.id <= 1025) &&
      (!biomeFilter.value || row.biome === biomeFilter.value) &&
      (!periodFilter.value || row.period === periodFilter.value) &&
      (!rarityFilter.value || row.rarity === rarityFilter.value) &&
      (!query || String(row.id) === query ||
        normalize([names.get(row.id), row.pokemon, formatSlug(row.pokemon), row.family, formatSlug(row.family)].join(" ")).includes(query)));
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.min(page, pages - 1);
    previous.disabled = page === 0;
    next.disabled = page + 1 >= pages;
    get("dexPage").textContent = (page + 1) + " / " + pages;
    status.textContent = filtered.length + " encontrados · " + Object.keys(draft).length + " editados";
    rows.replaceChildren(...filtered.slice(page * pageSize, (page + 1) * pageSize).map(mon => {
      const row = document.createElement("tr");
      const name = row.insertCell();
      name.className = "dex-identity";
      const sprite = document.createElement("img");
      sprite.src = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/" + mon.id + ".png";
      sprite.alt = "";
      sprite.loading = "lazy";
      sprite.width = sprite.height = 48;
      sprite.addEventListener("error", () => { sprite.hidden = true; }, {once:true});
      const identity = document.createElement("span");
      const title = document.createElement("b");
      title.textContent = names.get(mon.id) || formatSlug(mon.pokemon);
      const number = document.createElement("small");
      number.textContent = "#" + String(mon.id).padStart(3, "0") + " · " + formatSlug(mon.family);
      identity.append(title, number);
      name.append(sprite, identity);
      const rating = row.insertCell();
      const badge = document.createElement("span");
      badge.className = "dex-rarity";
      badge.dataset.rarity = mon.rarity;
      badge.textContent = rarity[mon.rarity];
      const bst = document.createElement("small");
      bst.textContent = mon.finalBst + " BST";
      rating.append(badge, bst);
      for (const [field, options, label] of [["biome", catalog.biomes, "Bioma"], ["period", labels, "Horário"]]) {
        const select = document.createElement("select");
        select.setAttribute("aria-label", label + " de " + title.textContent);
        select.dataset.id = mon.id;
        select.dataset.field = field;
        select.append(...Object.entries(options).map(([value, text]) => new Option(text, value)));
        select.value = mon[field];
        row.insertCell().append(select);
      }
      return row;
    }));
  }

  rows.addEventListener("change", event => {
    const control = event.target;
    const original = catalog.species.find(mon => mon.id === Number(control.dataset.id));
    if (!original) return;
    const changed = {...draft[original.id], [control.dataset.field]:control.value};
    for (const field of ["biome", "period"]) if (changed[field] === original[field]) delete changed[field];
    if (Object.keys(changed).length) draft[original.id] = changed;
    else delete draft[original.id];
    let saved = true;
    try { localStorage.setItem(key, JSON.stringify(draft)); } catch { saved = false; }
    render();
    if (!saved) status.textContent += " · Armazenamento indisponível. Exporte para guardar.";
    rows.querySelector('[data-id="' + original.id + '"][data-field="' + control.dataset.field + '"]')?.focus();
  });

  for (const control of [search, biomeFilter, periodFilter, rarityFilter, forms])
    control.addEventListener("input", () => { if (catalog) { page = 0; render(); } });
  previous.onclick = () => { page--; render(); };
  next.onclick = () => { page++; render(); };
  download.onclick = () => {
    const blob = new Blob([JSON.stringify({...catalog, species:catalog.species.map(withEdits)}, null, 2)],
      {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "spawn-catalog-preview.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  Promise.all([guideData("spawn-catalog"), guideData("species").catch(() => [])]).then(([data, species]) => {
    catalog = data;
    names = new Map(species.map(mon => [mon.id, mon.name]));
    biomeFilter.append(...Object.entries(catalog.biomes).map(([value, text]) => new Option(text, value)));
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "{}");
      for (const mon of catalog.species) {
        const entry = saved?.[mon.id];
        const edit = {};
        if (entry && Object.hasOwn(catalog.biomes, entry.biome) && entry.biome !== mon.biome) edit.biome = entry.biome;
        if (entry && Object.hasOwn(labels, entry.period) && entry.period !== mon.period) edit.period = entry.period;
        if (Object.keys(edit).length) draft[mon.id] = edit;
      }
    } catch {}
    download.disabled = false;
    render();
  }).catch(error => { status.textContent = error.message; });
})();
