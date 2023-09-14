import {describe, it, before, after, beforeEach, afterEach} from "node:test";
import {strict as assert} from "node:assert";

import {createServer} from "http-server";
import {chromium} from "playwright";

import {createHelia} from "helia";
import {unixfs} from "@helia/unixfs";
import {CID} from "multiformats/cid";
import {multiaddr} from "@multiformats/multiaddr";
import {peerIdFromString} from "@libp2p/peer-id";

import {createServers} from "../../create-gateway-servers.js";
import {createHeliaWithWebsockets} from "../common/helia-websockets.js";
import {createHeliaOnPage} from "../common/helia-browser.js";

describe("helia on browser", async () => {
  let httpServer, gatewayServers;
  let node, nodefs, browser, page1, page2, addrs1, addrs2;
  let gatewayHelia;
  before(async () => {
    httpServer = createServer();
    await new Promise(f => httpServer.server.listen(8000, f));
    //console.log(await (await fetch("http://localhost:8000/test-for-browser/common/index.html")).text());
    gatewayServers = await createServers({
      gateway: {port: 9000},
    });
    const {multiaddrs} = gatewayServers.info();
    gatewayHelia = await createHelia({libp2p: gatewayServers.libp2p}); // TBD: intermediate helia node required?
    // helia node on nodejs

    node = await createHeliaWithWebsockets(multiaddrs);
    nodefs = unixfs(node);
    //const appendedMultiaddrs = node.libp2p.getMultiaddrs().concat(multiaddrs);
    //const appendedMultiaddrs = node.libp2p.getMultiaddrs();
    browser = await chromium.launch();
    page1 = await browser.newPage();
    // load empty page includes only importmap
    await page1.goto("http://localhost:8000/test-for-browser/common/index.html");
    page1.on("console", msg => {
      if (msg.type() === "log") console.log(msg.location(), msg.text());
      //if (msg.type() === "error") console.log(msg.location(), msg.text());
    });
    addrs1 = await createHeliaOnPage(page1, multiaddrs);
    //addrs1 = await createHeliaOnPage(page1, appendedMultiaddrs);
    //console.log(addrs1);

    page2 = await browser.newPage();
    // load empty page includes only importmap
    await page2.goto("http://localhost:8000/test-for-browser/common/index.html");
    page2.on("console", msg => {
      if (msg.type() === "log") console.log(msg.location(), msg.text());
      //if (msg.type() === "error") console.log(msg.location(), msg.text());
    });
    addrs2 = await createHeliaOnPage(page2, multiaddrs);
    //console.log(addrs1);

    // uncomment when slow
    //*
    //await node.libp2p.dial(multiaddr(addrs1.multiaddr));
    //await node.libp2p.dial(multiaddr(addrs2.multiaddr));
    //await (await node.libp2p.dialProtocol(multiaddr(addrs1.multiaddr), node.libp2p.getProtocols()))?.close();
    console.log(node.libp2p.getProtocols());
    await node.libp2p.dialProtocol(multiaddr(addrs1.multiaddr), node.libp2p.getProtocols(), {runOnTransientConnection: true});
    //await node.libp2p.dialProtocol(peerIdFromString(addrs1.peerId), node.libp2p.getProtocols());
    await node.libp2p.dialProtocol(multiaddr(addrs2.multiaddr), node.libp2p.getProtocols(), {runOnTransientConnection: true});
    //await (await node.libp2p.dialProtocol(multiaddr(addrs2.multiaddr), node.libp2p.getProtocols()))?.close();
    
    await page1.evaluate(({ma, ma2}) => (async () => {
      for (const proto of ctx.node.libp2p.getProtocols()) console.log("[proto]", proto);
      await ctx.node.libp2p.dialProtocol(ctx.multiaddr(ma), ctx.node.libp2p.getProtocols().slice(0, -1), {runOnTransientConnection: true});
      await ctx.node.libp2p.dialProtocol(ctx.multiaddr(ma2), ctx.node.libp2p.getProtocols(), {runOnTransientConnection: true});
      //await (await ctx.node.libp2p.dialProtocol(ctx.multiaddr(ma2), ctx.node.libp2p.getProtocols()))?.close();
    })(), {ma: `${node.libp2p.getMultiaddrs()[3]}`, ma2: addrs2.multiaddr});
    await page2.evaluate(({ma1}) => (async () => {
      await ctx.node.libp2p.dialProtocol(ctx.multiaddr(ma1), ctx.node.libp2p.getProtocols(), {runOnTransientConnection: true});
      //await (await ctx.node.libp2p.dialProtocol(ctx.multiaddr(ma1), ctx.node.libp2p.getProtocols()))?.close();
    })(), {ma1: addrs1.multiaddr});
    //*/
  });
  after(async () => {
    await page1.evaluate(() => (async () => await ctx.node.stop())());
    await page2.evaluate(() => (async () => await ctx.node.stop())());
    await browser.close();
    await node.stop();

    await new Promise(f => httpServer.server.close(f));
    await gatewayHelia.stop();
    await gatewayServers.stop();
  });

  it("resolve content on nodejs", async () => {
    //console.log(node.libp2p.getMultiaddrs());
    const blob = new Blob(["Hello from nodejs"], {type: "text/plain;charset=utf-8"});
    const cid = await nodefs.addByteStream(blob.stream()); // nodejs implements ReadableStream[Symbol.asyncIterator]
    if (!(await node.pins.isPinned(cid))) await node.pins.add(cid);
    //console.log(cid);

    //console.log("[stat]", await nodefs.stat(`${cid}`));
    const decoder = new TextDecoder();
    const texts = [];
    for await (const chunk of nodefs.cat(`${cid}`)) {
      //console.log(chunk);
      texts.push(decoder.decode(chunk, {stream: true}));
    }
    assert.equal(texts.join(""), "Hello from nodejs");
  });
     
  it("resolve content on browser", async () => {
    const result = await page1.evaluate(() => (async () => {
      const {CID} = await import("multiformats/cid");

      const rsToAi = rs => {
        if (Symbol.asyncIterator in rs) return rs;
        rs[Symbol.asyncIterator] = async function* () {
          const reader = rs.getReader();
          try {
            for (;;) {
              const {done, value} = await reader.read();
              if (done) break;
              yield value;
            }
          } finally {
            reader.releaseLock();
          }
        };
        return rs;
      };
      
      const blob = new Blob(["Hello from browser"], {type: "text/plain;charset=utf-8"});
      const cid = await ctx.nodefs.addByteStream(rsToAi(blob.stream())); // nodejs implements ReadableStream[Symbol.asyncIterator]
      if (!(await ctx.node.pins.isPinned(cid))) await ctx.node.pins.add(cid);
      
      //console.log("[cid]", cid)      
      //console.log("[stat]", await ctx.nodefs.stat(cid));
      
      const decoder = new TextDecoder();
      const texts = [];
      for await (const chunk of ctx.nodefs.cat(cid)) {
        //console.log(chunk);
        texts.push(decoder.decode(chunk, {stream: true}));
      }
      return texts.join("");
    })());
    assert.equal(result, "Hello from browser");
  });

  it("resolve content from browser to node", async () => {
    const cidStr = await page1.evaluate(() => (async () => {
      const rsToAi = rs => {
        if (Symbol.asyncIterator in rs) return rs;
        rs[Symbol.asyncIterator] = async function* () {
          const reader = rs.getReader();
          try {
            for (;;) {
              const {done, value} = await reader.read();
              if (done) break;
              yield value;
            }
          } finally {
            reader.releaseLock();
          }
        };
        return rs;
      };
      
      const blob = new Blob(["Hello from browser"], {type: "text/plain;charset=utf-8"});
      const cid = await ctx.nodefs.addByteStream(rsToAi(blob.stream())); // nodejs implements ReadableStream[Symbol.asyncIterator]
      if (!(await ctx.node.pins.isPinned(cid))) await ctx.node.pins.add(cid);
      
      //console.log("[cid]", cid)      
      //console.log("[stat]", await ctx.nodefs.stat(cid));
      return `${cid}`;
    })());
    
    const cid = CID.parse(cidStr);
    //console.log("[stat]", await nodefs.stat(`${cid}`));
    const decoder = new TextDecoder();
    const texts = [];
    for await (const chunk of nodefs.cat(`${cid}`)) {
      //console.log(chunk);
      texts.push(decoder.decode(chunk, {stream: true}));
    }
    assert.equal(texts.join(""), "Hello from browser");
  });

  it("resolve content from nodejs to browser", async () => {
    //console.log(await node.libp2p.peerRouting.findPeer(peerIdFromString(addrs1.peerId)));
    const blob = new Blob(["Hello from nodejs"], {type: "text/plain;charset=utf-8"});
    const cid = await nodefs.addByteStream(blob.stream()); // nodejs implements ReadableStream[Symbol.asyncIterator]
    if (!(await node.pins.isPinned(cid))) await node.pins.add(cid);

    //for await (const p of node.libp2p.contentRouting.findProviders(cid)) {
      //console.log(p);
      //break;
    //}
    //console.log(cid);

    const result = await page1.evaluate(({cidStr, ma, id}) => (async () => {
      const {CID} = await import("multiformats/cid");
      const {peerIdFromString} = await import("@libp2p/peer-id");

      //const {multiaddrs} = await ctx.node.libp2p.peerRouting.findPeer(peerIdFromString(id));
      //for (const ma of multiaddrs) console.log("[ma of node]",  `${ma}`);
      
      //console.log("[dial]", await ctx.node.libp2p.dial(ctx.multiaddr(ma)));

      
      const cid = CID.parse(cidStr);
      //console.log("[cid]", cid);
      //console.log("[stat]", await ctx.nodefs.stat(cid));
      for await (const p of ctx.node.libp2p.contentRouting.findProviders(cid)) {
        console.log("[id]", `${p.id}`);
        for (const ma of p.multiaddrs) console.log("[multiaddrs]", `${ma}`);
        for (const proto of p.protocols) console.log("[protocols]", `${proto}`);// empty protocols when stacked case

        const peer = await ctx.node.libp2p.peerStore.get(p.id);
        for (const proto of peer.protocols) console.log("[protocols in peerStore]", `${proto}`);// empty protocols when stacked case
        
        break;
      }
      
      const decoder = new TextDecoder();
      const texts = [];
      for await (const chunk of ctx.nodefs.cat(cid)) {
        //console.log(chunk);
        texts.push(decoder.decode(chunk, {stream: true}));
      }
      return texts.join("");
    })(), {cidStr: `${cid}`, ma: `${node.libp2p.getMultiaddrs()[3]}`, id: `${node.libp2p.peerId}`});
    assert.equal(result, "Hello from nodejs");
  });

  it("resolve content from browser to browser", async () => {
    const cidStr = await page1.evaluate(() => (async () => {
      const rsToAi = rs => {
        if (Symbol.asyncIterator in rs) return rs;
        rs[Symbol.asyncIterator] = async function* () {
          const reader = rs.getReader();
          try {
            for (;;) {
              const {done, value} = await reader.read();
              if (done) break;
              yield value;
            }
          } finally {
            reader.releaseLock();
          }
        };
        return rs;
      };
      
      const blob = new Blob(["Hello from browser 1"], {type: "text/plain;charset=utf-8"});
      const cid = await ctx.nodefs.addByteStream(rsToAi(blob.stream())); // nodejs implements ReadableStream[Symbol.asyncIterator]
      if (!(await ctx.node.pins.isPinned(cid))) await ctx.node.pins.add(cid);
      for (const ma of ctx.node.libp2p.getMultiaddrs()) console.log("[browser1 ma]", `${ma}`);
      //console.log("[cid]", cid)      
      //console.log("[stat]", await ctx.nodefs.stat(cid));
      return `${cid}`;
    })());
    
    
    const result = await page2.evaluate(({cidStr}) => (async () => {
      const {CID} = await import("multiformats/cid");
      
      //console.log("[dial]", await ctx.node.libp2p.dial(ctx.multiaddr(ma)));
      
      const cid = CID.parse(cidStr);
      console.log("[cid]", cid);
      for await (const p of ctx.node.libp2p.contentRouting.findProviders(cid)) {
        console.log("[id]", `${p.id}`);
        for (const ma of p.multiaddrs) console.log("[multiaddrs]", `${ma}`);
        for (const proto of p.protocols) console.log("[protocols]", `${proto}`);// empty protocols when stacked case
        const peer = await ctx.node.libp2p.peerStore.get(p.id);
        for (const proto of peer.protocols) console.log("[protocols in peerStore]", `${proto}`);// empty protocols when stacked case
        break;
      }
      console.log("[stat]", await ctx.nodefs.stat(cid));
      
      const decoder = new TextDecoder();
      const texts = [];
      for await (const chunk of ctx.nodefs.cat(cid)) {
        //console.log(chunk);
        texts.push(decoder.decode(chunk, {stream: true}));
      }
      return texts.join("");
    })(), {cidStr});
    assert.equal(result, "Hello from browser 1");
  });
});
