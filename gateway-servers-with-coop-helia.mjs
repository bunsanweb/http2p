import * as repl from "node:repl";
import {createServersWithCoopHelia} from "./create-gateway-servers-with-coop-helia.js";

// create
const config = {
  gateway: {port: 9000,},
  idFile: "./.gateway-peer-id.bin",
  refreshPeerListIntervalMS: 1000, // default 10sec
  coop: {
    keys: ["gateway-servers"],
  },
};
const {info, stop} = await createServersWithCoopHelia(config);
//console.log(info);
console.log(await (await fetch(info().gateways[0])).json()); // get info from gateway web server

console.log("To stop with Ctrl+D");
const rs = repl.start({
  prompt: "> ",
});
rs.once("exit", () => {
  stop().then(() => {
    console.log("Wait to stop gateway-servers...");
    rs.close();
  }).catch(console.error);
});
Object.assign(rs.context, {
  info, stop,
});
