const {randomInt} = require("node:crypto");

const directions = {
  up:[0,-1], right:[1,0], down:[0,1], left:[-1,0],
};
const positionTime = 10000;
const revealTime = 2200;
const speed = 3.2;
const margin = .35;

function bound(value, size) {
  return Math.max(margin, Math.min(size - margin, value));
}

function positionAt(game, player, now) {
  const [dx, dy] = directions[player.motion] || [0, 0];
  const distance = Math.max(0, Math.min(now, game.deadline) - (player.motionAt ?? now)) * speed / 1000;
  return {
    x:bound(player.x + dx * distance, game.size),
    y:bound(player.y + dy * distance, game.size),
  };
}

function initFog(game) {
  game.size = 13;
  const cells = Array.from({length:game.size ** 2}, (_, index) => index);
  for (const player of Object.values(game.players)) {
    const cell = cells.splice(randomInt(cells.length), 1)[0];
    Object.assign(player, {x:cell % game.size + .5, y:Math.floor(cell / game.size) + .5,
      direction:"down", motion:null, motionAt:null, survived:0});
  }
}

function beginFog(game, now) {
  game.start = now + 2400;
  game.deadline = game.start + positionTime;
}

function moveFog(game, player, data, now) {
  if (!player.alive || data.round !== game.round ||
      (data.direction !== null && !Object.hasOwn(directions, data.direction)))
    throw Error("Movimento indisponível.");
  Object.assign(player, positionAt(game, player, now), {motion:data.direction, motionAt:now});
  if (data.direction) player.direction = data.direction;
}

function firesAt(shooter, target) {
  const [dx, dy] = directions[shooter.direction] || directions.down;
  const x = target.x - shooter.x, y = target.y - shooter.y;
  return Math.hypot(x, y) <= margin || (x * dx + y * dy > 0 && Math.abs(x * dy - y * dx) <= margin);
}

function advanceFog(room, now) {
  const game = room.arcade;
  const entries = Object.entries(game.players);
  if (game.revealUntil !== null) {
    if (now < game.revealUntil) return false;
    const survivors = entries.filter(([, p]) => p.alive);
    if (survivors.length <= 1) {
      const best = Math.max(...entries.map(([, p]) => p.survived));
      game.results = entries.sort(([, a], [, b]) => b.survived - a.survived).map(([id, p]) => ({
        id, score:p.survived, won:p.survived === best,
      }));
      for (const {id, won} of game.results)
        if (won) {
          const player = room.players.find(p => p.id === id);
          player.minigameWins = (player.minigameWins ?? 0) + 1;
        }
    } else {
      const nextSize = 1.4 + (game.size - 1.4) * .79;
      const inset = (game.size - nextSize) / 2;
      game.size = nextSize;
      for (const [, p] of survivors) {
        p.x = bound(p.x - inset, nextSize);
        p.y = bound(p.y - inset, nextSize);
      }
      game.round++;
      game.reveal = game.revealUntil = null;
      game.start = now + 1200;
      game.deadline = game.start + positionTime;
    }
    return true;
  }
  const bot = game.players[room.practiceBot];
  if (bot?.alive && now >= game.start && now < game.deadline &&
      (bot.motionAt == null || now - bot.motionAt >= 650)) {
    const keys = Object.keys(directions);
    moveFog(game, bot, {round:game.round, direction:keys[randomInt(keys.length)]}, now);
    return true;
  }
  if (now < game.deadline) return false;
  const shooters = entries.filter(([, p]) => p.alive);
  for (const [, p] of shooters)
    Object.assign(p, positionAt(game, p, game.deadline), {motion:null, motionAt:null});
  const defeated = new Set(shooters.filter(([id, target]) =>
    shooters.some(([other, shooter]) => other !== id && firesAt(shooter, target))).map(([id]) => id));
  game.reveal = shooters.map(([id, p]) => ({
    id, x:p.x, y:p.y, direction:p.direction, hit:defeated.has(id),
  }));
  for (const [id, p] of shooters) {
    p.alive = !defeated.has(id);
    if (p.alive) p.survived++;
  }
  game.revealUntil = now + revealTime;
  return true;
}

function fogView(game, you) {
  const self = game.players[you];
  return {
    size:game.size, start:game.start, deadline:game.deadline, round:game.round,
    reveal:game.reveal, revealUntil:game.revealUntil, results:game.results,
    you:{...positionAt(game, self, self.motionAt ?? game.start), motion:self.motion ?? null,
      motionAt:self.motionAt ?? game.start, direction:directions[self.direction] ? self.direction : "down", alive:self.alive},
    remaining:Object.values(game.players).filter(p => p.alive).length,
  };
}

module.exports = {initFog, beginFog, moveFog, advanceFog, fogView};
