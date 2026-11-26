import subprocess, json, re, sys
ver = sys.argv[1] if len(sys.argv)>1 else '1'
subprocess.check_call(['/usr/lib/node_modules/tsx/node_modules/esbuild/bin/esbuild','src/standalone.tsx','--bundle','--minify','--target=es2019','--define:process.env.NODE_ENV="production"','--outfile=/tmp/pwa/app.js','--log-level=warning'])
css=open('src/style.css').read(); js=open('/tmp/pwa/app.js').read().replace('</script','<\\/script')
html=f'''<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>S7-300 STL Simulator</title>
<meta name="theme-color" content="#0d1117">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="S7 STL">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/icon-192.png">
<style>{css}
.s7{{padding-top:max(10px,env(safe-area-inset-top));padding-bottom:max(40px,env(safe-area-inset-bottom));}}
body{{overscroll-behavior-y:contain;}}
</style>
</head>
<body><div id="root"></div>
<script>{js}</script>
</body></html>'''
open('index.html','w').write(html)
sw=open('sw.js').read()
sw=re.sub(r"const V='[^']*'","const V='s7stl-v"+ver+"'",sw)
open('sw.js','w').write(sw)
print('built v'+ver, len(html))
