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
import {pubsubPeerDiscovery} from "@libp2p/pubsub-peer-discovery";
// contentRouters
import {ipniContentRouting} from "@libp2p/ipni-content-routing";
// services
import {identifyService} from "libp2p/identify";
import {autoNATService} from "libp2p/autonat";
import {uPnPNATService} from "libp2p/upnp-nat";
import {gossipsub} from "@chainsafe/libp2p-gossipsub";
//import {floodsub} from "@libp2p/floodsub";
import {kadDHT} from "@libp2p/kad-dht";
import {ipnsSelector} from "ipns/selector";
import {ipnsValidator} from "ipns/validator";


// https://github.com/ipfs/helia/blob/main/packages/helia/src/utils/bootstrappers.ts
export const defaultBootstrapConfig = {
  list: [
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
    '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ',
  ]
};

export const createHeliaWithWebsockets = async multiaddrs => {
  //const bootstrapConfig = {list: multiaddrs.concat(defaultBootstrapConfig.list)};
  const bootstrapConfig = {list: multiaddrs};
  const node = await helia.createHelia({libp2p: {
    addresses: {
      listen: [
        "/ip4/0.0.0.0/tcp/0",
        "/ip4/0.0.0.0/tcp/0/ws",
        "/webrtc",
      ]
    },
    transports: [
      tcp(),
      webSockets({websocket: {rejectUnauthorized: false}}),
      circuitRelayTransport({discoverRelays: 5}),
      webRTC(),
      webRTCDirect(),
    ],
    peerDiscovery: [mdns(), bootstrap(bootstrapConfig), pubsubPeerDiscovery()],
    services: {
      identify: identifyService(),
      autoNAT: autoNATService(),
      upnp: uPnPNATService(),
      //pubsub: gossipsub({emitSelf: true}),
      pubsub: gossipsub({allowPublishToZeroPeers: true, emitSelf: true, canRelayMessage: true}),
      //pubsub: floodsub(),
      dht: kadDHT({
        clientMode: true,
        validators: {ipns: ipnsValidator},
        selectors: {ipns: ipnsSelector},
      }),
      relay: circuitRelayServer({
        advertise: {
          bootDelay: 1000,
        },
        reservations: {
          maxReservations: 128,
          defaultDurationLimit: 10 * 60 * 1000,
          defaultDataLimit: 1n << 30n,
        },
      }),
    },
  }});
  console.log(node.libp2p.getProtocols());
  return node;
};
