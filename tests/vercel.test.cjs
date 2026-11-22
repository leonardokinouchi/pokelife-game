const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

test("concurrent joins keep both trainers in the cloud room", async t => {
  // Simulate two function invocations reading the same Redis revision.
  const records = new Map();
  const expirations = new Map();
  let heldRead, synchronize = false, conflicts = 0;
  const redis = http.createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const [op, ...args] = JSON.parse(body);
    let result;
    if (op === "GET") {
      result = records.get(args[0]) ?? null;
      if (synchronize) {
        if (!heldRead) await new Promise(resolve => { heldRead = resolve; });
        else { synchronize = false; heldRead(); }
      }
    } else {
      assert.equal(op, "EVAL");
      const [, , key, expected, value, ttl] = args;
      result = Number((records.get(key) || "").slice(0, 36) === expected);
      if (!result) conflicts++;
      else if (value) {
        records.set(key, value);
        expirations.set(key, ttl);
      }
      else records.delete(key);
    }
    res.end(JSON.stringify({result}));
  });
  await new Promise(resolve => redis.listen(0, "127.0.0.1", resolve));
  t.after(() => redis.close());
  process.env.VERCEL = "1";
  process.env.UPSTASH_REDIS_REST_URL = "http://127.0.0.1:" + redis.address().port;
  process.env.UPSTASH_REDIS_REST_TOKEN = "test";
  const server = http.createServer(require("../api/game.js"));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  async function action(payload) {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/game", {
      method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload),
    });
    assert.equal(response.status, 200);
    return response.json();
  }
  const host = await action({action:"create", name:"Ana"});
  const code = host.state.code;
  synchronize = true;
  const [guest, other] = await Promise.all(["Bia", "Caio"].map(name => action({action:"join", code, name})));
  const {state} = await action({action:"state", code, token:host.token});
  assert.deepEqual(state.players.map(p => p.name).sort(), ["Ana", "Bia", "Caio"]);
  assert.equal(conflicts, 1);
  const prefix = "expedicao:" + (process.env.VERCEL_ENV || "development") + ":";
  assert.equal(expirations.get(prefix + code), "");
  const practice = await action({action:"practice", kind:"magnetic"});
  const training = await action({action:"miniReady", ...practice});
  assert.equal(training.state.minigame, "magnetic");
  assert.ok(training.state.arcade.start);
  const ttl = Number(expirations.get(prefix + practice.code));
  assert.ok(ttl > 0 && ttl <= 30 * 60 * 1000);
  const offer = {action:"rtcOffer", ...practice, kind:"magnetic", round:1, offer:{type:"offer",sdp:"test"}};
  const apiUrl = "http://127.0.0.1:" + server.address().port + "/api/game";
  const postOffer = () => fetch(apiUrl, {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(offer),
  });
  assert.equal((await postOffer()).status, 410);
  const {serialize, deserialize} = require("node:v8");
  const entry = records.get(prefix + code);
  const room = deserialize(Buffer.from(entry.slice(36), "base64"));
  const {startMinigame, eligibleMinigames} = require("../game.cjs");
  for (const kind of ["market", "elements", "claim"]) {
    assert.ok(!eligibleMinigames(2).includes(kind));
    const response = await fetch(apiUrl, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action:"practice", kind}),
    });
    assert.equal(response.status, 400);
  }
  startMinigame(room, "magnetic");
  records.set(prefix + code, entry.slice(0,36) + serialize(room).toString("base64"));
  const signal = (token, data = {}) => action({action:"peerSignal", code, token, round:room.round, kind:"magnetic", ...data});
  const nonce = "ab".repeat(12);
  const guestOffer = {type:"offer", sdp:"guest-offer"};
  await signal(guest.token, {nonce, description:guestOffer});
  const {links} = await signal(host.token);
  const guestId = guest.state.you.id;
  assert.deepEqual(links[guestId], {nonce, offer:guestOffer});
  assert.deepEqual(await signal(other.token), {link:null});
  const description = {type:"answer", sdp:"host-answer"};
  await signal(host.token, {target:guestId, nonce, description});
  assert.deepEqual((await signal(guest.token)).link.answer, description);

  const testHost = await action({action:"create", name:"Lia", testLobby:true});
  const testCode = testHost.state.code;
  const testGuest = await action({action:"join", code:testCode, name:"Noa", testLobby:true});
  const inTestRoom = (user, kind, data = {}) =>
    action({action:kind, code:testCode, token:user.token, ...data});
  for (const user of [testHost, testGuest]) await inTestRoom(user, "ready");
  const started = await inTestRoom(testHost, "start", {kind:"guess"});
  assert.equal(started.state.phase, "minigame");
  assert.equal(started.state.minigame, "guess");
  for (const user of [testHost, testGuest]) await inTestRoom(user, "miniReady");
  const hostView = (await inTestRoom(testHost, "state")).state;
  const guestView = (await inTestRoom(testGuest, "state")).state;
  assert.notEqual(hostView.pairGame.guide, guestView.pairGame.guide);
  const runner = hostView.pairGame.guide ? testGuest : testHost;
  const snapshot = deserialize(Buffer.from(records.get(prefix + testCode).slice(36), "base64"));
  await inTestRoom(runner, "pairGuess", {name:snapshot.pairGame.teams[0].answer});
  await inTestRoom(testHost, "pairContinue");
  assert.equal((await inTestRoom(testGuest, "pairContinue")).state.phase, "final");
  const reopened = await inTestRoom(testHost, "reopenTestLobby");
  assert.equal(reopened.state.phase, "lobby");
  assert.equal(reopened.state.code, testCode);
  assert.ok(reopened.state.players.every(p => !p.ready));
  assert.equal((await inTestRoom(testGuest, "state")).state.phase, "lobby");
});
