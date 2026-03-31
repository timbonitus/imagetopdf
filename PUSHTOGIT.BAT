@echo off
REM --- Change to your project directory ---
cd /d "C:\Users\Timothy\Desktop\App Projects\imagetoPDF\pdf-tool"

REM --- Add all changes ---
git add .

REM --- Commit with a message ---
set /p commitMsg=Enter commit message: 
git commit -m "%commitMsg%"

REM --- Push to main branch ---
git push origin main

echo.
echo ✅ Push complete!
pause