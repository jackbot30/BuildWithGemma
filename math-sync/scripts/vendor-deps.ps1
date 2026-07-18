# Vendors offline front-end deps out of node_modules into public/vendor/ so the
# app renders with ZERO network (airplane-mode requirement). Run after `bun install`
# and re-run if you bump katex / function-plot versions.
#
#   bun run vendor    (== pwsh scripts/vendor-deps.ps1)
$ErrorActionPreference = "Stop"
$app = Split-Path $PSScriptRoot -Parent
$nm = Join-Path $app "node_modules"
$vendor = Join-Path $app "public\vendor"

if (-not (Test-Path $nm)) { throw "node_modules not found — run 'bun install' first." }

# --- KaTeX: css + js + auto-render + the ENTIRE fonts/ dir (css references it by relative url) ---
$katexDst = Join-Path $vendor "katex"
New-Item -ItemType Directory -Force (Join-Path $katexDst "contrib") | Out-Null
Copy-Item (Join-Path $nm "katex\dist\katex.min.css") $katexDst -Force
Copy-Item (Join-Path $nm "katex\dist\katex.min.js")  $katexDst -Force
Copy-Item (Join-Path $nm "katex\dist\contrib\auto-render.min.js") (Join-Path $katexDst "contrib") -Force
Copy-Item (Join-Path $nm "katex\dist\fonts") $katexDst -Recurse -Force

# --- function-plot: single self-contained UMD bundle (d3 already inlined) ---
$fpDst = Join-Path $vendor "function-plot"
New-Item -ItemType Directory -Force $fpDst | Out-Null
Copy-Item (Join-Path $nm "function-plot\dist\function-plot.js") $fpDst -Force

Write-Host "Vendored KaTeX + function-plot into public/vendor/. Test with wifi OFF."
