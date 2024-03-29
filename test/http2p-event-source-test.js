import {describe, it, before, after} from "node:test";
import {strict as assert} from "node:assert";

import * as fs from "node:fs";
import * as helia from "helia";

import {createHttp2p} from "../http2p.js";
import {createEventSource} from "../http2p-event-source.js";

describe("http2p-event-source", async () => {
  let node1, node2;
  before(async () => {
    node1 = await helia.createHelia();
    node2 = await helia.createHelia();
    // connect node1 and node2
    await node2.libp2p.dial(node1.libp2p.getMultiaddrs()[0]);
  });
  after(async () => {
    await node1.stop();
    await node2.stop();
  });

  it("Receive text/event-stream", async () => {
    const node1Http2p = await createHttp2p(node1.libp2p);
    const node2Http2p = await createHttp2p(node2.libp2p);
    
    const id1 = node1.libp2p.peerId.toJSON();
    const id2 = node2.libp2p.peerId.toJSON();
    const uri = `http2p:${id1}/`;

    let serveCount = 0;
    const controllers = [];
    const eventStreamBody = () => {
      return new ReadableStream({
        type: "bytes",
        async start(controller) {controllers.push(controller);},
        async pull(controller) {
          const event = [
            "event: event-example",
            `data: ${JSON.stringify({count: ++serveCount})}`,
            "",
          ].join("\r\n") + "\r\n";
          const u8 = new TextEncoder().encode(event);
          //console.log(serveCount);
          controller.enqueue(u8);
          await new Promise(f => setTimeout(f, 50));
        },
      });
    };
    node1Http2p.scope.addEventListener("fetch", ev => {
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

    let finish = null;
    const guard = new Promise(f => {finish = f;});
    let count = 0;
    const EventSource = createEventSource(node2Http2p);
    const eventSource = new EventSource(uri);
    eventSource.addEventListener("event-example", ev => {
      //console.log("ev.data", ev.data);
      const json = JSON.parse(ev.data);
      //console.log("count", json.count);
      count = json.count;
      if (json.count === 10) {
        eventSource.close();
        finish();
      }
    });
    await guard;
    assert.ok(count === 10 && serveCount < count + 5, "serveCount stopped after last push");
    for (const controller of controllers) controller.close();
    await Promise.allSettled([node1Http2p.close(),  node2Http2p.close()]);    
  });
});
