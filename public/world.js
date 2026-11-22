(function (root) {
  const leagueIsland = "league1";
  const leaguePorts = ["city3", "city4"];
  const hasLeagueAccess = (player) => player.badges.length >= 8;
  const laboratoryLocations = new Set(["village3", "village4", "village6"]);
  const hasLaboratory = (id) => laboratoryLocations.has(id);
  const routes = [
    ...leaguePorts.map(port => [port, leagueIsland]),
    ["village1", "city1", "biome1", "city2", "biome5", "city3"],
    ["village1", "biome4", "city6", "city7", "village6", "city8"],
    ["city1", "biome3", "village2", "biome2", "biome5"],
    ["biome3", "biome1", "village3", "city6", "biome8", "village5"],
    ["city2", "village3", "city3", "village5", "city7", "biome7", "city8"],
    ["city3", "city4", "village4", "biome6", "city5", "village4"],
    ["city4", "village5", "city6"],
    ["city5", "city7", "village6", "biome7"],
    ["biome2", "city2"],
  ];
  const edges = routes.flatMap((route) =>
    route.slice(1).map((to, index) => [route[index], to]),
  );
  const neighbors = (id) => edges.flatMap(([a, b]) =>
    a === id ? [b] : b === id ? [a] : [],
  );
  function routeBetween(from, to) {
    if (from === to) return null;
    const paths = new Map([[from, []]]);
    const queue = [from];
    for (const current of queue) {
      for (const next of neighbors(current)) {
        if (paths.has(next) || (next === leagueIsland && next !== to)) continue;
        const path = [...paths.get(current), next];
        if (next === to) return path;
        paths.set(next, path);
        queue.push(next);
      }
    }
    return null;
  }
  const avatars = {
    mar: "Mar", brasa: "Brasa", cedro: "Cedro", geada: "Geada",
    jade: "Jade", aurora: "Aurora", areia: "Areia", noite: "Noite", vento: "Vento",
    sol: "Sol", chama: "Chama", pedra: "Pedra",
  };
  const maxPlayers = 12;
  const validPlayerCount = (count) => count >= 2 && count <= maxPlayers && count % 2 === 0;
  const actionPeriod = actions => actions >= 6 ? "day" : actions >= 4 ? "dusk" : "night";
  const world = { actionPeriod, edges, neighbors, routeBetween, avatars, maxPlayers, validPlayerCount, leagueIsland, leaguePorts, hasLeagueAccess, hasLaboratory };
  if (typeof module === "object" && module.exports) module.exports = world;
  else root.ExpeditionWorld = world;
})(globalThis);
