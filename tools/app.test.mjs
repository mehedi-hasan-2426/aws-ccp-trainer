import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";

const source = readFileSync(new URL("../assets/js/app.js", import.meta.url), "utf8");

function session({ multi = false, revealed = false, mode = "study" } = {}) {
  const context = createContext({
    URL,
    document: {
      baseURI: "https://example.test/",
      getElementById: () => ({ hidden: false }),
      querySelectorAll: () => [],
    },
    fetch: () => new Promise(() => {}),
  });
  runInContext(source, context);
  runInContext(`
    render = () => {};
    state.mode = ${JSON.stringify(mode)};
    state.session = [{
      id: "q1",
      multi: ${multi},
      options: [{ key: "a" }, { key: "b" }, { key: "c" }],
      answer: ${JSON.stringify(multi ? ["a", "b"] : ["a"])},
    }];
    state.progress.set("q1", {
      selected: new Set(${JSON.stringify(multi ? ["a", "b"] : ["a"])}),
      revealed: ${revealed},
      correct: true,
    });
  `, context);
  return context;
}

for (const multi of [false, true]) {
  test(`revealed ${multi ? "multi" : "single"}-choice answers ignore keyboard changes`, () => {
    const context = session({ multi, revealed: true });
    runInContext('onKeydown({ key: "b", preventDefault() {} })', context);
    assert.equal(runInContext('Array.from(state.progress.get("q1").selected).join(",")', context), multi ? "a,b" : "a");
    assert.equal(runInContext('state.progress.get("q1").correct', context), true);
    assert.equal(runInContext('state.progress.get("q1").revealed', context), true);
  });
}

test("unrevealed exam answers can still be changed with letter and number shortcuts", () => {
  const context = session({ mode: "exam" });
  runInContext('onKeydown({ key: "b", preventDefault() {} })', context);
  assert.equal(runInContext('Array.from(state.progress.get("q1").selected).join(",")', context), "b");
  assert.equal(runInContext('state.progress.get("q1").correct', context), false);
  runInContext('onKeydown({ key: "1", preventDefault() {} })', context);
  assert.equal(runInContext('state.progress.get("q1").correct', context), true);
  assert.equal(runInContext('state.progress.get("q1").revealed', context), false);
});
