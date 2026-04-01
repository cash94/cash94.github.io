#!/usr/bin/env pwsh

# Цвета для вывода
$RED = 'Red'
$GREEN = 'Green'
$YELLOW = 'Yellow'
$CYAN = 'Cyan'
$NC = 'White'

# Путь установки
$installPath = "C:\Vidaa"

# Функция для проверки доступности порта
function Test-Port {
    param($Port)
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
        $listener.Start()
        $listener.Stop()
        return $true
    }
    catch {
        return $false
    }
}

# Функция для получения свободного порта
function Get-FreePort {
    $port = 3000
    while (-not (Test-Port $port)) {
        $port++
        if ($port -gt 65535) {
            Write-Host "Ошибка: нет свободных портов в диапазоне 3000-65535" -ForegroundColor $RED
            exit 1
        }
    }
    return $port
}

# Функция для настройки брандмауэра Windows
function Add-FirewallRule {
    param($Port)
    
    Write-Host "Настройка брандмауэра для порта $Port..." -ForegroundColor $YELLOW
    
    $ruleExists = Get-NetFirewallRule -DisplayName "Vidaa Server" -ErrorAction SilentlyContinue
    
    if ($ruleExists) {
        Write-Host "Правило брандмауэра для Vidaa уже существует. Обновляем..." -ForegroundColor $YELLOW
        Remove-NetFirewallRule -DisplayName "Vidaa Server" -ErrorAction SilentlyContinue
    }
    
    try {
        New-NetFirewallRule -DisplayName "Vidaa Server" `
            -Direction Inbound `
            -LocalPort $Port `
            -Protocol TCP `
            -Action Allow `
            -Profile Any `
            -Description "Разрешает входящие соединения для Vidaa сервера на порту $Port" `
            -ErrorAction Stop
        
        Write-Host "Правило брандмауэра успешно добавлено для порта $Port" -ForegroundColor $GREEN
        
        $rule = Get-NetFirewallRule -DisplayName "Vidaa Server"
        if ($rule.Enabled -eq 'False') {
            Enable-NetFirewallRule -DisplayName "Vidaa Server"
            Write-Host "Правило брандмауэра включено" -ForegroundColor $GREEN
        }
        
        return $true
    }
    catch {
        Write-Host "Ошибка при добавлении правила брандмауэра: $_" -ForegroundColor $RED
        Write-Host "Попробуйте запустить PowerShell от имени администратора" -ForegroundColor $YELLOW
        return $false
    }
}

# Функция для удаления правила брандмауэра
function Remove-FirewallRule {
    Write-Host "Удаление правила брандмауэра для Vidaa..." -ForegroundColor $YELLOW
    
    try {
        Remove-NetFirewallRule -DisplayName "Vidaa Server" -ErrorAction SilentlyContinue -Confirm:$false
        Write-Host "Правило брандмауэра удалено" -ForegroundColor $GREEN
        return $true
    }
    catch {
        Write-Host "Ошибка при удалении правила брандмауэра: $_" -ForegroundColor $RED
        return $false
    }
}

# Функция для создания службы Windows
function Create-WindowsService {
    param($Port)
    
    $serviceName = "VidaaServer"
    $exePath = "$installPath\myapp.exe"
    
    Write-Host "Создание службы Windows..." -ForegroundColor $YELLOW
    
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    
    if ($service) {
        Write-Host "Служба $serviceName уже существует. Останавливаем и удаляем..." -ForegroundColor $YELLOW
        Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
        & sc.exe delete $serviceName
        Start-Sleep -Seconds 2
    }
    
    try {
        & sc.exe create $serviceName binPath= "`"$exePath`"" start= auto DisplayName= "Vidaa Video Server"
        & sc.exe description $serviceName "Vidaa Video HLS Server - стриминг видео с торрентов"
        & sc.exe config $serviceName obj= "LocalSystem"
        
        $regPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName"
        Set-ItemProperty -Path $regPath -Name "Environment" -Value "NODE_ENV=production;PORT=$Port;HOST=0.0.0.0" -Type MultiString
        
        Write-Host "Служба $serviceName успешно создана" -ForegroundColor $GREEN
        return $true
    }
    catch {
        Write-Host "Ошибка при создании службы: $_" -ForegroundColor $RED
        Write-Host "Служба не будет создана. Сервер будет запускаться вручную." -ForegroundColor $YELLOW
        return $false
    }
}

# Функция для запуска службы
function Start-ServiceIfCreated {
    param($ServiceName)
    
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($service) {
        try {
            Start-Service -Name $ServiceName
            Write-Host "Служба $ServiceName запущена" -ForegroundColor $GREEN
            return $true
        }
        catch {
            Write-Host "Ошибка при запуске службы: $_" -ForegroundColor $RED
            return $false
        }
    }
    return $false
}

# Функция для установки
function Install-Vidaa {
    Write-Host "Начинаем установку Vidaa для Windows..." -ForegroundColor $GREEN
    
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Host "ВНИМАНИЕ: Для установки службы и настройки брандмауэра требуются права администратора!" -ForegroundColor $RED
        Write-Host "Пожалуйста, запустите PowerShell от имени администратора." -ForegroundColor $YELLOW
        exit 1
    }
    
    if (Test-Path $installPath) {
        Write-Host "Директория $installPath уже существует. Удаляем старые файлы..." -ForegroundColor $YELLOW
        Remove-Item -Path $installPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    
    New-Item -ItemType Directory -Path $installPath -Force | Out-Null
    Set-Location $installPath
    
    Write-Host "Скачивание архива приложения..." -ForegroundColor $YELLOW
    $appUrl = "https://github.com/cash94/cash94.github.io/releases/download/%23vidaa/TorrStream-windows.zip"
    $appZip = "$installPath\TorrStream-windows.zip"
    
    Invoke-WebRequest -Uri $appUrl -OutFile $appZip -UseBasicParsing
    
    if (-not (Test-Path $appZip)) {
        Write-Host "Ошибка при скачивании архива" -ForegroundColor $RED
        exit 1
    }
    
    Write-Host "Распаковка архива..." -ForegroundColor $YELLOW
    Expand-Archive -Path $appZip -DestinationPath $installPath -Force
    Remove-Item $appZip -Force
    
    $exeFile = Get-ChildItem -Path $installPath -Filter "TorrStream-windows-*.exe" | Select-Object -First 1
    if ($exeFile) {
        Rename-Item -Path $exeFile.FullName -NewName "myapp.exe"
        Write-Host "Найден и переименован бинарник: $($exeFile.Name)" -ForegroundColor $GREEN
    }
    else {
        Write-Host "Бинарник TorrStream-windows-x64.exe не найден в архиве" -ForegroundColor $RED
        exit 1
    }
    
    $ffmpegPath = "$installPath\ffmpeg"
    New-Item -ItemType Directory -Path $ffmpegPath -Force | Out-Null
    
    Write-Host "Скачивание ffmpeg..." -ForegroundColor $YELLOW
    $ffmpegUrl = "https://github.com/jellyfin/jellyfin-ffmpeg/releases/download/v7.1.3-3/jellyfin-ffmpeg_7.1.3-3_portable_win64-clang-gpl.zip"
    $ffmpegZip = "$ffmpegPath\ffmpeg.zip"
    
    Invoke-WebRequest -Uri $ffmpegUrl -OutFile $ffmpegZip -UseBasicParsing
    
    if (-not (Test-Path $ffmpegZip)) {
        Write-Host "Ошибка при скачивании ffmpeg" -ForegroundColor $RED
        exit 1
    }
    
    Write-Host "Распаковка ffmpeg..." -ForegroundColor $YELLOW
    Expand-Archive -Path $ffmpegZip -DestinationPath $ffmpegPath -Force
    Remove-Item $ffmpegZip -Force
    
    Write-Host "Скачивание yt-dlp..." -ForegroundColor $YELLOW
    $ytdlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/download/2026.03.17/yt-dlp.exe"
    $ytdlpPath = "$ffmpegPath\yt-dlp.exe"
    
    Invoke-WebRequest -Uri $ytdlpUrl -OutFile $ytdlpPath -UseBasicParsing
    
    if (-not (Test-Path $ytdlpPath)) {
        Write-Host "Ошибка при скачивании yt-dlp" -ForegroundColor $RED
        exit 1
    }
    
    $selectedPort = $null
    while ($true) {
        $userPort = Read-Host "`nВведите порт для Vidaa сервера (или нажмите Enter для автоматического выбора)"
        
        if ([string]::IsNullOrEmpty($userPort)) {
            $selectedPort = Get-FreePort
            Write-Host "Выбран свободный порт: $selectedPort" -ForegroundColor $GREEN
            break
        }
        elseif ($userPort -match '^\d+$' -and [int]$userPort -ge 1 -and [int]$userPort -le 65535) {
            if (Test-Port $userPort) {
                $selectedPort = $userPort
                Write-Host "Порт $selectedPort доступен" -ForegroundColor $GREEN
                break
            }
            else {
                Write-Host "Порт $userPort уже занят. Пожалуйста, выберите другой порт." -ForegroundColor $RED
            }
        }
        else {
            Write-Host "Пожалуйста, введите корректный номер порта (1-65535)" -ForegroundColor $RED
        }
    }
    
    # Создаем скрипт запуска
    $startScript = @"
@echo off
set NODE_ENV=production
set PORT=$selectedPort
set HOST=0.0.0.0
cd /d "$installPath"
start "Vidaa Server" "$installPath\myapp.exe"
"@
    $startScript | Out-File -FilePath "$installPath\start_vidaa.bat" -Encoding ASCII
    
    # Создаем скрипт остановки
    $stopScript = @"
@echo off
taskkill /F /IM myapp.exe
"@
    $stopScript | Out-File -FilePath "$installPath\stop_vidaa.bat" -Encoding ASCII
    
    # Создаем ярлык на рабочем столе
    $shortcutPath = [Environment]::GetFolderPath("Desktop") + "\Vidaa Server.lnk"
    $wshell = New-Object -ComObject WScript.Shell
    $shortcut = $wshell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = "$installPath\start_vidaa.bat"
    $shortcut.WorkingDirectory = $installPath
    $shortcut.Description = "Запуск Vidaa сервера"
    $shortcut.Save()
    
    # Настройка брандмауэра
    Write-Host "`nХотите открыть порт $selectedPort в брандмауэре для доступа из сети?" -ForegroundColor $YELLOW
    $configureFw = Read-Host "(y/n)"
    
    if ($configureFw -eq 'y' -or $configureFw -eq 'Y' -or $configureFw -eq 'д' -or $configureFw -eq 'Д') {
        Add-FirewallRule -Port $selectedPort
    }
    else {
        Write-Host "Брандмауэр не настроен. Сервер будет доступен только локально." -ForegroundColor $YELLOW
    }
    
    # Создание службы Windows
    Write-Host "`nХотите создать службу Windows для автоматического запуска?" -ForegroundColor $YELLOW
    $createService = Read-Host "(y/n)"
    
    if ($createService -eq 'y' -or $createService -eq 'Y' -or $createService -eq 'д' -or $createService -eq 'Д') {
        Create-WindowsService -Port $selectedPort
        Start-ServiceIfCreated -ServiceName "VidaaServer"
    }
    
    # Получаем IP адрес
    $ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -notlike "169.254.*"} | Select-Object -First 1).IPAddress
    
    Write-Host "`n========================================" -ForegroundColor $GREEN
    Write-Host "Установка завершена успешно!" -ForegroundColor $GREEN
    Write-Host "Vidaa сервер доступен:" -ForegroundColor $GREEN
    Write-Host "  Локально: http://localhost:$selectedPort" -ForegroundColor $CYAN
    if ($ipAddress) {
        Write-Host "  В сети: http://$ipAddress`:$selectedPort" -ForegroundColor $CYAN
    }
    Write-Host "========================================" -ForegroundColor $GREEN
    Write-Host "`nДля управления сервером:" -ForegroundColor $YELLOW
    Write-Host "  Запуск: $installPath\start_vidaa.bat" -ForegroundColor $NC
    Write-Host "  Остановка: $installPath\stop_vidaa.bat" -ForegroundColor $NC
    Write-Host "  Ярлык: Рабочий стол\Vidaa Server.lnk" -ForegroundColor $NC
    
    if ($createService -eq 'y' -or $createService -eq 'Y') {
        Write-Host "`nДля управления службой:" -ForegroundColor $YELLOW
        Write-Host "  Запуск службы: Start-Service VidaaServer" -ForegroundColor $NC
        Write-Host "  Остановка службы: Stop-Service VidaaServer" -ForegroundColor $NC
        Write-Host "  Просмотр статуса: Get-Service VidaaServer" -ForegroundColor $NC
    }
    
    Write-Host "`nДля проверки брандмауэра: Get-NetFirewallRule -DisplayName 'Vidaa Server'" -ForegroundColor $YELLOW
}

# Функция для удаления
function Uninstall-Vidaa {
    Write-Host "Начинаем удаление Vidaa..." -ForegroundColor $YELLOW
    
    Write-Host "ВНИМАНИЕ: Это действие полностью удалит Vidaa и все его данные!" -ForegroundColor $RED
    $confirm = Read-Host "Вы уверены, что хотите продолжить? (y/n)"
    
    if ($confirm -notmatch '^[YyДд]$') {
        Write-Host "Удаление отменено." -ForegroundColor $YELLOW
        return
    }
    
    $service = Get-Service -Name "VidaaServer" -ErrorAction SilentlyContinue
    if ($service) {
        Write-Host "Остановка и удаление службы VidaaServer..." -ForegroundColor $YELLOW
        Stop-Service -Name "VidaaServer" -Force -ErrorAction SilentlyContinue
        & sc.exe delete "VidaaServer"
        Start-Sleep -Seconds 2
    }
    
    Remove-FirewallRule
    
    if (Test-Path $installPath) {
        Write-Host "Удаление $installPath..." -ForegroundColor $YELLOW
        Remove-Item -Path $installPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    
    $shortcutPath = [Environment]::GetFolderPath("Desktop") + "\Vidaa Server.lnk"
    if (Test-Path $shortcutPath) {
        Remove-Item -Path $shortcutPath -Force
    }
    
    $configDir = "$env:USERPROFILE\.videoloop-server"
    if (Test-Path $configDir) {
        Write-Host "Удаление $configDir..." -ForegroundColor $YELLOW
        Remove-Item -Path $configDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    
    Write-Host "========================================" -ForegroundColor $GREEN
    Write-Host "Удаление Vidaa завершено успешно!" -ForegroundColor $GREEN
    Write-Host "========================================" -ForegroundColor $GREEN
}

# Проверка наличия необходимых модулей
if (-not (Get-Command Invoke-WebRequest -ErrorAction SilentlyContinue)) {
    Write-Host "PowerShell версия 3.0 или выше не обнаружена. Установка невозможна." -ForegroundColor $RED
    exit 1
}

# Главное меню
Write-Host "Выберите действие:" -ForegroundColor $CYAN
Write-Host "1) Установка"
Write-Host "2) Удаление"
$choice = Read-Host "Введите номер (1 или 2)"

switch ($choice) {
    "1" {
        Install-Vidaa
    }
    "2" {
        Uninstall-Vidaa
    }
    default {
        Write-Host "Неверный выбор. Пожалуйста, запустите скрипт снова." -ForegroundColor $RED
        exit 1
    }
}
