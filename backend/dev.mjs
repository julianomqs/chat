import { spawn } from "node:child_process";

const scripts = ["typecheck:watch", "start:server"];
const children = [];
let stopping = false;

const stopChildren = (signal) => {
  if (stopping) {
    return;
  }

  stopping = true;

  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  }
};

for (const script of scripts) {
  const child = spawn("npm", ["run", script], { stdio: "inherit" });

  children.push(child);

  child.on("exit", (code, signal) => {
    if (!stopping) {
      process.exitCode = code ?? (signal ? 1 : 0);
      stopChildren("SIGTERM");
    }
  });
}

process.once("SIGINT", () => stopChildren("SIGINT"));
process.once("SIGTERM", () => stopChildren("SIGTERM"));
