import {describe, it, before, after} from "node:test";
import {strict as assert} from "node:assert";

import * as fs from "node:fs";
import * as IPFS from "ipfs-core";

import {createHttp2p} from "../http2p.js";
import {createCoop} from "../coop.js";

describe("coop", async () => {
  const repo1 = "./.repos/test-repo1", repo2 = "./.repos/test-repo2";
  let node1, node2;
  let http2p1, http2p2;
  before(async () => {
    fs.rmSync(repo1, {recursive: true, force: true});
    fs.rmSync(repo2, {recursive: true, force: true});
    node1 = await IPFS.create({
      repo: repo1,
      config: {Addresses: {Swarm: ["/ip4/0.0.0.0/tcp/0"]}},
    });
    node2 = await IPFS.create({
      repo: repo2,
      config: {Addresses: {Swarm: ["/ip4/0.0.0.0/tcp/0"]}},
    });
    // connect node1 and node2
    await node2.swarm.connect((await node1.id()).addresses[0]);
    //await node1.swarm.connect((await node2.id()).addresses[0]);
    
    http2p1 = await createHttp2p(node1.libp2p);
    http2p2 = await createHttp2p(node2.libp2p);
  });
  after(async () => {
    http2p1.close();
    http2p2.close();
    await node1.stop();
    await node2.stop();
    fs.rmSync(repo1, {recursive: true, force: true});
    fs.rmSync(repo2, {recursive: true, force: true});
  });

  // tests
  it("Do start and stop", async () => {
    const coop1 = createCoop(http2p1);
    //console.log(coop1.uri);
    assert.equal(coop1.stopped, false);
    coop1.stop();
  });

  it("add/remove coop keys", async () => {
    const coop1 = createCoop(http2p1);
    coop1.keys.add("http2p:foobar/buzz");
    assert.deepEqual(coop1.keys.currentKeys, ["http2p:foobar/buzz"], "key added");
    coop1.keys.remove("http2p:foobar/buzz");
    assert.deepEqual(coop1.keys.currentKeys, [], "key removed");
    coop1.stop();
  });
  
  it("put/drop uri props", async () => {
    const coop1 = createCoop(http2p1);
    const uri1 = "http://example.com/foo";
    coop1.put(uri1, {"content-type": "text/html;chraset=utf-8", "rel": "text"});
    assert.deepEqual(coop1.getProps(uri1), {"content-type": "text/html;chraset=utf-8", "rel": "text"}, "props added");
    coop1.put(uri1, {rel: "web-page", "atom:canonical": "http://example.com/foo.html"});
    assert.deepEqual(coop1.getProps(uri1), {
      "content-type": "text/html;chraset=utf-8", "rel": "web-page", "atom:canonical": "http://example.com/foo.html"}, "props updated");
    coop1.drop(uri1, ["rel", "atom:canonical"]);
    assert.deepEqual(coop1.getProps(uri1), {"content-type": "text/html;chraset=utf-8"}, "props droped");
    coop1.stop();
  });
  
  it("follow via coop's http2p.fetch: not matched keys", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2);
    coop1.keys.add("coop");
    //coop2.keys.add("coop");
    //console.log(coop1.uri);
    const res = await http2p2.fetch(coop1.uri);
    //console.log(await res.text());
    // TBD
    await new Promise(f => setTimeout(f, 100));
    assert.equal(coop1.followings.followings().length, 0);
    assert.equal(coop2.followings.followings().length, 0);
    coop1.stop();
    coop2.stop();
  });

  it("follow via coop's http2p.fetch", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2);
    coop1.keys.add("coop");
    coop2.keys.add("coop");
    //console.log(coop1.uri);
    const res = await http2p2.fetch(coop1.uri);
    //console.log(await res.text());
    // TBD
    await new Promise(f => setTimeout(f, 100));
    const coop1Followings = coop1.followings.followings();
    const coop2Followings = coop2.followings.followings();
    //console.log(coop1Followings);
    //console.log(coop2Followings);
    assert.equal(coop1Followings.length, 1);
    assert.equal(coop2Followings.length, 1);
    coop1.stop();
    coop2.stop();
  });

  it("update by propagated links events", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2);
    coop1.keys.add("coop");
    coop2.keys.add("coop");
    const res = await http2p2.fetch(coop1.uri);
    await new Promise(f => setTimeout(f, 100));

    // example data
    const uri1 = "http://example.com/foo";
    const props1 = {"rel": "text"};
    const start = new Date(new Date().toUTCString());// drop msec

    const watchDone = (async () => {
      const reader = coop2.watch(eventData => true);
      //console.log(reader);
      for await (const {type, uri, time, link} of reader) {
        //console.log(type, uri, time, link);
        assert.equal(type, "link-added");
        assert.equal(uri, coop1.uri);
        assert.ok(new Date(time) >= start);
        assert.equal(link.uri, uri1);
        assert.equal(link.key, "rel");
        assert.equal(link.value, "text");
        break;
      }
    })();
    coop1.put(uri1, props1);
    await watchDone;

    coop1.stop();
    coop2.stop();
  });

  it("find after following", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2);

    // example data
    const start = new Date(new Date().toUTCString());// drop msec
    const uri1 = "http://example.com/foo";
    const props1 = {"rel": "text"};
    coop1.put(uri1, props1);

    const uri2 = "http://example.com/bar";
    const props2 = {"rel": "css"};
    coop1.put(uri2, props2);

    // follow
    coop1.keys.add("coop");
    coop2.keys.add("coop");
    const res = await http2p2.fetch(coop1.uri);
    await new Promise(f => setTimeout(f, 100));

    const all = new Set(coop2.find(props => true));
    assert.ok(all.size === 2 && all.has(uri1) && all.has(uri2));

    const textOnly = new Set(coop2.find(props => {
      return props.find(({key}) => key === "rel")?.value === "text";
    }));
    assert.ok(textOnly.size === 1 && textOnly.has(uri1));

    coop1.stop();
    coop2.stop();
  });

  it("find after updated by remote events", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2);

    // follow
    coop1.keys.add("coop");
    coop2.keys.add("coop");
    const res = await http2p2.fetch(coop1.uri);
    await new Promise(f => setTimeout(f, 100));

    // example data
    const start = new Date(new Date().toUTCString());// drop msec
    const uri1 = "http://example.com/foo";
    const props1 = {"rel": "text"};
    coop1.put(uri1, props1);

    const uri2 = "http://example.com/bar";
    const props2 = {"rel": "css"};
    coop1.put(uri2, props2);
    await new Promise(f => setTimeout(f, 100));

    const all = new Set(coop2.find(props => true));
    assert.ok(all.size === 2 && all.has(uri1) && all.has(uri2));

    const textOnly = new Set(coop2.find(props => {
      return props.find(({key}) => key === "rel")?.value === "text";
    }));
    assert.ok(textOnly.size === 1 && textOnly.has(uri1));

    coop1.stop();
    coop2.stop();
  });
});
