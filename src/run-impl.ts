import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import fs from "fs/promises";

interface FuzzOptions {
  packages: string;
  workingDirectory: string;
  fuzzRegexp: string;
  fuzzTime: string;
  fuzzMinimizeTime: string;
}

interface FuzzResult {
  TODO: string;
}

export async function fuzz(options: FuzzOptions): Promise<FuzzResult> {
  const exitCode = await core.group("fuzzing", async () => {
    return await exec.exec(
      "go",
      [
        "test",
        `-fuzz=${options.fuzzRegexp}`,
        `-fuzztime=${options.fuzzTime}`,
        `-fuzzminimizetime=${options.fuzzMinimizeTime}`,
        options.packages,
      ],
      { cwd: options.workingDirectory, ignoreReturnCode: true }
    );
  });

  if (exitCode === 0) {
    return {
      TODO: "fill me!",
    };
  }

  await generateReport(options);

  return {
    TODO: "fill me!",
  };
}

async function generateReport(options: FuzzOptions): Promise<void> {
  // const cwd = { cwd: options.workingDirectory };
  const ignoreReturnCode = { cwd: options.workingDirectory, ignoreReturnCode: true };

  const corpus = await getNewCorpus(options);
  if (corpus === undefined) {
    return;
  }

  const segments = corpus.split(path.sep);
  const testFunc = segments[segments.length - 2];
  const testCorpus = segments[segments.length - 1];
  await exec.getExecOutput("go", ["test", `-run=${testFunc}/${testCorpus}`, options.packages], ignoreReturnCode);

  const ret = await fs.readFile(corpus);
  ret.toString("base64");

  // cleanup
  await exec.exec("git", ["restore", "--staged", "."], ignoreReturnCode);
  await fs.unlink(corpus);
}

async function getNewCorpus(options: FuzzOptions): Promise<string | undefined> {
  const cwd = { cwd: options.workingDirectory };
  const ignoreReturnCode = { cwd: options.workingDirectory, ignoreReturnCode: true };

  // check whether there is any changes.
  await exec.exec("git", ["add", "."], cwd);
  const hasChange = await exec.exec("git", ["diff", "--cached", "--exit-code", "--quiet"], ignoreReturnCode);
  if (hasChange === 0) {
    return undefined;
  }

  // find new test corpus.
  const output = await exec.getExecOutput(
    "git",
    ["diff", "--name-only", "--cached", "--no-renames", "--diff-filter=d"],
    cwd
  );
  const testdata = output.stdout.split("\n").filter((file) => {
    {
      const segments = file.split(path.sep);
      return (
        segments.length >= 4 &&
        segments[segments.length - 4] === "testdata" &&
        segments[segments.length - 3] === "fuzz" &&
        segments[segments.length - 2].startsWith("Fuzz")
      );
    }
  });
  if (testdata.length !== 1) {
    return undefined;
  }
  return testdata[0];
}
