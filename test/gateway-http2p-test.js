import {describe, it, before, after} from "node:test";
import {strict as assert} from "node:assert";

import * as fs from "node:fs";
import * as http from "node:http";
//import * as IPFS from "ipfs-core";
import * as helia from "helia";

import {createHttp2p} from "../http2p.js";
import {createListener} from "../gateway-http2p.js";

describe("gateway-http2p", async () => {
  let node1, node2;
  before(async () => {
    node1 = await helia.createHelia();
    node2 = await helia.createHelia();
    // connect node1 and node2
    await node2.libp2p.dial(node1.libp2p.getMultiaddrs()[0]);
  });
  after(async () => {
    await node1.stop();
    await node2.stop();
  });
  
  // tests
  it("Create and access gateway and http2p node", async () => {
    const node1Http2p = await createHttp2p(node1.libp2p);
    const node2Http2p = await createHttp2p(node2.libp2p);
    
    const id1 = node1.libp2p.peerId.toJSON();
    const id2 = node2.libp2p.peerId.toJSON();
    
    const uri = `http2p:${id2}/`; // request.url accessed from gateway 
    const port = 9000;
    const url = `http://localhost:${port}/${id2}/`; // http url to gateway

    // create gateway http server
    const gatewayListener = createListener(node1Http2p);
    const httpServer = http.createServer(gatewayListener);
    httpServer.listen(port);

    // simple text serving node
    node2Http2p.scope.addEventListener("fetch", ev => {
      //console.log(ev.request);
      assert.equal(ev.request.url, uri, "FetchEvent.request.url is http2p uri");
      assert.equal(ev.remotePeerId, id1, "FetchEvent.remotePeerId is client peer-id");
      
      ev.respondWith(new Response(
        "Hello World",
        {
          headers: {
            "content-type": "text/plain;charset=utf-8",
          },
        }
      ));
    });

    // fetch with http url
    const res = await fetch(url);
    //console.log(res);
    assert.equal(res.headers.get("content-type"), "text/plain;charset=utf-8", "content-type is plain utf-8 text");
    assert.equal(await res.text(), "Hello World", "body is Hello World");

    await new Promise(f => httpServer.close(f));
    await Promise.allSettled([node1Http2p.close(),  node2Http2p.close()]);
  });
});
