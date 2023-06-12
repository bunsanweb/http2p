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
    const ifModified = req.headers.has("if-modified-since") ? new Date(req.headers.get("if-modified-since")) : new Date(undefined);
    if (this.lastModified <= ifModified) return new Response("", {status: 304});
    const data = {
      uri: this.coop.uri,
      mainnet: this.coop.params.mainnet,
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

  parseEvent(ev) {
    if (ev.type !== "key-added" && ev.type !== "key-removed") throw new TypeError("non related event");
    const json = JSON.parse(ev.data);
    const {type, uri, time, key} = json;
    if (type !== "key-added" && type !== "key-removed") throw new TypeError("Invalid event type");
    const coopUri = new URL(uri);
    if (coopUri.protocol !== "http2p:") throw TypeError("URI is not Coop URI");
    if (isNaN(new Date(time).getTime())) throw TypeError("Invalid timestamp");
    if (typeof key !== "string") throw TypeError("Invalid key");
    return {type, uri, time, key};
  }
  
  newMainnetConnectedEvent(uri, keys) {
    const data = {
      type: "mainnet-connected",
      uri: this.coop.uri,
      time: new Date(),
      coop: {uri, keys},
    };
    return new MessageEvent("mainnet-connected", {data: JSON.stringify(data)});
  }
  parseMainnetEvent(ev) {
    if (ev.type !== "mainnet-connected") throw new TypeError("non related event");
    const json = JSON.parse(ev.data);
    const {type, uri, time, coop} = json;
    if (type !== "mainnet-connected") throw new TypeError("Invalid event type");
    const coopUri = new URL(uri);
    if (coopUri.protocol !== "http2p:") throw TypeError("URI is not Coop URI");
    const connectedUri = new URL(coop.uri);
    if (connectedUri.protocol !== "http2p:") throw TypeError("URI is not Coop URI");
    if (isNaN(new Date(time).getTime())) throw TypeError("Invalid timestamp");
    if (!Array.isArray(coop.keys) || coop.keys.some(key => typeof key !== "string")) throw TypeError("Invalid key");
    return {type, uri, time, coop};
  }
};
