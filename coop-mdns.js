// only for node.js runtime
import * as mdns from "mdns";
import {multiaddr} from "@multiformats/multiaddr";

export const createCoopMdns = coop => {
  return new CoopMdns(coop);
};

const CoopMdns = class {
  constructor(coop) {
    this.coop = coop;
    this.start();
  }
  start() {
    this.serviceType = new mdns.ServiceType("coop", "tcp");
    this.browser = mdns.createBrowser(this.serviceType);
    this.browser.on('serviceUp', service => {
      //console.log("service up: ", service);
      const {uri, multiaddrs} = service.txtRecord;
      const mas = multiaddrs.split(/ /);
      // skip self adverise
      if (uri === this.coop.uri) return;
      const selfMas = new Set(this.coop.http2p.libp2p.getMultiaddrs().map(ma => ma.toString()));
      if (mas.some(ma => selfMas.has(ma))) return;
      
      const url = new URL(uri);
      if (url.protocol !== "http2p:") return;
      //0. check uri is not followed
      if (this.coop.followings.isFollowing(uri)) return;
      //1. libp2p.dial() one of multiaddrs
      (async () => {
        for (const maStr of mas) {
          try {
            const ma = multiaddr(maStr);
            await this.coop.http2p.libp2p.dial(ma);
            break;
          } catch {}
        }
        //2. http2p.fetch(uri)
        const res = await this.coop.http2p.fetch(uri);
      })().catch(console.error);
    });
    this.browser.start();
    
    // advertise for each tcp ports
    const multiAddrs = this.coop.http2p.libp2p.getMultiaddrs().filter(ma => ma.protoNames().includes("tcp"));
    const ports = new Set(multiAddrs.map(ma => ma.nodeAddress().port));
    this.advertisements = [...ports].map(port => {
      const mas = multiAddrs.filter(ma => ma.nodeAddress().port === port);
      const txtRecord = {
        uri: this.coop.uri,
        multiaddrs: mas.map(ma => ma.toString()).join(" "), //NOTE: cannot use string array in txtRecord
      };
      return mdns.createAdvertisement(this.serviceType, port, {txtRecord});
    });
    this.advertisements.forEach(adv => adv.start());
  }
  stop() {
    this.browser.stop();
    this.advertisements.forEach(adv => adv.stop());
  };
};
