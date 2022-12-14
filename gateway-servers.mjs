import * as fs from "node:fs";
import * as http from "node:http";
// IPFS
import wrtc from "@koush/wrtc";
import {sigServer} from "@libp2p/webrtc-star-signalling-server";
import {webRTCStar} from "@libp2p/webrtc-star";
import {createLibp2p} from "libp2p";
import {mplex} from "@libp2p/mplex";
import {tcp} from "@libp2p/tcp";
import {createEd25519PeerId, exportToProtobuf, createFromProtobuf} from "@libp2p/peer-id-factory";
import {noise} from "@chainsafe/libp2p-noise";
import {yamux} from "@chainsafe/libp2p-yamux";
import {gossipsub} from "@chainsafe/libp2p-gossipsub";

import {createHttp2p} from "./http2p.js";
import {createListener} from "./gateway-http2p.js";

// WebRTC star and config for IPFS nodes
const sigServerPort = 9090;
const aSigServer = await sigServer({
  port: sigServerPort,
  host: "0.0.0.0",
});
const sigServerAddr = `/ip4/127.0.0.1/tcp/${sigServerPort}/ws/p2p-webrtc-star`;
console.log("[libp2p webrtc signalling server]", sigServerAddr);

// node for gateway
// TBD: load/store peerId
const idFile = "./.gateway-peer-id.json";
let peerId;
if (fs.existsSync(idFile)) {
  const u8a = fs.readFileSync(idFile);
  peerId = await createFromProtobuf(u8a);
} else {
  peerId = await createEd25519PeerId();
  const u8a = exportToProtobuf(peerId);
  fs.writeFileSync(idFile, u8a);
}

const starGateway = webRTCStar({wrtc});
const libp2pGateway = await createLibp2p({
  peerId,
  addresses: {
    listen: [
      "/ip4/0.0.0.0/tcp/0",
      sigServerAddr,
    ],
  },
  transports: [tcp(), starGateway.transport],
  peerDiscovery: [starGateway.discovery],
  streamMuxers: [yamux(), mplex()],
  pubsub: gossipsub({allowPublishToZeroPeers: true}),
  connectionEncryption: [noise()], // must required
  relay: {
    enabled: true,
    hop: {
      enabled: true,
      active: true,
    },
  }
});
await libp2pGateway.start();
console.info("[gateway id]", libp2pGateway.peerId.toJSON());
const gatewayAddrs = libp2pGateway.getMultiaddrs();
console.info("[gateway address 0]", gatewayAddrs[0].toJSON()); // tcp: localhost
console.info("[gateway address 1]", gatewayAddrs[1].toJSON()); // tcp: ip address
console.info("[gateway address 2]", gatewayAddrs[2].toJSON()); // webRTCStar


// http server for gateway
const gatewayHttp2p = await createHttp2p(libp2pGateway);
const gatewayListener = createListener(gatewayHttp2p);
const server = http.createServer(gatewayListener);
const port = 8000;
server.listen(port);
console.log("[http2p gateway server] base URL", `http://localhost:${port}/`);
