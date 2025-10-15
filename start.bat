@echo off
echo Starting Glyphs Bot...
cd /d "D:\Cursor Project\Glyphs Bot 1"
npm run build
npm run pm2:start
echo Glyphs Bot started successfully!
pause
