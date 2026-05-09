param(
  [int]$LargeFileLineThreshold = 1000
)

$ErrorActionPreference = 'Stop'

function Write-Section {
  param([string]$Title)
  Write-Host ""
  Write-Host "== $Title =="
}

$trackedFiles = git ls-files
$generatedPatterns = @(
  '^node_modules/',
  '^api/node_modules/',
  '^dist/',
  '^review-artifacts/',
  '(^|/)__pycache__/',
  '\.py[cod]$',
  '\.log$',
  '\.tsbuildinfo$',
  '^vite\.config\.js$',
  '^vite\.config\.d\.ts$',
  '^analysis-function/\.python_packages/',
  '^analysis-function/autoinsight_analysis/'
)

Write-Section 'Tracked generated files'
$trackedGenerated = @(
  foreach ($file in $trackedFiles) {
    foreach ($pattern in $generatedPatterns) {
      if ($file -match $pattern) {
        $file
        break
      }
    }
  }
)

if ($trackedGenerated.Count -gt 0) {
  $trackedGenerated | Sort-Object -Unique | ForEach-Object { Write-Host "ERROR $_" }
} else {
  Write-Host 'OK no generated files are tracked.'
}

Write-Section 'Large source files'
$sourceExtensions = '\.(ts|tsx|js|py|css|md)$'
$largeFiles = @(
  foreach ($file in $trackedFiles) {
    if ($file -notmatch $sourceExtensions) {
      continue
    }

    if ($file -match '(^|/)(node_modules|dist|review-artifacts|__pycache__)(/|$)') {
      continue
    }

    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      continue
    }

    $lineCount = (Get-Content -LiteralPath $file | Measure-Object -Line).Lines
    if ($lineCount -ge $LargeFileLineThreshold) {
      [PSCustomObject]@{
        Lines = $lineCount
        Path = $file
      }
    }
  }
)

if ($largeFiles.Count -gt 0) {
  $largeFiles |
    Sort-Object Lines -Descending |
    ForEach-Object { Write-Host ("WARN {0,5} {1}" -f $_.Lines, $_.Path) }
} else {
  Write-Host "OK no tracked source files exceed $LargeFileLineThreshold lines."
}

if ($trackedGenerated.Count -gt 0) {
  Write-Host ""
  Write-Host 'Repository hygiene failed: remove generated files from Git tracking.'
  exit 1
}

Write-Host ""
Write-Host 'Repository hygiene passed.'
