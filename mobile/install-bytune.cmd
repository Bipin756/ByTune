@echo off
rem Installs the ByTune Android APK on a phone connected over USB.
rem Double-click this file whenever you want to install the latest build.
setlocal
set "APK=%~dp0android\app\build\outputs\apk\release\app-release.apk"
if not exist "%APK%" (
  echo APK not found at:
  echo   %APK%
  echo Build it first: run the build, or ask the assistant to.
  pause
  exit /b 1
)
"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" devices
echo.
echo If your phone appears above, it will now be installed.
echo Watch the phone screen and accept the USB debugging prompt if asked.
"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" install -r "%APK%"
echo.
echo Done. You can unplug the phone.
pause
