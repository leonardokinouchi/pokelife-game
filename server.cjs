const { captureChance, captureGuide, encounterGuide } = require("./rules.cjs");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { randomInt, randomUUID } = require("node:crypto");
const { player, newRoom, view, command, advanceRace, advanceAuction, advancePractice, startMinigame, minigames } = require("./game.cjs");
const { advanceMillion } = require("./million.cjs");
const { advancePairGame } = require("./pair-minigames.cjs");
const { advanceArcade } = require("./arcade.cjs");
const { avatars, maxPlayers } = require("./public/world.js");
const rooms = new Map(),
  root = path.join(__dirname, "public");
const { serialize, deserialize } = require("node:v8");
const { BattleSession } = require("./battle.cjs");
const { createHash } = require("node:crypto");
const storage = path.join(process.env.LOCALAPPDATA || require("node:os").homedir(),
  "ExpedicaoAurora", createHash("sha256").update(__dirname).digest("hex").slice(0, 12),
  String(Number(process.env.PORT || 4173)));
const rtcCompanion = process.env.AURORA_RTC_COMPANION === "1";
const cloudRooms = Boolean(process.env.VERCEL || rtcCompanion);
if (!cloudRooms) fs.mkdirSync(storage, { recursive: true });
const savePath = code => path.join(storage, code + ".sav");

function pack(room) {
  const battleCopy = holder => holder?.battle
    ? { ...holder, battle: holder.battle.snapshot() } : holder;
  const saved = { ...room, players: room.players.map(p => ({ ...p, enc: battleCopy(p.enc) })),
    duels: room.duels.map(battleCopy) };
  return serialize(saved);
}
function saveRoom(room) {
  rooms.set(room.code, room);
  const file = savePath(room.code);
  fs.writeFileSync(file + ".tmp", pack(room));
  fs.renameSync(file + ".tmp", file);
}

function loadRoom(code) {
  if (typeof code !== "string") return;
  if (rooms.has(code)) return rooms.get(code);
  if (!/^(?:[A-Z2-9]{5}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(code)) return;
  if (!fs.existsSync(savePath(code))) return;
  const room = unpack(fs.readFileSync(savePath(code)));
  if (room.practiceExpires < Date.now()) {
    fs.rmSync(savePath(code), { force: true });
    return;
  }
  rooms.set(code, room);
  return room;
}
function unpack(buffer) {
  const room = deserialize(buffer);
  if (room.phase === "resumo") {
    room.phase = "trocas";
    for (const p of room.players) p.done = false;
  }
  if (room.phase === "lobby") {
    const reserved = new Set(room.players.map(p => p.avatar));
    const available = Object.keys(avatars).filter(avatar => !reserved.has(avatar));
    const assigned = new Set();
    for (const p of room.players) {
      if (!Object.hasOwn(avatars, p.avatar) || assigned.has(p.avatar)) {
        p.avatar = available.shift();
        p.ready = false;
      }
      assigned.add(p.avatar);
    }
  }
  // Return saves from the retired laboratory islets to their connected destinations.
  const retiredIslets = new Map([["lab1", "biome3"], ["lab2", "biome4"], ["lab3", "city5"], ["lab4", "city5"]]);
  for (const p of room.players) {
    p.loc = retiredIslets.get(p.loc) || p.loc;
    for (const step of p.travel || []) step.loc = retiredIslets.get(step.loc) || step.loc;
  }
  for (const holder of [...room.players.map(p => p.enc), ...room.duels])
    if (holder?.battle) holder.battle = BattleSession.restore(holder.battle);
  return room;
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};
function reply(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
function answer(status, value) { return { status, value }; }

function handleAction(d, roomCode, r, save, realtimeSession) {
  if (realtimeSession && (r?.phase !== "minigame" || r.round !== realtimeSession.round ||
      r.minigame !== realtimeSession.kind))
    return answer(409, {error:"Sessão em tempo real encerrada."});
  let p;
  if (d.action === "practice") {
    const kind = minigames.indexOf(d.kind);
    if (kind < 0) throw Error("Minigame inválido.");
    p = player("Você");
    const bot = player("Rival", "brasa");
    p.money = bot.money = 300;
    const code = roomCode;
    r = newRoom(code, p);
    r.players.push(bot);
    r.practiceBot = bot.id;
    r.practiceExpires = Date.now() + 30 * 60 * 1000;
    startMinigame(r, () => kind);
    command(r, bot, "miniReady");
    save(r);
    return answer(200, {code, token:p.token});
  }
  if (d.action === "create" || d.action === "join") {
    const name = String(d.name || "")
      .trim()
      .slice(0, 22);
    if (!name) throw Error("Digite seu nome.");
    if (d.action === "create") {
      p = player(name, d.avatar);
      r = newRoom(roomCode, p);
    } else {
      if (!r || r.phase !== "lobby") throw Error("Sala indisponível.");
      if (r.players.length >= maxPlayers) throw Error("Sala cheia. O limite é de 12 treinadores.");
      if (
        r.players.some((q) => q.name.toLowerCase() === name.toLowerCase())
      )
        throw Error("Nome já utilizado nesta sala.");
      const usedAvatars = new Set(r.players.map(q => q.avatar));
      const avatar = d.avatar ?? Object.keys(avatars).find(id => !usedAvatars.has(id));
      if (!Object.hasOwn(avatars, avatar)) throw Error("Personagem indisponível.");
      if (usedAvatars.has(avatar)) throw Error("Esse personagem já está em uso.");
      p = player(name, avatar);
      r.players.push(p);
    }
    save(r);
    return answer(200, { token: p.token, state: view(r, p) });
  }
  p = r?.players.find((x) => x.token === d.token);
  if (!p) return answer(403, { error: "Sessão expirada." });
  if (d.action === "leave" && r.phase === "lobby") {
    r.players = r.players.filter((q) => q !== p);
    if (r.players.length && r.host === p.id) r.host = r.players[0].id;
    if (r.players.length) save(r);
    else save(null);
    return answer(200, { left: true });
  }
  if (advanceRace(r) || advanceMillion(r) || advanceAuction(r) || advancePairGame(r) || advanceArcade(r)) save(r);
  let result;
  if (d.action !== "state") {
    result = command(r, p, d.action, d);
    save(r);
  }
  if (r.practiceBot) {
    const changed = advancePractice(r);
    if (changed || d.action !== "state") save(r);
  }
  return answer(200, { state: view(r, p), clock: Date.now(), ...result });
}

function newCode(action) {
  if (action === "practice") return randomUUID();
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

async function processRequest(d, realtimeSession) {
  const creating = d.action === "create" || d.action === "practice";
  if (!creating && (typeof d.code !== "string" || !/^(?:[A-Z2-9]{5}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(d.code)))
    return answer(403, { error: "Sessão expirada." });
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = creating ? newCode(d.action) : d.code;
    if (cloudRooms) {
      const { read, commit } = require("./cloud-rooms.cjs");
      const entry = await read(code);
      if (creating && entry) continue;
      let dirty = false, updated;
      const room = entry && unpack(entry.data);
      const result = handleAction(d, code, room, value => { dirty = true; updated = value; }, realtimeSession);
      if (!dirty || await commit(code, entry?.version || "", updated ? pack(updated) : null, updated?.practiceExpires))
        return result;
      continue;
    }
    const room = loadRoom(code);
    if (creating && room) continue;
    if (d.action === "practice") {
      for (const [code, room] of rooms)
        if (room.practiceExpires < Date.now()) {
          rooms.delete(code);
          fs.rmSync(savePath(code), { force: true });
        }
    }
    return handleAction(d, code, room, value => {
      if (value) saveRoom(value);
      else {
        rooms.delete(code);
        fs.rmSync(savePath(code), { force: true });
      }
    }, realtimeSession);
  }
  return answer(409, { error: "Sala ocupada. Tente a ação novamente." });
}

const realtime = require("./realtime.cjs").createRealtime(async code => {
  if (!cloudRooms) return loadRoom(code);
  if (!/^(?:[A-Z2-9]{5}|[a-f0-9-]{36})$/.test(code)) return null;
  const entry = await require("./cloud-rooms.cjs").read(code);
  return entry && unpack(entry.data);
}, processRequest);

async function relayRtcOffer(d) {
  const configured = process.env.AURORA_RTC_ORIGIN;
  if (!configured) return answer(503, {error:"Servidor WebRTC indisponível."});
  const origin = new URL(configured);
  if (origin.protocol !== "https:") return answer(503, {error:"O servidor WebRTC precisa usar HTTPS."});
  try {
    const response = await fetch(new URL("/api", origin), {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(d),
      redirect:"error",
      signal:AbortSignal.timeout(4500),
    });
    return answer(response.status, await response.json());
  } catch {
    return answer(503, {error:"Servidor WebRTC indisponível."});
  }
}

async function handleRequest(req, res) {
  try {
    const { pathname, searchParams } = new URL(req.url, "http://localhost");
    if (req.method === "GET" && pathname === "/api/guide/species")
      return reply(res, 200, captureGuide());
    if (req.method === "GET" && pathname === "/api/guide/encounters") {
      const biome = searchParams.get("biome"), period = searchParams.get("period");
      const level = Number(searchParams.get("level"));
      if (!["campo","floresta","caverna","praia","lago","neve","vulcao","cidade"].includes(biome) ||
          !["day","dusk","night"].includes(period) || !Number.isInteger(level) || level < 1 || level > 100)
        return reply(res, 400, {error:"Selecione um bioma, período e nível válidos."});
      return reply(res, 200, encounterGuide(biome, period, level));
    }
    if (req.method === "GET" && pathname === "/api/guide/capture") {
      const hp = Number(searchParams.get("hp")), maxhp = Number(searchParams.get("maxhp"));
      const status = searchParams.get("status"), id = Number(searchParams.get("id"));
      if (!Number.isSafeInteger(hp) || !Number.isSafeInteger(maxhp) ||
          hp < 1 || hp > maxhp || !["","slp","frz","par","brn","psn","tox"].includes(status))
        return reply(res, 400, {error:"Informe PV e condição válidos."});
      const balls = ["poke-ball", "great-ball", "ultra-ball", "master-ball"];
      return reply(res, 200, Object.fromEntries(balls.map(ball =>
        [ball, captureChance({pokemonId:id, hp, maxhp, status}, ball)])));
    }
    if (pathname === "/api") {
      if (
        req.method !== "POST" ||
        !req.headers["content-type"]?.startsWith("application/json")
      )
        return reply(res, 405, { error: "Use JSON." });
      let body = "";
      if (req.body === undefined) {
        for await (const part of req) {
          body += part;
          if (body.length > 160 * 1024) throw Error("Pedido muito grande.");
        }
      }
      const input = req.body ?? body;
      const d = typeof input === "string" || Buffer.isBuffer(input) ? JSON.parse(input) : input;
      if (rtcCompanion && d.action !== "rtcOffer") return reply(res, 404, {});
      if (d.action === "rtcOffer") {
        if (process.env.AURORA_DISABLE_RTC === "1")
          return reply(res, 503, {error:"Transporte em tempo real indisponível."});
        if (process.env.VERCEL) {
          const result = await relayRtcOffer(d);
          return reply(res, result.status, result.value);
        }
        return reply(res, 200, await realtime(d));
      }
      const result = await processRequest(d);
      return reply(res, result.status, result.value);
    }
    const file =
      pathname === "/phaser.js"
        ? require.resolve("phaser/dist/phaser.min.js")
        : path.resolve(
            root,
            "." +
              (pathname === "/" || pathname === "/test-minigames/play" ? "/index.html" :
              pathname === "/test-minigames" ? "/minigame-test.html" :
              pathname === "/guia" ? "/guide.html" : decodeURIComponent(pathname)),
          );
    if (pathname !== "/phaser.js" && !file.startsWith(root + path.sep))
      return reply(res, 404, {});
    if (!fs.existsSync(file) || !fs.statSync(file).isFile())
      return reply(res, 404, {});
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    reply(res, e.statusCode || 400, { error: e.message });
  }
}
const server = http.createServer(handleRequest);
if (require.main === module) {
  server.listen(Number(process.env.PORT || 4173), "0.0.0.0", () =>
    console.log(
      "Expedição Aurora em http://localhost:" + server.address().port,
    ),
  );
}
module.exports = server;

module.exports.handleRequest = handleRequest;
