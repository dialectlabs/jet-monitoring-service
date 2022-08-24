import fetch from 'cross-fetch';
//import { RequestInfo, RequestInit } from "node-fetch";

//const fetch = (url: RequestInfo, init?: RequestInit) =>  import("node-fetch").then(({ default: fetch }) => fetch(url, init));

global.fetch = fetch;
