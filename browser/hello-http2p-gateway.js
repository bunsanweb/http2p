import {create} from "ipfs-core";
import {createLibp2p} from "libp2p";
import {mplex} from "@libp2p/mplex";
import {createEd25519PeerId, exportToProtobuf, createFromProtobuf} from "@libp2p/peer-id-factory";
import {webRTCStar} from "@libp2p/webrtc-star";
import {noise} from "@chainsafe/libp2p-noise";
import {yamux} from "@chainsafe/libp2p-yamux";
import {gossipsub} from "@chainsafe/libp2p-gossipsub";
import {multiaddr} from "@multiformats/multiaddr";

import {createHttp2p} from "http2p";

const gatewayUrl = "http://localhost:9000/";
const info = await (await fetch(gatewayUrl)).json();

const node = await create({
  repo: `repo-${Math.random()}`,
  config: {
    Addresses: {
      Swarm: info.sig,
    },
    Discovery: {
      MDNS: {Enabled: true},
      webRTCStar: {Enabled: true},
    },
  },
  relay: {
    enabled: true,
    hop: {enabled: true},
  },
});
const id = await node.id();
console.log("[id]", id.id.toJSON());

//gateway peer id
const gatewayId = info.id;
const gatewayAddr = info.multiaddrs.find(ma => ma.includes("/p2p-webrtc-star/"));
const keepSwarmConnect = async (node, address, id) => {
  const peers = await node.swarm.peers();
  if (!peers.some(peer => peer.peer.toJSON() === id)) {
    console.log("[swarm.peers]", peers.length);
    for (const peer of peers) console.log("- [addr]", peer.addr.toJSON());
    console.log("[reconnect]", await node.swarm.connect(multiaddr(address)));
  }
  setTimeout(() => keepSwarmConnect(node, address, id), 1000);
};
await keepSwarmConnect(node, gatewayAddr, gatewayId);

// simple fetch handler
const nodeHttp2p = await createHttp2p(node.libp2p);
nodeHttp2p.scope.addEventListener("fetch", ev => {
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

// display link 
const url = `http://localhost:9000/${id.id.toJSON()}/`;
console.log(`open: ${url}`);
const link = document.createElement("a");
link.target = "_blank";
link.textContent = link.href = url;
document.body.append(link);
