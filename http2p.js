import {newClosableStream} from "./closable-stream.js";

// functions for libp2p stream handling
const readLine = async (u8asRest, sourceIter) => {
  const cr = "\r".codePointAt(0), lf = "\n".codePointAt(0);
  const u8as = u8asRest.slice();
  for (let i = 0;; i++) {
    if (i >= u8as.length) {
      const {done, value} = await sourceIter.next();
      if (done) return [u8as, []];
      //u8as.push(value.slice().slice()); //[no closable-stream]
      u8as.push(value); //[closable-stream]
    }
    for (let j = 0; j < u8as[i].length - 1; j++) {
      if (u8as[i][j] === cr && u8as[i][j + 1] === lf) {
        // found CRLF in a chunk
        const lineForwards = u8as.slice(0, i);
        const lineLast = u8as[i].slice(0, j + 2);
        const restTop = u8as[i].slice(j + 2);
        const restEnd = u8as.slice(i + 1);
        return [[...lineForwards, lineLast], [restTop, ...restEnd]];
      }
    }
    if (u8as[i].at(-1) === cr && i < u8as.length - 1 && u8as[i + 1][0] === lf) {
      // found CR at last byte of chunk and found LF at head of next chunk
      const lineForwards = u8as.slice(0, i + 1);
      const lineLast = u8as[i + 1].slice(0, 1);
      const restTop = u8as[i + 1].slice(1);
      const restEnd = u8as.slice(i + 2);
      return [[...lineForwards, lineLast], [restTop, ...restEnd]];
    }
  }
  throw Error("never reached");
};

const u8asToText = u8as => {
  const decoder = new TextDecoder();
  let text = "";
  for (const u8a of u8as) {
    text += decoder.decode(u8a, {stream: true});
  }
  return text;
};
const u8asToReadableStream = (u8as, sourceIter, close) => {
  return new ReadableStream({
    type: "bytes",
    async start(controller) {
      for (const u8a of u8as) {
        if (u8a.length > 0) controller.enqueue(u8a);
      }
      await this.pull(controller); //read one chunk for closing from remote side
    },
    async pull(controller) {
      const {done, value} = await sourceIter.next();
      //if (value) controller.enqueue(value.slice().slice()); //[no closable-stream]
      if (value) controller.enqueue(value); //[closable-stream]
      if (done) controller.close();
    },
    async cancel(reason) {
      await close(reason);
    },
  });
};

const sourceToMime = async (source, close) => {
  const sourceIter = source[Symbol.asyncIterator]();
  let [line, rest] = await readLine([], sourceIter);
  const start = u8asToText(line);
  const headers = new Headers();
  while (true) {
    [line, rest] = await readLine(rest, sourceIter);
    const text = u8asToText(line);
    if (text.length === 2) break; // CRLF only
    const index = text.indexOf(": ");
    const key = text.slice(0, index);
    const value = text.slice(index + 2);
    headers.set(key, value);
  }
  const body = u8asToReadableStream(rest, sourceIter, close);
  return {start, headers, body};
};

const formatHeaders = headers => {
  return [...headers].map(([key, value]) => `${key}: ${value}\r\n`).join("") + "\r\n";
};

// Fetch handler
const sourceToRequest = async (source, close) => {
  const {start, headers, body} = await sourceToMime(source, close);
  const spaceIndex = start.indexOf(" ");
  const method = start.slice(0, spaceIndex);
  const url = start.slice(spaceIndex + 1, -2);
  const options = ["GET", "HEAD"].includes(method) ? {method, headers} : {method, headers, body, duplex: "half"};
  return new Request(url, options);
};

const errorToSink = (sink, error, code = 500) => {
  const statusLine = `${code}\r\n`; //NOTE: HTTP Status value only
  const body = new TextEncoder().encode(error.stack);
  const headers = new Headers([
    ["Content-Type", "text/plain;charset=utf-8"],
    ["Content-Length", `${body.length}`],
  ]);
  const msg = statusLine + formatHeaders(headers);
  const u8 = new TextEncoder().encode(msg);
  sink(async function* () {
    yield u8;
    yield body;
  }());
};
  
const responseToSink = (sink, response) => {
  if (!(response instanceof Response)) throw new TypeError("response should be instance of Response");
  const statusLine = `${response.status}\r\n`;
  const u8 = new TextEncoder().encode(statusLine + formatHeaders(response.headers));
  sink((async function* () {
    yield u8;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const {done, value} = await reader.read();
        //try {console.log(done, new TextDecoder().decode(value));} catch (err) {}
        if (done) break;
        yield value;
      }
      reader.releaseLock();
    }
  })());
};

const libp2pHandler = scope => ({connection, stream}) => {
  //console.log(connection);
  //console.log(stream);
  stream = newClosableStream(stream); //[closable-stream]
  sourceToRequest(stream.source, stream.close).then(request => {
    const remotePeerId = connection.remotePeer.toJSON();
    const response = [], waits = [];
    const FetchEvent = class extends Event {
      get remotePeerId() {return remotePeerId;} //[non-standard] libp2p PeerId of remote client
      get request() {return request;}
      respondWith(responsePromise) {
        if (response.length !== 0) throw TypeError("multiple respondWith() call");
        this.stopImmediatePropagation();
        response.push(responsePromise);
      }
      waitUntil(promise) {
        waits.push(promise);
      }
    };
    const doDefault = scope.dispatchEvent(new FetchEvent("fetch", {cancelable: true}));
    if (response.length === 0) {
      errorToSink(stream.sink, new Error("Not Found"), 404);
    } else {
      Promise.resolve(response[0]).then(
        response => responseToSink(stream.sink, response),
        error => errorToSink(stream.sink, error)).catch(console.error);
    }
    Promise.allSettled(waits).catch(err => {/* ignore waitUntil error results */});
  }).catch(console.error);
};


// fetch function
const requestToSink = async (request, sink) => {
  const startLine = `${request.method} ${request.url}\r\n`;
  const u8 = new TextEncoder().encode(startLine + formatHeaders(request.headers));
  sink(async function* () {
    yield u8;
    if (request.body) {
      const reader = request.body.getReader();
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        yield value;
      }
      reader.releaseLock();
    }
  }());
};
const sourceToResponse = async (source, close) => {
  const {start, headers, body} = await sourceToMime(source, close);
  const status = start.slice(0, -2);
  return new Response(body, {status, headers});
};

const libp2pProtocol = "/http2p/1.0";
const libp2pFetch = (libp2p, Multiaddr) => async (input, options) => {
  const request = typeof input === "string" ? new Request(input, options) : input;
  const url = new URL(request.url);
  const p2pid = url.pathname.slice(0, url.pathname.indexOf("/"));
  await ping(Multiaddr, libp2p, p2pid);
  const addr = new Multiaddr(`/p2p/${p2pid}`);
  const stream = newClosableStream(await libp2p.dialProtocol(addr, libp2pProtocol)); //[closable-stream]
  request.signal.addEventListener("abort", ev => {
    //console.log("abort");
    stream.close(request.signal.reason);
  });
  await requestToSink(request, stream.sink);
  return await sourceToResponse(stream.source, err => stream.close(err));
};

// resolve route of p2p ID
const ping = async (Multiaddr, libp2p, p2pid, retry = 5) => {
  const pids = new Set((await libp2p.peerStore.all()).map(peer => peer.id.toJSON()));
  for (const pid of pids) {
    try {
      // ping via p2p-circuit address (fast)
      const circuit = `/p2p/${pid}/p2p-circuit/p2p/${p2pid}`;
      //console.log("[ping]", circuit);
      return await libp2p.ping(new Multiaddr(circuit));
    } catch (error) {
      //console.log("[ping error]", error);
    }
  }
  // case of no peer routing (slow)
  try {
    return await libp2p.peerRouting.findPeer(p2pid);
  } catch (error) {
    //console.log("[findPeer error]", error);
    if (retry > 0) return await ping(Multiaddr, libp2p, p2pid, retry - 1);
    throw error;
  }
};

// exports
export const createHttp2p = async libp2p => {
  const Multiaddr = libp2p.getMultiaddrs()[0].constructor;
  const scope = new EventTarget();
  const handler = libp2pHandler(scope);
  await libp2p.handle(libp2pProtocol, handler);
  const close = () => libp2p.unhandle(libp2pProtocol);
  const fetch = libp2pFetch(libp2p, Multiaddr);
  return {scope, fetch, close, libp2p};
};
