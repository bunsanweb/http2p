import {createHttp2p} from "http2p";
import {createHeliaWithHttp2pGateway} from "./connect-helia-gateway-servers.js";

const gatewayUrl = "http://localhost:9000/";
const node = await createHeliaWithHttp2pGateway(gatewayUrl);

const id = node.libp2p.peerId;
console.log("[id]", id.toJSON());

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
const url = `http://localhost:9000/${id.toJSON()}/`;
console.log(`open: ${url}`);
const link = document.createElement("a");
link.target = "_blank";
link.textContent = link.href = url;
document.body.append(link);
