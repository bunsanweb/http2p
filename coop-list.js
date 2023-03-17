
export const createCoopList = coop => {
  return new CoopList(coop);
};

// Prop: {key, coopUri, value}
// find(query = {key, value}) matches by one of Prop has key and value

const CoopList = class {
  constructor(coop) {
    this.coop = coop;
    this.list = new Map(); // URI and a list of props
    this.lastModified = new Date();
  }
  addFromLinks(linksMessage) {
    const coopUri = linksMessage.uri;
    const time = new Date(linksMessage.time);
    const clock = linksMessage.clock;
    for (const {uri, links} of linksMessage.list) {
      if (!this.list.has(uri)) this.list.set(uri, new Set());
      const props = this.list.get(uri);
      for (const {key, value} of links) {
        const prop = [...props].find(prop => prop.coopUri === coopUri && prop.key === key);
        if (!prop) props.add({coopUri, key, value, time, clock});
        else if (isPast(prop, time, clock)) {
          [prop.value, prop.time, prop.clock] = [value, time, clock];
        }
      }
    }
  }
  updateFromEvent(linksEventData) {
    const coopUri = linksEventData.uri;
    const time = new Date(linksEventData.time);
    const clock = linksEventData.clock;
    const {uri, key, value} = linksEventData.link;
    if (linksEventData.type === "link-added") {
      if (!this.list.has(uri)) this.list.set(uri, new Set());
      const props = this.list.get(uri);
      const prop = [...props].find(prop => prop.key === key && prop.coopUri === coopUri);
      if (!prop) props.add({coopUri, key, value, time, clock}); // add prop
      else if (isPast(prop, time, clock)) {
        [prop.value, prop.time, prop.clock] = [value, time, clock]; // update value
      }
      // else drop event
    } else if (linksEventData.type === "link-removed") {
      if (!this.list.has(uri)) this.list.set(uri, new Set());
      const props = this.list.get(uri);
      const prop = [...props].find(prop => prop.key === key && prop.coopUri === coopUri);
      if (!prop) props.add({coopUri, key, time, clock}); // record deleted prop
      else if (isPast(prop, time, clock)) {
        [prop.time, prop.clock] = [time, clock]; // remain timestamp when delete
        delete prop.value;
      }
    }
  }
  getProps(uri) {
    const raw = this.list.get(uri);
    if (!raw) return [];
    return [...raw].filter(prop => Object.hasOwn(prop, "value"));
  }
  getMultiProps(uri) {
    const props = new Map();
    for (const {key, coopUri, value} of this.getProps(uri)) {
      const values = props.has(key) ? props.get(key) : props.set(key, new Map()).get(key);
      values.set(coopUri, value);
    }
    return props;
  }
  
  *find(query) {// query: [{key, value, coopUri, time}] => boolean
    for (const uri of this.list.keys()) {
      if (query(this.getProps(uri))) yield uri;
    }
  }
};

const isPast = (prop, time, clock) => prop.time < time || +prop.time === +time && prop.clock < clock;
