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
powershell -Command "Expand-Archive -Path '%TEMP%\TorrStream-update.zip' -DestinationPath '%TEMP%\TorrStream_update' -Force"

:: Копирование основного файла
copy /Y "%TEMP%\TorrStream_update\TorrStream-windows-x64.exe" "%extractPath%\" >nul

:: Проверка и копирование pssuspend.exe если его нет в C:\Vidaa\ffmpeg
if not exist "C:\Vidaa\ffmpeg\pssuspend.exe" (
    if exist "%TEMP%\TorrStream_update\pssuspend.exe" (
        copy /Y "%TEMP%\TorrStream_update\pssuspend.exe" "C:\Vidaa\ffmpeg\" >nul
        echo [OK] pssuspend.exe добавлен в C:\Vidaa\ffmpeg
    ) else (
        echo [ПРЕДУПРЕЖДЕНИЕ] pssuspend.exe не найден в архиве
    )
) else (
    echo [OK] pssuspend.exe уже есть в C:\Vidaa\ffmpeg
)

:: Очистка временных файлов
rmdir /S /Q "%TEMP%\TorrStream_update" >nul 2>&1
del /Q "%TEMP%\TorrStream-update.zip" >nul

echo.
echo Обновление завершено!
echo Запустите: %extractPath%\TorrStream-windows-x64.exe
pause
