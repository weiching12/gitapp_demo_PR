$ErrorActionPreference = 'Stop'
$stockProjectPath = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $stockProjectPath
$Host.UI.RawUI.WindowTitle = 'Stock Insight - secure FinMind Token setup'
$env:WRANGLER_LOG_PATH = Join-Path $stockProjectPath '.wrangler\logs'
$env:WRANGLER_SEND_METRICS = 'false'
$stockStatusPath = Join-Path $stockProjectPath '.wrangler\token-setup-status.json'
New-Item -ItemType Directory -Path (Join-Path $stockProjectPath '.wrangler') -Force | Out-Null

function Set-StockSetupStatus([string]$status) {
    @{ status = $status; updatedAt = [DateTime]::UtcNow.ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath $stockStatusPath -Encoding UTF8
}

Set-StockSetupStatus 'waiting'
Write-Host 'Paste your FinMind API Token below and press Enter.' -ForegroundColor Cyan
Write-Host 'The value is hidden. It will be sent only to FinMind and your Cloudflare Worker.'
Write-Host 'It will also be saved in the Git-ignored local .dev.vars file.'
$stockSecureToken = Read-Host 'FinMind Token' -AsSecureString
$stockBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($stockSecureToken)
try {
    $stockPlainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($stockBstr).Trim()
    if ($stockPlainToken -notmatch '^[A-Za-z0-9._-]+$') { throw 'Invalid token format.' }
    Set-StockSetupStatus 'validating'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $stockFrom = (Get-Date).AddDays(-10).ToString('yyyy-MM-dd')
    $stockUri = 'https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=2330&start_date=' + $stockFrom
    $stockReply = Invoke-RestMethod -Uri $stockUri -Headers @{ Authorization = 'Bearer ' + $stockPlainToken } -TimeoutSec 25
    if ($stockReply.status -ne 200) { throw 'FinMind validation failed.' }
    Write-Host 'FinMind validation passed. Saving Cloudflare Secret...' -ForegroundColor Green
    Set-StockSetupStatus 'uploading'
    $stockWranglerPath = Join-Path $stockProjectPath 'node_modules\.bin\wrangler.cmd'
    $stockPlainToken | & $stockWranglerPath secret put FINMIND_TOKEN --name stock-insight-tw
    if ($LASTEXITCODE -ne 0) { throw 'Cloudflare Secret upload failed.' }
    $stockEnvPath = Join-Path $stockProjectPath '.dev.vars'
    $stockOtherLines = if (Test-Path -LiteralPath $stockEnvPath) {
        @(Get-Content -LiteralPath $stockEnvPath | Where-Object { $_ -notmatch '^\s*FINMIND_TOKEN\s*=' })
    } else { @() }
    $stockEnvContent = (@($stockOtherLines) + ('FINMIND_TOKEN="' + $stockPlainToken + '"')) -join "`n"
    [IO.File]::WriteAllText($stockEnvPath, $stockEnvContent + "`n", [Text.UTF8Encoding]::new($false))
    Set-StockSetupStatus 'success'
    Write-Host 'Done. The Cloudflare Secret and local environment are ready.' -ForegroundColor Green
} catch {
    Set-StockSetupStatus 'failed'
    Write-Host 'Setup did not complete. No token value was printed. Return to Codex for assistance.' -ForegroundColor Red
} finally {
    $stockPlainToken = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($stockBstr)
    $stockSecureToken.Dispose()
}
Read-Host 'Press Enter to close' | Out-Null
