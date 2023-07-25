import {describe, it, before, after, beforeEach, afterEach} from "node:test";
import {strict as assert} from "node:assert";

import {createServer} from "http-server";
import {chromium} from "playwright";

import {createServers} from "../../create-gateway-servers.js";
import {createHeliaWithWebsockets, defaultBootstrapConfig} from "../common/helia-websockets.js";

describe("helia-websocket:creation", async () => {
  let httpServer, gatewayServers, browser;
  before(async () => {
    httpServer = createServer();
    await new Promise(f => httpServer.server.listen(8000, f));
    //console.log(await (await fetch("http://localhost:8000/test-for-browser/common/index.html")).text());
    gatewayServers = await createServers({
      gateway: {port: 9000},
    });
    browser = await chromium.launch();
  });
  after(async () => {
    await browser.close();
    await gatewayServers.stop();
    await new Promise(f => httpServer.server.close(f));
  });
  
  it("connect helia nodes from browser to nodejs", async () => {
    const multiaddrs = gatewayServers.info().multiaddrs;
    // helia node on nodejs
    const node = await createHeliaWithWebsockets(multiaddrs);
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
    const wsAddr = node.libp2p.getMultiaddrs().find(ma => `${ma}`.includes("/ws/"));
    const nodeAddr = `${wsAddr}`;
    
    // run codes on browser page
    const page = await browser.newPage();
    // load empty page includes only importmap
    await page.goto("http://localhost:8000/test-for-browser/common/index.html");
    page.on("console", msg => {
      if (msg.type() === "log") console.log(msg.location(), msg.text());
      //if (msg.type() === "error") console.log(msg.location(), msg.text());
    });
    // evaluete test codes run on browser 
    const r = await page.evaluate(({defaultBootstrapConfig, multiaddrs, proto, nodeAddr}) => (async () => {
      console.log(nodeAddr);
      // import() in async (replacement from import statement)
      const {createHelia} = await import("helia");
      const {multiaddr} = await import("@multiformats/multiaddr");
      const {bootstrap} = await import("@libp2p/bootstrap");
      const {pubsubPeerDiscovery} = await import("@libp2p/pubsub-peer-discovery");
      const {circuitRelayTransport} = await import("libp2p/circuit-relay");
      const {webRTC, webRTCDirect} = await import("@libp2p/webrtc");
      const {webTransport} = await import("@libp2p/webtransport");
      const {webSockets} = await import("@libp2p/websockets");
      const {all} = await import("@libp2p/websockets/filters");

      const bootstrapConfig = {list: defaultBootstrapConfig.list.concat(multiaddrs)};
      // new helia node
      const node = await createHelia({
        libp2p: {
          // https://github.com/ipfs/helia/blob/main/packages/helia/src/utils/libp2p-defaults.browser.ts#L27
          addresses: {
            listen: [
              "/webrtc", "/wss", "/ws",
            ],
          },
          transports: [
            webRTC(), webRTCDirect(),
            webTransport(),
            // https://github.com/libp2p/js-libp2p-websockets#libp2p-usage-example
            webSockets({filter: all}),
            circuitRelayTransport({discoverRelays: 1}),
          ],
          peerDiscovery: [bootstrap(bootstrapConfig), pubsubPeerDiscovery()],
          // https://github.com/libp2p/js-libp2p/blob/master/doc/CONFIGURATION.md#configuring-connection-gater
          connectionGater: {denyDialMultiaddr: async (...args) => false},
        },
      }); // tcp network, stored on memory (not use files)

      // wait to connect
      while (node.libp2p.getMultiaddrs().length === 0) await new Promise(f => setTimeout(f, 500));
      try {
        const conn = await node.libp2p.dial(multiaddr(nodeAddr));
        console.log("[dial]", conn);
        node.libp2p.getMultiaddrs().forEach(ma => {
          console.log("[ma]", `${ma}`);
        });
      } catch (error) {console.log("[error]", error);}
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
    })(), {defaultBootstrapConfig, multiaddrs, proto, nodeAddr});
    
    // check results on test
    assert.equal(r, "Hello from browser");
    // clean up on nodejs
    await node.stop();
  });
});
