import {describe, it, before, after, beforeEach, afterEach} from "node:test";
import {strict as assert} from "node:assert";

import * as fs from "node:fs";
import * as helia from "helia";
import {matchObject, rest} from "patcom";

import {createHttp2p} from "../http2p.js";
import {createCoop} from "../coop.js";
import {createCoopMdns} from "../coop-mdns.js";

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

describe("coop-mdns", async () => {
  let node1, node2;
  let http2p1, http2p2;
  //beforeEach(async () => {
  before(async () => {
    node1 = await helia.createHelia();
    node2 = await helia.createHelia();
    // connect node1 and node2
    await node2.libp2p.dial(node1.libp2p.getMultiaddrs()[0]);

    http2p1 = await createHttp2p(node1.libp2p);
    http2p2 = await createHttp2p(node2.libp2p);
  });
  //afterEach(async () => {
  after(async () => {
    http2p1.close();
    http2p2.close();
    await node1.stop();
    await node2.stop();
  });

  it("follow via coop-mdns", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2);
    coop1.keys.add("coop");
    coop2.keys.add("coop");
    
    const waitCoop1Follows = new Promise(f => coop1.addEventListener("coop-detected", ev => f(), {once: true}));
    const waitCoop2Follows = new Promise(f => coop2.addEventListener("coop-detected", ev => f(), {once: true}));

    const coopMdns1 = createCoopMdns(coop1);
    const coopMdns2 = createCoopMdns(coop2);
    
    await Promise.all([waitCoop1Follows, waitCoop2Follows]);

    const coop1Followings = coop1.followings.followings();
    const coop2Followings = coop2.followings.followings();
    //console.log(coop1Followings);
    //console.log(coop2Followings);
    assert.equal(coop1Followings.length, 1);
    assert.equal(coop2Followings.length, 1);
    
    coopMdns1.stop();
    coopMdns2.stop();
    coop1.stop();
    coop2.stop();
    
  });
});

