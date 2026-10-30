// Wrangler may print progress before its D1 --json result. Accept only a complete
// result array, and never infer success from progress messages or partial JSON.
export function parseWranglerD1Results(stdout) {
  const text = String(stdout ?? '').trim();
  let results;
  try {
    try { results = JSON.parse(text); }
    catch {
      const start = /(?:^|\r?\n)[\t ]*(?=\[\s*(?:\{|$))/.exec(text);
      if (!start) throw new Error();
      results = JSON.parse(text.slice(start.index + start[0].length));
    }
  } catch { throw new Error('帳號設定失敗，無法確認資料庫執行結果'); }
  if (!Array.isArray(results) || results.length === 0 || results.some(result =>
    !result || typeof result !== 'object' || result.success !== true || !Array.isArray(result.results)))
    throw new Error('帳號設定失敗，資料庫未回傳成功結果');
  return results;
}

// Remote --file uses the bulk-import API and returns import statistics instead
// of SELECT rows. Only accept the exact SELECT id shape for existence checks.
export function accountExistsFromD1Results(results) {
  if (!Array.isArray(results) || results.length !== 1 || results[0]?.success !== true ||
      !Array.isArray(results[0].results) || results[0].results.length > 1 ||
      results[0].results.some(row => !row || typeof row !== 'object' ||
        Object.keys(row).length !== 1 || typeof row.id !== 'string' || row.id.length === 0))
    throw new Error('帳號設定失敗，無法確認帳號查詢結果');
  return results[0].results.length === 1;
}
