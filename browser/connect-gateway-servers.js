import {create} from "ipfs-core";
import {multiaddr} from "@multiformats/multiaddr";

export const createIpfsWithHttp2pGateway = async gatewayUrl => {
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

  // keep gateway node connection
  const keepSwarmConnect = async (node, address, id) => {
    const peers = await node.swarm.peers();
    if (!peers.some(peer => peer.peer.toJSON() === id)) {
      //console.log("[swarm.peers]", peers.length);
      for (const peer of peers) console.log("- [addr]", peer.addr.toJSON());
      console.log("[reconnect]", await node.swarm.connect(multiaddr(address)));
    }
    setTimeout(() => keepSwarmConnect(node, address, id), 1000);
  };
  const gatewayAddr = info.multiaddrs.find(ma => ma.includes("/p2p-webrtc-star/"));
  await keepSwarmConnect(node, gatewayAddr, info.id);
  
  return node;
};


