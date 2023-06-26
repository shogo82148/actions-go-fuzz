import * as exec from "@actions/exec";

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
  await exec.exec(
    "go",
    [
      "test",
      `-fuzz=${options.fuzzRegexp}`,
      `-fuzztime=${options.fuzzTime}`,
      `-fuzzminimizetime=${options.fuzzMinimizeTime}`,
      options.packages,
    ],
    { cwd: options.workingDirectory }
  );
  return {
    TODO: "fill me!",
  };
}
