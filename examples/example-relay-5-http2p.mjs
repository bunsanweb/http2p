#!/usr/bin/env node
import {createHelia} from "helia";
import {createHttp2p} from "../http2p.js";

// nodes
const node1 = await createHelia();
console.info("[node1 id]", node1.libp2p.peerId.toJSON());
console.info("[node1 address]", node1.libp2p.getMultiaddrs()[0].toJSON());
const node2 = await createHelia();
console.info("[node2 id]", node2.libp2p.peerId.toJSON());
console.info("[node2 address 0]", node2.libp2p.getMultiaddrs()[0].toJSON());
const node3 = await createHelia();
console.info("[node3 id]", node3.libp2p.peerId.toJSON());
console.info("[node3 address 0]", node3.libp2p.getMultiaddrs()[0].toJSON());
const node4 = await createHelia({
  libp2p: {
    addresses: {
      listen: [
        "/ip4/0.0.0.0/tcp/0",
        "/ip4/0.0.0.0/tcp/0/ws",
      ]
    },
  },
});
console.info("[node4 id]", node4.libp2p.peerId.toJSON());
console.info("[node4 address 0]", node4.libp2p.getMultiaddrs()[0].toJSON());
console.info("[node4 address 3]", node4.libp2p.getMultiaddrs()[3].toJSON());

//NOTE: connect
console.log("[node3 to node1]", await node3.libp2p.dial(node1.libp2p.getMultiaddrs()[0])); // tcp
console.log("[node3 to node4]", await node3.libp2p.dial(node4.libp2p.getMultiaddrs()[3])); // ws
console.log("[node4 to node2]", await node4.libp2p.dial(node2.libp2p.getMultiaddrs()[0])); // tcp


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
const url = `http2p:${node1.libp2p.peerId}/`;
const response = await node2Http2p.fetch(url);
console.log(response);
console.log(await response.text());


await Promise.all([node1.stop(), node2.stop(), node3.stop(), node4.stop()]);
if (globalThis.process) process.exit(0);
