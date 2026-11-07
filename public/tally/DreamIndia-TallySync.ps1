<#
  Dream India ERP -> Tally sync
  Runs on the computer or cloud server where TallyPrime is open. Every run it:
    1. fetches the new and changed receipts and payments from the ERP (the ERP's Tally link),
    2. imports them one by one into TallyPrime through Tally's own XML port (http://localhost:9000),
    3. tells the ERP which ones went in and which Tally refused (and why).
  Each voucher carries REMOTEID "DIERP-<ID>", so sending one again alters the same voucher in Tally; nothing is duplicated.

  One-time set-up (about 15 minutes):
    a. TallyPrime: F1 (Help) > Settings > Connectivity > Client/Server configuration:
       "TallyPrime acts as" = Both (or Server), "Enable ODBC" = Yes, "Port" = 9000. Restart TallyPrime.
       Keep the company open (Prime Realtors, as set on the ERP's Tally link page).
    b. Put this file in C:\DreamIndia\ and create C:\DreamIndia\tally-sync.json with:
         { "erp": "https://erp.dreamindiarealty.com", "key": "tly_...the key from the ERP...", "tally": "http://localhost:9000" }
    c. Test once:   powershell -ExecutionPolicy Bypass -File C:\DreamIndia\DreamIndia-TallySync.ps1
    d. Schedule every 15 minutes (run in an admin command prompt):
         schtasks /Create /TN "Dream India Tally Sync" /SC MINUTE /MO 15 /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\DreamIndia\DreamIndia-TallySync.ps1" /RU "%USERNAME%"
  The log is C:\DreamIndia\tally-sync.log. Results also show on the ERP: Accounts > Banks, heads & import > Tally link.
#>
param([string]$Config = (Join-Path $PSScriptRoot 'tally-sync.json'))
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Log = Join-Path $PSScriptRoot 'tally-sync.log'
function Note([string]$m) { $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $m; Add-Content -Path $Log -Value $line -Encoding UTF8; Write-Host $line }

try {
  $cfg = Get-Content -Raw -Path $Config | ConvertFrom-Json
  $erp = ($cfg.erp -replace '/+$', ''); $tally = $(if ($cfg.tally) { $cfg.tally } else { 'http://localhost:9000' })
  if (-not $cfg.key) { throw 'No "key" in tally-sync.json (make it on the ERP: Accounts > Banks, heads & import > Tally link).' }

  # Is Tally listening?
  try { $null = Invoke-WebRequest -Uri $tally -Method Get -UseBasicParsing -TimeoutSec 10 } catch {
    if (-not $_.Exception.Response) { throw "TallyPrime is not answering on $tally. Open TallyPrime with the company, and check F1 > Settings > Connectivity (port 9000)." }
  }

  # 1. what the ERP has for Tally
  $feed = Invoke-WebRequest -Uri "$erp/api/accounts?tally=feed" -Headers @{ 'X-ERP-Key' = $cfg.key } -UseBasicParsing -TimeoutSec 60
  $text = [Text.Encoding]::UTF8.GetString($feed.RawContentStream.ToArray())
  $company = ([regex]::Match($text, '<SVCURRENTCOMPANY>(.*?)</SVCURRENTCOMPANY>')).Groups[1].Value
  $msgs = [regex]::Matches($text, '(?s)<TALLYMESSAGE\b.*?</TALLYMESSAGE>')
  if ($msgs.Count -eq 0) { Note 'Nothing new from the ERP.'; exit 0 }
  Note ("{0} voucher(s) from the ERP for company '{1}'." -f $msgs.Count, $company)

  # 2. into Tally, one at a time, so one bad voucher does not stop the rest
  $done = @()
  foreach ($m in $msgs) {
    $one = $m.Value
    $id = ([regex]::Match($one, 'REMOTEID="DIERP-([^"]+)"')).Groups[1].Value
    $env = '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>' +
           "<STATICVARIABLES><SVCURRENTCOMPANY>$company</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>$one</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"
    try {
      $r = Invoke-WebRequest -Uri $tally -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($env)) -ContentType 'text/xml; charset=utf-8' -UseBasicParsing -TimeoutSec 60
      $out = $r.Content
      $errors = [int]('0' + ([regex]::Match($out, '<ERRORS>(\d+)</ERRORS>')).Groups[1].Value)
      $made = [int]('0' + ([regex]::Match($out, '<CREATED>(\d+)</CREATED>')).Groups[1].Value) + [int]('0' + ([regex]::Match($out, '<ALTERED>(\d+)</ALTERED>')).Groups[1].Value) + [int]('0' + ([regex]::Match($out, '<COMBINED>(\d+)</COMBINED>')).Groups[1].Value)
      $why = (([regex]::Matches($out, '<LINEERROR>(.*?)</LINEERROR>') | ForEach-Object { $_.Groups[1].Value }) -join '; ')
      if ($errors -eq 0 -and $made -gt 0) { $done += @{ id = $id; result = 'ok' }; Note "  $id imported." }
      else {
        if (-not $why) { $why = $(if ($made -eq 0) { 'Tally did not create or alter the voucher (check the ledger names and the company name).' } else { 'Tally reported an error.' }) }
        $done += @{ id = $id; result = 'error'; note = $why }; Note "  $id NOT imported: $why"
      }
    } catch { $done += @{ id = $id; result = 'error'; note = "Could not reach Tally: $($_.Exception.Message)" }; Note "  $id NOT imported: $($_.Exception.Message)" }
  }

  # 3. tell the ERP
  $body = @{ action = 'tally-ack'; key = $cfg.key; done = $done } | ConvertTo-Json -Depth 5 -Compress
  $ack = Invoke-RestMethod -Uri "$erp/api/accounts" -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 60
  Note ("ERP told: {0} imported, {1} refused." -f $ack.imported, $ack.failed)
} catch {
  Note ("STOPPED: " + $_.Exception.Message); exit 1
}
