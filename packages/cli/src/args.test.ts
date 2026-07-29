import { describe, expect, it } from "vitest";
import { parseCliArguments } from "./args.js";

describe("parseCliArguments", () => {
  it("accepts supported repeated server filters", () => {
    expect(
      parseCliArguments([
        "probe",
        "--run",
        "--server",
        "alpha",
        "--server=beta",
        "--timeout=4000",
        "--json"
      ])
    ).toMatchObject({
      command: "probe",
      run: true,
      servers: ["alpha", "beta"],
      timeout: 4000,
      json: true
    });
  });

  it.each([
    [["scan", "--unknown"], "Unknown option"],
    [["scan", "--lang"], "--lang requires a value"],
    [["scan", "--lang", "xx"], "--lang must be one of"],
    [["scan", "--run"], "not valid for scan"],
    [["probe", "--timeout", "20"], "--timeout must be an integer"],
    [["unknown"], "Unknown command"]
  ])("rejects invalid arguments %#", (argv, expected) => {
    expect(() => parseCliArguments(argv)).toThrow(expected);
  });
});
