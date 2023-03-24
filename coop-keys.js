import {CoopCache} from "./coop-cache.js";

export const createCoopKeys = coop => {
  return new CoopKeys(coop);
};

const CoopKeys = class {
  constructor(coop) {
    this.coop = coop;
    this.keys = new Set();
    this.lastModified = new Date(0);
    this.cache = new CoopCache(60);
  }
  get currentKeys() {return [...this.keys];}
  add(key) {
    if (!(typeof key === "string")) throw TypeError("key must be string");
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.lastModified = new Date();
    const data = {
      type: "key-added",
      uri: this.coop.uri,
      time: this.lastModified.toUTCString(),
      key: key,
    };
    const ev = new MessageEvent("key-added", {data: JSON.stringify(data)});
    this.coop.dispatchEvent(ev);
  }
  remove(key) {
    if (!(typeof key === "string")) throw TypeError("key must be string");
    if (!this.keys.has(key)) return;
    this.keys.delete(key);
    const data = {
      type: "key-removed",
      uri: this.coop.uri,
      time: this.lastModified.toUTCString(),
      key: key,
    };
    const ev = new MessageEvent("key-removed", {data: JSON.stringify(data)});
    this.coop.dispatchEvent(ev);
  }
  newResponse(req) {
    const ifModified = new Date(req.headers.get("if-modified-since"));
    if (!!ifModified.getTime() && this.lastModified <= ifModified) return new Response("", {status: 304});
    const data = {
      uri: this.coop.uri,
      keys: this.currentKeys,
      time: this.lastModified.toUTCString(),
    };
    return new Response(JSON.stringify(data), {
      headers: {
        "content-type": "application/json",
        "last-modified": this.lastModified.toUTCString(),
        "cache-control": "max-age=60",
      },
    });
  }
  
  async fetch(coopUri, keys, lastModified) {
    const headers = {};
    if (lastModified) headers["If-Modified-Since"] = lastModified.toUTCString();
    const req = new Request(coopUri, {headers});
    let res = await this.cache.match(req);
    if (!res) {
      await this.cache.put(req, await this.coop.http2p.fetch(req));
      res = await this.cache.match(req);
    }
    if (res.status === 304 && keys) return {uri: coopUri, keys, time: lastModified};
    if (res.status === 200) {
      // parse and check
      const {uri, keys, time} = await res.json();
      if (uri !== coopUri) throw new TypeError("Message contains different Coop URI");
      if (!keys.every(k => typeof k === "string")) throw new TypeError("Invalid Keys");
      if (isNaN(new Date(time).getTime())) throw new TypeError("Invalid Time");
      return {uri, keys, time};
    }
    throw new Error("Not Coop Uri");
  }
};
