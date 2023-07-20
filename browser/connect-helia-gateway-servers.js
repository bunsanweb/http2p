import {createHelia} from "helia";
import {multiaddr} from "@multiformats/multiaddr";
import {CID} from "multiformats/cid";
import {peerIdFromString} from"@libp2p/peer-id";

// libp2p transport
import {webRTC, webRTCDirect} from "@libp2p/webrtc";
import {webTransport} from "@libp2p/webtransport";
import {webSockets} from "@libp2p/websockets";
import {all} from "@libp2p/websockets/filters";
import {circuitRelayTransport} from "libp2p/circuit-relay";
// libp2p peer discovery
import {bootstrap} from "@libp2p/bootstrap";
import {pubsubPeerDiscovery} from"@libp2p/pubsub-peer-discovery";


// https://github.com/ipfs/helia/blob/main/packages/helia/src/utils/bootstrappers.ts
const defaultBootstrapConfig = {
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
  const bootstrapConfig = {list: info.multiaddrs};
  const node = await createHelia({
    libp2p: {
      // https://github.com/ipfs/helia/blob/main/packages/helia/src/utils/libp2p-defaults.browser.ts#L27
      addresses: {listen: ["/webrtc", "/wss", "/ws"],},
      transports: [
        webRTC(), webRTCDirect(), webTransport(),
        // https://github.com/libp2p/js-libp2p-websockets#libp2p-usage-example
        webSockets({filter: all}),
        circuitRelayTransport({discoverRelays: 1}),
      ],
      peerDiscovery: [bootstrap(bootstrapConfig), pubsubPeerDiscovery()],
      // https://github.com/libp2p/js-libp2p/blob/master/doc/CONFIGURATION.md#configuring-connection-gater
      connectionGater: {denyDialMultiaddr: async (...args) => false},
    },
  });
  while (node.libp2p.getMultiaddrs().length === 0) await new Promise(f => setTimeout(f, 500));
  return node;
};
