#!/bin/bash

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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
    
    # Проверяем, включен ли firewall
    if ! pfctl -s info 2>/dev/null | grep -q "Status: Enabled"; then
        echo -e "${YELLOW}Firewall (pf) в данный момент не включен.${NC}"
        echo -n "Хотите включить firewall и настроить его? (y/n): "
        read -r enable_fw
        if [[ "$enable_fw" =~ ^[YyДд]$ ]]; then
            # Включаем pf
            sudo pfctl -e
            
            # Создаем backup оригинального конфига если его нет
            if [ ! -f "$pf_conf" ]; then
                echo "# PF configuration file" | sudo tee "$pf_conf" > /dev/null
            fi
            
            if ! grep -q "anchor \"$pf_anchor\"" "$pf_conf" 2>/dev/null; then
                echo "anchor \"$pf_anchor\"" | sudo tee -a "$pf_conf" > /dev/null
                echo "load anchor \"$pf_anchor\" from \"$pf_rules_file\"" | sudo tee -a "$pf_conf" > /dev/null
            fi
        else
            echo -e "${YELLOW}Firewall не будет настроен. Сервер будет доступен только локально.${NC}"
            return 0
        fi
    fi
    
    # Создаем правила для нашего порта
    cat > "$pf_rules_file" << EOF
# Vidaa Server Rules
pass in on en0 proto tcp from any to any port $port
pass in on en1 proto tcp from any to any port $port
pass in on en2 proto tcp from any to any port $port
pass in on en3 proto tcp from any to any port $port
EOF
    
    # Загружаем правила
    sudo pfctl -a "$pf_anchor" -f "$pf_rules_file" 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Firewall успешно настроен для порта $port${NC}"
        
        # Проверяем, не блокирует ли macOS Application Firewall
        if /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate | grep -q "disabled"; then
            echo -e "${YELLOW}Внимание: Application Firewall (socketfilterfw) отключен.${NC}"
            echo -e "${YELLOW}Убедитесь, что в Системных настройках > Защита и безопасность > Брандмауэр разрешен доступ для приложений.${NC}"
        fi
        
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
    
    # Удаляем anchor
    sudo pfctl -a "$pf_anchor" -F all 2>/dev/null
    
    # Удаляем anchor из основного конфига
    if [ -f "/etc/pf.conf" ]; then
        sudo sed -i '' "/anchor \"$pf_anchor\"/d" "/etc/pf.conf"
        sudo sed -i '' "/load anchor \"$pf_anchor\"/d" "/etc/pf.conf"
    fi
    
    echo -e "${GREEN}Правила firewall удалены${NC}"
}

# Функция для создания launchd plist (аналог systemd сервиса)
create_launchd_service() {
    local port=$1
    local plist_path="$HOME/Library/LaunchAgents/com.vidaa.server.plist"
    
    mkdir -p "$HOME/Library/LaunchAgents"
    
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
    
    # Загружаем сервис
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
    
    # Определяем архитектуру
    local arch=$(detect_architecture)
    echo -e "${GREEN}Обнаружена архитектура: $arch${NC}"
    
    # Выбираем версию приложения (правильные имена)
    local app_file=""
    if [ "$arch" = "x64" ]; then
        app_file="TorrStream-macos-x64"
    else
        app_file="TorrStream-macos-arm64"
    fi
    
    # Создаем директорию
    sudo mkdir -p /opt/Vidaa/
    cd /opt/Vidaa/ || exit 1
    
    # Скачиваем архив приложения
    echo "Скачивание архива приложения..."
    sudo wget -q --show-progress "https://github.com/cash94/cash94.github.io/releases/download/%23vidaa/TorrStream-macos.zip"
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при скачивании архива${NC}"
        exit 1
    fi
    
    # Распаковываем
    echo "Распаковка архива..."
    sudo unzip -q TorrStream-macos.zip
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при распаковке архива${NC}"
        exit 1
    fi
    
    # Удаляем архив
    sudo rm -rf /opt/Vidaa/TorrStream-macos.zip
    
    # Переименовываем бинарник в соответствии с архитектурой
    if [ -f "/opt/Vidaa/$app_file" ]; then
        sudo mv "/opt/Vidaa/$app_file" "/opt/Vidaa/myapp-macos"
        echo -e "${GREEN}Найден и переименован бинарник: $app_file${NC}"
    else
        echo -e "${RED}Бинарник $app_file не найден в архиве${NC}"
        echo -e "${YELLOW}Доступные файлы в архиве:${NC}"
        ls -la /opt/Vidaa/
        exit 1
    fi
    
    # Создаем директорию для ffmpeg
    sudo mkdir -p /opt/Vidaa/ffmpeg
    cd /opt/Vidaa/ffmpeg || exit 1
    
    # Выбираем версию ffmpeg
    local ffmpeg_url=""
    if [ "$arch" = "x64" ]; then
        ffmpeg_url="https://github.com/jellyfin/jellyfin-ffmpeg/releases/download/v7.1.3-3/jellyfin-ffmpeg_7.1.3-3_portable_mac64-gpl.tar.xz"
    else
        ffmpeg_url="https://github.com/jellyfin/jellyfin-ffmpeg/releases/download/v7.1.3-3/jellyfin-ffmpeg_7.1.3-3_portable_macarm64-gpl.tar.xz"
    fi
    
    # Скачиваем ffmpeg
    echo "Скачивание ffmpeg..."
    sudo wget -q --show-progress "$ffmpeg_url"
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при скачивании ffmpeg${NC}"
        exit 1
    fi
    
    # Распаковываем tar.xz
    echo "Распаковка ffmpeg..."
    sudo tar -xf jellyfin-ffmpeg_*.tar.xz
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при распаковке ffmpeg${NC}"
        exit 1
    fi
    
    # Копируем бинарники из распакованной папки
    sudo find . -name "ffmpeg" -type f -exec cp {} /opt/Vidaa/ffmpeg/ \;
    sudo find . -name "ffprobe" -type f -exec cp {} /opt/Vidaa/ffmpeg/ \;
    
    # Удаляем распакованную папку и архив
    sudo rm -rf jellyfin-ffmpeg_* && sudo rm -f jellyfin-ffmpeg_*.tar.xz
    
    # Скачиваем yt-dlp для macOS
    echo "Скачивание yt-dlp..."
    sudo wget -q --show-progress "https://github.com/yt-dlp/yt-dlp/releases/download/2026.03.17/yt-dlp_macos" -O yt-dlp
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при скачивании yt-dlp${NC}"
        exit 1
    fi
    
    # Устанавливаем права
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
            # Автоматический выбор свободного порта
            selected_port=$(get_free_port)
            echo -e "${GREEN}Выбран свободный порт: $selected_port${NC}"
            break
        elif [[ "$user_port" =~ ^[0-9]+$ ]] && [ "$user_port" -ge 1 ] && [ "$user_port" -le 65535 ]; then
            if check_port "$user_port"; then
                selected_port=$user_port
                echo -e "${GREEN}Порт $selected_port доступен${NC}"
                break
            else
                echo -e "${RED}Порт $user_port уже занят. Пожалуйста, выберите другой порт.${NC}"
            fi
        else
            echo -e "${RED}Пожалуйста, введите корректный номер порта (1-65535)${NC}"
        fi
    done
    
    # Создаем launchd сервис
    create_launchd_service "$selected_port"
    
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
    else
        echo -e "${YELLOW}Firewall не настроен. Сервер будет доступен только локально.${NC}"
    fi
    
    # Получаем IP адрес
    local ip_addr=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n 1)
    
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}Установка завершена успешно!${NC}"
    echo -e "${GREEN}Vidaa сервер доступен:${NC}"
    echo -e "${BLUE}  Локально: http://localhost:$selected_port${NC}"
    echo -e "${BLUE}  В сети: http://$ip_addr:$selected_port${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo -e "${YELLOW}Для управления сервисом используйте:${NC}"
    echo "  launchctl load ~/Library/LaunchAgents/com.vidaa.server.plist   # запуск"
    echo "  launchctl unload ~/Library/LaunchAgents/com.vidaa.server.plist # остановка"
    echo "  tail -f /tmp/vidaa.log                                         # просмотр логов"
    
    if [[ "$configure_fw" =~ ^[YyДд]$ ]]; then
        echo -e "${YELLOW}Для проверки правил firewall: pfctl -s rules${NC}"
        echo -e "${YELLOW}Для просмотра активных соединений: netstat -an | grep $selected_port${NC}"
    fi
}

# Функция для обновления
update_vidaa() {
    echo -e "${GREEN}Начинаем обновление Vidaa...${NC}"
    
    # Проверяем существование директории
    if [ ! -d "/opt/Vidaa/" ]; then
        echo -e "${RED}Директория /opt/Vidaa/ не существует. Сначала выполните установку.${NC}"
        exit 1
    fi
    
    # Определяем архитектуру
    local arch=$(detect_architecture)
    echo -e "${GREEN}Обнаружена архитектура: $arch${NC}"
    
    # Выбираем версию приложения (правильные имена)
    local app_file=""
    if [ "$arch" = "x64" ]; then
        app_file="TorrStream-macos-x64"
    else
        app_file="TorrStream-macos-arm64"
    fi
    
    cd /opt/Vidaa/ || exit 1
    
    # Скачиваем архив
    echo "Скачивание обновления..."
    sudo wget -q --show-progress "https://github.com/cash94/cash94.github.io/releases/download/%23vidaa/TorrStream-macos.zip"
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при скачивании архива${NC}"
        exit 1
    fi
    
    # Распаковываем с заменой файлов
    echo "Распаковка обновления..."
    sudo rm -rf /opt/Vidaa/public
    sudo unzip -q -o TorrStream-macos.zip
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при распаковке архива${NC}"
        exit 1
    fi
    
    # Удаляем архив
    sudo rm -rf /opt/Vidaa/TorrStream-macos.zip
    
    # Переименовываем бинарник
    if [ -f "/opt/Vidaa/$app_file" ]; then
        sudo mv "/opt/Vidaa/$app_file" "/opt/Vidaa/myapp-macos"
        echo -e "${GREEN}Обновлен бинарник: $app_file${NC}"
    else
        echo -e "${RED}Бинарник $app_file не найден в архиве${NC}"
        exit 1
    fi
    
    # Обновляем yt-dlp
    echo "Обновление yt-dlp..."
    sudo wget -q --show-progress "https://github.com/yt-dlp/yt-dlp/releases/download/2026.03.17/yt-dlp_macos" -O /opt/Vidaa/ffmpeg/yt-dlp
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при скачивании yt-dlp${NC}"
        exit 1
    fi
    
    # Обновляем права
    sudo chmod 755 /opt/Vidaa/myapp-macos
    sudo chmod 755 /opt/Vidaa/ffmpeg/ffmpeg
    sudo chmod 755 /opt/Vidaa/ffmpeg/ffprobe
    sudo chmod 755 /opt/Vidaa/ffmpeg/yt-dlp
    
    # Перезапускаем сервис
    echo "Перезапуск сервиса..."
    launchctl unload "$HOME/Library/LaunchAgents/com.vidaa.server.plist" 2>/dev/null
    launchctl load "$HOME/Library/LaunchAgents/com.vidaa.server.plist"
    
    if [ $? -eq 0 ]; then
        # Получаем информацию о сервисе
        local port=$(grep -A1 "PORT" "$HOME/Library/LaunchAgents/com.vidaa.server.plist" | grep "<string>" | sed 's/.*<string>\(.*\)<\/string>.*/\1/')
        local ip_addr=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n 1)
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}Обновление завершено успешно!${NC}"
        echo -e "${GREEN}Vidaa сервер доступен по адресу: http://$ip_addr:$port${NC}"
        echo -e "${GREEN}========================================${NC}"
    else
        echo -e "${RED}Ошибка при перезапуске сервиса${NC}"
        exit 1
    fi
}

# Функция для удаления
uninstall_vidaa() {
    echo -e "${YELLOW}Начинаем удаление Vidaa...${NC}"
    
    # Запрашиваем подтверждение
    echo -e "${RED}ВНИМАНИЕ: Это действие полностью удалит Vidaa и все его данные!${NC}"
    echo -n "Вы уверены, что хотите продолжить? (y/n): "
    read -r confirm
    
    if [[ ! "$confirm" =~ ^[YyДд]$ ]]; then
        echo -e "${YELLOW}Удаление отменено.${NC}"
        return 0
    fi
    
    # Останавливаем и удаляем launchd сервис
    echo "Остановка сервиса vidaa..."
    launchctl unload "$HOME/Library/LaunchAgents/com.vidaa.server.plist" 2>/dev/null
    
    # Удаляем файл plist
    echo "Удаление файла сервиса..."
    rm -f "$HOME/Library/LaunchAgents/com.vidaa.server.plist"
    
    # Удаляем правила firewall
    remove_firewall_rules
    
    # Удаляем директорию установки
    if [ -d "/opt/Vidaa/" ]; then
        echo "Удаление /opt/Vidaa/..."
        sudo rm -rf /opt/Vidaa/
    else
        echo -e "${YELLOW}Директория /opt/Vidaa/ не найдена${NC}"
    fi
    
    # Удаляем конфигурационную директорию в домашнем каталоге
    local config_dir="$HOME/.videoloop-server"
    if [ -d "$config_dir" ]; then
        echo "Удаление $config_dir..."
        rm -rf "$config_dir"
    else
        echo -e "${YELLOW}Директория $config_dir не найдена${NC}"
    fi
    
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}Удаление Vidaa завершено успешно!${NC}"
    echo -e "${GREEN}========================================${NC}"
}

# Проверка, что скрипт запущен на macOS
if [[ "$(uname)" != "Darwin" ]]; then
    echo -e "${RED}Этот скрипт предназначен только для macOS${NC}"
    exit 1
fi

# Проверка наличия необходимых утилит
for cmd in wget unzip tar lsof pfctl; do
    if ! command -v $cmd &> /dev/null; then
        echo -e "${RED}Утилита $cmd не найдена. Пожалуйста, установите её.${NC}"
        if [ "$cmd" = "wget" ]; then
            echo -e "${YELLOW}Для установки wget используйте: brew install wget${NC}"
        elif [ "$cmd" = "pfctl" ]; then
            echo -e "${YELLOW}pfctl является системной утилитой macOS, должна быть доступна по умолчанию${NC}"
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
        echo -e "${RED}Неверный выбор. Пожалуйста, запустите скрипт снова.${NC}"
        exit 1
        ;;
esac
