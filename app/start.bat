@echo off
setlocal
title Fee Reconciliation Desk
cd /d "%~dp0"

where dotnet >nul 2>nul
if errorlevel 1 goto :nodotnet
dotnet --list-runtimes | findstr /C:"Microsoft.AspNetCore.App 8." >nul
if errorlevel 1 goto :nodotnet

echo.
echo  Fee Reconciliation Desk
echo  ------------------------
echo  Type a new admin password and press Enter, or just press Enter to keep the current one.
echo  (At least 10 characters, with three of: upper case, lower case, digits, symbols.)
echo.
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "$s = Read-Host 'New admin password' -AsSecureString; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"`) do set "FRD_ADMIN_PASSWORD=%%p"

echo.
echo  Starting on http://localhost:5090  -  keep this window open while you use the app.
echo  Closing this window stops the app.
echo.
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start "" http://localhost:5090"
dotnet "app\FeeReconDesk.dll"
echo.
echo  The app has stopped.
pause
exit /b 0

:nodotnet
echo.
echo  The ASP.NET Core 8 runtime is not installed.
echo  Install it with:   winget install Microsoft.DotNet.AspNetCore.8
echo  (or the full SDK:  winget install Microsoft.DotNet.SDK.8)
echo  then open a new window and run start.bat again.
echo.
pause
exit /b 1
