@echo off
chcp 65001 >nul
echo ========================================
echo     Обновление TorrStream
echo ========================================
echo.

:: Обновление TorrServer (опционально)
set /p "updateTorrServer=Хотите обновить TorrServer до последней версии? (Y/N): "
if /i "%updateTorrServer%"=="Y" (
    echo.
    echo Скачивание последней версии TorrServer...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/YouROK/TorrServer/releases/latest/download/TorrServer-windows-amd64.exe' -OutFile 'C:\Vidaa\TorrServer-windows-amd64.exe'"
    if %errorLevel% neq 0 (
        echo [ОШИБКА] Не удалось скачать TorrServer
    ) else (
        echo [OK] TorrServer обновлен в C:\Vidaa\TorrServer-windows-amd64.exe
    )
) else (
    echo [ПРОПУЩЕНО] Обновление TorrServer пропущено
)
echo.

:: ==========================================
:: ПРОВЕРКА RAM-ДИСКА (ImDisk Toolkit)
:: ==========================================
echo [ПРОВЕРКА] Статус RAM-диска...

set "imdiskInstalled=N"

:: Проверяем наличие ImDisk в стандартных путях установки
if exist "C:\Program Files\ImDisk\imdisk.exe" (
    set "imdiskInstalled=Y"
) else if exist "C:\Program Files (x86)\ImDisk\imdisk.exe" (
    set "imdiskInstalled=Y"
) else if exist "C:\Vidaa\ffmpeg\imdisk.exe" (
    set "imdiskInstalled=Y"
)

:: Также проверяем через реестр (более надёжный способ)
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" /s /f "ImDisk" 2>nul | find /i "ImDisk" >nul 2>&1
if %errorLevel% equ 0 set "imdiskInstalled=Y"

:: Проверяем, существует ли уже RAM-диск на букве R:
set "ramDiskExists=N"
if exist "R:\" set "ramDiskExists=Y"

if /i "%imdiskInstalled%"=="Y" (
    echo [OK] ImDisk Toolkit уже установлен
    if /i "%ramDiskExists%"=="Y" (
        echo [OK] RAM-диск ^(R:^) уже создан и активен
        echo.
        echo 💡 TorrStream автоматически использует RAM-диск для HLS-кэша
    ) else (
        echo [ВНИМАНИЕ] ImDisk установлен, но RAM-диск ^(R:^) не обнаружен
        echo.
        echo 📋 Не забудьте настроить RAM-диск через ярлык "Настройка RAM-диска":
        echo    • Размер: 2048 MB
        echo    • Буква диска: R
        echo    • ✅ Галочка "Load ImDisk Driver at startup"
    )
) else (
    echo [ВНИМАНИЕ] ImDisk Toolkit НЕ установлен
    echo.
    
    :: Проверяем свободную память
    echo [ПРОВЕРКА] Анализ оперативной памяти...
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

    for /f "tokens=1 delims=." %%a in ("%FREE_SWAP_GB%") do set FREE_MEM_INT=%%a

    set "installRamDisk=N"

    if %FREE_MEM_INT% GEQ 4 (
        echo ✅ У вас достаточно свободной памяти для RAM-диска!
        echo.
        echo 💡 RAM-диск ускорит работу TorrStream:
        echo    - HLS-сегменты в оперативной памяти
        echo    - Скорость в 10-20 раз выше
        echo    - Снижение износа SSD/HDD
        echo.
        set /p "installRamDisk=Хотите установить RAM-диск для кэша HLS? (Y/N): "
    ) else (
        echo ⚠️  Свободно менее 4 GB памяти.
        echo    RAM-диск не рекомендуется.
        echo.
    )

    if /i "%installRamDisk%"=="Y" (
        echo.
        echo [RAM-ДИСК] Скачивание установщика ImDisk Toolkit...
        powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cash94/cash94.github.io/releases/download/%%23vidaa/RamCache.zip' -OutFile '%TEMP%\RamCache.zip'"
        
        if %errorLevel% neq 0 (
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
                echo   📋 ИНСТРУКЦИЯ ПО НАСТРОЙКЕ RAM-ДИСКА:
                echo ========================================
                echo.
                echo 1️⃣  Найдите на Рабочем столе ярлык
                echo     "Настройка RAM-диска"
                echo.
                echo 2️⃣  Настройте параметры:
                echo     • Размер:        2048 MB
                echo     • Буква диска:   R
                echo     • ФС:            NTFS
                echo.
                echo 3️⃣  ✅ Поставьте галочку:
                echo     "Load ImDisk Driver at startup"
                echo.
                echo 4️⃣  Нажмите "OK"
                echo.
                echo ⚡ TorrStream автоматически обнаружит
                echo    диск R: и будет использовать его!
                echo.
                echo ========================================
                echo.
                pause
            ) else (
                echo [ОШИБКА] install.bat не найден в архиве
            )
            
            :: Очистка временных файлов RamCache
            rmdir /S /Q "%TEMP%\RamCache" >nul 2>&1
            del /Q "%TEMP%\RamCache.zip" >nul 2>&1
        )
    ) else (
        echo [ПРОПУЩЕНО] Установка RAM-диска пропущена
    )
)
echo.

set /p "extractPath=Введите путь, где находится TorrStream (Enter для рабочего стола): "
if "%extractPath%"=="" set "extractPath=%USERPROFILE%\Desktop"

echo.
echo Скачивание обновления TorrStream...
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
echo ========================================
echo     Обновление завершено!
echo ========================================
echo.
if /i "%updateTorrServer%"=="Y" (
    echo ✅ TorrServer обновлен до последней версии
)
if /i "%imdiskInstalled%"=="Y" (
    echo ✅ ImDisk Toolkit: установлен
    if /i "%ramDiskExists%"=="Y" (
        echo ✅ RAM-диск ^(R:^): активен и используется
    ) else (
        echo ⚠️  RAM-диск ^(R:^): не создан ^(настройте вручную^)
    )
) else if /i "%installRamDisk%"=="Y" (
    echo ✅ ImDisk Toolkit: установлен ^(настройте RAM-диск^)
)
echo ✅ TorrStream обновлен в: %extractPath%
echo.
echo Запустите: %extractPath%\TorrStream-windows-x64.exe
echo.
pause
