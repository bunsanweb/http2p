import * as helia from "helia";
import {unixfs} from "@helia/unixfs";
import {CID} from "multiformats/cid";
import {multiaddr} from "@multiformats/multiaddr";

// modules required for helia creation on nodejs
// transports
import {tcp} from "@libp2p/tcp";
import {webSockets} from "@libp2p/websockets";
import {webRTC, webRTCDirect} from "@libp2p/webrtc";
import {circuitRelayTransport, circuitRelayServer} from "libp2p/circuit-relay";
// peerDiscovery
import {mdns} from "@libp2p/mdns";
import {bootstrap} from "@libp2p/bootstrap";
// contentRouters
import {ipniContentRouting} from "@libp2p/ipni-content-routing";
// p2p-webrtc-star
import {webRTCStar} from "@libp2p/webrtc-star";
import wrtc from "@koush/wrtc";

// https://github.com/ipfs/helia/blob/main/packages/helia/src/utils/bootstrappers.ts
export const bootstrapConfig = {
  list: [
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
    '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ',
  ]
};

export const createHeliaWithWrtcstar = async sigAddrs => {
  const star = webRTCStar({wrtc});
  const node = await helia.createHelia({libp2p: {
    addresses: {
      listen: [
        "/ip4/0.0.0.0/tcp/0",
        "/ip4/0.0.0.0/tcp/0/ws",
        ...sigAddrs,
      ]
    },
    transports: [
      tcp(),
      webSockets({websocket: {rejectUnauthorized: false}}),
      circuitRelayTransport({discoverRelays: 1}),
      star.transport,
    ],
    peerDiscovery: [mdns(), bootstrap(bootstrapConfig), star.discovery],
    // from https://github.com/libp2p/js-libp2p-webtransport/blob/main/examples/fetch-file-from-kubo/src/libp2p.ts
    //connectionGater: {denyDialMultiaddr: async () => false}, // denyDial is enabled only on browser config
  }});
  return node;
};