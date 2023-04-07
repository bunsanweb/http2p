
/*
  // API design
  const coop = await createCoop(http2pNode);
  // `coop` registered http2pNode.scope.addEventListener("fetch", wellKnownUriHandler)
  // `coop` fetch handler sees NON .well-known uri event, then gather event.remotePeerId,
  //  and access to wel-known uris of remotePeerId 

  // managing URI list
  await coop.put(url, {"content-type": ..., "text": ...}); // put event spawn at /.well-knwon/http2p/coop/event
  await coop.drop(url, ["text"]); // dropped event spawn at /.well-knwon/http2p/coop/event
  // NOTE: props value structure: non-empty string
  
  // query uris from remotePeers 
  for (const {href, props} of coop.find({"content-type": "image/"})) {...} // find existing uris  
  for await (const {href, event, props} of coop.watch({"content-type": "image/"})) {...} // watch future uris
  // NOTE: query: (propOfUri) => boolean

  // query peer managed in coop
  for (const {href, props} of coop.find({"http2p/coop": "peer"})) {...} // find existing peers
  for await (const {href, event, props} of coop.watch({"http2p/coop": "peer"})) {...} // watch future peers
  // TBD: peer prop key
  */

/*
  NOTE: coop keys
  coop node itself ony use has at least one same coop key.
  except peer manage is not limit same coop key peer.
  (gather peers from non same key peer)

  Format of coop key is URI, it can use http2p coop wekk-knwon URI.
  */
/*
  TBD: storing/restoring states to storage
 */
import {TextEventStreamBody} from "./text-event-stream-body.js";
import {createEventSource} from "./http2p-event-source.js";
import {createCoopKeys} from "./coop-keys.js";
import {createCoopLinks} from "./coop-links.js";
import {createCoopFollowings} from "./coop-followings.js";
import {createCoopList} from "./coop-list.js";
import {createCoopWatchers} from "./coop-watchers.js";


export const createCoop = (http2p, params) => {
  return new Coop(http2p, params);
};

const coopBasePath = `/.well-known/http2p/coop`;
const coopUri = peerId => `http2p:${peerId}${coopBasePath}/`;
const listUri = peerId => `http2p:${peerId}${coopBasePath}/list`;
const eventUri = peerId => `http2p:${peerId}${coopBasePath}/event`;

const checkCoop = async (coop, uri) => {
  if (uri === coop.uri) return; // self uri
  try {
    //console.log(`[checkCoop] ${coop.uri} follow ${uri}: ${coop.followings.isFollowing(uri)}`);
    if (coop.followings.isFollowing(uri)) return;
    //console.info(`${coop.uri} checking ${uri}: ${coop.checkings.has(uri)}`);
    if (coop.checkings.has(uri)) return; //NOTE: to avoid check loop in followCoop()
    //console.info(`${coop.uri} access to ${uri}`);
    coop.checkings.add(uri);
    try {
      //console.log("[fetch]", coop.uri, uri);
      const {uri: fetchedUri, keys, time} = await coop.followings.fetch(uri);
      //console.log("[checkCoop]", coop.uri, fetchedUri);
      //console.log("[fetched]", coop.uri, keys, coop.followings.crossKeys(new Set(keys)).size > 0);
      if (coop.followings.crossKeys(new Set(keys)).size > 0) {
        //console.info(`${coop.uri} follows to ${uri}`);
        await followCoop(coop, fetchedUri);
        coop.followings.put(fetchedUri, keys, time);
      }
      //console.info(`${coop.uri} followed ${uri}`);
    } finally {
      coop.checkings.delete(uri);
    }
  } catch (error) {
    // TBD: skip managed errors
    console.info("[not coop node]", error);
  }
};

const followCoop = async (coop, coopUri) => {
  const res = await coop.http2p.fetch(`${coopUri}list`);
  const linksMessage = await coop.links.parseResponse(res);
  coop.list.addFromLinks(linksMessage);

  const EventSource = createEventSource(coop.http2p);
  const es = new EventSource(`${coopUri}event`);
  coop.watchers.watchEventSource(coopUri, es);
  while (es.readyState === EventSource.CONNECTING) {
    await new Promise(f => setTimeout(f, 100));
  }
};

const Coop = class extends EventTarget {
  constructor(http2p, params = {}) {
    super();
    this.http2p = http2p;
    this.params = params;
    this.keys = createCoopKeys(this);
    this.links = createCoopLinks(this);
    this.followings = createCoopFollowings(this);
    this.list = createCoopList(this);
    this.watchers = createCoopWatchers(this);
    this.events = new TextEventStreamBody();
    this.checkings = new Set();
    this.keyAddedDataCache = new Map();
    
    this.handler = ev => {
      // process http2p/coop well-known uris
      {
        //console.log("[handler]", this.uri, ev.remotePeerId);
        const promise = checkCoop(this, coopUri(ev.remotePeerId));
      }
      try {
        if (ev.request.url === coopUri(this.http2p.libp2p.peerId)) {
          const res = this.keys.newResponse(ev.request);
          return ev.respondWith(res);
        }
        if (ev.request.url === eventUri(this.http2p.libp2p.peerId)) {
          return ev.respondWith(new Response(this.events.newReadableStream({
            lastEventId: ev.request.headers.get("LAST-EVENT-ID"),
          }), {headers: {"content-type": "text/event-stream"}}));
        }
        if (ev.request.url === listUri(this.http2p.libp2p.peerId)) {
          return ev.respondWith(this.links.newResponse(ev.request));
        }
      } finally {
        //const promise = checkCoop(this, coopUri(ev.remotePeerId));
      }
    };
    http2p.scope.addEventListener("fetch", this.handler);
    this.stopped = false;

    this.watchLinksEvent = (async () => {
      const reader = this.watchers.watch(({type}) => {
        return type === "link-added" || type === "link-removed";
      });
      try {
        for await (const linksEventData of reader) {
          this.list.updateFromEvent(linksEventData);
        }
      } catch (error) {}//when closed
    })();
    this.watchFollowingsEvent = (async () => {
      const reader = this.watchers.watch(({type}) => {
        return type === "coop-detected";
      });
      try {
        for await (const followingsEventData of reader) {
          //console.log(this.uri, followingsEventData);
          const uri = await this.followings.checkEvent(followingsEventData);
          if (uri) {
            //console.log(this.uri, uri);
            const promise = checkCoop(this, uri);
          }
        }
      } catch (error) {}//when closed
    })();
    this.watchKeyAddedEvent = (async () => {
      const reader = this.watchers.watch(({type}) => {
        return type === "key-added";
      });
      try {
        for await (const keyAddedEventData of reader) {
          //TBD: forward as dispatchEvent
          const {uri, time, key} = keyAddedEventData;
          //console.log(keyAddedEventData);
          //1. check repeated data
          if (uri === this.uri) break;
          if (this.keyAddedDataCache.has(uri)) {
            if (this.keyAddedDataCache.get(uri).some(data => data.key === key && data.time === time)) break;
          }
          //2. cache eventData
          if (!this.keyAddedDataCache.has(uri)) this.keyAddedDataCache.set(uri, []);
          this.keyAddedDataCache.get(uri).push(keyAddedEventData);
          //3. dispatchEvent as key-added MessageEvent
          const ev = new MessageEvent("key-added", {data: JSON.stringify(keyAddedEventData)});
          this.events.dispatchEvent(ev);
          //4. checkCoop when the key in this.keys
          //console.log("[checkCoop in watch]", this.uri, uri, new Set(this.keys.currentKeys).has(key));
          if (new Set(this.keys.currentKeys).has(key)) {
            this.keys.cache.delete(uri); //NOTE: for GETing uri in fresh age
            checkCoop(this, uri);
          }
        }
      } catch (error) {}//when closed
    })();

    this.addEventListener("key-removed", ev => {
      const detachings = this.followings.detachingFollowings();
      for (const coopUri of detachings) {
        this.watchers.closeEventSource(coopUri);
      }
    });
  }
  get uri() {return coopUri(this.http2p.libp2p.peerId);}
  
  stop() {
    this.stopped = true;
    this.http2p.scope.removeEventListener("fetch", this.handler);
    this.watchers.close();
  }

  getMultiProps(uri) {
    return this.list.getMultiProps(uri);
  }
  find(query) {
    return this.list.find(query);
  }
  watch(query) {
    return this.watchers.watch(query);
  }
  
  put(uri, props) {
    return this.links.put(uri, props);
  }
  drop(uri, keys) {
    return this.links.drop(uri, keys);
  }
  getProps(uri) {
    return this.links.getProps(uri);
  }
  dispatchEvent(ev) {
    this.events.dispatchEvent(ev);
    return super.dispatchEvent(ev);
  }
};


