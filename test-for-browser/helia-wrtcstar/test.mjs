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
      if (msg.type() === "log") console.log(msg.location(), msg.text());
    });
    addrs1 = await createHeliaOnPage(page1, sigAddrs);
    //console.log(addrs1);
    
    page2 = await browser.newPage();
    // load empty page includes only importmap
    await page2.goto("http://localhost:8000/test-for-browser/common/index.html");
    page2.on("console", msg => {
      if (msg.type() === "log") console.log(msg.location(), msg.text());
    });
    addrs2 = await createHeliaOnPage(page2, sigAddrs);
    //console.log(addrs2);
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
  
  it("dial from browser to nodejs", async () => {
    const proto = "/my-echo/0.1";
    // handle on nodejs
    const handler = ({connection, stream}) => {
      stream.sink(async function* () {
        for await (const bufs of stream.source) {
          yield bufs.slice().slice();
        }
      }());
    };
    await node1.libp2p.handle(proto, handler);
    const starAddr = node1.libp2p.getMultiaddrs().find(ma => `${ma}`.includes("/p2p-webrtc-star/"));
    console.log(`${node1.libp2p.peerId}`);
    
    // dial on browser page (helia as ctx.node)
    const r = await page1.evaluate(({proto, addr}) => (async () => {
      const send = async (addr, msg) => {
        if (typeof addr === "string" && addr[0] === "/") addr = ctx.multiaddr(addr);
        else if (typeof addr === "string" && addr[0] !== "/") addr = ctx.peerIdFromString(addr);
        //console.log(addr.toString());
        //console.log(await ctx.node.libp2p.peerStore.get(addr));
        const stream = await ctx.node.libp2p.dialProtocol(addr, proto);
        stream.sink(async function* () {
          yield (new TextEncoder().encode(msg));
        }());
        for await (const bufs of stream.source) {
          return new TextDecoder().decode(bufs.slice().slice());
        }
      };
      return await send(addr, "Hello from browser");
    //})(), {proto, addr: `${starAddr}`});
    })(), {proto, addr: `${node1.libp2p.peerId}`});

    // check results
    assert.equal(r, "Hello from browser");
    
    // cleanup on nodejs
    await node1.libp2p.unhandle(proto);
  });

  it("dial from nodejs to browser", async () => {
    const proto = "/my-echo/0.1";
    // handle on browser
    await page1.evaluate(({proto}) => (async () => {
      const handler = ({connection, stream}) => {
        stream.sink(async function* () {
          for await (const bufs of stream.source) {
            yield bufs.slice().slice();
          }
        }());
      };
      await ctx.node.libp2p.handle(proto, handler);
    })(), {proto});

    // dial on nodejs
    const send = async (addr, msg) => {
      if (typeof addr === "string" && addr[0] === "/") addr = multiaddr(addr);
      else if (typeof addr === "string" && addr[0] !== "/") addr = peerIdFromString(addr);
      const stream = await node1.libp2p.dialProtocol(addr, proto);
      stream.sink(async function* () {
        yield (new TextEncoder().encode(msg));
      }());
      for await (const bufs of stream.source) {
        return new TextDecoder().decode(bufs.slice().slice());
      }
    };
    //const r = await send(addrs1.multiaddr, "Hello from nodejs");
    const r = await send(addrs1.peerId, "Hello from nodejs");
    
    // check results
    assert.equal(r, "Hello from nodejs");

    // cleanup on browser
    await page1.evaluate(({proto}) => (async () => {
      await ctx.node.libp2p.unhandle(proto);
    })(), {proto});
  });
});
