const { randomUUID } = require("node:crypto");

const compareAndSave = `
local current = redis.call('GET', KEYS[1])
if (current and string.sub(current, 1, 36) or '') ~= ARGV[1] then return 0 end
if ARGV[2] == '' then redis.call('DEL', KEYS[1])
elseif ARGV[3] ~= '' then redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
else redis.call('SET', KEYS[1], ARGV[2]) end
return 1`;

async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  const unavailable = message => Object.assign(new Error(message), { statusCode: 503 });
  if (!url || !token) throw unavailable("Configure o banco de salas no projeto Vercel.");
  try {
    const response = await fetch(url, {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(command), signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    if (!response.ok || data.error) throw Error();
    return data.result;
  } catch {
    throw unavailable("Banco de salas indisponível. Tente novamente em instantes.");
  }
}

function key(code) {
  return `expedicao:${process.env.VERCEL_ENV || "development"}:${code}`;
}

async function read(code) {
  const value = await redis(["GET", key(code)]);
  return value && { version: value.slice(0, 36), data: Buffer.from(value.slice(36), "base64") };
}

async function commit(code, version, buffer, expiresAt) {
  const next = buffer ? randomUUID() + buffer.toString("base64") : "";
  const ttl = expiresAt == null ? "" : String(Math.max(1, expiresAt - Date.now()));
  return (await redis(["EVAL", compareAndSave, 1, key(code), version, next, ttl])) === 1;
}

module.exports = { read, commit };
