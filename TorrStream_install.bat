@echo off
chcp 65001 >nul
title Установка TorrStream
echo ========================================
echo     Установка TorrStream
echo ========================================
echo.

:: Проверка прав администратора
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ОШИБКА] Запустите скрипт от имени администратора!
    pause
    exit /b 1
)

:: Создание папок
echo [1/4] Создание папок...
if not exist "C:\Vidaa" mkdir "C:\Vidaa"
if not exist "C:\Vidaa\ffmpeg" mkdir "C:\Vidaa\ffmpeg"
echo [OK] Папки созданы
echo.

:: Скачивание ffmpeg
echo [2/4] Скачивание ffmpeg...
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/jellyfin/jellyfin-ffmpeg/releases/download/v7.1.3-3/jellyfin-ffmpeg_7.1.3-3_portable_win64-clang-gpl.zip' -OutFile '%TEMP%\ffmpeg.zip'"
if %errorLevel% neq 0 (
    echo [ОШИБКА] Не удалось скачать ffmpeg
    pause
    exit /b 1
)

echo Распаковка ffmpeg...
powershell -Command "Expand-Archive -Path '%TEMP%\ffmpeg.zip' -DestinationPath '%TEMP%\ffmpeg' -Force"
copy /Y "%TEMP%\ffmpeg\ffmpeg.exe" "C:\Vidaa\ffmpeg\" >nul
copy /Y "%TEMP%\ffmpeg\ffprobe.exe" "C:\Vidaa\ffmpeg\" >nul
del /Q "%TEMP%\ffmpeg.zip" >nul
rmdir /S /Q "%TEMP%\ffmpeg" >nul
echo [OK] ffmpeg установлен
echo.

:: Скачивание yt-dlp
echo [3/4] Скачивание yt-dlp...
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.03.17/yt-dlp.exe' -OutFile 'C:\Vidaa\ffmpeg\yt-dlp.exe'"
echo [OK] yt-dlp установлен
echo.

:: Скачивание TorrStream
echo [4/4] Скачивание TorrStream...
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cash94/cash94.github.io/releases/download/%%23vidaa/TorrStream-windows.zip' -OutFile '%TEMP%\TorrStream.zip'"
if %errorLevel% neq 0 (
    echo [ОШИБКА] Не удалось скачать TorrStream
    pause
    exit /b 1
)

set /p "extractPath=Введите путь для распаковки (Enter для рабочего стола): "
if "%extractPath%"=="" set "extractPath=%USERPROFILE%\Desktop"

echo Распаковка TorrStream...
powershell -Command "Expand-Archive -Path '%TEMP%\TorrStream.zip' -DestinationPath '%extractPath%' -Force"
del /Q "%TEMP%\TorrStream.zip" >nul

echo.
echo ========================================
echo     Установка завершена!
echo ========================================
echo TorrStream распакован в: %extractPath%
echo Запустите: TorrStream-windows-x64.exe
echo.
pause