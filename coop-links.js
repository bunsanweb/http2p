
export const createCoopLinks = (coop) => {
  return new CoopLinks(coop);
};

const CoopLinks = class {
  constructor(coop) {
    this.coop = coop;
    this.lastModified = new Date(0);
    this.clock = 0; // version counter for updates in same seconds 
    this.links = new Map(); // Map<uri, Map<key, value>>
  }
  get currentLinks() {
    // e.g.  [{uri: "http:...", links: [{key: "rel", value: "stylesheet"}, ...]}, ...]
    return [...this.links].map(([uri, props]) => ({uri, links: [...props].map(([key, value]) => ({key, value}))}));
  }
  put(uri, keyValues) {
    // TBD: spawn as single event?
    for (const [key, value] of Object.entries(keyValues)) this.add(uri, key, value);
  }
  drop(uri, keys) {
    for (const key of keys) this.remove(uri, key);
  }
  getProps(uri) {
    return this.links.has(uri) ? Object.fromEntries(this.links.get(uri)) : {};
  }
  
  add(uri, key, value) {
    if (!(typeof key === "string")) throw TypeError("key must be string");
    if (!(typeof value === "string")) throw TypeError("value must be string");
    if (!this.links.has(uri)) this.links.set(uri, new Map());
    const props = this.links.get(uri);
    if (props.get(key) === value) return;
    props.set(key, value);
    updateLastModified(this);
    const data = {
      type: "link-added",
      uri: this.coop.uri,
      time: this.lastModified.toUTCString(),
      clock: this.clock,
      link: {uri, key, value},
    };
    const ev = new MessageEvent("link-added", {data: JSON.stringify(data)});
    this.coop.events.dispatchEvent(ev);
  }
  remove(uri, key) {
    if (!(typeof key === "string")) throw TypeError("key must be string");
    if (!this.links.has(uri)) return;
    const props = this.links.get(uri);
    if (!props.has(key)) return;
    const value = props.get(key);
    props.delete(key);
    updateLastModified(this);
    const data = {
      type: "link-removed",
      uri: this.coop.uri,
      time: this.lastModified.toUTCString(),
      clock: this.clock,
      link: {uri, key, value},
    };
    const ev = new MessageEvent("link-removed", {data: JSON.stringify(data)});
    this.coop.events.dispatchEvent(ev);
  }
  parseEvent(ev) {
    if (ev.type !== "link-added" && ev.type !== "link-removed") throw new TypeError("non related event");
    const json = JSON.parse(ev.data);
    const {type, uri, time, clock, link} = json;
    if (type !== "link-added" && type !== "link-removed") throw new TypeError("Invalid event type");
    const coopUri = new URL(uri);
    if (coopUri.protocol !== "http2p:") throw TypeError("URI is not Coop URI");
    if (isNaN(new Date(time).getTime())) throw TypeError("Invalid timestamp");
    if (!Number.isInteger(clock) || clock < 0) throw TypeError("Invalid clock");
    {
      const {uri, key, value} = link;
      new URL(uri);
      if (typeof key !== "string") throw TypeError("Invalid key");
      //if (typeof value !== "string") throw TypeError("Invalid value");
    }
    return {type, uri, time, clock, link};
  }
  
  newResponse(req) {
    const ifModified = req.headers.has("if-modified-since") ? new Date(req.headers.get("if-modified-since")) : new Date(undefined);
    if (this.lastModified <= ifModified) return new Response("", {status: 304});
    const data = {
      uri: this.coop.uri,
      time: this.lastModified.toUTCString(),
      clock: this.clock,
      list: this.currentLinks,
    };
    return new Response(JSON.stringify(data), {
      headers: {
        "content-type": "application/json",
        "last-modified": this.lastModified.toUTCString(),
      },
    });
  }
  async parseResponse(res) {
    const json = await res.json();
    //console.log(json);
    const {uri, time, clock, list} = json;
    const coopUri = new URL(uri);
    if (coopUri.protocol !== "http2p:") throw TypeError("URI is not Coop URI");
    if (isNaN(new Date(time).getTime())) throw TypeError("Invalid timestamp");
    if (!Number.isInteger(clock) || clock < 0) throw TypeError("Invalid clock");
    if (!Array.isArray(list)) throw TypeError("no list array");
    for (const {uri, links} of list) {
      new URL(uri);
      for (const {key, value} of links) {
        if (typeof key !== "string") throw TypeError("Invalid key");
        if (typeof value !== "string") throw TypeError("Invalid value");
      }
    }
    return {uri, time, clock, list};
  }
};

const updateLastModified = links => {
  const now = new Date();
  if (now.toUTCString() === links.lastModified.toUTCString()) {
    links.clock++;
  } else {
    links.clock = 0;
  }
  links.lastModified = now;
};
