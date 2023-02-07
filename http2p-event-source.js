export const createEventSource = injects => {
  return class EventSource extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;
    #abortController = new AbortController();
    constructor(url, options = {}) {
      super();
      this.readyState = this.constructor.CONNECTING;
      this.url = url;
      this.withCredentials = options.withCredentials ?? false;
      fetchUri(this, injects, null, #this.abortController.signal).catch(console.error);
    }
    close() {
      this.readyState = this.constructor.CLOSED;
      this.#abortController.abort();
    }
  };
};

const fetchUri = async (eventSource, injects, lastEventId, signal) => {
  eventSource.readyState = eventSource.constructor.OPEN;
  const reqOpts = {signal};
  if (lastEventId) reqOpts.headers = {"LAST-EVENT-ID": lastEventId};
  const req = new Request(eventSource.url, reqOpts);
  const res = await injects.fetch(req);
  const reader = res.body.getReader();
  let remain = new Uint8Array(0);
  let retry = -1;
  let start = true;
  try {
    while (eventSource.readyState === eventSource.constructor.OPEN) {
      let {done, value} = await reader.read();
      if (done) break;
      if (start) { //drop UTF-8 BOM 
        if (value.length >= 3 && value[0] === 0xEF && value[1] === 0xBB && value[2] === 0xBF) value = value.slice(3);
        start = false;
      }
      const u8a = new Uint8Array(remain.length + value.length);
      u8a.set(remain, 0);
      u8a.set(value, remain.length);
      [remain, retry, lastEventId] = processEvents(eventSource, u8a);
      if (retry > 0) break;
    }
  } finally {
    reader.releaseLock();
    res.body.cancel();
  };
  if (retry > 0) {
    await new Promsie(f => setTimeout(f, retry));
    await fetchUri(eventSource, injects, lastEventId, signal);
  } else eventSource.readyState = eventSource.constructor.CLOSED;
}

// returns: [remainBytes, retryMSec, lastEventId | null]
const processEvents = (eventSource, u8a) => {
  while (true) {
    const [msg, remain] = splitEvent(u8a);
    if (!msg) return [remain, 0, null];
    const {event, retry} = parseEvent(msg);
    if (event) eventSource.dispatchEvent(event);
    u8a = remain;
    if (retry) return [new Uint8Array(0), retry, event.lastEventId];
  }
};

const cr = `\r`.codePointAt(0), lf = `\n`.codePointAt(0), colon = `:`.codePointAt(0);
// returns: [singleEvent | null, remainBytes]
const splitEvent = u8a => {
  let [cr1, lf1, cr2] = [false, false, false];
  for (let i = 0; i < u8a.length; i++) {
    const ch = u8a[i];
    if (ch === cr && !cr1 && !lf1 && !cr2) cr1 = true;
    else if (ch === lf && cr1 && !lf1 && !cr2) lf1 = true;
    else if (ch === cr && cr1 && lf1 && !cr2) cr2 = true;
    else if (ch === lf && cr1 && lf1 && cr2) return [u8a.slice(0, i + 1), u8a.slice(i + 1)];
    else [cr1, lf1, cr2] = [false, false, false];
  }
  return [null, u8a];
};
// returns: lineEndsWithCRLF[]
const splitLines = u8a => {
  const lines = [];
  let head = 0, cr1 = false;
  for (let i = 0; i < u8a.length; i++) {
    const ch = u8a[i];
    if (ch === cr && !cr1) cr1 = true;
    else if (ch === lf && cr1) {
      lines.push(u8a.slice(head, i + 1));
      head = i + 1;
    } else cr1 = false;
  }
  return lines;
};
// returns: [keyWithoutColon, valueWithoutCRLF] | []
const splitKeyValue = u8a => {
  for (let i = 0; i < u8a.length; i++) {
    if (u8a[i] === colon) return [u8a.slice(0, i), u8a.slice(i + 1, -2)]; // remove : and crlf
  }
  return []; // invalid line
}

// returns: MessageEvent
const parseEvent = msg => {
  const map = new Map();
  const textDecoder = new TextDecoder();
  const lines = splitLines(msg);
  for (const line of lines) {
    if (line.length <= 2) break; // as the last empty line
    const [key, value] = splitKeyValue(line);
    if (key.length === 0) continue; // as a comment line
    const keyText = textDecoder.decode(key);
    if (keyText === "data" && map.has(keyText)) {
      const data = map.get(keyText);
      const buf = new Uint8Array(data.length + value.length);
      buf.set(data);
      buf.set(value, data.length);
      map.set(keyText, value);
    } else {
      map.set(keyText, value);
    }
  }
  const eventName = map.has("event") ? textDecoder.decode(map.get("event")).trim() : "message";
  const id = map.has("id") ? textDecoder.decode(map.get("id")).trim() : null;
  const data = map.has("data") ? textDecoder.decode(map.get("data")) : null;
  const retry = map.has("retry") ? parseInt(textDecoder.decode(map.get("retry"))) : -1;
  const event = data !== null ? new MessageEvent(eventName, {data, lastEventId: id}) : null;
  return {event, retry};
};
