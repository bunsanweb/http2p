import {describe, it, before, after} from "node:test";
import {strict as assert} from "node:assert";

import * as fs from "node:fs";
import * as IPFS from "ipfs-core";
import {matchObject, rest} from "patcom";

import {createHttp2p} from "../http2p.js";
import {createCoop} from "../coop.js";

// helpers
const checkCoopDetected = async (coop, count = 1) => new Promise(f => {
  const listener = ev => {
    if (--count === 0) {
      coop.removeEventListener("coop-detected", listener);
      f();
    }
  };
  coop.addEventListener("coop-detected", listener);
});
const follow3Coops = async (coop1, coop2, coop3) => {
  const waitCoop1Follows = checkCoopDetected(coop1, 2);
  const waitCoop2Follows = checkCoopDetected(coop2, 2);
  const waitCoop3Follows = checkCoopDetected(coop3, 2);
  const res1 = await coop2.http2p.fetch(coop1.uri);
  const res2 = await coop3.http2p.fetch(coop2.uri);
  await Promise.all([waitCoop1Follows, waitCoop2Follows, waitCoop3Follows]);
};
const checkEventArrived = async (coop, type, link) => {
  const findLastEvent = matchObject({type, link: Object.assign({}, link, {rest}), rest});
  const reader = coop.watch(eventData => findLastEvent(eventData).matched);
  for await (const eventData of reader) break;
};


describe("coop", async () => {
  const repo1 = "./.repos/test-repo1", repo2 = "./.repos/test-repo2", repo3 = "./.repos/test-repo3";
  let node1, node2, node3;
  let http2p1, http2p2, http2p3;
  before(async () => {
    fs.rmSync(repo1, {recursive: true, force: true});
    fs.rmSync(repo2, {recursive: true, force: true});
    fs.rmSync(repo3, {recursive: true, force: true});
    node1 = await IPFS.create({
      repo: repo1,
      config: {Addresses: {Swarm: ["/ip4/0.0.0.0/tcp/0"]}},
    });
    node2 = await IPFS.create({
      repo: repo2,
      config: {Addresses: {Swarm: ["/ip4/0.0.0.0/tcp/0"]}},
    });
    node3 = await IPFS.create({
      repo: repo3,
      config: {Addresses: {Swarm: ["/ip4/0.0.0.0/tcp/0"]}},
    });
    // connect node1 and node2 and node3
    await node2.swarm.connect((await node1.id()).addresses[0]);
    await node3.swarm.connect((await node2.id()).addresses[0]);
    await node1.swarm.connect((await node3.id()).addresses[0]); // instead of using peer discovery
    
    http2p1 = await createHttp2p(node1.libp2p);
    http2p2 = await createHttp2p(node2.libp2p);
    http2p3 = await createHttp2p(node3.libp2p);
  });
  after(async () => {
    http2p1.close();
    http2p2.close();
    http2p3.close();
    await node1.stop();
    await node2.stop();
    await node3.stop();
    fs.rmSync(repo1, {recursive: true, force: true});
    fs.rmSync(repo2, {recursive: true, force: true});
    fs.rmSync(repo3, {recursive: true, force: true});
  });

  // tests
  it("add followings from events", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2);
    const coop3 = createCoop(http2p3);
    coop1.keys.add("coop");
    coop2.keys.add("coop");
    coop3.keys.add("coop");

    // follow 1 and 2
    {
      const waitCoop1Follows = checkCoopDetected(coop1);
      const waitCoop2Follows = checkCoopDetected(coop2);
      const res = await http2p2.fetch(coop1.uri);
      await Promise.all([waitCoop1Follows, waitCoop2Follows]);
      
      const coop1Followings = coop1.followings.followings();
      const coop2Followings = coop2.followings.followings();
      const coop3Followings = coop3.followings.followings();
      assert.equal(coop1Followings.length, 1);
      assert.equal(coop2Followings.length, 1);
      assert.equal(coop3Followings.length, 0);
    }
    

    // follow 2 and 3
    {
      const waitCoop1Follows = checkCoopDetected(coop1);
      const waitCoop2Follows = checkCoopDetected(coop2);
      const waitCoop3Follows = checkCoopDetected(coop3, 2);
      const res = await http2p3.fetch(coop2.uri);
      await Promise.all([waitCoop1Follows, waitCoop2Follows, waitCoop3Follows]);

      const coop1Followings = coop1.followings.followings();
      const coop2Followings = coop2.followings.followings();
      const coop3Followings = coop3.followings.followings();
      //console.log(coop1Followings);
      //console.log(coop2Followings);
      //console.log(coop3Followings);
      assert.equal(coop1Followings.length, 2);
      assert.equal(coop2Followings.length, 2);
      assert.equal(coop3Followings.length, 2);
    }
    
    coop1.stop();
    coop2.stop();
    coop3.stop();
  });

  it("set diffrent props to the same uri from diffrent coop nodes", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2);
    const coop3 = createCoop(http2p3);
    coop1.keys.add("coop");
    coop2.keys.add("coop");
    coop3.keys.add("coop");
    await follow3Coops(coop1, coop2, coop3);
    
    //set diffrent prop into same uri
    const uri = "http://example.com/foo";
    const propByCoop1 = {keyword: "foo"};
    const propByCoop2 = {keyword: "bar"};
    coop1.put(uri, propByCoop1);
    await checkEventArrived(coop3, "link-added", {uri, key: "keyword", value: "foo"});
    coop2.put(uri, propByCoop2);
    await checkEventArrived(coop3, "link-added", {uri, key: "keyword", value: "bar"});

    // multiple property values
    const props = coop3.getMultiProps(uri);
    //console.log(props);
    const values = props.get("keyword");
    assert.equal(values.size, 2);
    assert.equal(values.get(coop1.uri), "foo");
    assert.equal(values.get(coop2.uri), "bar");

    // find uri with some key-value set
    {
      const keywordIsBar = prop => matchObject({key: "keyword", value: "bar", rest})(prop).matched;
      const result = new Set(coop3.find(props => props.some(keywordIsBar)));
      assert.equal(result.size, 1);
      assert.ok(result.has(uri));
    }
    {
      const keywordIsBuzz = prop => matchObject({key: "keyword", value: "buzz", rest})(prop).matched;
      const result = new Set(coop3.find(props => props.some(keywordIsBuzz)));
      assert.equal(result.size, 0);
    }
    
    
    coop1.stop();
    coop2.stop();
    coop3.stop();
  });
});
