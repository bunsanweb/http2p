import {createServers} from "./create-gateway-servers.js";

// create
const config = {
  sig: {port: 9090,},
  gateway: {port: 9000,},
  idFile: "./.gateway-peer-id.bin",
};
const {info} = await createServers(config);
//console.log(info);
console.log(await (await fetch(info.gateways[0])).json()); // get info from gateway web server
