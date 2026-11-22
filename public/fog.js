const fogDirections = {
  up:[0,-1,3], right:[1,0,2], down:[0,1,0], left:[-1,0,1],
};
const fogKeys = {
  ArrowUp:"up", w:"up", ArrowRight:"right", d:"right",
  ArrowDown:"down", s:"down", ArrowLeft:"left", a:"left",
};
const fogHeldKeys = new Set();
const fogSpeed = 3.2;

function renderFog() {
  return '<section id="fogStage" class="fog-stage"><div class="fog-hud"><strong></strong><span></span>' +
    '<output aria-live="off"></output></div><div class="fog-board" role="region" aria-label="Arena com névoa">' +
    '<div class="fog-units"></div><div class="fog-mist" aria-hidden="true"></div></div></section>';
}

document.addEventListener("keydown", event => {
  if (state?.phase !== "minigame" || state.minigame !== "fog" || !document.querySelector("#fogStage") ||
      event.ctrlKey || event.altKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  const canonical = event.key.startsWith("Arrow") ? event.key : key;
  if (!Object.hasOwn(fogKeys, canonical)) return;
  event.preventDefault();
  fogHeldKeys.add(canonical);
});
document.addEventListener("keyup", event => {
  fogHeldKeys.delete(event.key.startsWith("Arrow") ? event.key : event.key.toLowerCase());
});
window.addEventListener("blur", () => fogHeldKeys.clear());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) fogHeldKeys.clear();
});

function fogBeamSound() {
  if (muted || audio?.state !== "running") return;
  const start = audio.currentTime;
  const filter = audio.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(3100, start);
  filter.frequency.exponentialRampToValueAtTime(170, start + .66);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(.0001, start);
  gain.gain.exponentialRampToValueAtTime(.11, start + .035);
  gain.gain.exponentialRampToValueAtTime(.0001, start + .72);
  filter.connect(gain).connect(audio.destination);
  for (const [type, from, to] of [["sawtooth", 580, 78], ["triangle", 126, 38]]) {
    const oscillator = audio.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, start + .68);
    oscillator.connect(filter);
    oscillator.start(start);
    oscillator.stop(start + .73);
  }
}

function animateFog(stage) {
  const board = stage.querySelector(".fog-board");
  const units = stage.querySelector(".fog-units");
  const [round, remaining, clock] = stage.querySelector(".fog-hud").children;
  const figures = new Map();
  let fired = false, lastTick, expired, activeRound, nextInputAt = 0;
  function frame() {
    const game = state?.arcade;
    if (!stage.isConnected || state.minigame !== "fog" || !game || game.results) {
      fogHeldKeys.clear();
      return;
    }
    const now = Date.now() + serverOffset;
    const revealed = !!game.reveal;
    const ready = !revealed && now >= game.start && now < game.deadline && game.you.alive;
    const seconds = Math.max(0, Math.ceil((game.deadline - now) / 1000));
    if (activeRound !== game.round) {
      activeRound = game.round;
      lastTick = null;
      expired = false;
    }
    if (!revealed && now >= game.start && now < game.deadline && seconds <= 3 && seconds !== lastTick) {
      playNotes([[seconds % 2 ? 850 : 630, 420, .065]]);
      lastTick = seconds;
    }
    if (!expired && now >= game.deadline) {
      playNotes([[770, 770, .13], [1050, 1050, .2]]);
      expired = true;
    }
    const direction = fogKeys[[...fogHeldKeys].at(-1)] ?? null;
    if (ready && direction !== game.you.motion && !busy && now >= nextInputAt) {
      nextInputAt = now + 90;
      act("fogMove", {direction, round:game.round});
    }
    board.dataset.revealed = revealed;
    board.dataset.clearing = now >= game.deadline;
    board.style.setProperty("--fog-scale", (56 + 44 * game.size / 13) + "%");
    round.textContent = "Disparo " + (game.round + 1);
    remaining.textContent = game.remaining + (game.remaining === 1 ? " sobrevivente" : " sobreviventes");
    clock.textContent = revealed ? "Hiper-raio!" : !game.you.alive ? "Eliminado" :
      now < game.start ? "Prepare-se · " + Math.ceil((game.start - now) / 1000) :
        seconds + " s";
    if (revealed && !fired) setTimeout(() => { if (stage.isConnected) fogBeamSound(); }, 360);
    fired = revealed;
    const visible = revealed ? game.reveal : game.you.alive ? [{id:state.you.id, ...game.you}] : [];
    const ids = new Set(visible.map(p => p.id));
    for (const [id, node] of figures)
      if (!ids.has(id)) { node.remove(); figures.delete(id); }
    for (const p of visible) {
      let node = figures.get(p.id);
      if (!node) {
        node = document.createElement("div");
        node.className = "fog-dragon";
        node.innerHTML = '<i class="fog-aim" aria-hidden="true"></i><i class="fog-sprite" aria-hidden="true"></i><b></b>';
        figures.set(p.id, node);
        units.append(node);
      }
      const [dx,dy,row] = fogDirections[p.direction] || fogDirections.down;
      const [vx,vy] = fogDirections[p.motion] || [0,0];
      const travel = Math.max(0, Math.min(now, game.deadline) - (p.motionAt ?? now)) * fogSpeed / 1000;
      const bound = value => Math.max(.35, Math.min(game.size - .35, value)) / game.size;
      const x = bound(p.x + vx * travel), y = bound(p.y + vy * travel);
      const limitX = dx > 0 ? 1 - x : dx < 0 ? x : Infinity;
      const limitY = dy > 0 ? 1 - y : dy < 0 ? y : Infinity;
      node.style.left = x * 100 + "%";
      node.style.top = y * 100 + "%";
      node.style.setProperty("--fog-row", row);
      node.style.setProperty("--aim-angle", Math.atan2(dy,dx) + "rad");
      node.style.setProperty("--beam-length", Math.min(limitX, limitY) * Math.hypot(dx,dy) * 100 + "%");
      node.dataset.hit = !!p.hit;
      node.dataset.self = p.id === state.you.id;
      node.querySelector("b").textContent = p.id === state.you.id ? "Você" :
        state.players.find(player => player.id === p.id)?.name || "";
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
