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
console.log("[node3 address3]", node3.libp2p.getMultiaddrs()[3].toJSON());

//NOTE: swarm connect from node1 and node2 to node3, then node2 to node1
console.log("[node1 to node3]", await node1.libp2p.dial(node3.libp2p.getMultiaddrs()[0]));
console.log("[node2 ro node3]", await node2.libp2p.dial(node3.libp2p.getMultiaddrs()[3])); // via tcp

// http2p example (relay node3 does not know about http2p protocol)
const node1Http2p = await createHttp2p(node1.libp2p);
const node2Http2p = await createHttp2p(node2.libp2p);

// server1
const eventStreamBody = () => {
  let n = 0;
  return new ReadableStream({
    type: "bytes",
    async pull(controller) {
      const event = [
        "event: event-example",
        `data: ${JSON.stringify({count: ++n})}`,
        "",
      ].join("\r\n");
      const u8 = new TextEncoder().encode(event);
      controller.enqueue(u8);
      console.log("count", n);
      await new Promise(f => setTimeout(f, 50));
    },
  });
};

node1Http2p.scope.addEventListener("fetch", ev => {
  console.log(ev.request);
  const body = eventStreamBody();
  ev.respondWith(new Response(
    body,
    {
      headers: {
        "content-type": "text/event-stream",
      },
    },
  ));
});

// fetch2
const url = `http2p:${node1.libp2p.peerId}/`;
{// first time
  const response = await node2Http2p.fetch(url);
  console.log(response);
  let count = 0;
  for await (const u8 of response.body) {
    console.log(new TextDecoder().decode(u8));
    if (++count === 10) break;
  }
  await response.body.cancel();
}
{//second time (wait a little)
  const response = await node2Http2p.fetch(url);
  const reader = response.body.getReader();
  for (let i = 0; i < 10; i++) {
    const {value, done} = await reader.read();
    console.log(new TextDecoder().decode(value));
  }
  await reader.cancel("reader");
  reader.releaseLock();
  await response.body.cancel("bory");
}

await node1.stop();
await node2.stop();
await node3.stop();
if (globalThis.process) process.exit(0);
