#!/bin/bash

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функция для определения архитектуры
detect_architecture() {
    local arch=$(uname -m)
    case $arch in
        x86_64|amd64)
            echo "amd64"
            ;;
        aarch64|arm64)
            echo "arm64"
            ;;
        armv7l|armv7*|armv8l|armhf)
            # armv8l — 32-битная система на 64-битном процессоре
            echo "armv7"
            ;;
        *)
            echo -e "${RED}Неподдерживаемая архитектура: $arch${NC}"
            exit 1
            ;;
    esac
}

# Имя бинарника TorrStream в архиве для архитектуры
app_file_for_arch() {
    case $1 in
        amd64) echo "TorrStream-linux-amd64" ;;
        arm64) echo "TorrStream-linux-arm64" ;;
        armv7) echo "TorrStream-linux-armv7" ;;
    esac
}

# Скачать ffmpeg и ffprobe в /opt/Vidaa/ffmpeg. Jellyfin собирает только
# amd64 и arm64, для armv7 — статическая сборка johnvansickle.com
install_ffmpeg() {
    local arch=$1
    local ffmpeg_url=""
    case $arch in
        amd64) ffmpeg_url="https://github.com/jellyfin/jellyfin-ffmpeg/releases/download/v7.1.3-3/jellyfin-ffmpeg_7.1.3-3_portable_linux64-gpl.tar.xz" ;;
        arm64) ffmpeg_url="https://github.com/jellyfin/jellyfin-ffmpeg/releases/download/v7.1.3-3/jellyfin-ffmpeg_7.1.3-3_portable_linuxarm64-gpl.tar.xz" ;;
        armv7) ffmpeg_url="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-armhf-static.tar.xz" ;;
    esac

    mkdir -p /opt/Vidaa/ffmpeg
    # Во временной папке: в /opt/Vidaa/ffmpeg уже может лежать прежний ffmpeg
    local tmp_dir=$(mktemp -d)

    echo "Скачивание ffmpeg..."
    wget -q --show-progress "$ffmpeg_url" -O "$tmp_dir/ffmpeg.tar.xz"
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при скачивании ffmpeg${NC}"
        rm -rf "$tmp_dir"
        exit 1
    fi

    echo "Распаковка ffmpeg..."
    tar -xf "$tmp_dir/ffmpeg.tar.xz" -C "$tmp_dir"
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при распаковке ffmpeg${NC}"
        rm -rf "$tmp_dir"
        exit 1
    fi

    # Раскладка у сборок разная (ffmpeg в корне архива, в папке или в bin/)
    local ff=$(find "$tmp_dir" -type f -name ffmpeg | head -n 1)
    local fp=$(find "$tmp_dir" -type f -name ffprobe | head -n 1)
    if [ -z "$ff" ] || [ -z "$fp" ]; then
        echo -e "${RED}Не удалось найти ffmpeg и ffprobe в архиве${NC}"
        tar -tf "$tmp_dir/ffmpeg.tar.xz" | head -20
        rm -rf "$tmp_dir"
        exit 1
    fi
    cp "$ff" /opt/Vidaa/ffmpeg/ffmpeg
    cp "$fp" /opt/Vidaa/ffmpeg/ffprobe
    chmod 775 /opt/Vidaa/ffmpeg/ffmpeg /opt/Vidaa/ffmpeg/ffprobe
    rm -rf "$tmp_dir"
    echo -e "${GREEN}ffmpeg установлен в /opt/Vidaa/ffmpeg${NC}"
}

# Функция для проверки и установки unzip
check_and_install_unzip() {
    if ! command -v unzip &> /dev/null; then
        echo -e "${YELLOW}Пакет unzip не найден. Устанавливаю...${NC}"
        
        if command -v apt-get &> /dev/null; then
            apt-get update -qq
            apt-get install -y unzip
        elif command -v yum &> /dev/null; then
            yum install -y unzip
        elif command -v dnf &> /dev/null; then
            dnf install -y unzip
        elif command -v pacman &> /dev/null; then
            pacman -S --noconfirm unzip
        else
            echo -e "${RED}Не удалось определить пакетный менеджер. Установите unzip вручную.${NC}"
            exit 1
        fi
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}unzip успешно установлен${NC}"
        else
            echo -e "${RED}Ошибка при установке unzip${NC}"
            exit 1
        fi
    else
        echo -e "${GREEN}unzip уже установлен${NC}"
    fi
}

# Функция для проверки доступности порта
check_port() {
    local port=$1
    if ss -tuln | grep -q ":$port "; then
        return 1
    else
        return 0
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

# Функция для установки
install_vidaa() {
    echo -e "${GREEN}Начинаем установку Vidaa...${NC}"
    
    check_and_install_unzip
    
    local arch=$(detect_architecture)
    echo -e "${GREEN}Обнаружена архитектура: $arch${NC}"
    
    local app_file=$(app_file_for_arch "$arch")

    mkdir -p /opt/Vidaa/
    cd /opt/Vidaa/ || exit 1
    
    echo "Скачивание архива приложения..."
    wget -q --show-progress "https://github.com/cash94/cash94.github.io/releases/download/%23vidaa/TorrStream-linux.zip"
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при скачивании архива${NC}"
        exit 1
    fi
    
    # ИСПРАВЛЕНИЕ 1: Добавлен флаг -o для автоматической перезаписи
    echo "Распаковка архива..."
    unzip -q -o TorrStream-linux.zip
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при распаковке архива${NC}"
        exit 1
    fi
    
    rm -f /opt/Vidaa/TorrStream-linux.zip
    
    if [ -f "/opt/Vidaa/$app_file" ]; then
        mv "/opt/Vidaa/$app_file" "/opt/Vidaa/myapp-linux-x64"
        # Сборки для других архитектур из архива не нужны
        rm -f /opt/Vidaa/TorrStream-linux-*
    else
        echo -e "${RED}Бинарник $app_file не найден в архиве${NC}"
        exit 1
    fi

    install_ffmpeg "$arch"
    chmod 775 /opt/Vidaa/myapp-linux-x64

    # ==========================================
    # ВЫБОР ПОРТА
    # ==========================================
    echo "=========================================="
    echo "  Настройка порта"
    echo "=========================================="
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
                echo -e "${RED}Порт $user_port уже занят. Пожалуйста, выберите другой порт.${NC}"
            fi
        else
            echo -e "${RED}Пожалуйста, введите корректный номер порта (1-65535)${NC}"
        fi
    done
    
    # Создаем systemd сервис
    local service_content="[Unit]
Description=VidaaVideo HLS Server
After=network.target
Wants=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/Vidaa/
Environment=NODE_ENV=production
Environment=PORT=$selected_port
Environment=HOST=0.0.0.0
ExecStart=/opt/Vidaa/myapp-linux-x64
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=Vidaa
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target"
    
    echo "$service_content" > /etc/systemd/system/vidaa.service
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при создании systemd сервиса${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}Файл сервиса создан${NC}"
    
    systemctl daemon-reload
    systemctl enable vidaa
    systemctl start vidaa
    
    if [ $? -eq 0 ]; then
        local ip_addr=$(hostname -I | awk '{print $1}')
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}Установка завершена успешно!${NC}"
        echo -e "${GREEN}Vidaa сервер доступен по адресу: http://$ip_addr:$selected_port${NC}"
        echo -e "${GREEN}Кэш HLS — в памяти TorrStream, размер меняется в админке (вкладка «Система»)${NC}"
echo -e "${GREEN}========================================${NC}"
    else
        echo -e "${RED}Ошибка при запуске сервиса${NC}"
        echo -e "${YELLOW}Проверьте логи: journalctl -xeu vidaa.service${NC}"
        exit 1
    fi
}

# Функция для обновления
update_vidaa() {
    echo -e "${GREEN}Начинаем обновление Vidaa...${NC}"
    
    check_and_install_unzip
    
    if [ ! -d "/opt/Vidaa/" ]; then
        echo -e "${RED}Директория /opt/Vidaa/ не существует. Сначала выполните установку.${NC}"
        exit 1
    fi
    
    local arch=$(detect_architecture)
    echo -e "${GREEN}Обнаружена архитектура: $arch${NC}"
    
    local app_file=$(app_file_for_arch "$arch")

    cd /opt/Vidaa/ || exit 1
    
    # ==========================================
    # ОБНОВЛЕНИЕ ПРИЛОЖЕНИЯ
    # ==========================================
    echo "Скачивание обновления..."
    wget -q --show-progress "https://github.com/cash94/cash94.github.io/releases/download/%23vidaa/TorrStream-linux.zip"
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при скачивании архива${NC}"
        exit 1
    fi
    
    echo "Распаковка обновления..."
    rm -rf /opt/Vidaa/public
    unzip -q -o TorrStream-linux.zip
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при распаковке архива${NC}"
        exit 1
    fi
    
    rm -rf /opt/Vidaa/TorrStream-linux.zip
    
    if [ -f "/opt/Vidaa/$app_file" ]; then
        mv "/opt/Vidaa/$app_file" "/opt/Vidaa/myapp-linux-x64"
        rm -f /opt/Vidaa/TorrStream-linux-*
    else
        echo -e "${RED}Бинарник $app_file не найден в архиве${NC}"
        exit 1
    fi

    chmod 775 /opt/Vidaa/myapp-linux-x64
    # ffmpeg мог не встать при прошлой установке — докачиваем
    if [ ! -x /opt/Vidaa/ffmpeg/ffmpeg ] || [ ! -x /opt/Vidaa/ffmpeg/ffprobe ]; then
        install_ffmpeg "$arch"
    fi
    # yt-dlp больше не нужен (YouTube в сервере убран)
    rm -f /opt/Vidaa/ffmpeg/yt-dlp

    # ==========================================
    # СТАРЫЙ RAM-ДИСК (tmpfs /mnt/hls-ram) БОЛЬШЕ НЕ НУЖЕН
    # ==========================================
    # Кэш HLS сервер держит в своей памяти; tmpfs поверх него занимал бы
    # память второй раз. Убираем его из службы и размонтируем
    if grep -q "hls-ram" /etc/systemd/system/vidaa.service 2>/dev/null; then
        echo "Отключение RAM-диска /mnt/hls-ram: кэш HLS теперь в памяти TorrStream..."
        systemctl stop vidaa
        sed -i '/hls-ram/d' /etc/systemd/system/vidaa.service
        if mountpoint -q /mnt/hls-ram 2>/dev/null; then
            umount /mnt/hls-ram 2>/dev/null
        fi
        rmdir /mnt/hls-ram 2>/dev/null
    fi

    # ==========================================
    # ПЕРЕЗАПУСК СЛУЖБЫ
    # ==========================================
    echo "Перезапуск сервиса..."
    systemctl daemon-reload
    systemctl restart vidaa
    
    if [ $? -eq 0 ]; then
        local port=$(systemctl show vidaa -p Environment | grep -oP 'PORT=\K\d+')
        local ip_addr=$(hostname -I | awk '{print $1}')
        
        echo ""
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}Обновление завершено успешно!${NC}"
        echo -e "${GREEN}Vidaa сервер доступен по адресу: http://$ip_addr:$port${NC}"
        echo -e "${GREEN}Кэш HLS — в памяти TorrStream, размер меняется в админке (вкладка «Система»)${NC}"

        echo -e "${GREEN}========================================${NC}"
    else
        echo -e "${RED}Ошибка при перезапуске сервиса${NC}"
        echo -e "${YELLOW}Проверьте логи: journalctl -xeu vidaa.service${NC}"
        exit 1
    fi
}

# Функция для удаления
uninstall_vidaa() {
    echo -e "${YELLOW}Начинаем удаление Vidaa...${NC}"
    
    echo -e "${RED}ВНИМАНИЕ: Это действие полностью удалит Vidaa и все его данные!${NC}"
    echo -n "Вы уверены, что хотите продолжить? (y/n): "
    read -r confirm
    
    if [[ ! "$confirm" =~ ^[YyДд]$ ]]; then
        echo -e "${YELLOW}Удаление отменено.${NC}"
        return 0
    fi
    
    echo "Остановка сервиса vidaa..."
    systemctl stop vidaa 2>/dev/null
    
    echo "Отключение сервиса vidaa..."
    systemctl disable vidaa 2>/dev/null
    
    echo "Удаление файла сервиса..."
    rm -f /etc/systemd/system/vidaa.service
    
    systemctl daemon-reload
    
    if mountpoint -q /mnt/hls-ram 2>/dev/null; then
        echo "Размонтирование RAM disk..."
        umount /mnt/hls-ram 2>/dev/null
    fi
    
    if [ -d "/mnt/hls-ram" ]; then
        echo "Удаление /mnt/hls-ram..."
        rmdir /mnt/hls-ram 2>/dev/null
    fi
    
    if [ -d "/opt/Vidaa/" ]; then
        echo "Удаление /opt/Vidaa/..."
        rm -rf /opt/Vidaa/
    else
        echo -e "${YELLOW}Директория /opt/Vidaa/ не найдена${NC}"
    fi
    
    local home_dir=""
    if [ -n "$SUDO_USER" ]; then
        home_dir=$(getent passwd "$SUDO_USER" | cut -d: -f6)
    else
        home_dir="$HOME"
    fi
    
    local config_dir="$home_dir/.videoloop-server"
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

# Проверка прав root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Пожалуйста, запустите скрипт с правами root (sudo)${NC}"
    exit 1
fi

# Проверка наличия необходимых утилит
for cmd in wget systemctl tar; do
    if ! command -v $cmd &> /dev/null; then
        echo -e "${RED}Утилита $cmd не найдена. Пожалуйста, установите её.${NC}"
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
