
export const createCoopFollowings = (coop) => {
  return new CoopFollowings(coop);
};

const CoopFollowings = class {
  constructor(coop) {
    this.coop = coop;
    this.keyMap = new Map();
    this.timeMap = new Map();
  }
  put(coopUri, keys, lastModified) {
    this.keyMap.set(coopUri, new Set(keys));
    const time = new Date(lastModified);
    this.timeMap.set(coopUri, time);
    const type = "coop-detected";
    const data = {
      type,
      uri: this.coop.uri, 
      time,
      coop: {href: coopUri},
    };
    const ev = new MessageEvent(type, {data: JSON.stringify(data)});
    this.coop.events.dispatchEvent(ev);
  }
  crossKeys(keys) {
    const myKeys = this.coop.keys.currentKeys;
    return new Set(myKeys.filter(k => keys.has(k)));
  }
  isFollowing(coopUri) {
    if (!this.keyMap.has(coopUri)) return false;
    return this.crossKeys(this.keyMap.get(coopUri)).size > 0;
  }
  followings() {
    return [...this.keyMap.keys()].filter(coopUri => this.isFollowing(coopUri)).sort(
      (a, b) => this.timeMap.get(b) - this.timeMap.get(a));
  }
  
  async fetch(coopUri) { // maybe throw Error
    if (this.keyMap.has(coopUri)) {
      const {uri, keys, time} = await this.coop.keys.fetch(coopUri, this.keyMap.get(coopUri), this.timeMap.get(coopUri));
      this.put(uri, keys, time);
      return uri;
    } else {
      const {uri, keys, time} = await this.coop.keys.fetch(coopUri);
      this.put(uri, keys, time);
      return uri;
    }
  }

  checkEvent(followingsEventData) {
    const coopUri = followingsEventData.uri;
    const time = new Date(followingsEventData.time);
    if (followingsEventData.type === "coop-detected") {
      try {
        const {coop: {href}} = followingsEventData;
        return new URL(href).href; //check as uri
      } catch (error) {
        // invalid data
      }
    }
    return null;
  }
};
