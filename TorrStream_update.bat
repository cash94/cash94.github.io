@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
echo ========================================
echo     Обновление TorrStream
echo ========================================
echo.

set "installRamDisk=N"

:: Обновление TorrServer (опционально)
set /p "updateTorrServer=Хотите обновить TorrServer до последней версии? (Y/N): "
if /i "!updateTorrServer!"=="Y" (
    echo.
    echo Скачивание последней версии TorrServer...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/YouROK/TorrServer/releases/latest/download/TorrServer-windows-amd64.exe' -OutFile 'C:\Vidaa\TorrServer-windows-amd64.exe'"
    if errorlevel 1 (
        echo [ОШИБКА] Не удалось скачать TorrServer
    ) else (
        echo [OK] TorrServer обновлен в C:\Vidaa\TorrServer-windows-amd64.exe
    )
) else (
    echo [ПРОПУЩЕНО] Обновление TorrServer пропущено
)
echo.

:: ==========================================
:: ПРОСТОЙ ВОПРОС ПРО RAM-ДИСК
:: ==========================================
set /p "installRamDisk=Хотите установить RAM-диск для кэша HLS? (Y/N): "

if /i "!installRamDisk!"=="Y" (
    echo.
    echo [RAM-ДИСК] Скачивание установщика ImDisk Toolkit...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cash94/cash94.github.io/releases/download/%%23vidaa/RamCache.zip' -OutFile '%TEMP%\RamCache.zip'"
    
    if errorlevel 1 (
        echo [ОШИБКА] Не удалось скачать RamCache.zip
    ) else (
        echo [RAM-ДИСК] Распаковка архива...
        powershell -Command "Expand-Archive -Path '%TEMP%\RamCache.zip' -DestinationPath '%TEMP%\RamCache' -Force"
        
        if exist "%TEMP%\RamCache\install.bat" (
            echo [RAM-ДИСК] Запуск установщика ImDisk Toolkit...
            echo.
            echo ========================================
            echo   ВАЖНО: Сейчас откроется окно установщика
            echo   ImDisk Toolkit. Следуйте инструкциям.
            echo ========================================
            echo.
            
            call "%TEMP%\RamCache\install.bat"
            
            echo.
            echo [OK] ImDisk Toolkit установлен
            echo.
            echo ========================================
            echo   ИНСТРУКЦИЯ ПО НАСТРОЙКЕ RAM-ДИСКА:
            echo ========================================
            echo.
            echo 1. Найдите на Рабочем столе ярлык
            echo    "Настройка RAM-диска"
            echo.
            echo 2. Настройте параметры:
            echo    - Размер:        2048 MB
            echo    - Буква диска:   R
            echo    - ФС:            NTFS
            echo.
            echo 3. Поставьте галочку:
            echo    "Load ImDisk Driver at startup"
            echo.
            echo 4. Нажмите "OK"
            echo.
            echo TorrStream автоматически обнаружит
            echo диск R: и будет использовать его!
            echo.
            echo ========================================
            echo.
            pause
        ) else (
            echo [ОШИБКА] install.bat не найден в архиве
        )
        
        REM Очистка временных файлов RamCache
        rmdir /S /Q "%TEMP%\RamCache" >nul 2>&1
        del /Q "%TEMP%\RamCache.zip" >nul 2>&1
    )
) else (
    echo [ПРОПУЩЕНО] Установка RAM-диска пропущена
)
echo.

set /p "extractPath=Введите путь, где находится TorrStream (Enter для рабочего стола): "
if "!extractPath!"=="" set "extractPath=%USERPROFILE%\Desktop"

echo.
echo Скачивание обновления TorrStream...
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cash94/cash94.github.io/releases/download/%%23vidaa/TorrStream-windows.zip' -OutFile '%TEMP%\TorrStream-update.zip'"

echo Распаковка...
powershell -Command "Expand-Archive -Path '%TEMP%\TorrStream-update.zip' -DestinationPath '%TEMP%\TorrStream_update' -Force"

REM Копирование основного файла
copy /Y "%TEMP%\TorrStream_update\TorrStream-windows-x64.exe" "!extractPath!\" >nul

REM Проверка и копирование pssuspend.exe если его нет в C:\Vidaa\ffmpeg
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

REM Очистка временных файлов
rmdir /S /Q "%TEMP%\TorrStream_update" >nul 2>&1
del /Q "%TEMP%\TorrStream-update.zip" >nul

echo.
echo ========================================
echo     Обновление завершено!
echo ========================================
echo.
if /i "!updateTorrServer!"=="Y" (
    echo [OK] TorrServer обновлен до последней версии
)
if /i "!installRamDisk!"=="Y" (
    echo [OK] ImDisk Toolkit: установлен
    echo.
    echo ВНИМАНИЕ: Не забудьте настроить RAM-диск!
    echo Буква диска должна быть: R
)
echo [OK] TorrStream обновлен в: !extractPath!
echo.
echo Запустите: !extractPath!\TorrStream-windows-x64.exe
echo.
pause
