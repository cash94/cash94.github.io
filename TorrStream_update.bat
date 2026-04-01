@echo off
chcp 65001 >nul
echo ========================================
echo     Обновление TorrStream
echo ========================================
echo.

set /p "extractPath=Введите путь, где находится TorrStream (Enter для рабочего стола): "
if "%extractPath%"=="" set "extractPath=%USERPROFILE%\Desktop"

echo Скачивание обновления...
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cash94/cash94.github.io/releases/download/%%23vidaa/TorrStream-windows.zip' -OutFile '%TEMP%\TorrStream-update.zip'"

echo Распаковка...
powershell -Command "Expand-Archive -Path '%TEMP%\TorrStream-update.zip' -DestinationPath '%extractPath%' -Force"
del /Q "%TEMP%\TorrStream-update.zip" >nul

echo.
echo Обновление завершено!
echo Запустите: TorrStream-windows-x64.exe
pause