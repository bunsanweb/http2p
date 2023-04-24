
export const createCoopIpfs = (coop, ipfsNode, options) => {
  return new CoopIpfs(coop, ipfsNode, options);
};

const CoopIpfs = class extends EventTarget {
  constructor(coop, ipfsNode, options = {}) {
    super();
    this.coop = coop;
    this.ipfsNode = ipfsNode;
    this.options = options;
    // TBD: run worker for watching shared IPFS URIs, pin them, then coop.put
    this.stopped = false;
    const stopPromise = new Promise(f => {
      this.stop = () => {
        this.stopped = true;
        f({done: true});
      };
    });
    
    this.watchLinkAddedEvents = (async () => {
      const rs = this.coop.watch(({type, uri}) => type === "link-added" && uri !== this.coop.uri);
      const reader = rs.getReader();
      try {
        while (!this.stopped) {
          const {done, value: eventData} = await Promise.race([reader.read(), stopPromise]);
          if (done) break;
          const {uri, key, value} = eventData.link;
          if (key === "coop:ipfs" && value === "shared") {
            const url = new URL(uri);
            if (url.protocol !== "ipfs:") continue;
            this.coop.links.add(uri, key, value);
            const cid = url.hostname;
            this.ipfsNode.pin.add(cid);
          } if (this.isShared(uri)) {
            this.coop.links.add(uri, key, value);
          }
        }
      } catch (error) { // after closed
        console.log(error);
      } finally {
        reader.releaseLock();
        rs.cancel();
      }
    })();
  }

  // - blob: Web API Blob object
  // - option: IPFS FileContent params
  // returns: IPFS URI string
  async share(blob, option = {}) {
    // 1. IPFS.add()
    const {cid} = await this.ipfsNode.add(blob, {pin: true, cidVersion: 1});
    // 2. coop.put()
    const uri = `ipfs://${cid}`;
    await this.coop.put(uri, {"coop:ipfs": "shared", "content-type": blob.type});
    return uri;
  }

  isShared(uri) {
    const propMap = this.coop.links.links.get(uri);
    if (!propMap || !propMap.has("coop:ipfs")) return false;
    return propMap.get("coop:ipfs") === "shared";
  }
  
  // returns: list of shared IPFS URI strings
  list() {
    // list up from coop.links.currentLinks
    return [...this.coop.links.links.keys()].filter(uri => this.isShared(uri));
  }
  
  // - uri: shared IPFS URI
  // returns: as Blob
  async get(uri) {
    const url = new URL(uri);
    if (url.protocol !== "ipfs:") throw TypeError("Not IPFS URI");
    // type from coop.getProps()
    const props = this.coop.getProps(uri);
    if (props["coop:ipfs"] !== "shared")  throw TypeError("Not Shared IPFS URI");
    // data from IPFS.cat()
    const cid = url.hostname;
    const u8as = [];
    for await (const u8a of this.ipfsNode.cat(cid)) u8as.push(u8a.slice());
    const blob = new Blob(u8as, {type: props["content-type"]});
    return blob;
  }
};
