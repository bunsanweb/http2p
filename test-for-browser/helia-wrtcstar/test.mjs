import {describe, it, before, after, beforeEach, afterEach} from "node:test";
import {strict as assert} from "node:assert";

import {createServer} from "http-server";
import {chromium} from "playwright";

import {createServers} from "../../create-gateway-servers.js";
import {createHeliaWithWrtcstar, bootstrapConfig} from "../common/helia-wrtcstar.js";


describe("helia-wrtcstar", async () => {
  let httpServer, gatewayServers, browser;
  before(async () => {
    httpServer = createServer();
    await new Promise(f => httpServer.server.listen(8000, f));
    //console.log(await (await fetch("http://localhost:8000/test-for-browser/common/index.html")).text());
    gatewayServers = await createServers({
      sig: {port: 9090},
      gateway: {port: 9000},
    });
    browser = await chromium.launch();
  });
  after(async () => {
    await browser.close();
    await new Promise(f => httpServer.server.close(f));
    await gatewayServers.stop();
  });
  
  it("connect helia nodes from browser to nodejs", async () => {
    const sigAddrs = gatewayServers.info.sig;
    // helia node on nodejs
    const node = await createHeliaWithWrtcstar(sigAddrs);
    // helia with echo back
    const proto = "/my-echo/0.1";
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
    
    // run codes on browser page
    const page = await browser.newPage();
    // load empty page includes only importmap
    await page.goto("http://localhost:8000/test-for-browser/common/index.html");
    // evaluete test codes run on browser 
    const r = await page.evaluate(({bootstrapConfig, sigAddrs, proto, nodeAddr}) => (async () => {
      // import() in async (replacement from import statement)
      const {createHelia} = await import("helia");
      const {multiaddr} = await import("@multiformats/multiaddr");
      const {bootstrap} = await import("@libp2p/bootstrap");
      const {circuitRelayTransport} = await import("libp2p/circuit-relay");
      const {webRTC, webRTCDirect} = await import("@libp2p/webrtc");
      const {webTransport} = await import("@libp2p/webtransport");
      const {webSockets} = await import("@libp2p/websockets");
      const {webRTCStar} = await import("@libp2p/webrtc-star");
      const {all} = await import("@libp2p/websockets/filters");
      
      // new helia node
      const star = webRTCStar();
      const node = await createHelia({
        libp2p: {
          // https://github.com/ipfs/helia/blob/main/packages/helia/src/utils/libp2p-defaults.browser.ts#L27
          addresses: {
            listen: [
              "/webrtc", "/wss", "/ws",
              ...sigAddrs,
            ],
          },
          transports: [
            webRTC(), webRTCDirect(),
            webTransport(),
            // https://github.com/libp2p/js-libp2p-websockets#libp2p-usage-example
            webSockets({filters: all}),
            circuitRelayTransport({discoverRelays: 1}),
            star.transport,
          ],
          peerDiscovery: [bootstrap(bootstrapConfig), star.discovery],
          // https://github.com/libp2p/js-libp2p/blob/master/doc/CONFIGURATION.md#configuring-connection-gater
          connectionGater: {denyDialMultiaddr: async (...args) => false},
        },
      }); // tcp network, stored on memory (not use files)

      // wait to connect
      while (node.libp2p.getMultiaddrs().length === 0) await new Promise(f => setTimeout(f, 500));

      // dialProtocol to nodejs helia
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
      const ret = await send(nodeAddr, "Hello from browser");

      // clean up and return on page
      await node.stop();
      return ret;
    })(), {bootstrapConfig, sigAddrs, proto, nodeAddr});

    // check results on test
    assert.equal(r, "Hello from browser");

    // clean up on nodejs
    await node.stop();
  });
});
