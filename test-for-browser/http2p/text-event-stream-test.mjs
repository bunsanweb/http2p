import {describe, it, before, after, beforeEach, afterEach} from "node:test";
import {strict as assert} from "node:assert";

import {createServer} from "http-server";
import {chromium} from "playwright";

import {multiaddr} from "@multiformats/multiaddr";

import {createServers} from "../../create-gateway-servers.js";
import {createHeliaWithWebsockets} from "../common/helia-websockets.js";
import {createHeliaOnPage} from "../common/helia-browser.js";

import {createHttp2p} from "../../http2p.js";
import {TextEventStreamBody} from "../../text-event-stream-body.js";


describe("text-event-stream-body on browser", async () => {
  let httpServer, gatewayServers, browser;
  let node, page1, page2, addrs1, addrs2;
  before(async () => {
    httpServer = createServer();
    await new Promise(f => httpServer.server.listen(8000, f));
    //console.log(await (await fetch("http://localhost:8000/test-for-browser/common/index.html")).text());
    gatewayServers = await createServers({
      gateway: {port: 9000},
    });

    // nodejs helia
    const {multiaddrs} = gatewayServers.info();
    // helia node on nodejs
    node = await createHeliaWithWebsockets(multiaddrs);
    
    // browser helia
    browser = await chromium.launch();
    page1 = await browser.newPage();
    // load empty page includes only importmap
    await page1.goto("http://localhost:8000/test-for-browser/common/index.html");
    page1.on("console", msg => {
      if (msg.type() === "log") console.log(msg.location(), msg.text());
      //if (msg.type() === "error") console.log(msg.location(), msg.text());
    });
    addrs1 = await createHeliaOnPage(page1, multiaddrs);
    //console.log(addrs1);

    page2 = await browser.newPage();
    // load empty page includes only importmap
    await page2.goto("http://localhost:8000/test-for-browser/common/index.html");
    page2.on("console", msg => {
      if (msg.type() === "log") console.log(msg.location(), msg.text());
      //if (msg.type() === "error") console.log(msg.location(), msg.text());
    });
    addrs2 = await createHeliaOnPage(page2, multiaddrs);
    //console.log(addrs1);

    //TBD: if not dialed, too slow
    try {
      await node.libp2p.dialProtocol(multiaddr(addrs1.multiaddr), "/ipfs/bitswap/1.2.0", {runOnTransientConnection: true}); //TBD: too late when no dialed to browser
    } catch (error) {console.log(error);}
  });
  after(async () => {
    await page1.evaluate(() => (async () => await ctx.node.stop())());
    await page2.evaluate(() => (async () => await ctx.node.stop())());
    await node.stop();
    await browser.close();
    await new Promise(f => httpServer.server.close(f));
    await gatewayServers.stop();
  });

  it("serve text/event-source on browser", async () => {
    const nodeHttp2p = await createHttp2p(node.libp2p);

    // handler
    await page1.evaluate(() => (async () => {
      const {createHttp2p} = await import("http2p");
      const {TextEventStreamBody} = await import("text-event-stream-body");
      
      globalThis.nodeHttp2p = await createHttp2p(ctx.node.libp2p);
      globalThis.textEventStreamBody = new TextEventStreamBody();
      nodeHttp2p.scope.addEventListener("fetch", ev => {
        const body = textEventStreamBody.newReadableStream();
        ev.respondWith(new Response(body, {headers: {"content-type": "text/event-stream"}}));
      });
    })());

    // fetch
    const uri = `http2p:${addrs1.peerId}/`;
    const res = await nodeHttp2p.fetch(uri);

    // send event
    await page1.evaluate(() => (async () => {
      const ev = new MessageEvent("event-example", {data: JSON.stringify("Hello from Browser")});
      textEventStreamBody.dispatchEvent(ev);
    })());

    // read event
    const reader = res.body.getReader();
    try {
      const {done, value} = await reader.read();
      assert.equal(done, false);
      const text = new TextDecoder().decode(value);
      const expect = [`event: event-example`, `data: "Hello from Browser"`, "", ""].join("\r\n");
      assert.equal(text, expect);
    } finally {
      reader.releaseLock();
    }
    await res.body.cancel();
    
    await page1.evaluate(() => (async () => {
      textEventStreamBody.close();
      await nodeHttp2p.close();
    })());
    await nodeHttp2p.close();
  });

  it("fetch on browser for serve text/event-source on browser", async () => {
    // handler
    await page1.evaluate(() => (async () => {
      const {createHttp2p} = await import("http2p");
      const {TextEventStreamBody} = await import("text-event-stream-body");
      
      globalThis.nodeHttp2p = await createHttp2p(ctx.node.libp2p);
      globalThis.textEventStreamBody = new TextEventStreamBody();
      nodeHttp2p.scope.addEventListener("fetch", ev => {
        const body = textEventStreamBody.newReadableStream();
        ev.respondWith(new Response(body, {headers: {"content-type": "text/event-stream"}}));
      });
    })());

    // fetch
    const uri = `http2p:${addrs1.peerId}/`;
    await page2.evaluate(({uri}) => (async () => {
      const {createHttp2p} = await import("http2p");
      globalThis.nodeHttp2p = await createHttp2p(ctx.node.libp2p);
      globalThis.res = await nodeHttp2p.fetch(uri);
    })(), {uri});
    
    // send event
    await page1.evaluate(() => (async () => {
      const ev = new MessageEvent("event-example", {data: JSON.stringify("Hello from Browser")});
      textEventStreamBody.dispatchEvent(ev);
    })());

    // read event
    const {done, text} = await page2.evaluate(() => (async () => {
      const reader = res.body.getReader();
      try {
        const {done, value} = await reader.read();
        const text = new TextDecoder().decode(value);
        return {done, text};
      } finally {
        reader.releaseLock();
        await res.body.cancel();
      }
    })());

    assert.equal(done, false);
    const expect = [`event: event-example`, `data: "Hello from Browser"`, "", ""].join("\r\n");
    assert.equal(text, expect);
    
    await page1.evaluate(() => (async () => {
      textEventStreamBody.close();
      await nodeHttp2p.close();
    })());
    await page2.evaluate(() => (async () => {
      await nodeHttp2p.close();
    })());
  });
});
