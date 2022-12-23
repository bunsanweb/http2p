#!/usr/bin/env node
import * as fs from "node:fs";
// IPFS
import * as IPFS from "ipfs-core";
// WebRTCStar
import wrtc from "@koush/wrtc";
import {sigServer} from "@libp2p/webrtc-star-signalling-server";
import {webRTCStar} from "@libp2p/webrtc-star";
// pubsub peerDiscovery
import {pubsubPeerDiscovery} from "@libp2p/pubsub-peer-discovery";
import {gossipsub} from "@chainsafe/libp2p-gossipsub";
import {noise} from "@chainsafe/libp2p-noise";
import {yamux} from "@chainsafe/libp2p-yamux";

import {createHttp2p} from "../http2p.js";

// cleanup repo dirs
const repo1 = "./.repos/test-repo1", repo2 = "./.repos/test-repo2", repo3 = "./.repos/test-repo3", repo4 = "./.repos/test-repo4";
fs.rmSync(repo1, {recursive: true, force: true});
fs.rmSync(repo2, {recursive: true, force: true});
fs.rmSync(repo3, {recursive: true, force: true});
fs.rmSync(repo4, {recursive: true, force: true});

// WebRTC star and config for IPFS nodes
const server = await sigServer({
  port: 9090,
  host: "0.0.0.0",
});
const config1 = { // webrtc only
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
const config2 = { // tcp only
  Addresses: {
    Swarm: [
      "/ip4/0.0.0.0/tcp/0",
    ],
  },
};
const config3 = { // relay 
  Addresses: {
    Swarm: [
      "/ip4/0.0.0.0/tcp/0",
      "/ip4/127.0.0.1/tcp/9090/ws/p2p-webrtc-star",
    ],
  },
  Discovery: {
    MDNS: {Enabled: true},
    webRTCStar: {Enabled: true},
  },
};
const config4 = { // webrtc only
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


// node1: webRTCStar
const star1 = webRTCStar({wrtc});
const node1 = await IPFS.create({
  repo: repo1,
  config: config1, 
  libp2p: {
    transports: [star1.transport],
    peerDiscovery: [
      star1.discovery,
      pubsubPeerDiscovery(),
    ],
    pubsub: gossipsub({allowPublishToZeroPeers: true}),
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
  },
});
const id1 = await node1.id();
console.info("[node1 id]", id1.id.toJSON());
console.info("[node1 address]", id1.addresses[0].toJSON());

// node2: TCP
const node2 = await IPFS.create({
  repo: repo2,
  config: config2,
  libp2p: {
    peerDiscovery: [
      pubsubPeerDiscovery(),
    ],
    pubsub: gossipsub({allowPublishToZeroPeers: true}),
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
  },
});
const id2 = await node2.id();
console.log("[node2 id]", id2.id.toJSON());
console.log("[node2 address]", id2.addresses[0].toJSON());

// node3 as relay node: TCP + webRTCStar
const star3 = webRTCStar({wrtc});
const node3 = await IPFS.create({
  repo: repo3,
  config: config3, 
  libp2p: {
    transports: [star3.transport],
    peerDiscovery: [
      star3.discovery,
      pubsubPeerDiscovery(),
    ],
    pubsub: gossipsub({allowPublishToZeroPeers: true}),
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
  },
});
const id3 = await node3.id();
console.log("[node2 id]", id3.id.toJSON());
console.log("[node2 address0]", id3.addresses[0].toJSON());
console.log("[node2 address1]", id3.addresses[1].toJSON());

// node4: webRTCStar
const star4 = webRTCStar({wrtc});
const node4 = await IPFS.create({
  repo: repo4,
  config: config4, 
  libp2p: {
    transports: [star4.transport],
    peerDiscovery: [
      star4.discovery,
      pubsubPeerDiscovery(),
    ],
    pubsub: gossipsub({allowPublishToZeroPeers: true}),
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
  },
});
const id4 = await node4.id();
console.info("[node4 id]", id4.id.toJSON());
console.info("[node4 address]", id4.addresses[0].toJSON());

//NOTE: 
console.log("[node2 ro node3]", await node2.swarm.connect(`${id3.addresses[0].toJSON()}/p2p-circuit`)); // via tcp


// http2p example (relay node3 does not know about http2p protocol)
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


await node1.stop();
await node2.stop();
await node3.stop();
await node4.stop();
await server.stop();
if (globalThis.process) process.exit(0);
