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
echo [1/6] Создание папок...
if not exist "C:\Vidaa" mkdir "C:\Vidaa"
if not exist "C:\Vidaa\ffmpeg" mkdir "C:\Vidaa\ffmpeg"
echo [OK] Папки созданы
echo.

:: Скачивание ffmpeg
echo [2/6] Скачивание ffmpeg...
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
echo [3/6] Скачивание yt-dlp...
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.03.17/yt-dlp.exe' -OutFile 'C:\Vidaa\ffmpeg\yt-dlp.exe'"
echo [OK] yt-dlp установлен
echo.

:: Установка TorrServer (опционально)
echo [4/6] Установка TorrServer...
set /p "installTorrServer=Хотите установить последнюю версию TorrServer для автоматического запуска с TorrStream? (Y/N): "
if /i "%installTorrServer%"=="Y" (
    echo Скачивание TorrServer...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/YouROK/TorrServer/releases/latest/download/TorrServer-windows-amd64.exe' -OutFile 'C:\Vidaa\TorrServer-windows-amd64.exe'"
    if %errorLevel% neq 0 (
        echo [ОШИБКА] Не удалось скачать TorrServer
    ) else (
        echo [OK] TorrServer установлен в C:\Vidaa\TorrServer-windows-amd64.exe
    )
) else (
    echo [ПРОПУЩЕНО] Установка TorrServer пропущена
)
echo.

:: ==========================================
:: ПРОВЕРКА СВОБОДНОЙ ПАМЯТИ И RAM-ДИСК
:: ==========================================
echo [5/6] Проверка оперативной памяти...

:: Получаем информацию о памяти через PowerShell
for /f "delims=" %%i in ('powershell -Command "[math]::Round(((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB), 2)"') do set FREE_RAM_GB=%%i
for /f "delims=" %%i in ('powershell -Command "[math]::Round(((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB), 2)"') do set TOTAL_RAM_GB=%%i
for /f "delims=" %%i in ('powershell -Command "[math]::Round(((Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory / 1MB), 2)"') do set FREE_SWAP_GB=%%i

echo.
echo ========================================
echo   Информация о памяти:
echo ========================================
echo   Всего RAM:         %TOTAL_RAM_GB% GB
echo   Свободно RAM:      %FREE_RAM_GB% GB
echo   Свободно (RAM+Swap): %FREE_SWAP_GB% GB
echo ========================================
echo.

:: Преобразуем в целое число для сравнения (берем целую часть)
for /f "tokens=1 delims=." %%a in ("%FREE_SWAP_GB%") do set FREE_MEM_INT=%%a

set "installRamDisk=N"

:: Если свободно 4 GB или больше - предлагаем RAM-диск
if %FREE_MEM_INT% GEQ 4 (
    echo ✅ У вас достаточно свободной памяти для использования RAM-диска!
    echo.
    echo 💡 RAM-диск значительно ускорит работу TorrStream:
    echo    - HLS-сегменты будут создаваться в оперативной памяти
    echo    - Скорость записи/чтения увеличится в 10-20 раз
    echo    - Снижение износа SSD/HDD
    echo    - Автоматическая очистка при перезагрузке
    echo.
    set /p "installRamDisk=Хотите установить RAM-диск для кэша HLS? (Y/N): "
) else (
    echo ⚠️  Свободно менее 4 GB памяти.
    echo    RAM-диск не рекомендуется устанавливать.
    echo    TorrStream будет использовать обычный диск.
    echo.
)

if /i "%installRamDisk%"=="Y" (
    echo.
    echo [RAM-ДИСК] Скачивание установщика ImDisk Toolkit...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cash94/cash94.github.io/releases/download/%%23vidaa/RamCache.zip' -OutFile '%TEMP%\RamCache.zip'"
    
    if %errorLevel% neq 0 (
        echo [ОШИБКА] Не удалось скачать RamCache.zip
        echo [ПРЕДУПРЕЖДЕНИЕ] Продолжаем установку без RAM-диска
    ) else (
        echo [RAM-ДИСК] Распаковка архива...
        powershell -Command "Expand-Archive -Path '%TEMP%\RamCache.zip' -DestinationPath '%TEMP%\RamCache' -Force"
        
        if exist "%TEMP%\RamCache\install.bat" (
            echo [RAM-ДИСК] Запуск установщика ImDisk Toolkit...
            echo.
            echo ========================================
            echo   ВАЖНО: Сейчас откроется окно установщика
            echo   ImDisk Toolkit. Следуйте инструкциям
            echo   установщика для завершения установки.
            echo ========================================
            echo.
            
            :: Запуск install.bat и ожидание его завершения
            call "%TEMP%\RamCache\install.bat"
            
            echo.
            echo [OK] ImDisk Toolkit установлен
            echo.
            echo ========================================
            echo   📋 ИНСТРУКЦИЯ ПО НАСТРОЙКЕ RAM-ДИСКА:
            echo ========================================
            echo.
            echo 1️⃣  После завершения этой установки найдите на
            echo     Рабочем столе ярлык "Настройка RAM-диска"
            echo     (или ImDisk Virtual Disk Driver)
            echo.
            echo 2️⃣  Запустите его и настройте следующие параметры:
            echo.
            echo     • Размер (Size):        2048 MB (или 2 GB)
            echo     • Буква диска (Drive):  R
            echo     • Файловая система:     NTFS
            echo.
            echo 3️⃣  ✅ ОБЯЗАТЕЛЬНО поставьте галочку:
            echo     "Load ImDisk Driver at startup"
            echo     (Автозапуск вместе с Windows)
            echo.
            echo 4️⃣  Нажмите "OK" для создания RAM-диска
            echo.
            echo 5️⃣  После создания в "Моем компьютере" появится
            echo     новый диск R: (RAM Disk)
            echo.
            echo ⚡ TorrStream автоматически обнаружит диск R:
            echo    и будет использовать его для HLS-кэша!
            echo.
            echo ========================================
            echo.
            pause
            
            :: Очистка временных файлов RamCache
            rmdir /S /Q "%TEMP%\RamCache" >nul 2>&1
            del /Q "%TEMP%\RamCache.zip" >nul 2>&1
        ) else (
            echo [ОШИБКА] install.bat не найден в архиве
        )
    )
) else (
    echo [ПРОПУЩЕНО] Установка RAM-диска пропущена
)
echo.

:: Скачивание TorrStream
echo [6/6] Скачивание TorrStream...
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cash94/cash94.github.io/releases/download/%%23vidaa/TorrStream-windows.zip' -OutFile '%TEMP%\TorrStream.zip'"
if %errorLevel% neq 0 (
    echo [ОШИБКА] Не удалось скачать TorrStream
    pause
    exit /b 1
)

set /p "extractPath=Введите путь для распаковки (Enter для рабочего стола): "
if "%extractPath%"=="" set "extractPath=%USERPROFILE%\Desktop"

echo Распаковка TorrStream...
powershell -Command "Expand-Archive -Path '%TEMP%\TorrStream.zip' -DestinationPath '%TEMP%\TorrStream_extracted' -Force"

:: Копирование TorrStream-windows-x64.exe в указанную папку
copy /Y "%TEMP%\TorrStream_extracted\TorrStream-windows-x64.exe" "%extractPath%\" >nul

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
echo - yt-dlp: C:\Vidaa\ffmpeg\
if /i "%installTorrServer%"=="Y" echo - TorrServer: C:\Vidaa\TorrServer-windows-amd64.exe
if exist "C:\Vidaa\ffmpeg\pssuspend.exe" echo - pssuspend: C:\Vidaa\ffmpeg\
if /i "%installRamDisk%"=="Y" echo - ImDisk Toolkit: установлен (настройте RAM-диск вручную)
echo.
echo TorrStream распакован в: %extractPath%
echo.
if /i "%installTorrServer%"=="Y" (
    echo 🔗 TorrServer будет автоматически запускаться при старте TorrStream
    echo    ^(если файл существует в C:\Vidaa\)
)
echo.
if /i "%installRamDisk%"=="Y" (
    echo ⚡ НЕ ЗАБУДЬТЕ настроить RAM-диск через ярлык на рабочем столе!
    echo    Буква диска должна быть: R
    echo.
)
echo Запустите: %extractPath%\TorrStream-windows-x64.exe
echo.
pause
