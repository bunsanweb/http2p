import {createHelia} from "helia";
import {multiaddr} from "@multiformats/multiaddr";
import {bootstrap} from "@libp2p/bootstrap";
import {circuitRelayTransport} from "libp2p/circuit-relay";
import {webRTC, webRTCDirect} from "@libp2p/webrtc";
import {webTransport} from "@libp2p/webtransport";
import {webSockets} from "@libp2p/websockets";
import {webRTCStar} from "@libp2p/webrtc-star";
import {all} from "@libp2p/websockets/filters";

// https://github.com/ipfs/helia/blob/main/packages/helia/src/utils/bootstrappers.ts
const bootstrapConfig = {
  list: [
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
    '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ',
  ]
};

export const createHeliaWithHttp2pGateway = async gatewayUrl => {
  const info = await (await fetch(gatewayUrl)).json();
  const star = webRTCStar();
  const node = await createHelia({
    libp2p: {
      // https://github.com/ipfs/helia/blob/main/packages/helia/src/utils/libp2p-defaults.browser.ts#L27
      addresses: {
        listen: [
          "/webrtc", "/wss", "/ws",
          ...info.sig, // ".../ws/p2p-webrtc-star" addresses
        ],
      },
      transports: [
        webRTC(), webRTCDirect(), webTransport(),
        // https://github.com/libp2p/js-libp2p-websockets#libp2p-usage-example
        webSockets({filters: all}),
        circuitRelayTransport({discoverRelays: 1}),
        star.transport,
      ],
      peerDiscovery: [bootstrap(bootstrapConfig), star.discovery],
      // https://github.com/libp2p/js-libp2p/blob/master/doc/CONFIGURATION.md#configuring-connection-gater
      connectionGater: {denyDialMultiaddr: async (...args) => false},
    },
  });
  const keepSwarmConnect = async (node, address, id) => {
    if (!node.libp2p.isStarted()) return;
    const peers = node.libp2p.getPeers();
    if (!peers.some(peer => peer.toString() === id)) {
      //console.log("[swarm.peers]", peers.length);
      for (const peer of peers) console.log("- [addr]", peer.toString());
      console.log("[reconnect]", await node.libp2p.dial(multiaddr(address)));
    }
    setTimeout(() => keepSwarmConnect(node, address, id), 1000);
  };
  const gatewayAddr = info.multiaddrs.find(ma => ma.includes("/p2p-webrtc-star/"));
  keepSwarmConnect(node, gatewayAddr, info.id);
  return node;
};
