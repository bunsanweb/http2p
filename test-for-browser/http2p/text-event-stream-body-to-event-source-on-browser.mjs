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
import {createEventSource} from "../../http2p-event-source.js";


describe("text-event-stream-body on browser to http2p-event-source on browser", async () => {
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
    //console.log(addrs2);

    //TBD: if not dialed, too slow
    //*
    await page1.evaluate(({multiaddr}) => (async () => {
      try {
        await ctx.node.libp2p.dialProtocol(ctx.multiaddr(multiaddr), "/ipfs/bitswap/1.2.0", {runOnTransientConnection: true});
      } catch (error) {console.log(error);}
    })(), {multiaddr: addrs2.multiaddr});
    //*/
  });
  after(async () => {
    await page1.evaluate(() => (async () => await ctx.node.stop())());
    await page2.evaluate(() => (async () => await ctx.node.stop())());
    await node.stop();
    await browser.close();
    await new Promise(f => httpServer.server.close(f));
    await gatewayServers.stop();
  });

  it("access with EventSource on browser for served text/event-source on browser ", async () => {
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

    // eventsource
    const uri = `http2p:${addrs1.peerId}/`;
    // wait open event source
    await page2.evaluate(({uri}) => (async () => {
      const {createHttp2p} = await import("http2p");
      const {createEventSource} = await import("http2p-event-source");
      
      globalThis.nodeHttp2p = await createHttp2p(ctx.node.libp2p);
      const Http2pEventSource = createEventSource(nodeHttp2p);
      globalThis.eventSource = new Http2pEventSource(uri);
      return new Promise(f => {
        if (eventSource.readyState === 1) f();
        else eventSource.addEventListener("open", () => f(), {once: true});
      });
    })(), {uri});
    
    // prepare receiving event
    const resultPromise = page2.evaluate(() => new Promise(f => {
      eventSource.addEventListener("event-example", ev => {
        //console.log("4. [event]", ev.data);
        f(ev.data);
        eventSource.close();
      });
    }));
    
    // send event
    await page1.evaluate(() => (async () => {
      const ev = new MessageEvent("event-example", {data: JSON.stringify("Hello from TextEventStreamBody")});
      textEventStreamBody.dispatchEvent(ev);
      //console.log("[dispatched]");
    })());

    // check values
    const res = await resultPromise;
    assert.equal(JSON.parse(res), "Hello from TextEventStreamBody");

    // close
    await page2.evaluate(() => (async () => {
      eventSource.close();
      await nodeHttp2p.close();
    })());
    await page1.evaluate(() => (async () => {
      textEventStreamBody.close();
      await nodeHttp2p.close();
    })());
  });
});
