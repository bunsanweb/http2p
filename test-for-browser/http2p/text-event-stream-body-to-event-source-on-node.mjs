import {describe, it, before, after, beforeEach, afterEach} from "node:test";
import {strict as assert} from "node:assert";

import {createServer} from "http-server";
import {chromium} from "playwright";

import {multiaddr} from "@multiformats/multiaddr";

import {createServers} from "../../create-gateway-servers.js";
import {createHeliaWithWrtcstar} from "../common/helia-wrtcstar.js";
import {createHeliaOnPage} from "../common/helia-browser.js";

import {createHttp2p} from "../../http2p.js";
import {TextEventStreamBody} from "../../text-event-stream-body.js";
import {createEventSource} from "../../http2p-event-source.js";



describe("text-event-stream-body on browser to http2p-event-source on node", async () => {
  let httpServer, gatewayServers, browser;
  let node, page1, page2, addrs1, addrs2;
  before(async () => {
    httpServer = createServer();
    await new Promise(f => httpServer.server.listen(8000, f));
    //console.log(await (await fetch("http://localhost:8000/test-for-browser/common/index.html")).text());
    gatewayServers = await createServers({
      sig: {port: 9090},
      gateway: {port: 9000},
      refreshPeerListIntervalMS: 10,
    });

    // nodejs helia
    const sigAddrs = gatewayServers.info.sig;
    // helia node on nodejs
    node = await createHeliaWithWrtcstar(sigAddrs);
    
    // browser helia
    browser = await chromium.launch();
    page1 = await browser.newPage();
    // load empty page includes only importmap
    await page1.goto("http://localhost:8000/test-for-browser/common/index.html");
    page1.on("console", msg => {
      if (msg.type() === "log") console.log(msg.location(), msg.text());
      //if (msg.type() === "error") console.log(msg.location(), msg.text());
    });
    addrs1 = await createHeliaOnPage(page1, sigAddrs);
    //console.log(addrs1);
    
    //TBD: if not dialed, too slow
    await node.libp2p.dial(multiaddr(addrs1.multiaddr)); //TBD: too late when no dialed to browser
  });
  after(async () => {
    await page1.evaluate(() => (async () => await ctx.node.stop())());
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

    // eventsource on nodejs libp2p instance
    const uri = `http2p:${addrs1.peerId}/`;

    const nodeHttp2p = await createHttp2p(node.libp2p);
    const Http2pEventSource = createEventSource(nodeHttp2p);
    const eventSource = new Http2pEventSource(uri);
    // wait open
    await new Promise(f => {
      if (eventSource.readyState === 1) f();
      else eventSource.addEventListener("open", () => f(), {once: true});
    });

    // prepare receiving event
    const resultPromise = new Promise(f => {
      eventSource.addEventListener("event-example", ev => {
        f(ev.data);
        eventSource.close();
      });
    });
    
    // send event
    await page1.evaluate(() => (async () => {
      const ev = new MessageEvent("event-example", {data: JSON.stringify("Hello from TextEventStreamBody")});
      textEventStreamBody.dispatchEvent(ev);
    })());

    // check values
    const res = await resultPromise;    
    assert.equal(JSON.parse(res), "Hello from TextEventStreamBody");

    // close
    eventSource.close();
    await nodeHttp2p.close();
    await page1.evaluate(() => (async () => {
      textEventStreamBody.close();
      await nodeHttp2p.close();
    })());
  });
});
