import {describe, it, before, after, beforeEach, afterEach} from "node:test";
import {strict as assert} from "node:assert";

import * as fs from "node:fs";
import * as IPFS from "ipfs-core";
import {matchObject, rest} from "patcom";

import {createHttp2p} from "../../http2p.js";
import {createCoop} from "../../coop.js";

const checkCoopDetected = async (coop, count = 1) => new Promise(f => {
  const listener = ev => {
    if (--count === 0) {
      coop.removeEventListener("coop-detected", listener);
      f();
    }
  };
  coop.addEventListener("coop-detected", listener);
});

describe("coop follow with remote event via a intermediate node", async () => {
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
    await node3.swarm.connect((await node1.id()).addresses[0]);
    await node3.swarm.connect((await node2.id()).addresses[0]); // instead of using peer discovery
    
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


  it("follow via intermediary (add akey at one side)", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2);
    const coop3 = createCoop(http2p3);
    coop1.keys.add("coop1");
    coop1.keys.add("coop3"); // key:coop3 already existed at coop1
    coop2.keys.add("coop1");
    coop2.keys.add("coop2");
    coop3.keys.add("coop2");
    
    {
      const waitCoop1Follows = checkCoopDetected(coop1, 1);
      const waitCoop2Follows = checkCoopDetected(coop2, 2);
      const waitCoop3Follows = checkCoopDetected(coop3, 1);
      const res1 = await coop2.http2p.fetch(coop1.uri);
      const res2 = await coop3.http2p.fetch(coop2.uri);
      await Promise.all([waitCoop1Follows, waitCoop2Follows, waitCoop3Follows]);

      const coop1Followings = coop1.followings.followings();
      const coop2Followings = coop2.followings.followings();
      const coop3Followings = coop3.followings.followings();
      assert.equal(coop1Followings.length, 1);
      assert.equal(coop2Followings.length, 2);
      assert.equal(coop3Followings.length, 1);
      //console.log("pass");
    }
    //console.log("coop1", coop1.uri);
    //console.log("coop2", coop2.uri);
    //console.log("coop3", coop3.uri);
    coop3.keys.add("coop3");
    {
      const waitCoop1Followings = checkCoopDetected(coop1, 1);
      const waitCoop3Followings = checkCoopDetected(coop3, 1);
      await Promise.all([waitCoop1Followings, waitCoop3Followings]);
      const coop1Followings = coop1.followings.followings();
      const coop2Followings = coop2.followings.followings();
      const coop3Followings = coop3.followings.followings();
      assert.equal(coop1Followings.length, 2);
      assert.equal(coop2Followings.length, 2);
      assert.equal(coop3Followings.length, 2);      
    }
    
    coop1.stop();
    coop2.stop();
    coop3.stop();
  });

  it("follow via intermediary (add a key both side)", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2);
    const coop3 = createCoop(http2p3);
    coop1.keys.add("coop1");
    coop2.keys.add("coop1");
    coop2.keys.add("coop2");
    coop3.keys.add("coop2");
    
    {
      const waitCoop1Follows = checkCoopDetected(coop1, 1);
      const waitCoop2Follows = checkCoopDetected(coop2, 2);
      const waitCoop3Follows = checkCoopDetected(coop3, 1);
      const res1 = await coop2.http2p.fetch(coop1.uri);
      const res2 = await coop3.http2p.fetch(coop2.uri);
      await Promise.all([waitCoop1Follows, waitCoop2Follows, waitCoop3Follows]);

      const coop1Followings = coop1.followings.followings();
      const coop2Followings = coop2.followings.followings();
      const coop3Followings = coop3.followings.followings();
      assert.equal(coop1Followings.length, 1);
      assert.equal(coop2Followings.length, 2);
      assert.equal(coop3Followings.length, 1);
      //console.log("pass");
    }
    //console.log("coop1", coop1.uri);
    //console.log("coop2", coop2.uri);
    //console.log("coop3", coop3.uri);

    // add key:coop3 into both coop1 and coop3
    {
      const waitCoop1Followings = checkCoopDetected(coop1, 1);
      const waitCoop3Followings = checkCoopDetected(coop3, 1);
      
      coop1.keys.add("coop3"); 
      coop3.keys.add("coop3");
      await Promise.all([waitCoop1Followings, waitCoop3Followings]);
      const coop1Followings = coop1.followings.followings();
      const coop2Followings = coop2.followings.followings();
      const coop3Followings = coop3.followings.followings();
      assert.equal(coop1Followings.length, 2);
      assert.equal(coop2Followings.length, 2);
      assert.equal(coop3Followings.length, 2);      
    }
    
    coop1.stop();
    coop2.stop();
    coop3.stop();
  });
});
