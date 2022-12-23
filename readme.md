# http2p

HTTP style request/response messaging between IPFS/libp2p nodes on JavaScript runtimes (node.js/browser).

## `http2p:` URI scheme

`http2p:LIBP2PID/path?searchparams`

- e.g. `http2p:12D3KooWCVA7aRkAJMyRZcp5MopuiDqxZ2dnTauHQtEyR2qPWhug/directory/content.html?query1=value1&query2=value2`

## Core API: `http2p.js`

- `import {createHttp2p} from "./http2p.js"`
- `http2p = await createHttp2p(libp2pNode)`: activate on libp2p message handling
- `response = await http2p.fetch(request, options)`: client for `http2p:` URIs; same as the Web standard `fetch(request, options)`
- `http2p.scope.addEventListener("fetch", (fetchEvent) => {...})`: same as `ServiceWorker`'s `"fetch"` event handling
- `await http2p.close()`: stop libp2p message handling

`http2p.js` depends on `closable-stream.js`: wrapping `js-libp2p` stream for closing from read side.

## Web-to-HTTP2P gateway for node.js builtin `http.Server`: `gateway-http2p.js`

The gateway handles `http://host/LIBP2PID/path?searchparams` request as `fetch` `http2p:LIBP2PID/path?searchparams`,
and also handles CORS preflight requests.

- `import {createListener} from "./gateway-http2p.js"`
- `listener = createListener(http2p)`: create Web-to-HTTP2P gateway listener for `http.createServer(listener)`

## Other files

- `create-gateway-servers.js`: library for launching libp2p webrtc-star-signalling-server and web-to-http2p gateway web server
- `gateway-servers.mjs`: command webrtc-star-signalling-server as port 9090 and gateway web server as port 9000
- `examples/`: example commands with js-ipfs nodes on  node.js runtime 
- `browser/` : example htmls with js-ipfs nodes on browser runtime, these nodes connect to `npm run gateway-servrers`
- `auto-browser-test-example.mjs`: example code for launching signallin-server and gateway web server and file http server,
  then accessing `browser/hello-http2p-gateway.html` with playwright chromium, and then shutting down them all.

## Setup

```sh
$ npm i                   # install dependencies for commands
$ npm run lib-for-browser # build `browser/npm-browser.js` from `node_modules/` with `esbuild`
$ npm run http-server     # Serving `browser/` html/js files for accessing with your browsers
```

## To be done

- message format as libp2p protocol
- test cases
- publishable npm package
