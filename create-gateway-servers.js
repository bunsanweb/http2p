import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
// IPFS
import wrtc from "@koush/wrtc";
import {sigServer} from "@libp2p/webrtc-star-signalling-server";
import {webRTCStar} from "@libp2p/webrtc-star";
import {createLibp2p} from "libp2p";
import {mplex} from "@libp2p/mplex";
import {tcp} from "@libp2p/tcp";
import {createEd25519PeerId, exportToProtobuf, createFromProtobuf} from "@libp2p/peer-id-factory";
import {noise} from "@chainsafe/libp2p-noise";
import {yamux} from "@chainsafe/libp2p-yamux";
import {gossipsub} from "@chainsafe/libp2p-gossipsub";

import {createHttp2p} from "./http2p.js";
import {createListener} from "./gateway-http2p.js";

const loadOrNewPeerId = async idFile => {
  if (fs.existsSync(idFile)) {
    const u8a = fs.readFileSync(idFile);
    return await createFromProtobuf(u8a);
  } else {
    const peerId = await createEd25519PeerId();
    const u8a = exportToProtobuf(peerId);
    fs.writeFileSync(idFile, u8a);
    return peerId;
  }
};

export const createServers = async config => {
  const sig = await sigServer({
    port: config.sig.port,
    host: "0.0.0.0",
  });
  const ip4addrs = Object.values(os.networkInterfaces()).flat().
        filter(({family}) => family === "IPv4").map(({address}) => address);
  const sigAddrs = ip4addrs.map(addr => `/ip4/${addr}/tcp/${config.sig.port}/ws/p2p-webrtc-star`);
  
  const peerId = await loadOrNewPeerId(config.idFile);
  const star = webRTCStar({wrtc});
  const libp2p = await createLibp2p({
    peerId,
    addresses: {
      listen: [
        "/ip4/0.0.0.0/tcp/0",
        sigAddrs[0],
      ],
    },
    transports: [tcp(), star.transport],
    peerDiscovery: [star.discovery],
    streamMuxers: [yamux(), mplex()],
    pubsub: gossipsub({allowPublishToZeroPeers: true}),
    connectionEncryption: [noise()], // must required
    relay: {
      enabled: true,
      hop: {
        enabled: true,
        active: true,
      },
    }
  });
  await libp2p.start();

  const multiaddrs = libp2p.getMultiaddrs().map(multiaddr => multiaddr.toJSON());
  const info = {
    id: peerId.toJSON(),
    sig: sigAddrs,
    multiaddrs: multiaddrs,
    gateways: ip4addrs.map(addr => `http://${addr}:${config.gateway.port}/`),
  };
  
  const http2p = await createHttp2p(libp2p);
  const gatewayListener = createListener(http2p);

  const wrapListener = (req, res) => {
    if (req.url === "/") {
      res.writeHead(200, {
        "access-control-allow-origin": "*",
        "content-type": "application/json",
      });
      res.end(JSON.stringify(info));
    } else {
      gatewayListener(req, res);
    }
  };
  
  const server = http.createServer(wrapListener);
  server.listen(config.gateway.port);

  return info;
};
