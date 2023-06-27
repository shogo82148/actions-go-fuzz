import * as core from "@actions/core";
import { fuzz } from "./run-impl";

async function run(): Promise<void> {
  try {
    const repository = core.getInput("repository");
    const githubToken = core.getInput("token");
    const githubGraphqlUrl = process.env["GITHUB_GRAPHQL_URL"] || "https://api.github.com/graphql";
    const packages = core.getInput("packages").trim();
    const workingDirectory = core.getInput("working-directory");
    const fuzzRegexp = core.getInput("fuzz-regexp");
    const fuzzTime = core.getInput("fuzz-time");
    const fuzzMinimizeTime = core.getInput("fuzz-minimize-time");
    const headBranchPrefix = core.getInput("head-branch-prefix").trim();
    const options = {
      repository,
      githubToken,
      githubGraphqlUrl,
      packages,
      workingDirectory,
      fuzzRegexp,
      fuzzTime,
      fuzzMinimizeTime,
      headBranchPrefix,
    };

    await fuzz(options);
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

void run();
