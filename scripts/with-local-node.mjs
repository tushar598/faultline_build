// Runs a command against a Hardhat node on 127.0.0.1:8545: reuses a node that is already running, otherwise starts
// `npx hardhat node`, waits until it answers, runs the command, and stops the node it started.
//   node scripts/with-local-node.mjs <command> [args…]
import { spawn } from "node:child_process";

const RPC = "http://127.0.0.1:8545";
const alive = async () => {
  try {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
    return (await r.json()).result === "0x7a69";
  } catch {
    return false;
  }
};

const [cmd, ...args] = process.argv.slice(2);
let node;
if (!(await alive())) {
  node = spawn("npx", ["hardhat", "node"], { stdio: "ignore", detached: false });
  for (let i = 0; i < 120 && !(await alive()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await alive())) {
    node.kill();
    console.error("hardhat node did not start on :8545");
    process.exit(1);
  }
  console.log("started a Hardhat node on :8545 for this run");
} else console.log("using the Hardhat node already running on :8545");

const child = spawn(cmd, args, { stdio: "inherit" });
const code = await new Promise((r) => child.on("exit", (c) => r(c ?? 1)));
if (node) node.kill();
process.exit(code);
