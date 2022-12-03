// route /123D.../path request to fetch("http2p:123D/path")
import * as stream from "node:stream";

const incomingMessageToRequest = im => {
  // create Response from im
  const urlMatch = im.url.match(/^\/([^/]+)(\/.*)$/);
  if (!urlMatch) throw Error("Invalid gateway url");
  const pid = urlMatch[1];
  const path = urlMatch[2];
  const url = `http2p:${pid}${path}`;
  const method = im.method.toUpperCase();
  const headers = im.headers;
  if (method === "GET" || method === "HEAD") {
    return new Request(url, {method, headers});
  } else {
    const body = stream.Readable.toWeb(im);
    return new Request(url, {method, headers, body});
  }
};
const responseToOutgoingMessage = (response, om) => {
  // write response status, headers, body into om
  const headers = Object.fromEntries(response.headers.entries());
  om.writeHead(response.status, headers);
  //(node-19.1.0) stream.Writable.toWeb is not accept http.OutgoingMessage: its NOT stream.Writable
  //- https://github.com/nodejs/node/pull/45642
  //response.body.pipeTo(stream.Writable.toWeb(om));
  (async () => {
    for await (const u8a of response.body) om.write(u8a);
    om.end();
  })().catch(console.error);
};

//[example]
// import * as http from "node:http";
// import * as IPFS from "ipfs-core";
//
// const ipfsNode = await IPFS.create();
// const server = http.createServer(createListener(createHttp2p(ipfsNode)))
// server.listen(8000);
export const createListener = http2p => (req, res) => {
  try {
    const request = incomingMessageToRequest(req);
    http2p.fetch(request).then(response => responseToOutgoingMessage(response, res)).catch(console.error);
  } catch (error) {
    res.writeHead(500, {"content-type": "text/plain;charset=utf-8"}); // TBD: use gateway error code?
    res.end(error.message);
  }
};
