// This test does not work with current werift implementation; it works with @koush/wrtc
import {describe, it, before, after} from "node:test";
import {strict as assert} from "node:assert";

import * as fs from "node:fs";
import * as IPFS from "ipfs-core";
import {sigServer} from "@libp2p/webrtc-star-signalling-server";
import {webRTCStar} from "@libp2p/webrtc-star";
import wrtc from "werift";
//import wrtc from "@koush/wrtc";

import {createHttp2p} from "../http2p.js";

describe("libp2p with werift", async () => {
  const repo1 = "./.repos/test-repo1", repo2 = "./.repos/test-repo2";
  let sig;
  let node1, node2;
  before(async () => {
    sig = await sigServer({port: 9090, host: "0.0.0.0"});
    fs.rmSync(repo1, {recursive: true, force: true});
    fs.rmSync(repo2, {recursive: true, force: true});
    const star1 = webRTCStar({wrtc});
    node1 = await IPFS.create({
      repo: repo1,
      config: {
        Addresses: {Swarm: ["/ip4/127.0.0.1/tcp/9090/ws/p2p-webrtc-star"]},
        Discovery: {webRTCStar: {Enabled: true}},
      },
      libp2p: {
        transports: [star1.transport],
        peerDiscovery: [star1.discovery],
      },
    });
    const star2 = webRTCStar({wrtc});
    node2 = await IPFS.create({
      repo: repo2,
      config: {
        Addresses: {Swarm: ["/ip4/127.0.0.1/tcp/9090/ws/p2p-webrtc-star"]},
        Discovery: {webRTCStar: {Enabled: true}},
      },
      libp2p: {
        transports: [star2.transport],
        peerDiscovery: [star2.discovery],
      },
    });
    // connect node1 and node2
    //console.log((await node1.id()).addresses[0].toJSON());
    await node2.swarm.connect((await node1.id()).addresses[0]);
  });
  after(async () => {
    await node1.stop();
    await node2.stop();
    fs.rmSync(repo1, {recursive: true, force: true});
    fs.rmSync(repo2, {recursive: true, force: true});
    sig.stop();
  });

  // tests
  it("Register fetch handler and access with fetch function", async () => {
    const node1Http2p = await createHttp2p(node1.libp2p);
    const node2Http2p = await createHttp2p(node2.libp2p);
    
    const id1 = (await node1.id()).id.toJSON();
    const id2 = (await node2.id()).id.toJSON();
    const uri = `http2p:${id1}/`;
    
    node1Http2p.scope.addEventListener("fetch", ev => {
      //console.log(ev.request);
      assert.equal(ev.request.url, uri, "FetchEvent.request.url is http2p uri");
      assert.equal(ev.remotePeerId, id2, "FetchEvent.remotePeerId is client peer-id");
      
      ev.respondWith(new Response(
        "Hello World",
        {
          headers: {
            "content-type": "text/plain;charset=utf-8",
          },
        }
      ));
    });
    const res = await node2Http2p.fetch(uri);
    assert.equal(res.headers.get("content-type"), "text/plain;charset=utf-8", "content-type is plain utf-8 text");
    assert.equal(await res.text(), "Hello World", "body is Hello World");
    
    await Promise.allSettled([node1Http2p.close(), node2Http2p.close()]);
  });
});
