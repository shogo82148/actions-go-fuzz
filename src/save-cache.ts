import * as core from "@actions/core";
import { saveCache } from "./run-impl";

async function run(): Promise<void> {
  try {
    await core.group("save cache", async () => {
      await saveCache();
    });
  } catch (error) {
    core.warning("error while saving cache.");
    if (error instanceof Error) core.warning(error.message);
  }
}

void run();
