import test from "node:test";
import assert from "node:assert/strict";
import { sentimentTone } from "../src/ui/sentiment.js";

test("market mood ring color follows the score and has an unknown fallback", () => {
  assert.equal(sentimentTone(0), "#3b82f6");
  assert.equal(sentimentTone(50), "#c49d69");
  assert.equal(sentimentTone(100), "#e86666");
  assert.notEqual(sentimentTone(49), sentimentTone(50));
  assert.notEqual(sentimentTone(50), sentimentTone(51));
  assert.equal(sentimentTone(null), "#64748b");
  assert.equal(sentimentTone(150), sentimentTone(100));
});
