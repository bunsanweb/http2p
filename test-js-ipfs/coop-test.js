import {describe, it, before, after, beforeEach, afterEach} from "node:test";
import {strict as assert} from "node:assert";

import * as fs from "node:fs";
import * as IPFS from "ipfs-core";
import {matchObject, rest} from "patcom";

import {createHttp2p} from "../http2p.js";
import {createCoop} from "../coop.js";

// utilities for tests
const followToFrom = async (coop1, coop2) => {
  const waitCoop1Follows = new Promise(f => coop1.addEventListener("coop-detected", ev => f(), {once: true}));
  const waitCoop2Follows = new Promise(f => coop2.addEventListener("coop-detected", ev => f(), {once: true}));
  const res = await coop2.http2p.fetch(coop1.uri);
  await Promise.all([waitCoop1Follows, waitCoop2Follows]);  
};
const checkEventArrived = async (coop, type, link) => {
  const findLastEvent = matchObject({type, link: Object.assign({}, link, {rest}), rest});
  const reader = coop.watch(eventData => findLastEvent(eventData).matched);
  for await (const eventData of reader) break;
};
const checkNoEventsArrived = async (coop, type, link, timeoutMsec = 10) => {
  const timeout = new Promise(f => setTimeout(f, timeoutMsec, {}));
  const findLastEvent = matchObject({type, link: Object.assign({}, link, {rest}), rest});
  const rs = coop.watch(eventData => findLastEvent(eventData).matched);
  const reader = rs.getReader();
  const ret = await Promise.race([reader.read(), timeout]);
  try {
    assert.equal(Object.hasOwn(ret, "done"), false, "event arrived before timeout");
  } finally {
    reader.releaseLock();
    await rs.cancel();
  }
};


describe("coop", async () => {
  const repo1 = "./.repos/test-repo1", repo2 = "./.repos/test-repo2";
  let node1, node2;
  let http2p1, http2p2;
  //beforeEach(async () => {
  before(async () => {
    fs.rmSync(repo1, {recursive: true, force: true});
    fs.rmSync(repo2, {recursive: true, force: true});
    node1 = await IPFS.create({
      silent: true,
      repo: repo1,
      config: {Addresses: {Swarm: ["/ip4/0.0.0.0/tcp/0"]}},
    });
    node2 = await IPFS.create({
      silent: true,
      repo: repo2,
      config: {Addresses: {Swarm: ["/ip4/0.0.0.0/tcp/0"]}},
    });
    // connect node1 and node2
    await node2.swarm.connect((await node1.id()).addresses[0]);
    //await node1.swarm.connect((await node2.id()).addresses[0]);
    
    http2p1 = await createHttp2p(node1.libp2p);
    http2p2 = await createHttp2p(node2.libp2p);
  });
  //afterEach(async () => {
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
    // TBD: no detection methods of accessed but not followed
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
    await followToFrom(coop1, coop2);
    
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
    await followToFrom(coop1, coop2);
    
    // example data
    const uri1 = "http://example.com/foo";
    const props1 = {"rel": "text"};
    const start = new Date(new Date().toUTCString());// drop msec

    const watchDone = (async () => {
      const reader = coop2.watch(eventData => eventData.type === "link-added");
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

  it("watch events of updating value", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2);
    coop1.keys.add("coop");
    coop2.keys.add("coop");
    await followToFrom(coop1, coop2);
    
    const start = new Date(new Date().toUTCString());// drop msec
    //set prop
    const uri1 = "http://example.com/foo";
    const prop1 = {keyword: "foo"};
    const prop2 = {keyword: "bar"};
    const prop3 = {keyword: "buzz"};
    coop1.put(uri1, prop1);
    await checkEventArrived(coop2, "link-added", {uri: uri1, key: "keyword", value: "foo"});

    // watchers with patcom matchers for update prop
    const findBar = matchObject({type: "link-added", link: {key: "keyword", value: /^bar$/, rest}, rest});
    const watchBar = (async () => {
      const reader = coop2.watch(eventData => findBar(eventData).matched);
      for await (const {type, uri, time, link} of reader) {
        assert.equal(type, "link-added");
        assert.equal(uri, coop1.uri);
        assert.ok(new Date(time) >= start);
        assert.equal(link.uri, uri1);
        assert.equal(link.key, "keyword");
        assert.equal(link.value, "bar");
        break;
      }
    })();
    const findBuzz = matchObject({type: "link-added", link: {key: "keyword", value: /^buzz$/, rest}, rest});
    const watchBuzz = (async () => {
      const reader = coop2.watch(eventData => findBuzz(eventData).matched);
      for await (const {type, uri, time, link} of reader) {
        assert.equal(type, "link-added");
        assert.equal(uri, coop1.uri);
        assert.ok(new Date(time) >= start);
        assert.equal(link.uri, uri1);
        assert.equal(link.key, "keyword");
        assert.equal(link.value, "buzz");
        break;
      }
    })();

    coop1.put(uri1, prop2); // first update
    coop1.put(uri1, prop3); // second update
    await Promise.all([watchBar, watchBuzz]);
    {
      const props = coop2.getMultiProps(uri1);
      const values = props.get("keyword");
      assert.equal(values.size, 1);
      assert.equal(values.get(coop1.uri), "buzz");
    }
    
    const findDrop = matchObject({type: "link-removed", link: {key: "keyword", rest}, rest});
    const watchDrop = (async () => {
      const reader = coop2.watch(eventData => findDrop(eventData).matched);
      for await (const {type, uri, time, link} of reader) {
        assert.equal(type, "link-removed");
        assert.equal(uri, coop1.uri);
        assert.ok(new Date(time) >= start);
        assert.equal(link.uri, uri1);
        assert.equal(link.key, "keyword");
        assert.equal(link.value, "buzz");
        break;
      }
    })();

    coop1.drop(uri1, ["keyword"]);
    await watchDrop;
    {
      const props = coop2.getMultiProps(uri1);
      assert.ok(!props.has("keyword"));
    }
    
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
    await followToFrom(coop1, coop2);
    
    const all = new Set(coop2.find(props => true));
    assert.equal(all.size, 2);
    assert.ok(all.has(uri1));
    assert.ok(all.has(uri2));

    const textOnly = new Set(coop2.find(props => {
      return props.find(({key}) => key === "rel")?.value === "text";
    }));
    assert.equal(textOnly.size, 1);
    assert.ok(textOnly.has(uri1));
    
    coop1.stop();
    coop2.stop();
  });

  it("find after updated by remote events", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2);

    // follow
    coop1.keys.add("coop");
    coop2.keys.add("coop");
    await followToFrom(coop1, coop2);
    
    // example data
    const start = new Date(new Date().toUTCString());// drop msec
    const uri1 = "http://example.com/foo";
    const props1 = {"rel": "text"};
    coop1.put(uri1, props1);

    const uri2 = "http://example.com/bar";
    const props2 = {"rel": "css"};
    coop1.put(uri2, props2);
    await checkEventArrived(coop2, "link-added", {uri: uri2, key: "rel", value: "css"});
    
    const all = new Set(coop2.find(props => true));
    //console.log(all);
    assert.equal(all.size, 2);
    assert.ok(all.has(uri1));
    assert.ok(all.has(uri2));

    const textOnly = new Set(coop2.find(props => {
      return props.find(({key}) => key === "rel")?.value === "text";
    }));
    assert.equal(textOnly.size, 1);
    assert.ok(textOnly.has(uri1));

    coop1.stop();
    coop2.stop();
  });
  
  it("find after removed and updated by remote events", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2);

    // follow
    coop1.keys.add("coop");
    coop2.keys.add("coop");
    await followToFrom(coop1, coop2);
    
    // example data
    const start = new Date(new Date().toUTCString());// drop msec
    const uri1 = "http://example.com/foo";
    const props1 = {"rel": "text"};
    coop1.put(uri1, props1);

    const uri2 = "http://example.com/bar";
    const props2 = {"rel": "css"};
    coop1.put(uri2, props2);
    await checkEventArrived(coop2, "link-added", {uri: uri2, key: "rel", value: "css"});
    
    const textOnly1 = new Set(coop2.find(props => {
      return props.find(({key}) => key === "rel")?.value === "text";
    }));
    assert.equal(textOnly1.size, 1);
    assert.ok(textOnly1.has(uri1));

    // remove
    coop1.drop(uri1, ["rel"]);
    await new Promise(f => setTimeout(f, 200));
    const textOnly2 = new Set(coop2.find(props => {
      return props.find(({key}) => key === "rel")?.value === "text";
    }));
    assert.equal(textOnly2.size, 0);

    // update
    coop1.put(uri1, props2);
    await new Promise(f => setTimeout(f, 200));
    const textOnly3 = new Set(coop2.find(props => {
      return props.find(({key}) => key === "rel")?.value === "text";
    }));
    assert.equal(textOnly3.size, 0);
    const cssOnly = new Set(coop2.find(props => {
      return props.find(({key}) => key === "rel")?.value === "css";
    }));
    assert.equal(cssOnly.size, 2);
    assert.ok(cssOnly.has(uri1));
    assert.ok(cssOnly.has(uri2));

    coop1.stop();
    coop2.stop();
  });

  it("ignore props after common key removed", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2);
    coop1.keys.add("coop");
    coop2.keys.add("coop");

    // example data
    const uri1 = "http://example.com/foo";
    const props1 = {"rel": "text"};
    const start = new Date(new Date().toUTCString());// drop msec
    coop1.put(uri1, props1);

    await followToFrom(coop1, coop2);

    const findBefore = [...coop2.find(props => props.find(({key}) => key === "rel")?.value === "text")];
    assert.deepEqual(findBefore, [uri1]);

    const followingsBefore = coop2.followings.followings();
    assert.deepEqual(followingsBefore, [coop1.uri]);

    coop2.keys.remove("coop");

    const findAfter = [...coop2.find(props => props.find(({key}) => key === "rel")?.value === "text")];
    assert.deepEqual(findAfter, []);

    const followingsAfter = coop2.followings.followings();
    assert.deepEqual(followingsAfter, []);

    coop1.stop();
    coop2.stop();
  });

  
  it("ignore events after common key removed", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2);
    coop1.keys.add("coop");
    coop2.keys.add("coop");

    // example data
    const uri1 = "http://example.com/foo";
    const props1 = {"rel": "text"};
    const props2 = {"rel": "css"};
    const props3 = {"rel": "plain"};
    const start = new Date(new Date().toUTCString());// drop msec
    coop1.put(uri1, props1);

    await followToFrom(coop1, coop2);
    
    const findBefore = [...coop2.find(props => props.find(({key}) => key === "rel")?.value === "text")];
    assert.deepEqual(findBefore, [uri1]);
    
    const followingsBefore = coop2.followings.followings();
    assert.deepEqual(followingsBefore, [coop1.uri]);

    // update props from followed
    coop1.put(uri1, props2);
    //await checkNoEventsArrived(coop2, "link-added", {uri: uri1, key: "rel", value: "css"});
    await checkEventArrived(coop2, "link-added", {uri: uri1, key: "rel", value: "css"});

    // remove common key
    coop2.keys.remove("coop");
    const followingsAfter = coop2.followings.followings();
    assert.deepEqual(followingsAfter, []);
    
    // update props from unfollowed
    coop1.put(uri1, props3);
    await checkNoEventsArrived(coop2, "link-added", {uri: uri1, key: "rel", value: "plain"});
    
    coop1.stop();
    coop2.stop();
  });

});
