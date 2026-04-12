import path from "path";
import { fileURLToPath } from "url";
import { list } from "../src/list-impl";
import { expect, test } from "@jest/globals";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("list fuzz tests", async () => {
  const workingDirectory = path.join(__dirname, "testdata/fuzz");
  const { fuzzTests } = await list({
    packages: ["./..."],
    workingDirectory,
  });
  expect(fuzzTests).toEqual([
    {
      package: "example/fuzz",
      func: "^FuzzReverse$",
    },
    {
      package: "example/fuzz/sub",
      func: "^FuzzSomeFuzzTarget$",
    },
  ]);
}, 600000); // it runs go test, so it takes time.
