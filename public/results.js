const scoreNumber = new Intl.NumberFormat("pt-BR");
const scoreCategories = [
  {
    key: "colecao",
    title: "Coleção Pokémon",
    scoring: "3 pontos por espécie registrada",
    detail: (p) => scoreNumber.format(p.registered ?? p.points.colecao / 3) + " espécies",
    note: 392,
  },
  {
    key: "shinys",
    title: "Shinys capturados",
    scoring: "10 pontos por captura shiny",
    detail: (p) => scoreNumber.format(p.shinyCaught || 0) +
      (p.shinyCaught === 1 ? " captura shiny" : " capturas shiny"),
    note: 440,
  },
  {
    key: "riqueza",
    title: "Saldo final",
    scoring: "1 ponto a cada ₽ 200",
    detail: (p) => "₽ " + scoreNumber.format(p.money),
    note: 494,
  },
  {
    key: "liga",
    title: "Liga Pokémon",
    scoring: "10 pontos por insígnia · 40 pela Elite Four completa",
    detail: (p) => {
      const badges = p.badges.length;
      return badges + (badges === 1 ? " insígnia" : " insígnias") + " · " +
        (p.elite >= 4 ? "Elite Four concluída" : "Elite Four pendente");
    },
    note: 587,
  },
  {
    key: "carentesco",
    title: "Carentesco",
    scoring: "1 ponto por carinho dado aos Pokémon",
    detail: (p) => scoreNumber.format(p.petsGiven) +
      (p.petsGiven === 1 ? " carinho" : " carinhos"),
    note: 659,
  },
  {
    key: "duelos",
    title: "Duelos entre treinadores",
    scoring: "5 pontos por vitória em duelo",
    detail: (p) => scoreNumber.format(p.wins ?? 0) +
      (p.wins === 1 ? " vitória" : " vitórias"),
    note: 784,
  },
  {
    key: "minigames",
    title: "Vitórias em minigames",
    scoring: "5 pontos por vitória em minigame",
    detail: (p) => scoreNumber.format(p.minigameWins) +
      (p.minigameWins === 1 ? " vitória" : " vitórias"),
    note: 880,
  },
];

async function renderFinalScoreboard(s) {
  const scene = $("finalScoreboard");
  if (!scene.hidden) return;
  const players = s.players.map((player) => ({
    player,
    total: scoreCategories.reduce((sum, { key }) => sum + player.points[key], 0),
  }));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const format = (value) => scoreNumber.format(value) + " pts";
  scene.innerHTML = '<div class="results-layout"><div class="results-heading">' +
    '<h1>Classificação final</h1><div class="results-current" aria-live="polite"></div></div>' +
    '<div class="results-grid">' + players.map(({ player }) =>
      '<article class="results-trainer"><header><span class="results-rank" hidden></span>' +
      trainerSprite(player.avatar, "results-avatar") + '<h2>' + esc(player.name) + '</h2>' +
      '<div class="results-total"><strong>0</strong><small>pts</small></div></header>' +
      '<div class="results-categories">' + scoreCategories.map(({ key, title }) =>
        '<div class="results-category" data-score="' + key + '" hidden>' +
        '<div class="results-row"><span>' + title + '</span><strong>0 pts</strong></div>' +
        '<div class="results-track" aria-hidden="true"><div></div></div>' +
        '<small hidden></small></div>',
      ).join("") + '</div></article>',
    ).join("") + '</div><footer class="results-footer" hidden>' +
    btn("Voltar ao lobby", "home", {}, "primary") + '</footer></div>';
  const grid = scene.querySelector(".results-grid");
  const stage = scene.querySelector(".results-current");
  players.forEach((entry, index) => {
    entry.card = grid.children[index];
    entry.displayed = 0;
    entry.totalLabel = entry.card.querySelector(".results-total strong");
  });
  scene.hidden = false;
  await wait(reduced ? 120 : 1050);

  for (const category of scoreCategories) {
    const { key, title, scoring, note } = category;
    stage.innerHTML = '<h2>' + title + '</h2><p>' + scoring + '</p>';
    const maximum = Math.max(1, ...players.map(({ player }) => player.points[key]));
    const active = players.map((entry) => {
      const row = entry.card.querySelector('[data-score="' + key + '"]');
      row.hidden = false;
      const details = row.querySelector("small");
      details.textContent = category.detail(entry.player);
      return {
        entry, row, details,
        value: entry.player.points[key],
        count: row.querySelector(".results-row strong"),
        fill: row.querySelector(".results-track div"),
      };
    });
    playNotes([[note, note * 1.5, .16], [note * 1.5, note * 1.5, .22]]);
    await wait(reduced ? 60 : 300);

    const fillBars = (progress) => {
      const eased = 1 - (1 - progress) ** 2;
      for (const { entry, value, count, fill } of active) {
        const current = Math.round(value * eased);
        count.textContent = format(current);
        fill.style.scale = (value * eased / maximum) + " 1";
        entry.totalLabel.textContent = scoreNumber.format(entry.displayed + current);
      }
    };
    if (reduced) fillBars(1);
    else await new Promise(resolve => {
      const start = performance.now();
      const frame = (now) => {
        const progress = Math.min(1, (now - start) / 1080);
        fillBars(progress);
        if (progress < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    for (const { entry, value, details } of active) {
      entry.displayed += value;
      details.hidden = false;
    }
    playNotes([[note * 2, note * 2, .17]]);
    await wait(reduced ? 80 : 530);
  }

  players.sort((a, b) => b.total - a.total);
  const best = players[0].total;
  const winners = players.filter(({ total }) => total === best);
  const names = new Intl.ListFormat("pt-BR").format(winners.map(({ player }) => player.name));
  stage.innerHTML = '<h2>' + (winners.length === 1 ? "Vencedor da expedição" : "Vitória compartilhada") +
    '</h2><p>' + esc(names) + ' · ' + format(best) + '</p>';
  let rank = 1;
  players.forEach(({ card, total }, index) => {
    if (index && players[index - 1].total !== total) rank = index + 1;
    const position = card.querySelector(".results-rank");
    position.textContent = rank + "º";
    position.hidden = false;
    card.classList.toggle("results-winner", total === best);
    grid.append(card);
  });
  scene.classList.add("results-complete");
  scene.querySelector(".results-footer").hidden = false;
  playNotes([[523, 523, .16], [659, 659, .16], [784, 784, .19], [1047, 1047, .48]]);
}
