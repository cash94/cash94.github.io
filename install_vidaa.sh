#!/bin/bash

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

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
    
    # Создаем директорию
    mkdir -p /opt/Vidaa/
    cd /opt/Vidaa/ || exit 1
    
    # Скачиваем архив
    echo "Скачивание архива..."
    wget -q --show-progress https://github.com/cash94/cash94.github.io/releases/download/%23vidaa/Vidaa.zip
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при скачивании архива${NC}"
        exit 1
    fi
    
    # Распаковываем
    echo "Распаковка архива..."
    unzip -q Vidaa.zip
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при распаковке архива${NC}"
        exit 1
    fi
    
    # Удаляем архив
    rm -rf /opt/Vidaa/Vidaa.zip
    
    # Устанавливаем права
    chmod o+x /opt/Vidaa/myapp-linux-x64
    chmod o+x /opt/Vidaa/ffmpeg/ffmpeg
    chmod o+x /opt/Vidaa/ffmpeg/ffprobe
    
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
    
    # Создаем systemd сервис
    cat > /etc/systemd/system/vidaa.service << EOF
[Unit]
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
WantedBy=multi-user.target
EOF
    
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
        echo -e "${GREEN}========================================${NC}"
    else
        echo -e "${RED}Ошибка при запуске сервиса${NC}"
        exit 1
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
    
    cd /opt/Vidaa/ || exit 1
    
    # Скачиваем архив
    echo "Скачивание обновления..."
    wget -q --show-progress https://github.com/cash94/cash94.github.io/releases/download/%23vidaa/Vidaa.zip
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при скачивании архива${NC}"
        exit 1
    fi
    
    # Распаковываем с заменой файлов
    echo "Распаковка обновления..."
    unzip -q -o Vidaa.zip
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка при распаковке архива${NC}"
        exit 1
    fi
    
    # Удаляем архив
    rm -rf /opt/Vidaa/Vidaa.zip
    
    # Обновляем права
    chmod o+x /opt/Vidaa/myapp-linux-x64
    chmod o+x /opt/Vidaa/ffmpeg/ffmpeg
    chmod o+x /opt/Vidaa/ffmpeg/ffprobe
    
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

# Проверка прав root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Пожалуйста, запустите скрипт с правами root (sudo)${NC}"
    exit 1
fi

# Проверка наличия необходимых утилит
for cmd in wget unzip systemctl; do
    if ! command -v $cmd &> /dev/null; then
        echo -e "${RED}Утилита $cmd не найдена. Пожалуйста, установите её.${NC}"
        exit 1
    fi
done

# Главное меню
echo "Выберите действие:"
echo "1) Установка"
echo "2) Обновление"
echo -n "Введите номер (1 или 2): "
read -r choice

case $choice in
    1)
        install_vidaa
        ;;
    2)
        update_vidaa
        ;;
    *)
        echo -e "${RED}Неверный выбор. Пожалуйста, запустите скрипт снова.${NC}"
        exit 1
        ;;
esac
