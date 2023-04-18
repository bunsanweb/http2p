import {describe, it, before, after, beforeEach, afterEach} from "node:test";
import {strict as assert} from "node:assert";

import * as fs from "node:fs";
import * as IPFS from "ipfs-core";

import {createHttp2p} from "../http2p.js";

describe("http2p", async () => {
  const repo1 = "./.repos/test-repo1", repo2 = "./.repos/test-repo2";
  let node1, node2;
  beforeEach(async () => {
    fs.rmSync(repo1, {recursive: true, force: true});
    fs.rmSync(repo2, {recursive: true, force: true});
    node1 = await IPFS.create({
      silent: true,
      repo: repo1,
      config: {Addresses: {Swarm: ["/ip4/0.0.0.0/tcp/0"]}},
    });
    node2 = await IPFS.create({
      silent: true,
      repo: repo2,
      config: {Addresses: {Swarm: ["/ip4/0.0.0.0/tcp/0"]}},
    });
    // connect node1 and node2
    await node2.swarm.connect((await node1.id()).addresses[0]);
  });
  afterEach(async () => {
    await node1.stop();
    await node2.stop();
    fs.rmSync(repo1, {recursive: true, force: true});
    fs.rmSync(repo2, {recursive: true, force: true});
  });

  // tests
  it("Do start and stop", async () => {
    const node1Http2p = await createHttp2p(node1.libp2p);
    assert.ok(node1Http2p.scope instanceof EventTarget, "has scope EventTarget");
    assert.equal(typeof node1Http2p.fetch, "function", "has fetch function");
    assert.equal(typeof node1Http2p.close, "function", "has close function");
    await node1Http2p.close();
  });

  it("Register fetch handler and access with fetch function", async () => {
    const node1Http2p = await createHttp2p(node1.libp2p);
    const node2Http2p = await createHttp2p(node2.libp2p);
    
    const id1 = (await node1.id()).id.toJSON();
    const id2 = (await node2.id()).id.toJSON();
    const uri = `http2p:${id1}/`;
    
    node1Http2p.scope.addEventListener("fetch", ev => {
      //console.log(ev.request);
      assert.equal(ev.request.url, uri, "FetchEvent.request.url is http2p uri");
      assert.equal(ev.remotePeerId, id2, "FetchEvent.remotePeerId is client peer-id");
      
      ev.respondWith(new Response(
        "Hello World",
        {
          headers: {
            "content-type": "text/plain;charset=utf-8",
          },
        }
      ));
    });
    const res = await node2Http2p.fetch(uri);
    assert.equal(res.headers.get("content-type"), "text/plain;charset=utf-8", "content-type is plain utf-8 text");
    assert.equal(await res.text(), "Hello World", "body is Hello World");
    
    await Promise.allSettled([node1Http2p.close(),  node2Http2p.close()]);
  });

  it("Serve infinite text/event-stream", async () => {
    const node1Http2p = await createHttp2p(node1.libp2p);
    const node2Http2p = await createHttp2p(node2.libp2p);
    
    const id1 = (await node1.id()).id.toJSON();
    const id2 = (await node2.id()).id.toJSON();
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

    const res = await node2Http2p.fetch(uri);
    let count = 0;
    for await (const u8 of res.body) {
      count++;
      const msg = new TextDecoder().decode(u8).split("\r\n");
      assert.equal(msg[0], "event: event-example", `"event" ${count}`);
      assert.equal(msg[1], `data: {"count":${count}}`, `"data" ${count}`);
      assert.equal(msg[2], "", `stream message empty line ${count}`);
      if (count === 20) break;
    }
    await new Promise(f => setTimeout(f, 300));
    assert.ok(serveCount < count + 10, "serveCount stopped after last push");

    for (const controller of controllers) controller.close();
    await Promise.allSettled([node1Http2p.close(),  node2Http2p.close()]);
  });

  it("Serve infinite text/event-stream with abort", async () => {
    const node1Http2p = await createHttp2p(node1.libp2p);
    const node2Http2p = await createHttp2p(node2.libp2p);
    
    const id1 = (await node1.id()).id.toJSON();
    const id2 = (await node2.id()).id.toJSON();
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

    const ac = new AbortController();
    const req = new Request(uri, {signal: ac.signal});
    const res = await node2Http2p.fetch(req);
    let count = 0;
    for await (const u8 of res.body) {
      count++;
      const msg = new TextDecoder().decode(u8).split("\r\n");
      assert.equal(msg[0], "event: event-example", `"event" ${count}`);
      assert.equal(msg[1], `data: {"count":${count}}`, `"data" ${count}`);
      assert.equal(msg[2], "", `stream message empty line ${count}`);
      //if (count === 10) break;
      if (count === 20) ac.abort();
    }
    await new Promise(f => setTimeout(f, 300));
    assert.ok(serveCount < count + 10, "serveCount stopped after last push");
    
    for (const controller of controllers) controller.close();
    await Promise.allSettled([node1Http2p.close(),  node2Http2p.close()]);    
  });
});
