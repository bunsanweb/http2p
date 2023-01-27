import * as fs from "node:fs";
// IPFS
import wrtc from "@koush/wrtc";
import * as IPFS from "ipfs-core";
import {sigServer} from "@libp2p/webrtc-star-signalling-server";
import {webRTCStar} from "@libp2p/webrtc-star";

import {createHttp2p} from "../http2p.js";

// cleanup repo dirs
const repo1 = "./.repos/test-repo1", repo2 = "./.repos/test-repo2";
fs.rmSync(repo1, {recursive: true, force: true});
fs.rmSync(repo2, {recursive: true, force: true});

// WebRTC star and config for IPFS nodes
const server = await sigServer({
  port: 9090,
  host: "0.0.0.0",
});
const config = {
  Addresses: {
    Swarm: [
      "/ip4/127.0.0.1/tcp/9090/ws/p2p-webrtc-star",
    ],
  },
  Discovery: {
    MDNS: {Enabled: true},
    webRTCStar: {Enabled: true},
  },  
};
const relay = {
  enabled: true,
  hop: {enabled: true},
};

// node1
const star1 = webRTCStar({wrtc});
const node1 = await IPFS.create({
  config, relay,
  repo: repo1,
  libp2p: {
    transports: [star1.transport],
    peerDiscovery: [star1.discovery],
  },
});
const id1 = await node1.id();
console.info("[node1 id]", id1.id.toJSON());
console.info("[node1 address]", id1.addresses[0].toJSON());

// node2
const star2 = webRTCStar({wrtc});
const node2 = await IPFS.create({
  config,
  repo: repo2,
  libp2p: {
    transports: [star2.transport],
    peerDiscovery: [star2.discovery],
  },
});
const id2 = await node2.id();
console.log("[node2 id]", id2.id.toJSON());
console.log("[node2 address]", id2.addresses[0].toJSON());

//NOTE: swarm connect node2 to node1
await node2.swarm.connect(id1.addresses[0]);

// http2p example
const node1Http2p = await createHttp2p(node1.libp2p);
const node2Http2p = await createHttp2p(node2.libp2p);
// server1
node1Http2p.scope.addEventListener("fetch", ev => {
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

// fetch2
const url = `http2p:${id1.id.toJSON()}/`;
const response = await node2Http2p.fetch(url);
console.log(response);
console.log(await response.text());
//for await (const u8 of response.body) console.log(new TextDecoder().decode(u8));

await node1.stop();
await node2.stop();
await server.stop();
if (globalThis.process) process.exit(0);
