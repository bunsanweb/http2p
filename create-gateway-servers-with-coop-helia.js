import {createHelia} from "helia";
import {unixfs} from "@helia/unixfs";
import {createServers} from "./create-gateway-servers.js";
import {createHttp2p} from "./http2p.js";
import {createCoop} from "./coop.js";
import {createCoopHelia} from "./coop-helia.js";

export const createServersWithCoopHelia = async config => {
  // config
  // - idFile string?: file path of private key binary of peerId
  // - gateway.port int: http server port of serving JSON libp2p info
  // - coop.mainnet string?: mainnet name
  // - coop.keys string[]: watching keys for caching CIDs
  const servers = await createServers(config);
  const helia = await createHelia({libp2p: servers.libp2p});
  const heliaUnixfs = unixfs(helia);
  const coop = await createCoop(servers.http2p, config.coop);
  for (const key of config.coop.keys ?? []) {
    coop.keys.add(key);
  }
  const coopHelia = createCoopHelia(coop, heliaUnixfs);
  const stop = async () => {
    await coopHelia.stop();
    await coop.stop();
    await helia.stop();
    await servers.stop();
  };
  return {...servers, helia, unixfs: heliaUnixfs, coop, coopHelia, stop};
};
