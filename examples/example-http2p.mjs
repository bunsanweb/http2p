// IPFS
import {createHelia} from "helia";
import {createHttp2p} from "../http2p.js";

const node1 = await createHelia();
console.info("[node1 id]", node1.libp2p.peerId.toJSON());
console.info("[node1 address]", node1.libp2p.getMultiaddrs()[0].toJSON());

// node2
const node2 = await createHelia();
console.log("[node2 id]", node2.libp2p.peerId.toJSON());
console.log("[node2 address]", node2.libp2p.getMultiaddrs()[0].toJSON());

//NOTE: connect node2 to node1
await node2.libp2p.dial(node1.libp2p.getMultiaddrs()[0]);

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
const url = `http2p:${node1.libp2p.peerId}/`;
const response = await node2Http2p.fetch(url);
console.log(response);
console.log(await response.text());
//for await (const u8 of response.body) console.log(new TextDecoder().decode(u8));

await node1.stop();
await node2.stop();
