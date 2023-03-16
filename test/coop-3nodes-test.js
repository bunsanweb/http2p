import {describe, it, before, after} from "node:test";
import {strict as assert} from "node:assert";

import * as fs from "node:fs";
import * as IPFS from "ipfs-core";

import {createHttp2p} from "../http2p.js";
import {createCoop} from "../coop.js";

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
      const res = await http2p2.fetch(coop1.uri);
      await new Promise(f => setTimeout(f, 100));

      const coop1Followings = coop1.followings.followings();
      const coop2Followings = coop2.followings.followings();
      const coop3Followings = coop3.followings.followings();
      assert.equal(coop1Followings.length, 1);
      assert.equal(coop2Followings.length, 1);
      assert.equal(coop3Followings.length, 0);
    }
    

    // follow 2 and 3
    {
      const res = await http2p3.fetch(coop2.uri);
      await new Promise(f => setTimeout(f, 100));

      const coop1Followings = coop1.followings.followings();
      const coop2Followings = coop2.followings.followings();
      const coop3Followings = coop3.followings.followings();
      console.log(coop1Followings);
      console.log(coop2Followings);
      console.log(coop3Followings);
      assert.equal(coop1Followings.length, 2);
      assert.equal(coop2Followings.length, 2);
      assert.equal(coop3Followings.length, 2);
    }
    
    coop1.stop();
    coop2.stop();
    coop3.stop();
  });

});
