import * as fs from "node:fs";
import * as http from "node:http";
// IPFS
import wrtc from "@koush/wrtc";
import * as IPFS from "ipfs-core";
import {sigServer} from "@libp2p/webrtc-star-signalling-server";
import {webRTCStar} from "@libp2p/webrtc-star";
import {createLibp2p} from "libp2p";
import {mplex} from "@libp2p/mplex";
import {tcp} from "@libp2p/tcp";
import {noise} from "@chainsafe/libp2p-noise";
import {yamux} from "@chainsafe/libp2p-yamux";
import {gossipsub} from "@chainsafe/libp2p-gossipsub";

import {createHttp2p} from "../http2p.js";
import {createListener} from "../gateway-http2p.js";

// cleanup repo dirs
const repoGateway = "./.repos/test-repo-gateway", repoServer = "./.repos/test-repo-server";
fs.rmSync(repoGateway, {recursive: true, force: true});
fs.rmSync(repoServer, {recursive: true, force: true});

// WebRTC star and config for IPFS nodes
const aSigServer = await sigServer({
  port: 9090,
  host: "0.0.0.0",
});
const configGateway = {
  Addresses: {
    Swarm: [
      "/ip4/0.0.0.0/tcp/0",
      "/ip4/127.0.0.1/tcp/9090/ws/p2p-webrtc-star",
    ],
  },
  Discovery: {
    MDNS: {Enabled: true},
    webRTCStar: {Enabled: true},
    streamNuxers: [yamux()],
  },
  Bootstrap: [],
};
const relay = {
  enabled: true,
  hop: {enabled: true},
};

// node for gateway
const starGateway = webRTCStar({wrtc});
/*
const nodeGateway = await IPFS.create({
  config: configGateway, relay,
  repo: repoGateway,
  libp2p: {
    transports: [starGateway.transport],
    peerDiscovery: [starGateway.discovery],
    streamMuxers: [yamux()],
    pubsub: gossipsub({allowPublishToZeroPeers: true}),
    connectionEncryption: [noise()],
  },
});
const idGateway = await nodeGateway.id();
console.info("[node gateway id]", idGateway.id.toJSON());
console.info("[node gateway address 0]", idGateway.addresses[0].toJSON()); // tcp: localhost
console.info("[node gateway address 1]", idGateway.addresses[1].toJSON()); // webRTCStar
console.info("[node gateway address 2]", idGateway.addresses[2].toJSON()); // tcp: ip address
*/
const libp2pGateway = await createLibp2p({
  addresses: {
    listen: [
      "/ip4/0.0.0.0/tcp/0",
      "/ip4/127.0.0.1/tcp/9090/ws/p2p-webrtc-star",
    ],
  },
  transports: [tcp(), starGateway.transport],
  peerDiscovery: [starGateway.discovery],
  streamMuxers: [yamux()],
  //streamMuxers: [mplex({maxInboundStreams: 256, maxOutboundStreams: 1024})],
  //streamMuxers: [mplex({maxInboundStreams: 256, maxOutboundStreams: 1024}), yamux()],
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

// simple http2p server
const configServer = {
  Addresses: {
    Swarm: [
      "/ip4/0.0.0.0/tcp/0",
    ],
  },
  Bootstrap: [],
};
const nodeServer = await IPFS.create({
  config: configServer, relay,
  repo: repoServer,
  libp2p: {
    streamMuxers: [yamux()],
    pubsub: gossipsub({allowPublishToZeroPeers: true}),
    connectionEncryption: [noise()],
  },
});
const idServer = await nodeServer.id();
console.info("[node server id]", idServer.id.toJSON());
console.info("[node server address]", idServer.addresses[0].toJSON());
const serverHttp2p = await createHttp2p(nodeServer.libp2p);
serverHttp2p.scope.addEventListener("fetch", ev => {
  console.log(ev.request);
  ev.respondWith(new Response(
    "Hello World",
    {
      headers: {
        "content-type": "text/plain;charset=utf-8",
      },
    }
  ));
});

// connect to gateway
await nodeServer.bootstrap.add(gatewayAddrs[0].toJSON()); //TBD add gateway address in bootstrap list
const keepSwarmConnect = async (node, address, id) => {
  const peers = await node.swarm.peers();
  if (!peers.some(peer => peer.peer.toJSON() === id)) {
    console.log("[swarm.peers]", peers.length);
    for (const peer of peers) console.log("- [addr]", peer.addr.toJSON());
    console.log("[reconnect]", await nodeServer.swarm.connect(address));    
  }
  setTimeout(() => keepSwarmConnect(node, address, id), 1000);
};
await keepSwarmConnect(nodeServer, gatewayAddrs[0].toJSON(), libp2pGateway.peerId.toJSON());

const url = `http://localhost:${port}/${idServer.id.toJSON()}/`;
console.log(`[access via browser] ${url}`);

console.log("[fetch]", await (await fetch(url)).text());

if (false) {
  await nodeGateway.stop();
  await nodeServer.stop();
  await aSigServer.stop();
}
