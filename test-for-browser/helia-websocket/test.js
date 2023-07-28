import {describe, it, before, after, beforeEach, afterEach} from "node:test";
import {strict as assert} from "node:assert";

import {createServer} from "http-server";
import {chromium} from "playwright";

import {createHelia} from "helia";
import {unixfs} from "@helia/unixfs";
import {CID} from "multiformats/cid";
import {multiaddr} from "@multiformats/multiaddr";

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
    const gatewayHelia = await createHelia({libp2p: gatewayServers.libp2p});
    // helia node on nodejs

    node = await createHeliaWithWebsockets(multiaddrs);
    nodefs = unixfs(node);
    browser = await chromium.launch();
    page1 = await browser.newPage();
    // load empty page includes only importmap
    await page1.goto("http://localhost:8000/test-for-browser/common/index.html");
    page1.on("console", msg => {
      if (msg.type() === "log") console.log(msg.location(), msg.text());
      //if (msg.type() === "error") console.log(msg.location(), msg.text());
    });
    addrs1 = await createHeliaOnPage(page1, multiaddrs);
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
    await node.libp2p.dial(multiaddr(addrs1.multiaddr));
    await node.libp2p.dial(multiaddr(addrs2.multiaddr));
    await page1.evaluate(({ma, ma2}) => (async () => {
      await ctx.node.libp2p.dial(ctx.multiaddr(ma));
      await ctx.node.libp2p.dial(ctx.multiaddr(ma2));
    })(), {ma: `${node.libp2p.getMultiaddrs()[3]}`, ma2: addrs2.multiaddr});
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
    //console.log(node.libp2p.getMultiaddrs()[3]);
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
    const blob = new Blob(["Hello from nodejs"], {type: "text/plain;charset=utf-8"});
    const cid = await nodefs.addByteStream(blob.stream()); // nodejs implements ReadableStream[Symbol.asyncIterator]
    if (!(await node.pins.isPinned(cid))) await node.pins.add(cid);
    //console.log(cid);

    const result = await page1.evaluate(({cidStr}) => (async () => {
      const {CID} = await import("multiformats/cid");

      const cid = CID.parse(cidStr);
      //console.log("[cid]", cid);
      //console.log("[stat]", await ctx.nodefs.stat(cid));
      
      const decoder = new TextDecoder();
      const texts = [];
      for await (const chunk of ctx.nodefs.cat(cid)) {
        //console.log(chunk);
        texts.push(decoder.decode(chunk, {stream: true}));
      }
      return texts.join("");
    })(), {cidStr: `${cid}`});
    assert.equal(result, "Hello from nodejs");
  });
});
