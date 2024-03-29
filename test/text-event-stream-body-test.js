import {describe, it, before, after} from "node:test";
import {strict as assert} from "node:assert";

import * as fs from "node:fs";
import * as helia from "helia";

import {createHttp2p} from "../http2p.js";
import {TextEventStreamBody} from "../text-event-stream-body.js";

describe("text-event-stream-body", async () => {
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

  // tests

  it("Serve infinite text/event-stream", async () => {
    const node1Http2p = await createHttp2p(node1.libp2p);
    const node2Http2p = await createHttp2p(node2.libp2p);
    
    const id1 = node1.libp2p.peerId.toJSON();
    const id2 = node2.libp2p.peerId.toJSON();
    const uri = `http2p:${id1}/`;

    const textEventStreamBody = new TextEventStreamBody();
    node1Http2p.scope.addEventListener("fetch", ev => {
      const body = textEventStreamBody.newReadableStream();
      ev.respondWith(new Response(body, {headers: {"content-type": "text/event-stream"}}));
    });
    
    const res = await node2Http2p.fetch(uri);

    // send events
    let serveCount = 0;
    (async () => {
      for (let i = 0; i < 20; i++) {
        await new Promise(f => setTimeout(f, 50));
        if (textEventStreamBody.closed) break;
        const ev = new MessageEvent("event-example", {data: JSON.stringify({count: ++serveCount})});
        //console.log(serveCount, textEventStreamBody.closed);
        textEventStreamBody.dispatchEvent(ev);
      }
    })().catch(console.error);

    // receive events
    let count = 0;
    for await (const u8 of res.body) {
      count++;
      const msg = new TextDecoder().decode(u8).split("\r\n");
      assert.equal(msg[0], "event: event-example", `"event" ${count}`);
      assert.equal(msg[1], `data: {"count":${count}}`, `"data" ${count}: ${msg[1]}`);
      assert.equal(msg[2], "", `stream message empty line ${count}`);
      if (count === 10) break;
    }
    textEventStreamBody.close();
    //await new Promise(f => setTimeout(f, 300));
    assert.ok(serveCount < count + 5, `serveCount stopped after last push: ${serveCount}`);
    
    await Promise.allSettled([node1Http2p.close(),  node2Http2p.close()]);    
  });
});
