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
  await Promise.all(["Bia", "Caio"].map(name => action({action:"join", code, name})));
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
  const previousOrigin = process.env.AURORA_RTC_ORIGIN;
  delete process.env.AURORA_RTC_ORIGIN;
  t.after(() => {
    if (previousOrigin === undefined) delete process.env.AURORA_RTC_ORIGIN;
    else process.env.AURORA_RTC_ORIGIN = previousOrigin;
  });
  assert.equal((await postOffer()).status, 503);
  process.env.AURORA_RTC_ORIGIN = "https://rtc.example.test";
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (url, options) => {
    if (String(url) !== "https://rtc.example.test/api") return realFetch(url, options);
    assert.deepEqual(JSON.parse(options.body), offer);
    return Promise.resolve(Response.json({answer:{type:"answer",sdp:"test-answer"}}));
  });
  assert.deepEqual(await (await postOffer()).json(), {answer:{type:"answer",sdp:"test-answer"}});
});
