// wrapping libp2p stream (mplex/stream)
// - stream.source: AsyncIterable<Uint8Array>
// - stream.sink: (Iterable<Uint8Array> | AsyncIterable<Uint8Array>) => Promise<undefined>
// - stream.close, stream.closeRead, stream.closeWrite, stream.abort, stream.reset
const newQueue = () => {
  const [gets, polls] = [[], []];
  const next = () => new Promise(
    get => polls.length > 0 ? polls.shift()(get) : gets.push(get));
  const poll = () => new Promise(
    poll => gets.length > 0 ? poll(gets.shift()) : polls.push(poll));
  const push = value => poll().then(get => get({value, done: false}));
  const close = () => poll().then(get => get({done: true}));
  return {[Symbol.asyncIterator]() {return this;}, next, push, close};
}

const payload = (u8a, type = 0) => {
  const ret = new Uint8Array(u8a.length + 1);
  ret[0] = type;
  ret.set(u8a, 1);
  return ret;
}

export const newClosableStream = stream => {
  const eventTarget = new EventTarget();
  let sinkFinished = false, sourceFinished = false;
  
  // send to remote
  const writeQueue = newQueue();
  const writing = async () => {
    return stream.sink(async function* () {
      let closed = false, finished = false;
      while (!closed || !finished) {
        const {done, value: {type, value}} = await writeQueue.next();
        if (type === "data") {
          yield payload(value, 0);
        } else if (type === "close") {
          yield Uint8Array.from([1]);
          closed = true;
        }  else if (type === "finished") {
          yield Uint8Array.from([2]);
          finished = true;
        }
      }
      stream.closeWrite();
      //console.info("[stream.closeWrite()]");
    });
  };
  const writingPromise = writing().catch(error => {
    eventTarget.dispatchEvent(new CustomEvent("error", {detail: error}));
  });

  // receive from remote
  const readQueue = newQueue();
  let remoteClosed = false;
  const reading = async () => {
    for await (const bl of stream.source) {
      if (sourceFinished) break;
      const u8a = bl.slice();
      //console.log("type", u8a[0], u8a);
      if (u8a[0] === 0) readQueue.push({type: "data", value: u8a.slice(1)});
      if (u8a[0] === 1) remoteClosed = true;
      if (u8a[0] === 2) readQueue.push({type: "finished"});
    }
    readQueue.push({type: "finished"});
    stream.closeRead();
    //console.info("[stream.closeRead()]");
  };
  const readingPromise = reading().catch(error => {
    // (ipfs-0.65.0) may spawn `Error: Socket read timeout`
    eventTarget.dispatchEvent(new CustomEvent("error", {detail: error}));
  });

  // wrapped stream.source
  const source = (async function* () {
    for (;;) {
      const {done, value: {type, value}} = await readQueue.next();
      if (type === "data") yield value;
      if (type === "finished") break;
    }
    writeQueue.push({type: "close"});
    sourceFinished = true;
  })();
  
  // wrapped stream.sink
  const sink = async iter => {
    for await (const value of iter) {
      if (remoteClosed) break;
      writeQueue.push({type: "data", value});
    }
    writeQueue.push({type: "finished"});
    sinkFinished = true;
  };

  // send close to read;
  const closeRead = async () => {
    writeQueue.push({type: "close"});
    sourceFinished = true;
  };
  const closeWrite = async () => {
    writeQueue.push({type: "finished"});
    sinkFinished = true;
  };
  
  // wrapped stream
  return Object.assign(eventTarget, {
    source, sink, closeRead, closeWrite,
    close() {return Promise.all([closeRead(), closeWrite()]);},
    reset() {return stream.reset();},
    abort(...args) {return stream.abort(...args);},
  });
};
