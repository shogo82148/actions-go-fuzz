import { list } from "./list-impl";
import * as core from "@actions/core";

async function run(): Promise<void> {
  try {
    const workingDirectory = core.getInput("working-directory");
    const pkg = core.getInput("packages").trim();
    const packages = pkg.split(/\s+/);

    const { fuzzTests } = await list(packages, workingDirectory);
    core.setOutput("fuzz-tests", JSON.stringify(fuzzTests));
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

void run();
