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

interface ListResult {
  fuzzTests: FuzzTest[];
}

export async function list(packages: string[], workingDirectory: string): Promise<ListResult> {
  // list Fuzz tests in the packages.
  const opts = { cwd: workingDirectory };
  const output = await exec.getExecOutput("go", ["test", "-list", "^Fuzz", "-json", ...packages], opts);
  const fuzzTests: FuzzTest[] = output.stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as TestEvent)
    .filter((line) => line.Action === "output")
    .filter((line) => line.Output !== undefined && line.Output.startsWith("Fuzz"))
    .map((line) => {
      return {
        package: line.Package,
        func: line.Output?.trim() ?? "",
      };
    });

  return {
    fuzzTests,
  };
}
