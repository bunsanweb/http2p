import * as repl from "node:repl";
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
console.info("[gateway address 2]", gatewayAddrs[2].toJSON()); // ws


// http server for http2p gateway
const gatewayHttp2p = await createHttp2p(libp2pGateway);
const gatewayListener = createListener(gatewayHttp2p);
const gatewayServer = http.createServer(gatewayListener);
const gatewayPort = 8100;
gatewayServer.listen(gatewayPort);

// simple http2p server for fetch
const nodeServer = await createHelia();
console.info("[node server id]", nodeServer.libp2p.peerId.toJSON());
console.info("[node server address]", nodeServer.libp2p.getMultiaddrs()[0].toJSON());
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

await nodeServer.libp2p.dial(gatewayAddrs[0]);

// HTTP Server for Browser
const accessUrl = `http://localhost:${gatewayPort}/${nodeServer.libp2p.peerId}/`;
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

const stop = () => Promise.all([
  nodeServer.stop(),
  libp2pGateway.stop(),
  new Promise(f => gatewayServer.close(f)),
  new Promise(f => webServer.close(f)),  
]);
console.log("To stop with Ctrl+D");
const rs = repl.start({
  prompt: "> ",
});
rs.once("exit", () => {
  stop().then(() => {
    console.log("Wait to stop helia nodes and http servers...");
    rs.close();
  }).catch(console.error);
});
Object.assign(rs.context, {
  stop,
});
