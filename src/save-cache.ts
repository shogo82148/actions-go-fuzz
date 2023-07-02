import * as core from "@actions/core";
import { saveCache } from "./run-impl";

async function run(): Promise<void> {
  const packages = core.getInput("packages").trim();
  const workingDirectory = core.getInput("working-directory");
  const fuzzRegexp = core.getInput("fuzz-regexp");
  const options = {
    packages,
    workingDirectory,
    fuzzRegexp,
  };

  try {
    await core.group("save cache", async () => {
      await saveCache(options);
    });
  } catch (error) {
    core.warning("error while saving cache.");
    if (error instanceof Error) core.warning(error.message);
  }
}

void run();
