// IPFS
import {createHelia} from "helia";
import {createHttp2p} from "../http2p.js";

// node1
const node1 = await createHelia();
console.info("[node1 id]", node1.libp2p.peerId.toJSON());
console.info("[node1 address]", node1.libp2p.getMultiaddrs()[0].toJSON());

// node2
const node2 = await createHelia();
console.log("[node2 id]", node2.libp2p.peerId.toJSON());
console.log("[node2 address]", node2.libp2p.getMultiaddrs()[0].toJSON());

// node3 as relay node
const node3 = await createHelia({
  libp2p: {
    addresses: {
      listen: [
        "/ip4/0.0.0.0/tcp/0",
        "/ip4/0.0.0.0/tcp/0/ws",
      ]
    },
  },
});
console.log("[node3 id]", node3.libp2p.peerId.toJSON());
console.log("[node3 address0]", node3.libp2p.getMultiaddrs()[0].toJSON());
console.log("[node3 address3]", node3.libp2p.getMultiaddrs()[3].toJSON()); // ws

//NOTE: connect node1 <-ws-> node3 and node2 <-tcp-> node3
console.log("[node1 to node3]", await node1.libp2p.dial(node3.libp2p.getMultiaddrs()[3])); 
console.log("[node2 to node3]", await node2.libp2p.dial(node3.libp2p.getMultiaddrs()[0])); 


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

await Promise.all([node1.stop(), node2.stop(), node3.stop()]);
if (globalThis.process) process.exit(0);
