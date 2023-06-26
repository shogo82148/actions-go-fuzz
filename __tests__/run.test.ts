import path from "path";
import { fuzz } from "../src/run-impl";
import { test } from "@jest/globals";

test("no error", async () => {
  const workingDirectory = path.join(__dirname, "testdata/fuzz");
  const opts = {
    packages: "example/fuzz/sub",
    fuzzRegexp: "^FuzzSomeFuzzTarget$",
    fuzzTime: "5s",
    fuzzMinimizeTime: "1s",
    workingDirectory,
  };
  await fuzz(opts);
}, 30000); // it runs go test, so it takes time.
