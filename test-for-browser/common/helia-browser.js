import {bootstrapConfig} from "./helia-wrtcstar.js";

export const createHeliaOnPage = async (page, sigAddrs) => await page.evaluate(({bootstrapConfig, sigAddrs}) => (async () => {
  // import() in async (replacement from import statement)
  const {createHelia} = await import("helia");
  const {unixfs} = await import("@helia/unixfs");
  const {CID} = await import("multiformats/cid");
  const {multiaddr} = await import("@multiformats/multiaddr");
  const {bootstrap} = await import("@libp2p/bootstrap");
  const {pubsubPeerDiscovery} = await import("@libp2p/pubsub-peer-discovery");
  const {circuitRelayTransport, circuitRelayServer} = await import("libp2p/circuit-relay");
  const {webRTC, webRTCDirect} = await import("@libp2p/webrtc");
  const {webTransport} = await import("@libp2p/webtransport");
  const {webSockets} = await import("@libp2p/websockets");
  const {webRTCStar} = await import("@libp2p/webrtc-star");
  const {all} = await import("@libp2p/websockets/filters");
  // services
  const {identifyService} = await import("libp2p/identify");
  const {autoNATService} = await import("libp2p/autonat");
  const {gossipsub} = await import("@chainsafe/libp2p-gossipsub");
  const {kadDHT} = await import("@libp2p/kad-dht");
  const {ipnsSelector} = await import("ipns/selector");
  const {ipnsValidator} = await import("ipns/validator");
  
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
      peerDiscovery: [bootstrap(bootstrapConfig), star.discovery, pubsubPeerDiscovery()],
      services: {
        identify: identifyService(),
        autoNAT: autoNATService(),
        pubsub: gossipsub({emitSelf: true}),
        dht: kadDHT({
          validators: {ipns: ipnsValidator},
          selectors: {ipns: ipnsSelector},
        }),
        //relay: circuitRelayServer({advertise: false}), // fail to add relay
      },
      // https://github.com/libp2p/js-libp2p/blob/master/doc/CONFIGURATION.md#configuring-connection-gater
      connectionGater: {denyDialMultiaddr: async (...args) => false},
    },
  }); // tcp network, stored on memory (not use files)
  // wait to connect
  while (node.libp2p.getMultiaddrs().length === 0) await new Promise(f => setTimeout(f, 500));
  
  const nodefs = unixfs(node);
  globalThis.ctx = {multiaddr, CID, node, nodefs};
  
  return {
    peerId: node.libp2p.peerId.toString(),
    multiaddr: node.libp2p.getMultiaddrs()[0].toString(),
  };
})(), {bootstrapConfig, sigAddrs});
