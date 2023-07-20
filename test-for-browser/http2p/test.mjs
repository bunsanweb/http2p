import {describe, it, before, after, beforeEach, afterEach} from "node:test";
import {strict as assert} from "node:assert";

import {createServer} from "http-server";
import {chromium} from "playwright";

import {multiaddr} from "@multiformats/multiaddr";

import {createServers} from "../../create-gateway-servers.js";
import {createHeliaWithWebsockets} from "../common/helia-websockets.js";
import {createHeliaOnPage} from "../common/helia-browser.js";

import {createHttp2p} from "../../http2p.js";


describe("http2p on browser", async () => {
  let httpServer, gatewayServers;
  let node, browser, page1, page2, addrs1, addrs2;
  before(async () => {
    httpServer = createServer();
    await new Promise(f => httpServer.server.listen(8000, f));
    //console.log(await (await fetch("http://localhost:8000/test-for-browser/common/index.html")).text());
    gatewayServers = await createServers({
      gateway: {port: 9000},
    });
    const {multiaddrs} = gatewayServers.info();
    // helia node on nodejs
    
    node = await createHeliaWithWebsockets(multiaddrs);
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
    
    // uncomment when slow
    //*
    await node.libp2p.dial(multiaddr(addrs1.multiaddr));
    await node.libp2p.dial(multiaddr(addrs2.multiaddr));
    await page1.evaluate(({ma}) => (async () => {
      await ctx.node.libp2p.dial(ctx.multiaddr(ma));
    })(), {ma: addrs2.multiaddr});
    //*/
    
  });
  after(async () => {
    await page1.evaluate(() => (async () => await ctx.node.stop())());
    await page2.evaluate(() => (async () => await ctx.node.stop())());
    await browser.close();
    await node.stop();
    
    await new Promise(f => httpServer.server.close(f));
    await gatewayServers.stop();
  });

  it("register fetch handler on nodejs and access with fetch function on browser", async () => {
    const nodeHttp2p = await createHttp2p(node.libp2p);
    const uri = `http2p:${node.libp2p.peerId}/`;
    
    nodeHttp2p.scope.addEventListener("fetch", ev => {
      const body = "Hello World from nodejs";
      const headers = {
        "content-type": "text/plain;charset=utf-8",
      };
      ev.respondWith(new Response(body, {headers}));
    });
    
    const res = await page1.evaluate(({uri}) => (async () => {
      const {createHttp2p} = await import("http2p");

      globalThis.nodeHttp2p = await createHttp2p(ctx.node.libp2p);
      const res = await nodeHttp2p.fetch(uri);
      return {
        body: await res.text(),
        headers: Object.fromEntries(res.headers.entries()),
      };
    })(), {uri});

    
    assert.equal(res.headers["content-type"], "text/plain;charset=utf-8", "content-type is plain utf-8 text");
    assert.equal(await res.body, "Hello World from nodejs", "body is Hello World");
    
    await page1.evaluate(() => (async () => {
      await nodeHttp2p.close();
    })());
    await nodeHttp2p.close();
  });

  it("register fetch handler on browser and access with fetch function on nodejs", async () => {
    const nodeHttp2p = await createHttp2p(node.libp2p);
    
    await page1.evaluate(() => (async () => {
      const {createHttp2p} = await import("http2p");

      globalThis.nodeHttp2p = await createHttp2p(ctx.node.libp2p);

      nodeHttp2p.scope.addEventListener("fetch", ev => {
        const body = "Hello World from browser";
        const headers = {
          "content-type": "text/plain;charset=utf-8",
        };
        ev.respondWith(new Response(body, {headers}));
      });
    })());
    
    const uri = `http2p:${addrs1.peerId}/`;
    const res = await nodeHttp2p.fetch(uri);
    
    assert.equal(res.headers.get("content-type"), "text/plain;charset=utf-8", "content-type is plain utf-8 text");
    assert.equal(await res.text(), "Hello World from browser", "body is Hello World");
    
    await page1.evaluate(() => (async () => {
      await nodeHttp2p.close();
    })());
    await nodeHttp2p.close();
  });

  it("register fetch handler on browser and access with fetch function on browser", async () => {
    await page1.evaluate(() => (async () => {
      const {createHttp2p} = await import("http2p");
      
      globalThis.nodeHttp2p = await createHttp2p(ctx.node.libp2p);
      
      nodeHttp2p.scope.addEventListener("fetch", ev => {
        const body = "Hello World from browser";
        const headers = {
          "content-type": "text/plain;charset=utf-8",
        };
        ev.respondWith(new Response(body, {headers}));
      });
    })());
    
    const uri = `http2p:${addrs1.peerId}/`;

    const res = await page2.evaluate(({uri}) => (async () => {
      const {createHttp2p} = await import("http2p");

      globalThis.nodeHttp2p = await createHttp2p(ctx.node.libp2p);
      const res = await nodeHttp2p.fetch(uri);
      return {
        body: await res.text(),
        headers: Object.fromEntries(res.headers.entries()),
      };
    })(), {uri});
    
    
    assert.equal(res.headers["content-type"], "text/plain;charset=utf-8", "content-type is plain utf-8 text");
    assert.equal(await res.body, "Hello World from browser", "body is Hello World");
    
    await page1.evaluate(() => (async () => {
      await nodeHttp2p.close();
    })());
    await page2.evaluate(() => (async () => {
      await nodeHttp2p.close();
    })());
  });  
});
