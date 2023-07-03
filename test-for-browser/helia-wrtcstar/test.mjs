import {describe, it, before, after, beforeEach, afterEach} from "node:test";
import {strict as assert} from "node:assert";

import {createServer} from "http-server";
import {chromium} from "playwright";

import {multiaddr} from "@multiformats/multiaddr";

import {createServers} from "../../create-gateway-servers.js";
import {createHeliaWithWrtcstar} from "../common/helia-wrtcstar.js";
import {createHeliaOnPage} from "../common/helia-browser.js";


describe("helia-wrtcstar", async () => {
  let httpServer, gatewayServers, browser;
  let page, node, addrs;
  before(async () => {
    httpServer = createServer();
    await new Promise(f => httpServer.server.listen(8000, f));
    //console.log(await (await fetch("http://localhost:8000/test-for-browser/common/index.html")).text());
    gatewayServers = await createServers({
      sig: {port: 9090},
      gateway: {port: 9000},
    });

    // nodejs helia
    const sigAddrs = gatewayServers.info.sig;
    // helia node on nodejs
    node = await createHeliaWithWrtcstar(sigAddrs);
    
    // browser helia
    browser = await chromium.launch();
    page = await browser.newPage();
    // load empty page includes only importmap
    await page.goto("http://localhost:8000/test-for-browser/common/index.html");
    page.on("console", msg => {
      if (msg.type() === "log") console.log(msg.location(), msg.text());
    });
    addrs = await createHeliaOnPage(page, sigAddrs);
    //console.log(addrs);
  });
  after(async () => {
    await page.evaluate(() => (async () => await ctx.node.stop())());
    await node.stop();
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
    await node.libp2p.handle(proto, handler);
    const starAddr = node.libp2p.getMultiaddrs().find(ma => `${ma}`.includes("/p2p-webrtc-star/"));
    const nodeAddr = `${starAddr}`;
    
    // dial on browser page (helia as ctx.node)
    const r = await page.evaluate(({proto, nodeAddr}) => (async () => {
      const send = async (ma, msg) => {
        if (typeof ma === "string") ma = ctx.multiaddr(ma);
        const stream = await ctx.node.libp2p.dialProtocol(ma, proto);
        stream.sink(async function* () {
          yield (new TextEncoder().encode(msg));
        }());
        for await (const bufs of stream.source) {
          return new TextDecoder().decode(bufs.slice().slice());
        }
      };
      return await send(nodeAddr, "Hello from browser");
    })(), {proto, nodeAddr});

    // check results
    assert.equal(r, "Hello from browser");
    
    // cleanup on nodejs
    await node.libp2p.unhandle(proto);
  });

  it("dial from nodejs to browser", async () => {
    const proto = "/my-echo/0.1";
    // handle on browser
    await page.evaluate(({proto}) => (async () => {
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
    const send = async (ma, msg) => {
      if (typeof ma === "string") ma = multiaddr(ma);
      const stream = await node.libp2p.dialProtocol(ma, proto);
      stream.sink(async function* () {
        yield (new TextEncoder().encode(msg));
      }());
      for await (const bufs of stream.source) {
        return new TextDecoder().decode(bufs.slice().slice());
      }
    };
    const r = await send(addrs.multiaddr, "Hello from nodejs");
    
    // check results
    assert.equal(r, "Hello from nodejs");

    // cleanup on browser
    await page.evaluate(({proto}) => (async () => {
      await ctx.node.libp2p.unhandle(proto);
    })(), {proto});
  });
});
