@echo off
rem Wide Worker — start the brain bridge (reads config.local.json if present)
cd /d %~dp0
for /f "usebackq delims=" %%A in (`node -e "try{const c=require('./config.local.json');for(const[k,v]of Object.entries(c))if(v)console.log(k+'='+v)}catch(e){}"`) do set %%A
node brain-bridge.mjs
