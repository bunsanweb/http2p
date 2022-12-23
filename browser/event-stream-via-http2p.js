import {createIpfsWithHttp2pGateway} from "./connect-gateway-servers.js";
import {createHttp2p} from "http2p";

const gatewayUrl = "http://localhost:9000/";
const node = await createIpfsWithHttp2pGateway(gatewayUrl);
const id = await node.id();

// text/event-stream fetch handler
const nodeHttp2p = await createHttp2p(node.libp2p);
nodeHttp2p.scope.addEventListener("fetch", ev => {
  //console.log(ev.request);
  const newCounterEventStream = max => {
    let n = 0;
    return new ReadableStream({
      type: "bytes",
      async pull(controller) {
        //console.log("[pull]");
        if (n === max) {
          const event = [
            "event: counter-closed",
            `data: ${JSON.stringify(true)}`,
          ].join("\r\n");
          controller.enqueue(new TextEncoder().encode(event + "\r\n\r\n"));
          return controller.close();
        } else {
          const event = [
            "event: counter-event",
            `data: ${JSON.stringify({counter: ++n})}`,
          ].join("\r\n");
          controller.enqueue(new TextEncoder().encode(event + "\r\n\r\n"));
          await new Promise(f => setTimeout(f, 1000));
        }
      },
    });
  };
  
  ev.respondWith(new Response(
    newCounterEventStream(20),
    {
      headers: {
        "content-type": "text/event-stream",
      },
    }
  ));
});

// event source
const url = `http://localhost:9000/${id.id.toJSON()}/`;
const button = document.createElement("button");
const div = document.createElement("div");
button.textContent = "access event-stream";
document.body.append(button, div);

let eventSource;
button.addEventListener("click", ev => {
  if (eventSource) return;
  eventSource = new EventSource(url);
  eventSource.addEventListener("counter-closed", ev => {
    eventSource.close();
    eventSource = null;
    div.textContent = "";
  });
  eventSource.addEventListener("counter-event", ev => {
    //console.log(ev);
    div.textContent = ev.data;
  });
});
