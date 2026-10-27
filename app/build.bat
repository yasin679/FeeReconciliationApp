@echo off
rem Rebuilds the app folder from source. Needs the .NET 8 SDK. No internet access or third-party packages are needed.
cd /d "%~dp0"
dotnet publish "src\FeeReconDesk\FeeReconDesk.csproj" -c Release -o app
if errorlevel 1 (echo Build failed. & pause & exit /b 1)
echo.
echo Running the built-in system check...
dotnet "app\FeeReconDesk.dll" --selftest
pause
