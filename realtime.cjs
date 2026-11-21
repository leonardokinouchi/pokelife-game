const allowed = {
  magnetic: "arcadeMove", race: "dodge", rhythm: "arcadeTap", sorter: "arcadeTap",
};

function gather(peer) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise(resolve => {
    function done() {
      clearTimeout(timer);
      peer.removeEventListener("icegatheringstatechange", changed);
      resolve();
    }
    function changed() {
      if (peer.iceGatheringState === "complete") done();
    }
    const timer = setTimeout(done, 2200);
    peer.addEventListener("icegatheringstatechange", changed);
  });
}

function createRealtime(loadRoom, dispatch) {
  const peers = new Map();
  async function authorize(code, token, round, kind) {
    const room = await loadRoom(code);
    return room?.phase === "minigame" && room.round === round && room.minigame === kind &&
      room.players.some(p => p.token === token);
  }

  return async ({code, token, round, kind, offer}) => {
    if (typeof code !== "string" || typeof token !== "string" || !Object.hasOwn(allowed, kind) ||
        offer?.type !== "offer" || typeof offer.sdp !== "string" || !await authorize(code, token, round, kind))
      throw Error("Sessão em tempo real indisponível.");
    const {RTCPeerConnection} = require("@roamhq/wrtc");
    const iceServers = JSON.parse(process.env.AURORA_ICE_SERVERS || "[]");
    const peer = new RTCPeerConnection({iceServers});
    const key = code + ":" + token;
    peers.get(key)?.();
    const deadline = setTimeout(() => close(), 120000);
    deadline.unref();
    function close() {
      clearTimeout(deadline);
      if (peers.get(key) === close) peers.delete(key);
      peer.close();
    }
    peers.set(key, close);
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed" || peer.connectionState === "closed") close();
    };
    peer.ondatachannel = ({channel}) => {
      if (channel.label !== "aurora") { channel.close(); return; }
      channel.onclose = close;
      let lastState = 0;
      let queue = Promise.resolve();
      channel.onmessage = async ({data}) => {
        if (typeof data !== "string" || data.length > 1024 || channel.bufferedAmount > 256000) return;
        let packet;
        try {
          packet = JSON.parse(data);
          const {id, action, direction, pose, lane} = packet;
          if (!Number.isSafeInteger(id) || (action !== "state" && action !== allowed[kind])) return;
          const now = Date.now();
          if (action === "state" && now - lastState < 45) {
            channel.send(JSON.stringify({id}));
            return;
          }
          if (action === "state") lastState = now;
          const task = queue.then(() => channel.readyState === "open" &&
            dispatch({code, token, action, direction, pose, lane}, {round, kind}));
          queue = task.catch(() => {});
          const result = await task;
          if (!result) return;
          if (channel.readyState === "open") channel.send(JSON.stringify({id, ...result.value}));
        } catch (error) {
          if (channel.readyState === "open" && packet?.id)
            channel.send(JSON.stringify({id:packet.id, error:error.message}));
        }
      };
    };
    try {
      await peer.setRemoteDescription(offer);
      await peer.setLocalDescription(await peer.createAnswer());
      await gather(peer);
      return {answer:peer.localDescription};
    } catch (error) {
      close();
      throw error;
    }
  };
}

module.exports = {createRealtime};
