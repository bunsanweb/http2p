import {describe, it, before, after} from "node:test";
import {strict as assert} from "node:assert";

import * as fs from "node:fs";
import * as helia from "helia";
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

const connectAsMesh = async nodes => {
  for (let i = 1; i < nodes.length; i++) for (let j = i - 1; j >= 0; j--) {
    await nodes[i].libp2p.dial(nodes[j].libp2p.getMultiaddrs()[0]);
  }
};

describe("coop follow with remote event via a intermediate node", async () => {
  let node1, node2, node3, node4;
  let http2p1, http2p2, http2p3, http2p4;
  before(async () => {
    node1 = await helia.createHelia();
    node2 = await helia.createHelia();
    node3 = await helia.createHelia();
    node4 = await helia.createHelia();
    connectAsMesh([node1, node2, node3, node4]);
    
    http2p1 = await createHttp2p(node1.libp2p);
    http2p2 = await createHttp2p(node2.libp2p);
    http2p3 = await createHttp2p(node3.libp2p);
    http2p4 = await createHttp2p(node4.libp2p);
  });
  after(async () => {
    http2p1.close();
    http2p2.close();
    http2p3.close();
    http2p4.close();
    await node1.stop();
    await node2.stop();
    await node3.stop();
    await node4.stop();
  });


  it("follow via intermediaries", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2);
    const coop3 = createCoop(http2p3);
    const coop4 = createCoop(http2p4);

    // 1<=>2 2<=>3 3<=>4
    coop1.keys.add("coop1");
    coop1.keys.add("coop4");

    coop2.keys.add("coop1");
    coop2.keys.add("coop2");

    coop3.keys.add("coop2");
    coop3.keys.add("coop3");

    coop4.keys.add("coop3");
    {
      const waitCoop1Follows = checkCoopDetected(coop1, 1);
      const waitCoop2Follows = checkCoopDetected(coop2, 2);
      const waitCoop3Follows = checkCoopDetected(coop3, 2);
      const waitCoop4Follows = checkCoopDetected(coop4, 1);
      
      const res1 = await coop2.http2p.fetch(coop1.uri);
      const res2 = await coop3.http2p.fetch(coop2.uri);
      //const res3 = await coop4.http2p.fetch(coop3.uri); //TBD: very slow
      const res3 = await coop3.http2p.fetch(coop4.uri);
      await Promise.all([waitCoop1Follows, waitCoop2Follows, waitCoop3Follows, waitCoop4Follows]);

      const coop1Followings = coop1.followings.followings();
      const coop2Followings = coop2.followings.followings();
      const coop3Followings = coop3.followings.followings();
      const coop4Followings = coop4.followings.followings();
      assert.equal(coop1Followings.length, 1);
      assert.equal(coop2Followings.length, 2);
      assert.equal(coop3Followings.length, 2);
      assert.equal(coop4Followings.length, 1);
      //console.log("pass");
    }
    //console.log("coop1", coop1.uri);
    //console.log("coop2", coop2.uri);
    //console.log("coop3", coop3.uri);
    //console.log("coop4", coop4.uri);

    // 1<=>2 2<=>3 3<=>4 plus 4<=>1
    {
      const waitCoop1Followings = checkCoopDetected(coop1, 1);
      const waitCoop4Followings = checkCoopDetected(coop4, 1);
      coop4.keys.add("coop4");
      
      await Promise.all([waitCoop1Followings, waitCoop4Followings]);
      const coop1Followings = coop1.followings.followings();
      const coop2Followings = coop2.followings.followings();
      const coop3Followings = coop3.followings.followings();
      const coop4Followings = coop4.followings.followings();
      assert.equal(coop1Followings.length, 2);
      assert.equal(coop2Followings.length, 2);
      assert.equal(coop3Followings.length, 2);      
      assert.equal(coop4Followings.length, 2);      
    }
    
    coop1.stop();
    coop2.stop();
    coop3.stop();
    coop4.stop();
  });
});
