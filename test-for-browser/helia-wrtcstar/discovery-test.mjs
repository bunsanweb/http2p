import {describe, it, before, after, beforeEach, afterEach} from "node:test";
import {strict as assert} from "node:assert";

import {createServer} from "http-server";
import {chromium} from "playwright";

import {multiaddr} from "@multiformats/multiaddr";
import {peerIdFromString} from "@libp2p/peer-id";
import {createServers} from "../../create-gateway-servers.js";
import {createHeliaWithWrtcstar} from "../common/helia-wrtcstar.js";
import {createHeliaOnPage} from "../common/helia-browser.js";


describe("helia-wrtcstar", async () => {
  let httpServer, gatewayServers, browser;
  let page1, page2, node1, node2, addrs1, addrs2;
  before(async () => {
    httpServer = createServer();
    await new Promise(f => httpServer.server.listen(8000, f));
    //console.log(await (await fetch("http://localhost:8000/test-for-browser/common/index.html")).text());
    gatewayServers = await createServers({
      sig: {port: 9090},
      gateway: {port: 9000},
      refreshPeerListIntervalMS: 50,
    });

    // nodejs helia
    const sigAddrs = gatewayServers.info.sig;
    // helia node on nodejs
    node1 = await createHeliaWithWrtcstar(sigAddrs);
    node2 = await createHeliaWithWrtcstar(sigAddrs);
    
    // browser helia
    browser = await chromium.launch();
    page1 = await browser.newPage();
    // load empty page includes only importmap
    await page1.goto("http://localhost:8000/test-for-browser/common/index.html");
    page1.on("console", msg => {
      if (msg.type() === "log") console.log("[page1]", msg.location(), msg.text());
    });
    addrs1 = await createHeliaOnPage(page1, sigAddrs);

    page2 = await browser.newPage();
    // load empty page includes only importmap
    await page2.goto("http://localhost:8000/test-for-browser/common/index.html");
    page2.on("console", msg => {
      if (msg.type() === "log") console.log("[page2]", msg.location(), msg.text());
    });
    addrs2 = await createHeliaOnPage(page2, sigAddrs);
    //console.log(addrs);
  });
  after(async () => {
    await page1.evaluate(() => (async () => await ctx.node.stop())());
    await page2.evaluate(() => (async () => await ctx.node.stop())());
    await node1.stop();
    await node2.stop();
    await browser.close();
    await new Promise(f => httpServer.server.close(f));
    await gatewayServers.stop();
  });
  
  it("dial from nodejs to nodejs", async () => {
    const starMa = node2.libp2p.getMultiaddrs().find(ma => `${ma}`.includes("/p2p-webrtc-star/"));
    //console.log(starMa);
    //const conn1 = await node1.libp2p.dial(multiaddr(starMa));
    //const conn = await node1.libp2p.dial(multiaddr(`/p2p/${node2.libp2p.peerId}`));
    const conn = await node1.libp2p.dial(peerIdFromString(`${node2.libp2p.peerId}`));
    assert.ok(conn);
    //await conn.close();
  });

  it("dial from browsers to browser", async () => {
    /*
    page1.on("console", msg => {
      if (msg.type() === "error") console.log("[page2]", msg.location(), msg.text());
    });
    */
    const r = await page1.evaluate(({addrs2}) => (async () => {
      //console.log(addrs2.multiaddr, addrs2.peerId);
      //const conn1 = await ctx.node.libp2p.dial(ctx.multiaddr(addrs2.multiaddr));
      //const conn = await ctx.node.libp2p.dial(ctx.multiaddr(`/p2p/${addrs2.peerId}`));
      const conn = await ctx.node.libp2p.dial(ctx.peerIdFromString(addrs2.peerId));
      const ret = !!conn;
      //await conn.close();
      return ret; 
    })(), {addrs2});
    assert.ok(r);
  });


  it("dial from nodejs to browser", async () => {
    //const conn1 = await node1.libp2p.dial(multiaddr(addrs1.multiaddr));
    //const conn = await node1.libp2p.dial(multiaddr(`/p2p/${addrs1.peerId}`));
    const conn = await node1.libp2p.dial(peerIdFromString(`${addrs1.peerId}`));
    assert.ok(conn);
    //await conn.close();
  });

  it("dial from browsers to node", async () => {
    const starMa = node1.libp2p.getMultiaddrs().find(ma => `${ma}`.includes("/p2p-webrtc-star/"));
    /*
    page1.on("console", msg => {
      if (msg.type() === "error") console.log("[page2]", msg.location(), msg.text());
    });
    */
    const r = await page1.evaluate(({peerId, multiaddr}) => (async () => {
      //console.log(multiaddr, peerId);
      //const conn1 = await ctx.node.libp2p.dial(ctx.multiaddr(multiaddr));
      //const conn = await ctx.node.libp2p.dial(ctx.multiaddr(`/p2p/${peerId}`));
      const conn = await ctx.node.libp2p.dial(ctx.peerIdFromString(peerId));
      const ret = !!conn;
      //await conn.close();
      return ret; 
    })(), {peerId: node1.libp2p.peerId.toString(), multiaddr: starMa.toString()});
    assert.ok(r);
  });
});
