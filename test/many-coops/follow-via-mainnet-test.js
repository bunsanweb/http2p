import {describe, it, before, after} from "node:test";
import {strict as assert} from "node:assert";

import * as fs from "node:fs";
import * as helia from "helia";
import {matchObject, rest} from "patcom";

import {createHttp2p} from "../../http2p.js";
import {createCoop} from "../../coop.js";

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
const checkMainnetConnected = async (coop, count = 1) => new Promise(f => {
  const listener = ev => {
    if (--count === 0) {
      coop.removeEventListener("mainnet-connected", listener);
      f();
    }
  };
  coop.addEventListener("mainnet-connected", listener);
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


describe("coop mainnet", async () => {
  let node1, node2, node3;
  let http2p1, http2p2, http2p3;
  before(async () => {
    node1 = await helia.createHelia();
    node2 = await helia.createHelia();
    node3 = await helia.createHelia();
    // connect node1 and node2 and node3
    await node2.libp2p.dial(node1.libp2p.getMultiaddrs()[0]);
    await node3.libp2p.dial(node2.libp2p.getMultiaddrs()[0]);
    await node1.libp2p.dial(node3.libp2p.getMultiaddrs()[0]);
    
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
  });

  // tests
  it("follow via mainnet", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2); // as mainnet-node
    const coop3 = createCoop(http2p3);
    coop1.keys.add("coop");
    coop3.keys.add("coop");

    
    // mainnet 1 and 2
    {
      const waitCoop1Connected = checkMainnetConnected(coop1);
      const waitCoop2Connected = checkMainnetConnected(coop2);
      const res = await http2p2.fetch(coop1.uri);
      await Promise.all([waitCoop1Connected, waitCoop2Connected]);
      
      const coop1Followings = coop1.followings.followings();
      const coop2Followings = coop2.followings.followings();
      const coop3Followings = coop3.followings.followings();
      assert.equal(coop1Followings.length, 0);
      assert.equal(coop2Followings.length, 0);
      assert.equal(coop3Followings.length, 0);
      // console.log("mainnet: 1 and 2");
    }
    
    
    // follow 1 and 3 via mainnet 2
    {
      const waitCoop1Follows = checkCoopDetected(coop1);
      const waitCoop3Follows = checkCoopDetected(coop3);
      const res = await http2p3.fetch(coop2.uri);
      await Promise.all([waitCoop1Follows, waitCoop3Follows]);
      
      const coop1Followings = coop1.followings.followings();
      const coop2Followings = coop2.followings.followings();
      const coop3Followings = coop3.followings.followings();
      //console.log(coop1Followings);
      //console.log(coop2Followings);
      //console.log(coop3Followings);
      assert.equal(coop1Followings.length, 1);
      assert.equal(coop2Followings.length, 0);
      assert.equal(coop3Followings.length, 1);
    }
    
    coop1.stop();
    coop2.stop();
    coop3.stop();
  });
});
