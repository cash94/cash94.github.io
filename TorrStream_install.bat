@echo off
setlocal enabledelayedexpansion
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

:: Установка TorrServer (опционально)
echo [3/4] Установка TorrServer...
set /p "installTorrServer=Хотите установить последнюю версию TorrServer для автоматического запуска с TorrStream? (Y/N): "
if /i "!installTorrServer!"=="Y" (
    echo Скачивание TorrServer...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/YouROK/TorrServer/releases/latest/download/TorrServer-windows-amd64.exe' -OutFile 'C:\Vidaa\TorrServer-windows-amd64.exe'"
    if errorlevel 1 (
        echo [ОШИБКА] Не удалось скачать TorrServer
    ) else (
        echo [OK] TorrServer установлен в C:\Vidaa\TorrServer-windows-amd64.exe
    )
) else (
    echo [ПРОПУЩЕНО] Установка TorrServer пропущена
)
echo.

:: Скачивание TorrStream
echo [4/4] Скачивание TorrStream...
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cash94/cash94.github.io/releases/download/%%23vidaa/TorrStream-windows.zip' -OutFile '%TEMP%\TorrStream.zip'"
if errorlevel 1 (
    echo [ОШИБКА] Не удалось скачать TorrStream
    pause
    exit /b 1
)

set /p "extractPath=Введите путь для распаковки (Enter для рабочего стола): "
if "!extractPath!"=="" set "extractPath=%USERPROFILE%\Desktop"

echo Распаковка TorrStream...
powershell -Command "Expand-Archive -Path '%TEMP%\TorrStream.zip' -DestinationPath '%TEMP%\TorrStream_extracted' -Force"

:: Копирование TorrStream-windows-x64.exe в указанную папку
copy /Y "%TEMP%\TorrStream_extracted\TorrStream-windows-x64.exe" "!extractPath!\" >nul

:: Копирование pssuspend.exe в C:\Vidaa\ffmpeg
if exist "%TEMP%\TorrStream_extracted\pssuspend.exe" (
    copy /Y "%TEMP%\TorrStream_extracted\pssuspend.exe" "C:\Vidaa\ffmpeg\" >nul
    echo [OK] pssuspend.exe помещен в C:\Vidaa\ffmpeg
) else (
    echo [ПРЕДУПРЕЖДЕНИЕ] pssuspend.exe не найден в архиве
)

:: Очистка временных файлов
rmdir /S /Q "%TEMP%\TorrStream_extracted" >nul 2>&1
del /Q "%TEMP%\TorrStream.zip" >nul

echo.
echo ========================================
echo     Установка завершена!
echo ========================================
echo.
echo Установленные компоненты:
echo - ffmpeg: C:\Vidaa\ffmpeg\
if /i "!installTorrServer!"=="Y" echo - TorrServer: C:\Vidaa\TorrServer-windows-amd64.exe
if exist "C:\Vidaa\ffmpeg\pssuspend.exe" echo - pssuspend: C:\Vidaa\ffmpeg\
echo - Кэш HLS: в памяти TorrStream, RAM-диск не нужен
echo.
echo TorrStream распакован в: !extractPath!
echo.
if /i "!installTorrServer!"=="Y" (
    echo TorrServer будет автоматически запускаться при старте TorrStream
)
echo.
echo Запустите: !extractPath!\TorrStream-windows-x64.exe
echo.
pause
