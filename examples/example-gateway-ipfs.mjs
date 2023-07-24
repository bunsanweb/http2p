import * as http from "node:http";
// IPFS
import {createHelia} from "helia";
import {createHttp2p} from "../http2p.js";
import {createListener} from "../gateway-http2p.js";

// node for gateway
const nodeGateway = await createHelia();
console.info("[node gateway id]", nodeGateway.libp2p.peerId.toJSON());
console.info("[node gateway address 0]", nodeGateway.libp2p.getMultiaddrs()[0].toJSON()); // tcp: localhost

// http server for gateway
const gatewayHttp2p = await createHttp2p(nodeGateway.libp2p);
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
await nodeServer.libp2p.dial(nodeGateway.libp2p.getMultiaddrs()[0]); //TBD add gateway address in bootstrap list

const url = `http://localhost:${port}/${nodeServer.libp2p.peerId}/`;
console.log(`[access via browser] ${url}`);
console.log("[fetch]", await (await fetch(url)).text());

await nodeGateway.stop();
await nodeServer.stop();
await new Promise(f => server.close(f));

