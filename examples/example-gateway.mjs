import * as http from "node:http";

// peer-id
import {createEd25519PeerId, exportToProtobuf, createFromProtobuf} from "@libp2p/peer-id-factory";
// libp2p
import {createLibp2p} from "libp2p";
// transports
import {tcp} from "@libp2p/tcp";
import {webSockets} from "@libp2p/websockets";
import {circuitRelayTransport, circuitRelayServer} from "libp2p/circuit-relay";
// connection encryption
import {noise} from "@chainsafe/libp2p-noise";
// peer discovery
import {mdns} from "@libp2p/mdns";
import {bootstrap} from "@libp2p/bootstrap";
import {pubsubPeerDiscovery} from "@libp2p/pubsub-peer-discovery";
// content router
import {ipniContentRouting} from "@libp2p/ipni-content-routing";
// stream muxers
import {mplex} from "@libp2p/mplex";
import {yamux} from "@chainsafe/libp2p-yamux";
// services
import {identifyService} from "libp2p/identify";
import {autoNATService} from "libp2p/autonat";
import {uPnPNATService} from "libp2p/upnp-nat";
import {gossipsub} from "@chainsafe/libp2p-gossipsub";
import {kadDHT} from "@libp2p/kad-dht";
import {ipnsSelector} from "ipns/selector";
import {ipnsValidator} from "ipns/validator";

import {createHelia} from "helia";
import {createHttp2p} from "../http2p.js";
import {createListener} from "../gateway-http2p.js";

// node for gateway
const libp2pGateway = await createLibp2p({
  addresses: {
    listen: [
      "/ip4/0.0.0.0/tcp/0",
      "/ip4/0.0.0.0/tcp/0/ws",
    ],
  },
  transports: [
    tcp(),
    webSockets({websocket: {rejectUnauthorized: false}}),
    circuitRelayTransport({discoverRelays: 1}),
  ],
  connectionEncryption: [noise()],
  peerDiscovery: [mdns(), pubsubPeerDiscovery()],
  streamMuxers: [yamux(), mplex()],
  pubsub: gossipsub({allowPublishToZeroPeers: true}),
  services: {
    identify: identifyService(),
    autoNAT: autoNATService(),
    upnp: uPnPNATService(),
    pubsub: gossipsub({allowPublishToZeroPeers: true, emitSelf: true}),
    dht: kadDHT({
      validators: {ipns: ipnsValidator},
      selectors: {ipns: ipnsSelector},
    }),
    relay: circuitRelayServer({advertise: true}),
  },
  relay: {
    enabled: true,
    hop: {
      enabled: true,
      active: true,
    },
  }
});
await libp2pGateway.start();
console.info("[gateway id]", libp2pGateway.peerId.toJSON());
const gatewayAddrs = libp2pGateway.getMultiaddrs();
console.info("[gateway address 0]", gatewayAddrs[0].toJSON()); // tcp: localhost
console.info("[gateway address 1]", gatewayAddrs[1].toJSON()); // tcp: ip address
console.info("[gateway address 2]", gatewayAddrs[2].toJSON()); // webRTCStar


// http server for gateway
const gatewayHttp2p = await createHttp2p(libp2pGateway);
const gatewayListener = createListener(gatewayHttp2p);
const server = http.createServer(gatewayListener);
const port = 8000;
server.listen(port);

// simple http2p server
const nodeServer = await createHelia();
console.info("[node server id]", nodeServer.libp2p.peerId.toJSON());
console.info("[node server address]", nodeServer.libp2p.getMultiaddrs()[0].toJSON());
const serverHttp2p = await createHttp2p(nodeServer.libp2p);
serverHttp2p.scope.addEventListener("fetch", ev => {
  console.log(ev.request);
  ev.respondWith(new Response(
    "Hello World",
    {
      headers: {
        "content-type": "text/plain;charset=utf-8",
      },
    }
  ));
});

// connect to gateway
await nodeServer.libp2p.dial(gatewayAddrs[0]); //TBD add gateway address in bootstrap list

const url = `http://localhost:${port}/${nodeServer.libp2p.peerId}/`;
console.log(`[access via browser] ${url}`);
console.log("[fetch]", await (await fetch(url)).text());


await libp2pGateway.stop();
await nodeServer.stop();
await new Promise(f => server.close(f));
