# Rebuild the downloadable resume PDF from the resume page.
#
# resume/index.html is the source of truth: its print stylesheet IS the
# PDF layout (all-serif, one page, contact line swapped in). This script
# stamps today's date into the page's "Resume - updated" line, then
# prints the page to resume/AdityaSundaram_Resume.pdf with headless
# Edge, so screen and PDF can never drift apart.
#
# Run after any content edit to the resume page:
#   powershell -File scripts/build-resume-pdf.ps1

$repo = Split-Path $PSScriptRoot -Parent
$page = Join-Path $repo "resume\index.html"
$pdf  = Join-Path $repo "resume\AdityaSundaram_Resume.pdf"

# Stamp the updated-on line with today's date.
$today = Get-Date -Format "M/d/yyyy"
$html  = [System.IO.File]::ReadAllText($page)
$html  = $html -replace "Resume - updated \d{1,2}/\d{1,2}/\d{4}", "Resume - updated $today"
[System.IO.File]::WriteAllText($page, $html)   # UTF-8, no BOM

# Print the page to PDF with headless Edge.
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) { $edge = "C:\Program Files\Microsoft\Edge\Application\msedge.exe" }
if (-not (Test-Path $edge)) { throw "Microsoft Edge not found; needed for --print-to-pdf." }

$url = "file:///" + (($page -replace "\\", "/") -replace " ", "%20")
& $edge --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$pdf" $url | Out-Null
Start-Sleep -Seconds 2

if (-not (Test-Path $pdf)) { throw "PDF was not written." }
Write-Host "Stamped 'Resume - updated $today' and rebuilt:"
Get-Item $pdf | Select-Object Name, Length, LastWriteTime
