export const TextEventStreamBody = class {
  #closed = false;
  #queue = [];
  #controllers = new Set();
  
  dispatchEvent(ev) {//ev: MessageEvent
    if (this.#closed) return;
    if (!(ev instanceof MessageEvent)) throw TypeError("argument should be MessageEvent");
    this.#queue.push(ev);
    const msg = messageEventToChunk(ev);
    for (const controller of this.#controllers) controller.enqueue(msg.slice());
  }
  sendRetry(msec) {
    if (this.#closed) return;
    const msg = new TextEncoder().encode(`retry: ${msec}\r\n\r\n`);
    for (const controller of this.#controllers) controller.enqueue(msg.slice());
  }
  get closed() {
    return this.#closed;
  }
  close() {
    this.#closed = true;
    for (const controller of this.#controllers) controller.close();
    this.#queue = [];
  }
  newReadableStream({lastEventId, all} = {}) {
    let ctr;
    const start = controller => {
      ctr = controller;
      if (all) {
        for (const ev of this.#queue) controller.enqueue(messageEventToChunk(ev));
      } else if (lastEventId !== undefined) {
        const idx = this.#queue.findIndex(ev => ev.lastEventId === lastEventId);
        if (idx >= 0) {
          for (const ev of this.#queue.slice(idx)) controller.enqueue(messageEventToChunk(ev));
        }
      }
      this.#controllers.add(controller);
    };
    const cancel = () => {
      this.#controllers.delete(ctr);
      ctr = null;
    }
    return new ReadableStream({start, cancel, type: "bytes"});
  }
};

const messageEventToChunk = event => {
  const head = [];
  if (event.lastEventId) head.push(`id: ${event.lastEventId}`);
  if (event.type !== "message") head.push(`event: ${event.type}`)
  const dataList = `${event.data}`.split("\r\n").map(line => `data: ${line}`);
  return new TextEncoder().encode([...head, ...dataList, "", ""].join("\r\n"));
};
