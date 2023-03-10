
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
    for (const {uri, key, value} of linksMessage.list) {
      if (!this.list.has(uri)) this.list.set(uri, new Set());
      const props = this.list.get(uri);
      const prop = [...props].find(prop => prop.coopUri === coopUri && prop.key === key);
      if (!prop) props.add({coopUri, key, value, time});
      else if (prop.time < time) [prop.value, prop.time] = [value, time];
    }
  }
  updateFromEvent(linksEventData) {
    const coopUri = linksEventData.uri;
    const time = new Date(linksEventData.time);
    const {uri, key, value} = linksEventData;
    if (linksEventData.type === "link-added") {
      if (!this.list.has(uri)) this.list.set(uri, new Set());
      const props = this.list.get(uri);
      const prop = [...props].find(prop => prop.key === key && prop.coopUri === coopUri);
      if (!prop) props.add({coopUri, key, value, time}); // add prop
      else if (prop.time < time) [prop.value, prop.time] = [value, time]; // update value
      // else drop event
    } else if (linksEventData.type === "link-removed") {
      if (!this.list.has(uri)) this.list.set(uri, new Set());
      const props = this.list.get(uri);
      const prop = props.find(prop => prop.key === key && prop.coopUri === coopUri);
      if (!prop) props.add({coopUri, key, time}); // record deleted prop
      else if (prop.time < time) {
        prop.time = time; // remain timestamp when delete
        delete prop.value;
      }
    }
  }
  getProps(uri) {
    const raw = this.links.get(uri);
    if (!raw) return [];
    return [...raw].filter(prop => Object.hasOwn(prop, "value"));
  }
  
  *find(query) {// query: [{key, value, coopUri, time}] => boolean
    for (const uri of this.links.keys()) {
      if (query(this.getProps(uri))) yield uri;
    }
  }
};
