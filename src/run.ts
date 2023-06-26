import * as core from "@actions/core";
import { fuzz } from "./run-impl";

async function run(): Promise<void> {
  try {
    const packages = core.getInput("packages").trim();
    const workingDirectory = core.getInput("working-directory");
    const fuzzRegexp = core.getInput("fuzz-regexp");
    const fuzzTime = core.getInput("fuzz-time");
    const fuzzMinimizeTime = core.getInput("fuzz-minimize-time");
    const options = {
      packages,
      workingDirectory,
      fuzzRegexp,
      fuzzTime,
      fuzzMinimizeTime,
    };

    await fuzz(options);
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

void run();
