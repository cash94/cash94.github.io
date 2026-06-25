#!/bin/bash

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Имя RAM-диска
RAMDISK_NAME="VidaaRAMDisk"
RAMDISK_PATH="/Volumes/$RAMDISK_NAME"

# Функция для загрузки файлов через curl
download_file() {
    local url=$1
    local output=$2
    
    if command -v curl &> /dev/null; then
        curl -L --progress-bar "$url" -o "$output"
        return $?
    else
        echo -e "${RED}curl не найден. Пожалуйста, установите curl.${NC}"
        return 1
    fi
}

# Функция для определения архитектуры macOS
detect_architecture() {
    local arch=$(uname -m)
    case $arch in
        x86_64)
            echo "x64"
            ;;
        arm64)
            echo "arm64"
            ;;
        *)
            echo -e "${RED}Неподдерживаемая архитектура: $arch${NC}"
            exit 1
            ;;
    esac
}

# Функция для проверки доступной памяти (RAM)
check_available_memory() {
    # Получаем общую RAM в байтах
    local total_mem=$(sysctl -n hw.memsize)
    local total_gb=$(echo "scale=2; $total_mem / 1073741824" | bc)
    
    # Получаем свободную память через vm_stat (приблизительно)
    local page_size=$(sysctl -n hw.pagesize)
    local free_pages=$(vm_stat | grep "Pages free" | awk '{print $3}' | sed 's/\.//')
    local inactive_pages=$(vm_stat | grep "Pages inactive" | awk '{print $3}' | sed 's/\.//')
    
    # Свободная + неактивная память (можно использовать)
    local available_bytes=$(( (free_pages + inactive_pages) * page_size ))
    local available_gb=$(echo "scale=2; $available_bytes / 1073741824" | bc)
    
    echo "$available_gb"
}

# Функция для настройки RAM-диска
setup_ramdisk() {
    local available_gb=$(check_available_memory)
    local ramdisk_size=""
    local ramdisk_size_bytes=""
    
    echo -e "${BLUE}Доступно памяти (приблизительно): ${available_gb} GB${NC}"
    
    local available_int=$(echo "$available_gb" | cut -d. -f1)
    
    if [ "$available_int" -ge 3 ]; then
        echo -e "${YELLOW}Хотите создать RAM-диск для HLS сегментов (рекомендуется 2 GB)?${NC}"
        echo -e "${YELLOW}Это ускорит работу сервера и снизит износ SSD.${NC}"
        echo -n "Создать RAM-диск на 2 GB? (y/n): "
        read -r create_ramdisk
        
        if [[ "$create_ramdisk" =~ ^[YyДд]$ ]]; then
            ramdisk_size="2G"
            ramdisk_size_bytes=$((2 * 1024 * 1024 * 1024))
        else
            echo -e "${YELLOW}RAM-диск не будет создан${NC}"
        fi
    else
        echo -e "${YELLOW}Доступно менее 3 GB памяти.${NC}"
        echo -e "${YELLOW}Хотите указать размер RAM-диска вручную?${NC}"
        echo -n "Введите размер RAM-диска в GB (например, 1, 2) или нажмите Enter чтобы пропустить: "
        read -r custom_size
        
        if [ -n "$custom_size" ] && [[ "$custom_size" =~ ^[0-9]+$ ]]; then
            ramdisk_size="${custom_size}G"
            ramdisk_size_bytes=$((custom_size * 1024 * 1024 * 1024))
            echo -e "${GREEN}RAM-диск будет создан размером: $ramdisk_size${NC}"
        else
            echo -e "${YELLOW}RAM-диск не будет создан${NC}"
        fi
    fi
    
    echo "$ramdisk_size_bytes"
}

# Функция для создания RAM-диска
create_ramdisk() {
    local size_bytes=$1
    
    if [ -z "$size_bytes" ] || [ "$size_bytes" -eq 0 ]; then
        return 1
    fi
    
    # Проверяем, не существует ли уже RAM-диск
    if [ -d "$RAMDISK_PATH" ]; then
        echo -e "${YELLOW}RAM-диск $RAMDISK_PATH уже существует${NC}"
        return 0
    fi
    
    # Вычисляем количество блоков (512 байт на блок)
    local blocks=$((size_bytes / 512))
    
    echo -e "${BLUE}Создание RAM-диска размером $((size_bytes / 1073741824)) GB...${NC}"
    
    # Создаём RAM-диск
    local device=$(hdiutil attach -nomount ram://$blocks 2>/dev/null)
    
    if [ -z "$device" ]; then
        echo -e "${RED}Ошибка создания RAM-диска${NC}"
        return 1
    fi
    
    # Форматируем и монтируем
    diskutil erasevolume HFS+ "$RAMDISK_NAME" $device > /dev/null 2>&1
    
    if [ $? -eq 0 ] && [ -d "$RAMDISK_PATH" ]; then
        echo -e "${GREEN}RAM-диск успешно создан: $RAMDISK_PATH${NC}"
        return 0
    else
        echo -e "${RED}Ошибка форматирования RAM-диска${NC}"
        hdiutil detach $device > /dev/null 2>&1
        return 1
    fi
}

# Функция для удаления RAM-диска
remove_ramdisk() {
    if [ -d "$RAMDISK_PATH" ]; then
        echo -e "${YELLOW}Удаление RAM-диска...${NC}"
        diskutil unmount "$RAMDISK_PATH" > /dev/null 2>&1
        
        # Находим device и отсоединяем
        local device=$(diskutil info "$RAMDISK_PATH" 2>/dev/null | grep "Device Node" | awk '{print $3}')
        if [ -n "$device" ]; then
            hdiutil detach "$device" > /dev/null 2>&1
        fi
        
        echo -e "${GREEN}RAM-диск удален${NC}"
    fi
}

# Функция для проверки доступности порта (для macOS)
check_port() {
    local port=$1
    if lsof -i :$port -sTCP:LISTEN &> /dev/null; then
        return 1 # порт занят
    else
        return 0 # порт свободен
    fi
}

# Функция для получения свободного порта
get_free_port() {
    local port=3000
    while ! check_port $port; do
        port=$((port + 1))
        if [ $port -gt 65535 ]; then
            echo "Ошибка: нет свободных портов в диапазоне 3000-65535"
            exit 1
        fi
    done
    echo $port
}

# Функция для настройки firewall
configure_firewall() {
    local port=$1
    local pf_conf="/etc/pf.conf"
    local pf_anchor="vidaa"
    local pf_rules_file="/tmp/pf.vidaa.rules"
    
    echo -e "${YELLOW}Настройка firewall для порта $port...${NC}"
    
    if ! pfctl -s info 2>/dev/null | grep -q "Status: Enabled"; then
        echo -e "${YELLOW}Firewall (pf) в данный момент не включен.${NC}"
        echo -n "Хотите включить firewall и настроить его? (y/n): "
        read -r enable_fw
        if [[ "$enable_fw" =~ ^[YyДд]$ ]]; then
            sudo pfctl -e
            
            if [ ! -f "$pf_conf" ]; then
                echo "# PF Configuration file" | sudo tee "$pf_conf" > /dev/null
            fi
            
            if ! grep -q "anchor \"$pf_anchor\"" "$pf_conf" 2>/dev/null; then
                echo "anchor \"$pf_anchor\"" | sudo tee -a "$pf_conf" > /dev/null
                echo "load anchor \"$pf_anchor\" from \"$pf_rules_file\"" | sudo tee -a "$pf_conf" > /dev/null
            fi
        else
            echo -e "${YELLOW}Firewall не будет настроен.${NC}"
            return 0
        fi
    fi
    
    cat > "$pf_rules_file" << EOF
# Vidaa Server Rules
pass in on en0 proto tcp from any to any port $port
pass in on en1 proto tcp from any to any port $port
pass in on en2 proto tcp from any to any port $port
pass in on en3 proto tcp from any to any port $port
EOF
    
    sudo pfctl -a "$pf_anchor" -f "$pf_rules_file" 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Firewall успешно настроен для порта $port${NC}"
        return 0
    else
        echo -e "${RED}Ошибка при настройке firewall${NC}"
        return 1
    fi
}

# Функция для удаления правил firewall
remove_firewall_rules() {
    local pf_anchor="vidaa"
    
    echo -e "${YELLOW}Удаление правил firewall для Vidaa...${NC}"
    
    sudo pfctl -a "$pf_anchor" -F all 2>/dev/null
    
    if [ -f "/etc/pf.conf" ]; then
        sudo sed -i '' "/anchor \"$pf_anchor\"/d" "/etc/pf.conf"
        sudo sed -i '' "/load anchor \"$pf_anchor\"/d" "/etc/pf.conf"
    fi
    
    echo -e "${GREEN}Правила firewall удалены${NC}"
}

# Функция для создания скрипта инициализации RAM-диска
create_ramdisk_script() {
    local size_bytes=$1
    local script_path="/opt/Vidaa/create-ramdisk.sh"
    
    cat > "$script_path" << EOF
#!/bin/bash
# Скрипт создания RAM-диска для Vidaa

RAMDISK_NAME="$RAMDISK_NAME"
RAMDISK_PATH="$RAMDISK_PATH"
SIZE_BYTES=$size_bytes
BLOCKS=\$((SIZE_BYTES / 512))

# Проверяем, существует ли уже RAM-диск
if [ -d "\$RAMDISK_PATH" ]; then
    exit 0
fi

# Создаём RAM-диск
DEVICE=\$(hdiutil attach -nomount ram://\$BLOCKS 2>/dev/null)

if [ -n "\$DEVICE" ]; then
    diskutil erasevolume HFS+ "\$RAMDISK_NAME" \$DEVICE > /dev/null 2>&1
fi
EOF
    
    chmod +x "$script_path"
    echo "$script_path"
}

# Функция для создания launchd plist (аналог systemd сервиса)
create_launchd_service() {
    local port=$1
    local ramdisk_size_bytes=$2
    local plist_path="$HOME/Library/LaunchAgents/com.vidaa.server.plist"
    
    mkdir -p "$HOME/Library/LaunchAgents"
    
    # Если нужен RAM-диск, создаём скрипт инициализации
    local pre_exec=""
    if [ -n "$ramdisk_size_bytes" ] && [ "$ramdisk_size_bytes" -gt 0 ]; then
        local ramdisk_script=$(create_ramdisk_script "$ramdisk_size_bytes")
        pre_exec="
    <key>ProgramArgumentsPre</key>
    <array>
        <string>/bin/bash</string>
        <string>$ramdisk_script</string>
    </array>"
    fi
    
    cat > "$plist_path" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.vidaa.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/Vidaa/myapp-macos</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>PORT</key>
        <string>$port</string>
        <key>HOST</key>
        <string>0.0.0.0</string>
    </dict>
    <key>WorkingDirectory</key>
    <string>/opt/Vidaa</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/vidaa.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/vidaa.log</string>
</dict>
</plist>
EOF
    
    launchctl unload "$plist_path" 2>/dev/null
    launchctl load "$plist_path"
    
    if [ $? -eq 0 ]; then
        return 0
    else
        return 1
    fi
}

# Функция для установки
install_vidaa() {
    echo -e "${GREEN}Начинаем установку Vidaa для macOS...${NC}"
    
    local arch=$(detect_architecture)
    echo -e "${GREEN}Обнаружена архитектура: $arch${NC}"
    
    local app_file=""
    if [ "$arch" = "x64" ]; then
        app_file="TorrStream-macos-x64"
    else
        app_file="TorrStream-macos-arm64"
    fi
    
    sudo mkdir -p /opt/Vidaa/
    cd /opt/Vidaa/ || exit 1
    
    echo "Скачивание архива приложения..."
    download_file "https://github.com/cash94/cash94.github.io/releases/download/%23vidaa/TorrStream-macos.zip" "TorrStream-macos.zip"
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при скачивании архива${NC}"
        exit 1
    fi
    
    echo "Распаковка архива..."
    sudo unzip -q TorrStream-macos.zip
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при распаковке архива${NC}"
        exit 1
    fi
    
    sudo rm -rf /opt/Vidaa/TorrStream-macos.zip
    
    if [ -f "/opt/Vidaa/$app_file" ]; then
        sudo mv "/opt/Vidaa/$app_file" "/opt/Vidaa/myapp-macos"
        echo -e "${GREEN}Найден и переименован бинарник: $app_file${NC}"
    else
        echo -e "${RED}Бинарник $app_file не найден в архиве${NC}"
        ls -la /opt/Vidaa/
        exit 1
    fi
    
    sudo mkdir -p /opt/Vidaa/ffmpeg
    cd /opt/Vidaa/ffmpeg || exit 1
    
    local ffmpeg_url=""
    if [ "$arch" = "x64" ]; then
        ffmpeg_url="https://github.com/jellyfin/jellyfin-ffmpeg/releases/download/v7.1.3-3/jellyfin-ffmpeg_7.1.3-3_portable_mac64-gpl.tar.xz"
    else
        ffmpeg_url="https://github.com/jellyfin/jellyfin-ffmpeg/releases/download/v7.1.3-3/jellyfin-ffmpeg_7.1.3-3_portable_macarm64-gpl.tar.xz"
    fi
    
    echo "Скачивание ffmpeg..."
    download_file "$ffmpeg_url" "jellyfin-ffmpeg.tar.xz"
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при скачивании ffmpeg${NC}"
        exit 1
    fi
    
    echo "Распаковка ffmpeg..."
    sudo tar -xf jellyfin-ffmpeg.tar.xz
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при распаковке ffmpeg${NC}"
        exit 1
    fi
    
    sudo find . -name "ffmpeg" -type f -exec cp {} /opt/Vidaa/ffmpeg/ \;
    sudo find . -name "ffprobe" -type f -exec cp {} /opt/Vidaa/ffmpeg/ \;
    
    sudo rm -rf jellyfin-ffmpeg_* && sudo rm -f jellyfin-ffmpeg.tar.xz
    
    echo "Скачивание yt-dlp..."
    download_file "https://github.com/yt-dlp/yt-dlp/releases/download/2026.03.17/yt-dlp_macos" "yt-dlp"
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при скачивании yt-dlp${NC}"
        exit 1
    fi
    
    sudo chmod 755 /opt/Vidaa/myapp-macos
    sudo chmod 755 /opt/Vidaa/ffmpeg/ffmpeg
    sudo chmod 755 /opt/Vidaa/ffmpeg/ffprobe
    sudo chmod 755 /opt/Vidaa/ffmpeg/yt-dlp
    
    # Запрос порта
    local selected_port=""
    while true; do
        echo -e "${YELLOW}Введите порт для Vidaa сервера (или нажмите Enter для автоматического выбора):${NC}"
        read -r user_port
        
        if [ -z "$user_port" ]; then
            selected_port=$(get_free_port)
            echo -e "${GREEN}Выбран свободный порт: $selected_port${NC}"
            break
        elif [[ "$user_port" =~ ^[0-9]+$ ]] && [ "$user_port" -ge 1 ] && [ "$user_port" -le 65535 ]; then
            if check_port "$user_port"; then
                selected_port=$user_port
                echo -e "${GREEN}Порт $selected_port доступен${NC}"
                break
            else
                echo -e "${RED}Порт $user_port уже занят.${NC}"
            fi
        else
            echo -e "${RED}Пожалуйста, введите корректный номер порта (1-65535)${NC}"
        fi
    done
    
    # Настраиваем RAM-диск
    local ramdisk_size_bytes=$(setup_ramdisk)
    
    # Создаём RAM-диск сейчас (для тестирования)
    if [ -n "$ramdisk_size_bytes" ] && [ "$ramdisk_size_bytes" -gt 0 ]; then
        create_ramdisk "$ramdisk_size_bytes"
    fi
    
    # Создаем launchd сервис
    create_launchd_service "$selected_port" "$ramdisk_size_bytes"
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при создании launchd сервиса${NC}"
        exit 1
    fi
    
    # Запрос на настройку firewall
    echo -e "${YELLOW}Хотите открыть порт $selected_port в firewall для доступа из сети?${NC}"
    echo -n "(y/n): "
    read -r configure_fw
    
    if [[ "$configure_fw" =~ ^[YyДд]$ ]]; then
        configure_firewall "$selected_port"
    fi
    
    local ip_addr=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n 1)
    
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}Установка завершена успешно!${NC}"
    echo -e "${GREEN}Vidaa сервер доступен:${NC}"
    echo -e "${BLUE}  Локально: http://localhost:$selected_port${NC}"
    echo -e "${BLUE}  В сети: http://$ip_addr:$selected_port${NC}"
    if [ -n "$ramdisk_size_bytes" ] && [ "$ramdisk_size_bytes" -gt 0 ]; then
        echo -e "${GREEN}RAM-диск ($((ramdisk_size_bytes / 1073741824)) GB) успешно создан${NC}"
        echo -e "${YELLOW}Внимание: RAM-диск удаляется при перезагрузке!${NC}"
        echo -e "${YELLOW}Для автоматического создания добавьте скрипт в Login Items или используйте launchd.${NC}"
    fi
    echo -e "${GREEN}========================================${NC}"
    echo -e "${YELLOW}Для управления сервисом:${NC}"
    echo "  launchctl load ~/Library/LaunchAgents/com.vidaa.server.plist   # запуск"
    echo "  launchctl unload ~/Library/LaunchAgents/com.vidaa.server.plist # остановка"
    echo "  tail -f /tmp/vidaa.log                                         # логи"
}

# Функция для обновления
update_vidaa() {
    echo -e "${GREEN}Начинаем обновление Vidaa...${NC}"
    
    if [ ! -d "/opt/Vidaa/" ]; then
        echo -e "${RED}Директория /opt/Vidaa/ не существует.${NC}"
        exit 1
    fi
    
    local arch=$(detect_architecture)
    echo -e "${GREEN}Обнаружена архитектура: $arch${NC}"
    
    local app_file=""
    if [ "$arch" = "x64" ]; then
        app_file="TorrStream-macos-x64"
    else
        app_file="TorrStream-macos-arm64"
    fi
    
    cd /opt/Vidaa/ || exit 1
    
    echo "Скачивание обновления..."
    download_file "https://github.com/cash94/cash94.github.io/releases/download/%23vidaa/TorrStream-macos.zip" "TorrStream-macos.zip"
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при скачивании архива${NC}"
        exit 1
    fi
    
    echo "Распаковка обновления..."
    sudo rm -rf /opt/Vidaa/public
    sudo unzip -q -o TorrStream-macos.zip
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при распаковке архива${NC}"
        exit 1
    fi
    
    sudo rm -rf /opt/Vidaa/TorrStream-macos.zip
    
    if [ -f "/opt/Vidaa/$app_file" ]; then
        sudo mv "/opt/Vidaa/$app_file" "/opt/Vidaa/myapp-macos"
        echo -e "${GREEN}Обновлен бинарник: $app_file${NC}"
    else
        echo -e "${RED}Бинарник $app_file не найден в архиве${NC}"
        exit 1
    fi
    
    echo "Обновление yt-dlp..."
    download_file "https://github.com/yt-dlp/yt-dlp/releases/download/2026.03.17/yt-dlp_macos" "/opt/Vidaa/ffmpeg/yt-dlp"
    
    sudo chmod 755 /opt/Vidaa/myapp-macos
    sudo chmod 755 /opt/Vidaa/ffmpeg/ffmpeg
    sudo chmod 755 /opt/Vidaa/ffmpeg/ffprobe
    sudo chmod 755 /opt/Vidaa/ffmpeg/yt-dlp
    
    echo "Перезапуск сервиса..."
    launchctl unload "$HOME/Library/LaunchAgents/com.vidaa.server.plist" 2>/dev/null
    launchctl load "$HOME/Library/LaunchAgents/com.vidaa.server.plist"
    
    if [ $? -eq 0 ]; then
        local port=$(grep -A1 "PORT" "$HOME/Library/LaunchAgents/com.vidaa.server.plist" | grep "<string>" | sed 's/.*<string>\(.*\)<\/string>.*/\1/')
        local ip_addr=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n 1)
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}Обновление завершено успешно!${NC}"
        echo -e "${GREEN}Vidaa сервер: http://$ip_addr:$port${NC}"
        echo -e "${GREEN}========================================${NC}"
    else
        echo -e "${RED}Ошибка при перезапуске сервиса${NC}"
        exit 1
    fi
}

# Функция для удаления
uninstall_vidaa() {
    echo -e "${YELLOW}Начинаем удаление Vidaa...${NC}"
    
    echo -e "${RED}ВНИМАНИЕ: Это действие полностью удалит Vidaa и все его данные!${NC}"
    echo -n "Вы уверены? (y/n): "
    read -r confirm
    
    if [[ ! "$confirm" =~ ^[YyДд]$ ]]; then
        echo -e "${YELLOW}Удаление отменено.${NC}"
        return 0
    fi
    
    echo "Остановка сервиса..."
    launchctl unload "$HOME/Library/LaunchAgents/com.vidaa.server.plist" 2>/dev/null
    
    echo "Удаление файла сервиса..."
    rm -f "$HOME/Library/LaunchAgents/com.vidaa.server.plist"
    
    # Удаляем RAM-диск
    remove_ramdisk
    
    # Удаляем скрипт создания RAM-диска
    if [ -f "/opt/Vidaa/create-ramdisk.sh" ]; then
        sudo rm -f "/opt/Vidaa/create-ramdisk.sh"
    fi
    
    remove_firewall_rules
    
    if [ -d "/opt/Vidaa/" ]; then
        echo "Удаление /opt/Vidaa/..."
        sudo rm -rf /opt/Vidaa/
    fi
    
    local config_dir="$HOME/.videoloop-server"
    if [ -d "$config_dir" ]; then
        echo "Удаление $config_dir..."
        rm -rf "$config_dir"
    fi
    
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}Удаление Vidaa завершено успешно!${NC}"
    echo -e "${GREEN}========================================${NC}"
}

# Проверка macOS
if [[ "$(uname)" != "Darwin" ]]; then
    echo -e "${RED}Этот скрипт предназначен только для macOS${NC}"
    exit 1
fi

# Проверка утилит
for cmd in curl unzip tar lsof pfctl hdiutil diskutil bc; do
    if ! command -v $cmd &> /dev/null; then
        echo -e "${RED}Утилита $cmd не найдена.${NC}"
        if [ "$cmd" = "bc" ]; then
            echo -e "${YELLOW}Установите bc: brew install bc${NC}"
        fi
        exit 1
    fi
done

# Главное меню
echo "Выберите действие:"
echo "1) Установка"
echo "2) Обновление"
echo "3) Удаление"
echo -n "Введите номер (1, 2 или 3): "
read -r choice

case $choice in
    1)
        install_vidaa
        ;;
    2)
        update_vidaa
        ;;
    3)
        uninstall_vidaa
        ;;
    *)
        echo -e "${RED}Неверный выбор.${NC}"
        exit 1
        ;;
esac
