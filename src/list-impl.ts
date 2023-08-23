import * as exec from "@actions/exec";

// An interface of the JSON output of go command.
// ref. https://pkg.go.dev/cmd/test2json
interface TestEvent {
  Time: string;
  Action: "start" | "run" | "pause" | "cont" | "pass" | "bench" | "fail" | "output";
  Package: string;
  Test?: string;
  Output?: string;
  Elapsed?: number;
}

interface FuzzTest {
  package: string;
  func: string;
}

interface ListOptions {
  packages: string[];
  workingDirectory: string;
  tags: string;
}

interface ListResult {
  fuzzTests: FuzzTest[];
}

export async function list(options: ListOptions): Promise<ListResult> {
  // build the command line arguments.
  const opts = { cwd: options.workingDirectory };
  const args = ["test", "-list", "^Fuzz", "-json", "-run", "^$"];
  if (options.tags) {
    args.push("-tags", options.tags);
  }
  args.push(...options.packages);
  const output = await exec.getExecOutput("go", args, opts);

  // list Fuzz tests in the packages.
  const fuzzTests: FuzzTest[] = output.stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as TestEvent)
    .filter((line) => line.Action === "output")
    .filter((line) => line.Output !== undefined && line.Output.startsWith("Fuzz"))
    .map((line) => {
      return {
        package: line.Package,
        func: `^${line.Output?.trim() ?? ""}$`,
      };
    });

  // sort by package name and function name for better stability.
  fuzzTests.sort((a, b) => {
    if (a.package < b.package) return -1;
    if (a.package > b.package) return 1;
    if (a.func < b.func) return -1;
    if (a.func > b.func) return 1;
    return 0;
  });

  return {
    fuzzTests,
  };
}
