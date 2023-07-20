import {describe, it, before, after, beforeEach, afterEach} from "node:test";
import {strict as assert} from "node:assert";

import {createServer} from "http-server";
import {chromium} from "playwright";

import {multiaddr} from "@multiformats/multiaddr";

import {createServers} from "../../create-gateway-servers.js";
import {createHeliaWithWebsockets} from "../common/helia-websockets.js";
import {createHeliaOnPage} from "../common/helia-browser.js";

import {createHttp2p} from "../../http2p.js";
import {createEventSource} from "../../http2p-event-source.js";



describe("http2p-event-source on browser", async () => {
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
    await node.libp2p.dial(multiaddr(addrs1.multiaddr)); //TBD: too late when no dialed to browser
    //const starAddr = node.libp2p.getMultiaddrs().find(ma => `${ma}`.includes("/p2p-webrtc-star/"));
    //await page1.evaluate(({multiaddr}) => (async () => {
      //await ctx.node.libp2p.dial(ctx.multiaddr(multiaddr));
    //})(), {multiaddr: `${starAddr}`});
  });
  after(async () => {
    await page1.evaluate(() => (async () => await ctx.node.stop())());
    await page2.evaluate(() => (async () => await ctx.node.stop())());
    await node.stop();
    await browser.close();
    await new Promise(f => httpServer.server.close(f));
    await gatewayServers.stop();
  });

  it("access with EventSource on browser", async () => {
    const nodeHttp2p = await createHttp2p(node.libp2p);
    const uri = `http2p:${node.libp2p.peerId}/`;

    // prepare event-stream body response for uri
    const acceptPromise = new Promise(f => {
      nodeHttp2p.scope.addEventListener("fetch", ev => {
        const body = new ReadableStream({
          type: "bytes",
          async start(controller) {
            //console.log("[accept]");
            f(controller);
          },
          async pull(controller) {},
        });
        const headers = {
          "content-type": "text/event-stream",
        };
        ev.respondWith(new Response(body, {headers}));
      });
    });
    
    // listen eventSource for uri
    const resultPromise = page1.evaluate(({uri}) => (async () => {
      const {createHttp2p} = await import("http2p");
      const {createEventSource} = await import("http2p-event-source");
      
      globalThis.nodeHttp2p = await createHttp2p(ctx.node.libp2p);
      const Http2pEventSource = createEventSource(nodeHttp2p);
      globalThis.eventSource = new Http2pEventSource(uri);
      await new Promise(f => {
        if (eventSource.readyState === 1) f();
        else eventSource.addEventListener("open", () => f(), {once: true});
      });
      return new Promise(f => {
        eventSource.addEventListener("event-example", ev => {
          f(ev.data);
        }, {once: true});
      });
    })(), {uri});
    
    // send event
    const controller = await acceptPromise;
    const event = [
      "event: event-example",
      `data: "Hello EventStream"`,
      "",
    ].join("\r\n") + "\r\n";
    controller.enqueue(new TextEncoder().encode(event));
    //console.log("[enqueue]");
    
    // check value
    const res = await resultPromise;
    assert.equal(JSON.parse(res), "Hello EventStream");

    // close
    await page1.evaluate(() => (async () => {
      eventSource.close();
      await nodeHttp2p.close();
    })());
    await nodeHttp2p.close();
  });
});
