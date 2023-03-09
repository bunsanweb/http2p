
export const CoopCache = class {
  constructor(maxAge) {
    if (maxAge <= 0) throw new TypeError("it requires maxAge > 0");
    this.responses = new Map();
    this.maxAge = maxAge;
  }
  async put(request, res) {
    const time = Date.now();
    const url = typeof request === "string" ? request : request.url;
    request = typeof request === "string" ? new Request(request) : request;
    const ccReq = parseCacheControl(request.headers.get("cache-control"));
    const ccRes = parseCacheControl(res.headers.get("cache-control"));
    if (!ccReq.has("no-store") && !ccReq.has("no-store")) this.responses.set(url, {req: request, res: await cloneResponse(res), time});
  }
  async match(request) {
    const res = matchResponse(this, request);
    return res ? res.clone() : res;
  }
  async delete(request) {
    const res = matchResponse(this, request);
    if (!res) return false;
    const url = typeof request === "string" ? request : request.url;
    this.responses.delete(url);
    return true;
  }
};

// NOTE: nodejs-19.6.0, Response.clone() fails with ReadableStream body (spec is support with body.tee())
// - https://fetch.spec.whatwg.org/#concept-body
// Response with arrayBuffer body can clone() 
const cloneResponse = async res => res ? new Response(await res.arrayBuffer(), res) : res;

const matchResponse = (cache, request) => {
  const now = Date.now();
  const url = typeof request === "string" ? request : request.url;
  request = typeof request === "string" ? new Request(request) : request;
  if (!cache.responses.has(url)) return undefined;
  const {req, res, time} = cache.responses.get(url);
  // cache age check
  const cc = parseCacheControl(res.headers.get("cache-control"));
  const ccMaxAge = +cc.get("max-age");
  const maxAge = ccMaxAge > 0 ? ccMaxAge : cache.maxAge;
  const date = res.headers.has("date") ? new Date(res.headers.get("date")).getTime() : time;
  if ((now - date) > maxAge * 1000) { // staled
    cache.responses.delete(url);
    return undefined;
  }
  
  // method mismatch
  if (request.method !== req.method) return undefined;
  // some of vary headers mismatch
  const vary = res.headers.get("vary");
  if (vary === "*") return undefined;
  if (typeof vary === "string") {
    const vkeys = vary.trim().split(/\s*,\s*/g);
    if (vkeys.some(k => request.headers.get(k) !== req.headers.get(k))) return undefined;
  }
  return res;
};

const parseCacheControl = cc => {
  const map = new Map();
  if (!cc) return map;
  for (const e of cc.split(";")) {
    const entry = e.trim().toLowerCase();
    if (!entry) continue;
    const eq = entry.indexOf("=");
    if (eq < 0) map.set(entry, "");
    else if (eq > 0) map.set(entry.slice(0, eq).trim(), entry.slice(eq + 1).trim());
    else continue;
  }
  return map;
};
