// route /123D.../path request to fetch("http2p:123D/path")
import * as stream from "node:stream";

const incomingMessageToRequest = im => {
  // create Response from im
  // request url to gateway as "/${p2pid}/path?query" e.g. "/12D3..../index.html?q=123"
  const urlMatch = im.url.match(/^\/([^/]+)(\/.*)$/); // TBD: ID validation
  if (!urlMatch) throw Error("Invalid gateway url: " + im.url);
  const pid = urlMatch[1];
  const path = urlMatch[2];
  const url = `http2p:${pid}${path}`; // as http2p url
  const method = im.method.toUpperCase();
  const headers = im.headers;
  if (method === "GET" || method === "HEAD") {
    return new Request(url, {method, headers});
  } else {
    const body = stream.Readable.toWeb(im);
    return new Request(url, {method, headers, body, duplex: "half"});
  }
};
const responseToOutgoingMessage = (response, om, cors, im) => {
  // write response status, headers, body into om
  const headers = Object.fromEntries(response.headers.entries()); // as nodejs response headers
  //console.log(cors, im.headers);
  if (cors && !headers["Access-Control-Allow-Origin"] && Object.hasOwn(im.headers, "origin")) {
    headers["Access-Control-Allow-Origin"] = im.headers["origin"];
  }
  om.writeHead(response.status, headers);
  //(node-19.1.0) stream.Writable.toWeb is not accept http.OutgoingMessage: its NOT stream.Writable
  //- https://github.com/nodejs/node/pull/45642
  //response.body.pipeTo(stream.Writable.toWeb(om));
  (async () => {
    for await (const u8a of response.body) om.write(u8a);
    om.end();
  })().catch(console.error);
};

const processPreflight = (req, res) => {
  //console.log(req.method, req.headers);
  if (req.method.toUpperCase() === "OPTIONS" && Object.hasOwn(req.headers, "access-control-request-method")) {
    // Send CORS Preflight reponse
    // allow all requests
    const headers = {
      "access-control-allow-methods": req.headers["access-control-request-method"],
      "access-control-allow-origin": req.headers["origin"],
    };
    if (Object.hasOwn(req.headers, "access-control-request-headers")) {
      headers["access-control-allow-headers"] = req.headers["access-control-request-headers"];
    }
    res.writeHead(204, headers);
    res.end();
    return true;
  }
  return false;
};


//[example]
// import * as http from "node:http";
// import * as Helia from "helia";
//
// const heliaNode = await Helia.createHelia();
// const server = http.createServer(createListener(createHttp2p(heliaNode.libp2p)))
// server.listen(8000);
export const createListener = (http2p, cors = true) => (req, res) => {
  try {
    if (cors && processPreflight(req, res)) return;
    const request = incomingMessageToRequest(req);
    //console.log(request);
    http2p.fetch(request).then(response => responseToOutgoingMessage(response, res, cors, req)).catch(console.error);
  } catch (error) {
    console.info("[http2p gateway error]", error.message);
    res.writeHead(500, {"content-type": "text/plain;charset=utf-8"}); // TBD: use gateway error code?
    res.end(error.message);
  }
};
