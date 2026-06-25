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
        *)
            echo -e "${RED}Неподдерживаемая архитектура: $arch${NC}"
            exit 1
            ;;
    esac
}

# Функция для проверки и установки unzip
check_and_install_unzip() {
    if ! command -v unzip &> /dev/null; then
        echo -e "${YELLOW}Пакет unzip не найден. Устанавливаю...${NC}"
        
        # Определяем пакетный менеджер
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

# Функция для проверки доступной памяти (RAM + Swap)
check_available_memory() {
    # Получаем доступную память в KB
    local avail_mem=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
    local swap_total=$(grep SwapTotal /proc/meminfo | awk '{print $2}')
    local swap_free=$(grep SwapFree /proc/meminfo | awk '{print $2}')
    
    # Считаем общую доступную память (RAM available + Swap free)
    local total_available=$((avail_mem + swap_free))
    
    # Конвертируем в GB
    local available_gb=$(echo "scale=2; $total_available / 1048576" | bc)
    
    echo "$available_gb"
}

# Функция для настройки RAM disk
setup_ramdisk() {
    local available_gb=$(check_available_memory)
    local ramdisk_size=""
    
    echo -e "${BLUE}Доступно памяти (RAM + Swap): ${available_gb} GB${NC}"
    
    # Проверяем, достаточно ли памяти
    local available_int=$(echo "$available_gb" | cut -d. -f1)
    
    if [ "$available_int" -ge 3 ]; then
        echo -e "${YELLOW}Хотите создать RAM disk для HLS сегментов (рекомендуется 2 GB)?${NC}"
        echo -e "${YELLOW}Это ускорит работу сервера и снизит износ диска.${NC}"
        echo -n "Создать RAM disk на 2 GB? (y/n): "
        read -r create_ramdisk
        
        if [[ "$create_ramdisk" =~ ^[YyДд]$ ]]; then
            ramdisk_size="2G"
        else
            echo -e "${YELLOW}RAM disk не будет создан${NC}"
        fi
    else
        echo -e "${YELLOW}Доступно менее 3 GB памяти.${NC}"
        echo -e "${YELLOW}Хотите указать размер RAM disk вручную?${NC}"
        echo -n "Введите размер RAM disk (например, 1G, 512M) или нажмите Enter чтобы пропустить: "
        read -r custom_size
        
        if [ -n "$custom_size" ]; then
            # Проверяем формат (должен заканчиваться на G или M)
            if [[ "$custom_size" =~ ^[0-9]+[GM]$ ]]; then
                ramdisk_size="$custom_size"
                echo -e "${GREEN}RAM disk будет создан размером: $ramdisk_size${NC}"
            else
                echo -e "${RED}Некорректный формат. Используйте формат: 1G, 2G, 512M и т.д.${NC}"
                echo -e "${YELLOW}RAM disk не будет создан${NC}"
            fi
        else
            echo -e "${YELLOW}RAM disk не будет создан${NC}"
        fi
    fi
    
    echo "$ramdisk_size"
}

# Функция для проверки доступности порта
check_port() {
    local port=$1
    if ss -tuln | grep -q ":$port "; then
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

# Функция для установки
install_vidaa() {
    echo -e "${GREEN}Начинаем установку Vidaa...${NC}"
    
    # Проверяем и устанавливаем unzip
    check_and_install_unzip
    
    # Определяем архитектуру
    local arch=$(detect_architecture)
    echo -e "${GREEN}Обнаружена архитектура: $arch${NC}"
    
    # Выбираем версию приложения
    local app_file=""
    if [ "$arch" = "amd64" ]; then
        app_file="TorrStream-linux-amd64"
    else
        app_file="TorrStream-linux-arm64"
    fi
    
    # Создаем директорию
    mkdir -p /opt/Vidaa/
    cd /opt/Vidaa/ || exit 1
    
    # Скачиваем архив приложения
    echo "Скачивание архива приложения..."
    wget -q --show-progress "https://github.com/cash94/cash94.github.io/releases/download/%23vidaa/TorrStream-linux.zip"
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при скачивании архива${NC}"
        exit 1
    fi
    
    # Распаковываем
    echo "Распаковка архива..."
    unzip -q TorrStream-linux.zip
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при распаковке архива${NC}"
        exit 1
    fi
    
    # Удаляем архив
    rm -rf /opt/Vidaa/TorrStream-linux.zip
    
    # Переименовываем бинарник в соответствии с архитектурой
    if [ -f "/opt/Vidaa/$app_file" ]; then
        mv "/opt/Vidaa/$app_file" "/opt/Vidaa/myapp-linux-x64"
    else
        echo -e "${RED}Бинарник $app_file не найден в архиве${NC}"
        exit 1
    fi
    
    # Создаем директорию для ffmpeg
    mkdir -p /opt/Vidaa/ffmpeg
    cd /opt/Vidaa/ffmpeg || exit 1
    
    # Выбираем версию ffmpeg
    local ffmpeg_url=""
    if [ "$arch" = "amd64" ]; then
        ffmpeg_url="https://github.com/jellyfin/jellyfin-ffmpeg/releases/download/v7.1.3-3/jellyfin-ffmpeg_7.1.3-3_portable_linux64-gpl.tar.xz"
    else
        ffmpeg_url="https://github.com/jellyfin/jellyfin-ffmpeg/releases/download/v7.1.3-3/jellyfin-ffmpeg_7.1.3-3_portable_linuxarm64-gpl.tar.xz"
    fi
    
    # Скачиваем ffmpeg
    echo "Скачивание ffmpeg..."
    wget -q --show-progress "$ffmpeg_url"
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при скачивании ffmpeg${NC}"
        exit 1
    fi
    
    # Распаковываем tar.xz
    echo "Распаковка ffmpeg..."
    tar -xf jellyfin-ffmpeg_*.tar.xz
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при распаковке ffmpeg${NC}"
        exit 1
    fi
    
    # Копируем бинарники из распакованной папки
    find . -name "ffmpeg" -type f -exec cp {} /opt/Vidaa/ffmpeg/ \;
    find . -name "ffprobe" -type f -exec cp {} /opt/Vidaa/ffmpeg/ \;
    
    # Удаляем распакованную папку и архив
    rm -rf jellyfin-ffmpeg_* && rm -f jellyfin-ffmpeg_*.tar.xz
    
    # Скачиваем yt-dlp
    echo "Скачивание yt-dlp..."
    wget -q --show-progress "https://github.com/yt-dlp/yt-dlp/releases/download/2026.03.17/yt-dlp_linux" -O yt-dlp
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при скачивании yt-dlp${NC}"
        exit 1
    fi
    
    # Устанавливаем права
    chmod 775 /opt/Vidaa/myapp-linux-x64
    chmod 775 /opt/Vidaa/ffmpeg/ffmpeg
    chmod 775 /opt/Vidaa/ffmpeg/ffprobe
    chmod 775 /opt/Vidaa/ffmpeg/yt-dlp
    
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
    
    # Настраиваем RAM disk
    local ramdisk_size=$(setup_ramdisk)
    
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
    
    # Если выбран RAM disk, добавляем ExecStartPre и ExecStopPost
    if [ -n "$ramdisk_size" ]; then
        # Создаем директорию для RAM disk
        mkdir -p /mnt/hls-ram
        
        service_content="[Unit]
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
ExecStartPre=/bin/mkdir -p /mnt/hls-ram
ExecStartPre=/bin/mount -t tmpfs -o size=$ramdisk_size,uid=root,gid=root tmpfs /mnt/hls-ram
ExecStart=/opt/Vidaa/myapp-linux-x64
ExecStopPost=/bin/umount /mnt/hls-ram
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=Vidaa
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target"
        
        echo -e "${GREEN}RAM disk будет создан размером: $ramdisk_size${NC}"
    fi
    
    echo "$service_content" > /etc/systemd/system/vidaa.service
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при создании systemd сервиса${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}Файл сервиса создан${NC}"
    
    # Включаем и запускаем сервис
    systemctl daemon-reload
    systemctl enable vidaa
    systemctl start vidaa
    
    if [ $? -eq 0 ]; then
        # Получаем IP адрес
        local ip_addr=$(hostname -I | awk '{print $1}')
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}Установка завершена успешно!${NC}"
        echo -e "${GREEN}Vidaa сервер доступен по адресу: http://$ip_addr:$selected_port${NC}"
        if [ -n "$ramdisk_size" ]; then
            echo -e "${GREEN}RAM disk ($ramdisk_size) успешно примонтирован${NC}"
        fi
        echo -e "${GREEN}========================================${NC}"
    else
        echo -e "${RED}Ошибка при запуске сервиса${NC}"
        exit 1
    fi
}

# Функция для обновления
update_vidaa() {
    echo -e "${GREEN}Начинаем обновление Vidaa...${NC}"
    
    # Проверяем и устанавливаем unzip если нужно
    check_and_install_unzip
    
    # Проверяем существование директории
    if [ ! -d "/opt/Vidaa/" ]; then
        echo -e "${RED}Директория /opt/Vidaa/ не существует. Сначала выполните установку.${NC}"
        exit 1
    fi
    
    # Определяем архитектуру
    local arch=$(detect_architecture)
    echo -e "${GREEN}Обнаружена архитектура: $arch${NC}"
    
    # Выбираем версию приложения
    local app_file=""
    if [ "$arch" = "amd64" ]; then
        app_file="TorrStream-linux-amd64"
    else
        app_file="TorrStream-linux-arm64"
    fi
    
    cd /opt/Vidaa/ || exit 1
    
    # Скачиваем архив
    echo "Скачивание обновления..."
    wget -q --show-progress "https://github.com/cash94/cash94.github.io/releases/download/%23vidaa/TorrStream-linux.zip"
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при скачивании архива${NC}"
        exit 1
    fi
    
    # Распаковываем с заменой файлов
    echo "Распаковка обновления..."
    rm -rf /opt/Vidaa/public
    unzip -q -o TorrStream-linux.zip
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при распаковке архива${NC}"
        exit 1
    fi
    
    # Удаляем архив
    rm -rf /opt/Vidaa/TorrStream-linux.zip
    
    # Переименовываем бинарник
    if [ -f "/opt/Vidaa/$app_file" ]; then
        mv "/opt/Vidaa/$app_file" "/opt/Vidaa/myapp-linux-x64"
    else
        echo -e "${RED}Бинарник $app_file не найден в архиве${NC}"
        exit 1
    fi
    
    # Обновляем yt-dlp (без ffmpeg, так как он обновляется реже)
    #echo "Обновление yt-dlp..."
    #wget -q --show-progress "https://github.com/yt-dlp/yt-dlp/releases/download/2026.03.17/yt-dlp_linux" -O /opt/Vidaa/ffmpeg/yt-dlp
    
    #if [ $? -ne 0 ]; then
        #echo -e "${RED}Ошибка при скачивании yt-dlp${NC}"
        #exit 1
    #fi
    
    # Обновляем права
    chmod 775 /opt/Vidaa/myapp-linux-x64
    chmod 775 /opt/Vidaa/ffmpeg/ffmpeg
    chmod 775 /opt/Vidaa/ffmpeg/ffprobe
    chmod 775 /opt/Vidaa/ffmpeg/yt-dlp
    
    # Перезапускаем сервис
    echo "Перезапуск сервиса..."
    systemctl restart vidaa
    
    if [ $? -eq 0 ]; then
        # Получаем информацию о сервисе
        local port=$(systemctl show vidaa -p Environment | grep -oP 'PORT=\K\d+')
        local ip_addr=$(hostname -I | awk '{print $1}')
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
    
    # Останавливаем и отключаем сервис
    echo "Остановка сервиса vidaa..."
    systemctl stop vidaa 2>/dev/null
    
    echo "Отключение сервиса vidaa..."
    systemctl disable vidaa 2>/dev/null
    
    # Удаляем файл сервиса
    echo "Удаление файла сервиса..."
    rm -f /etc/systemd/system/vidaa.service
    
    # Перезагружаем systemd
    systemctl daemon-reload
    
    # Размонтируем RAM disk если он был создан
    if mountpoint -q /mnt/hls-ram 2>/dev/null; then
        echo "Размонтирование RAM disk..."
        umount /mnt/hls-ram 2>/dev/null
    fi
    
    # Удаляем директорию RAM disk
    if [ -d "/mnt/hls-ram" ]; then
        echo "Удаление /mnt/hls-ram..."
        rmdir /mnt/hls-ram 2>/dev/null
    fi
    
    # Удаляем директорию установки
    if [ -d "/opt/Vidaa/" ]; then
        echo "Удаление /opt/Vidaa/..."
        rm -rf /opt/Vidaa/
    else
        echo -e "${YELLOW}Директория /opt/Vidaa/ не найдена${NC}"
    fi
    
    # Определяем домашнюю директорию пользователя
    local home_dir=""
    if [ -n "$SUDO_USER" ]; then
        # Если запущено через sudo
        home_dir=$(getent passwd "$SUDO_USER" | cut -d: -f6)
    else
        # Если запущено от root напрямую
        home_dir="$HOME"
    fi
    
    # Удаляем конфигурационную директорию в домашнем каталоге
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
for cmd in wget systemctl tar bc; do
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
