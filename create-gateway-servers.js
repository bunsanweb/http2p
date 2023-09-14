import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";

// peer-id
import {createEd25519PeerId, exportToProtobuf, createFromProtobuf} from "@libp2p/peer-id-factory";
// libp2p
import {createLibp2p} from "libp2p";
// transports
import {tcp} from "@libp2p/tcp";
import {webSockets} from "@libp2p/websockets";
import {webRTC, webRTCDirect} from "@libp2p/webrtc";
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
//import {floodsub} from "@libp2p/floodsub";
import {kadDHT} from "@libp2p/kad-dht";
import {ipnsSelector} from "ipns/selector";
import {ipnsValidator} from "ipns/validator";

import {createHttp2p} from "./http2p.js";
import {createListener} from "./gateway-http2p.js";

const loadOrNewPeerId = async idFile => {
  if (fs.existsSync(idFile)) {
    const u8a = fs.readFileSync(idFile);
    return await createFromProtobuf(u8a);
  } else {
    const peerId = await createEd25519PeerId();
    const u8a = exportToProtobuf(peerId);
    if (idFile) fs.writeFileSync(idFile, u8a);
    return peerId;
  }
};

export const createServers = async config => {
  const ip4addrs = Object.values(os.networkInterfaces()).flat().
        filter(({family}) => family === "IPv4").map(({address}) => address);
  
  const peerId = await loadOrNewPeerId(config.idFile);
  const libp2p = await createLibp2p({
    peerId,
    addresses: {
      listen: [
        "/ip4/0.0.0.0/tcp/0",
        "/ip4/0.0.0.0/tcp/0/ws",
        "/webrtc",
      ],
    },
    transports: [
      tcp(),
      webSockets({websocket: {rejectUnauthorized: false}}),
      circuitRelayTransport({discoverRelays: 1}),
      webRTC(),
      //webRTCDirect(),
    ],
    connectionEncryption: [noise()],
    peerDiscovery: [mdns(), pubsubPeerDiscovery()],
    streamMuxers: [yamux(), mplex()],
    services: {
      identify: identifyService(),
      autoNAT: autoNATService(),
      upnp: uPnPNATService(),
      pubsub: gossipsub({allowPublishToZeroPeers: true, emitSelf: true, canRelayMessage: true}),
      //pubsub: gossipsub({emitSelf: true, canRelayMessage: true}),
      //pubsub: floodsub(),
      dht: kadDHT({
        //clientMode: true,
        validators: {ipns: ipnsValidator},
        selectors: {ipns: ipnsSelector},
      }),
      relay: circuitRelayServer({advertise: true}),
    },
    //*
    relay: {
      enabled: true,
      hop: {
        enabled: true,
        active: true,
      },
    }
    //*/
  });
  await libp2p.start();
  
  const info = () => ({
    id: `${peerId}`,
    multiaddrs: libp2p.getMultiaddrs().map(multiaddr => `${multiaddr}`),
    gateways: ip4addrs.map(addr => `http://${addr}:${config.gateway.port}/`),
  });
  
  const http2p = await createHttp2p(libp2p);
  const gatewayListener = createListener(http2p);

  const wrapListener = (req, res) => {
    if (req.url === "/") {
      res.writeHead(200, {
        "access-control-allow-origin": "*",
        "content-type": "application/json",
      });
      res.end(JSON.stringify(info()));
    } else {
      gatewayListener(req, res);
    }
  };
  
  const gateway = http.createServer(wrapListener);
  gateway.listen(config.gateway.port);

  const stop = () => Promise.all([
    new Promise(f => gateway.close(f)),
    http2p.close(),
    libp2p.stop(),
  ]);
  
  return {config, gateway, libp2p, http2p, info, stop};
};
