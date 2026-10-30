import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWranglerD1Results, accountExistsFromD1Results } from '../scripts/lib/wrangler-json.js';

const found = [{ success: true, results: [{ id: 'existing-account' }] }];

test('account CLI preserves successful D1 results with and without Wrangler progress', () => {
  for (const prefix of ['', '├ Checking database availability…\n', 'Wrangler\r\n└ Ready\r\n  '])
    assert.deepEqual(parseWranglerD1Results(prefix + JSON.stringify(found, null, 2)), found);
  const batch = [{ success: true, results: [] }, { success: true, results: [] }];
  assert.deepEqual(parseWranglerD1Results(JSON.stringify(batch)), batch);
});

test('account CLI rejects structured failures even when the process exits successfully', () => {
  for (const results of [[{ success: false, results: [], error: 'query failed' }],
    [{ success: true, results: [] }, { success: false, results: [] }]])
    for (const prefix of ['', '├ Checking database availability…\n'])
      assert.throws(() => parseWranglerD1Results(prefix + JSON.stringify(results)), /未回傳成功結果/);
});

test('account CLI never treats logging, partial JSON or unrelated JSON as query success', () => {
  for (const output of ['', 'success: true', '├ Checking…\n', '<html>Unavailable</html>',
    '[{"success":true,"results":', '[]', '{}', '{"success":true,"results":[]}',
    '[{"results":[]}]', '[{"success":true}]', '[{"success":"true","results":[]}]',
    '├ success\n[{"success":true,"results":[]}] trailing text'])
    assert.throws(() => parseWranglerD1Results(output), /帳號設定失敗/);
});

test('account existence requires SELECT rows and rejects remote bulk-import statistics', () => {
  assert.equal(accountExistsFromD1Results([{ success: true, results: [] }]), false);
  assert.equal(accountExistsFromD1Results(found), true);
  const imported = [{ success: true, results: [{
    'Total queries executed': 1, 'Rows read': 0, 'Rows written': 0, 'Database size (MB)': '47.21',
  }] }];
  assert.throws(() => accountExistsFromD1Results(imported), /無法確認帳號查詢結果/);
  for (const invalid of [[], [{ success: false, results: [] }],
    [{ success: true, results: [{ id: null }] }],
    [{ success: true, results: [{ id: '' }] }],
    [{ success: true, results: [{ id: 'a' }, { id: 'b' }] }]])
    assert.throws(() => accountExistsFromD1Results(invalid), /無法確認帳號查詢結果/);
});
