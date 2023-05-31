import {describe, it, before, after, beforeEach, afterEach} from "node:test";
import {strict as assert} from "node:assert";
import {setMaxListeners} from "node:events";

import * as fs from "node:fs";
import * as IPFS from "ipfs-core";
import {matchObject, rest} from "patcom";

import {createHttp2p} from "../http2p.js";
import {createCoop} from "../coop.js";
import {createCoopIpfs} from "../coop-ipfs.js";

setMaxListeners(13); // stop MaxListenersExceededWarning from IPFS findProviders on nodejs (default = 10)

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

describe("coop-ipfs", async () => {
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

  it("share IPFS URI via coop-ipfs", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2);
    coop1.keys.add("coop");
    coop2.keys.add("coop");
    await followToFrom(coop1, coop2);
    
    const coopIpfs1 = await createCoopIpfs(coop1, node1);
    const coopIpfs2 = await createCoopIpfs(coop2, node2);

    const waitShared = checkEventArrived(coop2, "link-added", {key: "content-type", value: /^text\/plain/});
    const blob1 = new Blob(["Hello World"], {type: "text/plain;charset=utf-8"});
    const ipfsUri = await coopIpfs1.share(blob1);
    await waitShared;
    
    const list1 = await coopIpfs1.list();
    const list2 = await coopIpfs2.list();
    assert.deepEqual(list1, [ipfsUri]);
    assert.deepEqual(list2, [ipfsUri]);
    const blob2 = await coopIpfs2.get(ipfsUri);
    assert.equal(blob2.type, "text/plain;charset=utf-8");
    assert.equal(await blob2.text(), "Hello World");

    coopIpfs1.stop();
    coopIpfs2.stop();
    
    coop1.stop();
    coop2.stop();
  });

  it("share IPFS URI via coop-ipfs from both side", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2);
    coop1.keys.add("coop");
    coop2.keys.add("coop");
    await followToFrom(coop1, coop2);
    
    const coopIpfs1 = await createCoopIpfs(coop1, node1);
    const coopIpfs2 = await createCoopIpfs(coop2, node2);

    // shared from coop1
    const waitShared1 = checkEventArrived(coop2, "link-added", {key: "content-type", value: /^text\/plain/});
    const blob1 = new Blob(["Hello World"], {type: "text/plain;charset=utf-8"});
    const ipfsUri1 = await coopIpfs1.share(blob1);
    await waitShared1;

    const listA1 = await coopIpfs1.list();
    const listA2 = await coopIpfs2.list();
    assert.deepEqual(listA1, [ipfsUri1]);
    assert.deepEqual(listA2, [ipfsUri1]);
    const blobA = await coopIpfs2.get(ipfsUri1);
    assert.equal(blobA.type, "text/plain;charset=utf-8");
    assert.equal(await blobA.text(), "Hello World");
    
    // shared from coop2
    const waitShared2 = checkEventArrived(coop1, "link-added", {key: "content-type", value: /^application\/octet-stream/});
    const blob2 = new Blob([new Uint8Array([0xCA, 0xFE, 0xBA, 0xBE])], {type: "application/octet-stream"});
    const ipfsUri2 = await coopIpfs2.share(blob2);
    await waitShared2;
    
    const listB1 = await coopIpfs1.list();
    const listB2 = await coopIpfs2.list();
    assert.deepEqual(listB1, [ipfsUri1, ipfsUri2]);
    assert.deepEqual(listB2, [ipfsUri1, ipfsUri2]);
    const blobB = await coopIpfs1.get(ipfsUri2);
    assert.equal(blobB.type, "application/octet-stream");
    assert.deepEqual(new Uint8Array(await blobB.arrayBuffer()), new Uint8Array([0xCA, 0xFE, 0xBA, 0xBE]));
    
    coopIpfs1.stop();
    coopIpfs2.stop();
    
    coop1.stop();
    coop2.stop();
  });

  it("share IPFS URI of large size via coop-ipfs", async () => {
    const coop1 = createCoop(http2p1);
    const coop2 = createCoop(http2p2);
    coop1.keys.add("coop");
    coop2.keys.add("coop");
    await followToFrom(coop1, coop2);
    
    const coopIpfs1 = await createCoopIpfs(coop1, node1);
    const coopIpfs2 = await createCoopIpfs(coop2, node2);

    const waitShared = checkEventArrived(coop2, "link-added", {key: "content-type", value: /^application\/octet-stream/});
    const oneMB = new Uint32Array(256 * 1024); // over size of multiple IPFS chunks (256KB)
    for (let i = 0; i < 256 * 1024; i++) oneMB[i] = i ^ 0xCAFEBABE;
    const blob1 = new Blob([oneMB], {type: "application/octet-stream"});
    const ipfsUri = await coopIpfs1.share(blob1);
    await waitShared;
    
    const list1 = await coopIpfs1.list();
    const list2 = await coopIpfs2.list();
    assert.deepEqual(list1, [ipfsUri]);
    assert.deepEqual(list2, [ipfsUri]);
    const blob2 = await coopIpfs2.get(ipfsUri);
    assert.equal(blob2.type, "application/octet-stream");
    assert.deepEqual(new Uint32Array(await blob2.arrayBuffer()), oneMB);

    coopIpfs1.stop();
    coopIpfs2.stop();
    
    coop1.stop();
    coop2.stop();
  });


});
