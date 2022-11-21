
// functions for libp2p stream handling
const readLine = u8as => {
  const cr = "\r".codePointAt(0), lf = "\n".codePointAt(0);
  for (let i = 0; i < u8as.length; i++) {
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
      // found CR at chunk last and found LF at next chunk head
      const lineForwards = u8as.slice(0, i + 1);
      const lineLast = u8as[i + 1].slice(0, 1);
      const restTop = u8as[i + 1].slice(1);
      const restEnd = u8as.slice(i + 2);
      return [[...lineForwards, lineLast], [restTop, ...restEnd]];
    }
  }
  return [u8as, []]; // CRLF not found
};
const u8asToText = u8as => {
  const decoder = new TextDecoder();
  let text = "";
  for (const u8a of u8as) {
    text += decoder.decode(u8a, {stream: true});
  }
  return text;
};
const u8asToReadableStream = u8as => {
  return new ReadableStream({
    type: "bytes",
    start(controller) {
      for (const u8a of u8as) {
        if (u8a.length > 0) controller.enqueue(u8a);
      }
      controller.close();
    },
  });
};

const sourceToMime = async source => {
  const u8as = [];
  for await (const bl of source) {
    u8as.push(bl.slice().slice());
  }
  let [line, rest] = readLine(u8as);
  const start = u8asToText(line);
  const headers = new Headers();
  while (true) {
    [line, rest] = readLine(rest);
    const text = u8asToText(line);
    if (text.length === 2) break; // CRLF only
    const index = text.indexOf(": ");
    const key = text.slice(0, index);
    const value = text.slice(index + 2);
    headers.set(key, value);
  }
  const body = u8asToReadableStream(rest);
  return {start, headers, body};
};
const formatHeaders = headers => {
  return [...headers].map(([key, value]) => `${key}: ${value}\r\n`).join("") + "\r\n";
};

// Fetch handler
const sourceToRequest = async source => {
  const {start, headers, body} = await sourceToMime(source);
  const spaceIndex = start.indexOf(" ");
  const method = start.slice(0, spaceIndex);
  const url = start.slice(spaceIndex + 1, -2);
  const options = ["GET", "HEAD"].includes(method) ? {method, headers} : {method, headers, body};
  return new Request(url, options);
};

const errorToSink = (sink, error, code = 500) => {
  const statusLine = `${code}\r\n`; //NOTE: HTTP Status value only
  const body = error.stack;
  const headers = new Headers([
    ["Content-Type", "text/plain;charset=utf-8"],
    ["Content-Length", `${body.length}`],
  ]);
  const msg = statusLine + fromatHeaders(headers) + body;
  const u8 = new TextEncoder().encode(msg);
  sink((async function* () {
    yield u8;
  })());
};
  
const responseToSink = (sink, response) => {
  if (!(response instanceof Response)) throw new TypeError("response should be instance of Response");
  const statusLine = `${response.status}\r\n`;
  const u8 = new TextEncoder().encode(statusLine + formatHeaders(response.headers));
  sink((async function* () {
    yield u8;
    if (response.body) for await (const chunk of response.body) {
      yield chunk;
    }
  })());
};

const libp2pHandler = scope => ({connection, stream}) => {
  sourceToRequest(stream.source).then(request => {
    const response = [], waits = [];
    const FetchEvent = class extends Event {
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
  sink((async function* () {
    yield u8;
    if (request.body) for await (const chunk of request.body) {
      yield chunk;
    }
  })());
};
const sourceToResponse = async (source) => {
  const {start, headers, body} = await sourceToMime(source);
  const status = start.slice(0, -2);
  return new Response(body, {status, headers});
};

const libp2pProtocol = "/http2p/1.0";
const libp2pFetch = libp2p => async (input, options) => {
  const request = typeof input === "string" ? new Request(input, options) : input;
  const url = new URL(request.url);
  const p2pid = url.pathname.slice(0, url.pathname.indexOf("/"));
  await ping(libp2p, p2pid);
  const stream = await libp2p.dialProtocol(`/p2p/${p2pid}`, libp2pProtocol);
  await requestToSink(request, stream.sink);
  return await sourceToResponse(stream.source);
};

const ping = async (libp2p, p2pid) => {
  const pids = new Set((await libp2p.peerStore.all()).map(peer => peer.id.toJSON()));
  for (const pid of pids) {
    try {
      // ping via p2p-circuit address
      const circuit = `/p2p/${pid}/p2p-circuit/p2p/${p2pid}`;
      return await libp2p.ping(circuit);
    } catch (error) {}
  }
  // case of no peer routing
  return await libp2p.peerRouting.findPeer(p2pid);
};

// exports
export const createHttp2p = async ({libp2p}) => {
  const scope = new EventTarget();
  const handler = libp2pHandler(scope);
  await libp2p.handle(libp2pProtocol, handler);
  const close = () => libp2p.unhandle(libp2pProtocol);
  const fetch = libp2pFetch(libp2p);
  return {scope, fetch, close};
};
