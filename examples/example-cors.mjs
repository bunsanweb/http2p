import * as fs from "node:fs";
import * as http from "node:http";

// IPFS
import wrtc from "@koush/wrtc";
import * as IPFS from "ipfs-core";
import {sigServer} from "@libp2p/webrtc-star-signalling-server";
import {webRTCStar} from "@libp2p/webrtc-star";
import {createLibp2p} from "libp2p";
import {mplex} from "@libp2p/mplex";
import {tcp} from "@libp2p/tcp";
import {noise} from "@chainsafe/libp2p-noise";
import {yamux} from "@chainsafe/libp2p-yamux";
import {gossipsub} from "@chainsafe/libp2p-gossipsub";

import {createHttp2p} from "../http2p.js";
import {createListener} from "../gateway-http2p.js";

// cleanup repo dirs
const repoGateway = "./.repos/test-repo-gateway", repoServer = "./.repos/test-repo-server";
fs.rmSync(repoGateway, {recursive: true, force: true});
fs.rmSync(repoServer, {recursive: true, force: true});

const libp2pGateway = await createLibp2p({
  addresses: {
    listen: [
      "/ip4/0.0.0.0/tcp/0",
    ],
  },
  transports: [tcp()],
  streamMuxers: [yamux()],
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
await libp2pGateway.start();

await libp2pGateway.start();
console.info("[gateway id]", libp2pGateway.peerId.toJSON());
const gatewayAddrs = libp2pGateway.getMultiaddrs();
console.info("[gateway address 0]", gatewayAddrs[0].toJSON()); // tcp: localhost
console.info("[gateway address 1]", gatewayAddrs[1].toJSON()); // tcp: ip address

// http server for http2p gateway
const gatewayHttp2p = await createHttp2p(libp2pGateway);
const gatewayListener = createListener(gatewayHttp2p);
const gatewayServer = http.createServer(gatewayListener);
const gatewayPort = 8100;
gatewayServer.listen(gatewayPort);

// simple http2p server for fetch
const configServer = {
  Addresses: {
    Swarm: [
      "/ip4/0.0.0.0/tcp/0",
    ],
  },
  Bootstrap: [],
};
const relay = {
  enabled: true,
  hop: {enabled: true},
};
const nodeServer = await IPFS.create({
  config: configServer, relay,
  repo: repoServer,
  libp2p: {
    streamMuxers: [yamux()],
    pubsub: gossipsub({allowPublishToZeroPeers: true}),
    connectionEncryption: [noise()],
  },
});
const idServer = await nodeServer.id();
console.info("[node server id]", idServer.id.toJSON());
console.info("[node server address]", idServer.addresses[0].toJSON());
const serverHttp2p = await createHttp2p(nodeServer.libp2p);
serverHttp2p.scope.addEventListener("fetch", ev => {
  console.log(ev.request);
  if (ev.request.method === "GET") {
    ev.respondWith(new Response(
      "Hello World",
      {
        headers: {
          "content-type": "text/plain;charset=utf-8",
        },
      }
    ));
  }
  if (ev.request.method === "PUT") {
    ev.respondWith((async () => {
      const text = await ev.request.text();
      console.log("[PUT body]", text);
      return new Response(
        `Echo: ${text}`,
        {
          headers: {
            "content-type": "text/plain;charset=utf-8",
          },
        }
      );
    })());
  }
});

await nodeServer.bootstrap.add(gatewayAddrs[0].toJSON()); //TBD add gateway address in bootstrap list
const keepSwarmConnect = async (node, address, id) => {
  const peers = await node.swarm.peers();
  if (!peers.some(peer => peer.peer.toJSON() === id)) {
    console.log("[swarm.peers]", peers.length);
    for (const peer of peers) console.log("- [addr]", peer.addr.toJSON());
    console.log("[reconnect]", await nodeServer.swarm.connect(address));
  }
  setTimeout(() => keepSwarmConnect(node, address, id), 1000);
};
await keepSwarmConnect(nodeServer, gatewayAddrs[0].toJSON(), libp2pGateway.peerId.toJSON());

// HTTP Server for Browser
const accessUrl = `http://localhost:${gatewayPort}/${idServer.id.toJSON()}/`;
console.log("[access url]", accessUrl);
console.log("[fetch]", await (await fetch(accessUrl)).text());

const page = `<!doctype html>
<html>
<head>
<script type="module">
const url = "${accessUrl}";
console.log(url);
document.getElementById("get").addEventListener("click", ev => {
  fetch(url, {mode: "cors"}).then(res => res.text()).then(text => alert(text));
});
document.getElementById("put").addEventListener("click", ev => {
  const msg = document.getElementById("msg").value;
  const req = new Request(url, {
    method: "PUT",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: msg,
    mode: "cors",
  });
  fetch(req).then(res => res.text()).then(text => alert(text));
});
</script>
</head>
<body>
  <button id="get">get</button>
  <hr />
  <input id="msg"><button id="put">put</button>
</body>
</html>`;
const webServer = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/html;charset=utf-8",
  });
  res.end(page);
});
const webPort = 8200;
webServer.listen(webPort);

const url = `http://localhost:${webPort}/`;
console.log(`[access via browser] ${url}`);
