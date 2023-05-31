import {describe, it, before, after} from "node:test";
import {strict as assert} from "node:assert";

import * as fs from "node:fs";
import * as IPFS from "ipfs-core";
import {multiaddr} from "@multiformats/multiaddr";

import {createHttp2p} from "../http2p.js";

describe("http2p", async () => {
  const repo1 = "./.repos/test-repo1", repo2 = "./.repos/test-repo2";
  before(async () => {
    fs.rmSync(repo1, {recursive: true, force: true});
    fs.rmSync(repo2, {recursive: true, force: true});
  });
  after(async () => {
    fs.rmSync(repo1, {recursive: true, force: true});
    fs.rmSync(repo2, {recursive: true, force: true});
  });

  // tests
  it("Do start and stop", async () => {
    const node1 = await IPFS.create({
      repo: repo1,
      config: {Addresses: {Swarm: ["/ip4/0.0.0.0/tcp/0"]}},
    });
    const node2 = await IPFS.create({
      repo: repo2,
      config: {Addresses: {Swarm: ["/ip4/0.0.0.0/tcp/0"]}},
    });
    // connect node1 and node2
    //await node2.swarm.connect((await node1.id()).addresses[0].toJSON());
    await node2.swarm.connect(multiaddr((await node1.id()).addresses[0].toJSON()));
    
    
    await node1.stop();
    await node2.stop();    
  });
});
