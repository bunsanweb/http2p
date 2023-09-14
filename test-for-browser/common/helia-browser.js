import {defaultBootstrapConfig} from "./helia-websockets.js";

export const createHeliaOnPage = async (page, multiaddrs) => await page.evaluate(({defaultBootstrapConfig, multiaddrs}) => (async () => {
  // import() in async (replacement from import statement)
  const {createHelia} = await import("helia");
  const {unixfs} = await import("@helia/unixfs");
  const {CID} = await import("multiformats/cid");
  const {multiaddr} = await import("@multiformats/multiaddr");
  const {peerIdFromString} = await import("@libp2p/peer-id");
  const {bootstrap} = await import("@libp2p/bootstrap");
  const {pubsubPeerDiscovery} = await import("@libp2p/pubsub-peer-discovery");
  const {circuitRelayTransport, circuitRelayServer} = await import("libp2p/circuit-relay");
  const {webRTC, webRTCDirect} = await import("@libp2p/webrtc");
  const {webTransport} = await import("@libp2p/webtransport");
  const {webSockets} = await import("@libp2p/websockets");
  const {all} = await import("@libp2p/websockets/filters");
  // services
  const {identifyService} = await import("libp2p/identify");
  const {autoNATService} = await import("libp2p/autonat");
  const {gossipsub} = await import("@chainsafe/libp2p-gossipsub");
  //const {floodsub} = await import("@libp2p/floodsub");
  const {kadDHT} = await import("@libp2p/kad-dht");
  const {ipnsSelector} = await import("ipns/selector");
  const {ipnsValidator} = await import("ipns/validator");

  //const bootstrapConfig = {list: defaultBootstrapConfig.list.concat(multiaddrs)};
  const bootstrapConfig = {list: multiaddrs};
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
        webSockets({filter: all}),
        webRTC(), webRTCDirect(),
        webTransport(),
        // https://github.com/libp2p/js-libp2p-websockets#libp2p-usage-example
        circuitRelayTransport({discoverRelays: 5}),
      ],
      peerDiscovery: [bootstrap(bootstrapConfig), pubsubPeerDiscovery()],
      services: {
        identify: identifyService(),
        autoNAT: autoNATService(),
        //pubsub: gossipsub({emitSelf: true}),
        pubsub: gossipsub({allowPublishToZeroPeers: true, emitSelf: false, canRelayMessage: true}),
        //pubsub: floodsub(),
        dht: kadDHT({
          clientMode: true,
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
  //console.log(node.libp2p.getProtocols());
  const nodefs = unixfs(node);
  globalThis.ctx = {multiaddr, CID, peerIdFromString, node, nodefs};

  return {
    peerId: node.libp2p.peerId.toString(),
    multiaddr: node.libp2p.getMultiaddrs()[0].toString(),
    //multiaddr: node.libp2p.getMultiaddrs()[7].toString(),
  };
})(), {defaultBootstrapConfig, multiaddrs});
