import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { render } from "./lunar-table.ts";

it("src/shared/lunar-table.ts is what scripts/lunar-table.ts makes", () => {
  expect(readFileSync(new URL("../src/shared/lunar-table.ts", import.meta.url), "utf8")).toBe(render());
});
