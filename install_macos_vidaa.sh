#!/bin/bash
# ==========================================================================
#  Vidaa / TorrStream — установщик для macOS
#  Совместимость: macOS 10.13 High Sierra … macOS 26 (Intel x86_64 и Apple Silicon)
# ==========================================================================

RAMDISK_NAME="VidaaRAMDisk"
RAMDISK_PATH="/Volumes/$RAMDISK_NAME"
INSTALL_DIR="/opt/Vidaa"
CONF_FILE="$INSTALL_DIR/install.conf"
BIN_PATH="$INSTALL_DIR/myapp-macos"
START_SH="$INSTALL_DIR/start.sh"
RAMDISK_SH="$INSTALL_DIR/create-ramdisk.sh"

SERVER_LABEL="com.vidaa.server"
RAMDISK_LABEL="com.vidaa.ramdisk"
SERVER_PLIST="/Library/LaunchDaemons/$SERVER_LABEL.plist"
RAMDISK_PLIST="/Library/LaunchDaemons/$RAMDISK_LABEL.plist"

PF_ANCHOR="vidaa"
PF_ANCHOR_FILE="/etc/pf.anchors/vidaa"
PF_CONF="/etc/pf.conf"

APP_ZIP_URL="https://github.com/cash94/cash94.github.io/releases/download/%23vidaa/TorrStream-macos.zip"
FFMPEG_TAG="v7.1.3-3"
FFMPEG_VER="7.1.3-3"
YTDLP_TAG="2026.03.17"

# --------------------------------------------------------------------------
# Вывод
# --------------------------------------------------------------------------
if [ -t 1 ]; then
    RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'
    BLUE=$'\033[0;34m'; NC=$'\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; NC=''
fi

info()  { printf '%s\n' "${BLUE}$*${NC}"; }
ok()    { printf '%s\n' "${GREEN}$*${NC}"; }
warn()  { printf '%s\n' "${YELLOW}$*${NC}"; }
err()   { printf '%s\n' "${RED}$*${NC}" >&2; }
plain() { printf '%s\n' "$*"; }

# Чтение ответа пользователя. Работает и при `curl ... | bash`,
# когда stdin занят телом скрипта.
ask() {
    local __prompt="$1" __var="$2" __ans=""
    if [ -r /dev/tty ]; then
        printf '%s' "$__prompt" > /dev/tty
        IFS= read -r __ans < /dev/tty || __ans=""
    else
        printf '%s' "$__prompt"
        IFS= read -r __ans || __ans=""
    fi
    eval "$__var=\$__ans"
}

is_yes() {
    case "$1" in
        [YyДд]|[Yy][Ee][Ss]|[Дд][Аа]) return 0 ;;
        *) return 1 ;;
    esac
}

# Оставить в строке только цифры (защита от точек, пробелов, локали)
digits_only() { printf '%s' "$1" | tr -cd '0-9'; }

# --------------------------------------------------------------------------
# Проверка платформы и версии macOS
# --------------------------------------------------------------------------
if [ "$(uname -s)" != "Darwin" ]; then
    err "Этот скрипт предназначен только для macOS"
    exit 1
fi

OS_VER="$(sw_vers -productVersion 2>/dev/null)"
[ -n "$OS_VER" ] || OS_VER="0.0"
OS_MAJOR="${OS_VER%%.*}"
OS_REST="${OS_VER#*.}"
if [ "$OS_REST" = "$OS_VER" ]; then
    OS_MINOR=0
else
    OS_MINOR="${OS_REST%%.*}"
fi
OS_MAJOR="$(digits_only "$OS_MAJOR")"; OS_MINOR="$(digits_only "$OS_MINOR")"
[ -n "$OS_MAJOR" ] || OS_MAJOR=0
[ -n "$OS_MINOR" ] || OS_MINOR=0

# Big Sur в режиме SYSTEM_VERSION_COMPAT отдаёт 10.16 — нормализуем в 11.0
if [ "$OS_MAJOR" -eq 10 ] && [ "$OS_MINOR" -ge 16 ]; then
    OS_MAJOR=11; OS_MINOR=0
fi
OS_NUM=$(( OS_MAJOR * 100 + OS_MINOR ))   # 10.13→1013, 11.0→1100, 26.0→2600

# минимально поддерживаемая версия: 10.13 High Sierra
if [ "$OS_NUM" -lt 1013 ]; then
    err "Требуется macOS 10.13 (High Sierra) или новее. Обнаружена: $OS_VER"
    exit 1
fi

os_at_least() { [ "$OS_NUM" -ge "$1" ]; }

# --------------------------------------------------------------------------
# Права root и определение «настоящего» пользователя
# --------------------------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
    err "Скрипт нужно запускать с правами администратора."
    warn "Выполните: sudo bash \"$0\""
    exit 1
fi

REAL_USER="${SUDO_USER:-}"
if [ -z "$REAL_USER" ] || [ "$REAL_USER" = "root" ]; then
    REAL_USER="$(stat -f%Su /dev/console 2>/dev/null)"
fi
[ -n "$REAL_USER" ] || REAL_USER="root"
REAL_HOME="$(dscl . -read "/Users/$REAL_USER" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"
[ -n "$REAL_HOME" ] || REAL_HOME="/Users/$REAL_USER"
[ -d "$REAL_HOME" ] || REAL_HOME="$HOME"

# --------------------------------------------------------------------------
# Архитектура
# --------------------------------------------------------------------------
ARCH=""
detect_architecture() {
    local a
    a="$(uname -m)"
    # под Rosetta uname -m возвращает x86_64 — уточняем через sysctl
    if [ "$a" = "x86_64" ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = "1" ]; then
        a="arm64"
    fi
    case "$a" in
        x86_64|i386) ARCH="x64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *) err "Неподдерживаемая архитектура: $a"; return 1 ;;
    esac
    return 0
}

# --------------------------------------------------------------------------
# Загрузка и распаковка
# --------------------------------------------------------------------------
download_file() {
    local url="$1" output="$2"
    if ! command -v curl >/dev/null 2>&1; then
        err "curl не найден."
        return 1
    fi
    # --fail: не сохранять HTML страницы ошибок как «успешную» загрузку
    curl -fL --retry 3 --retry-delay 2 --connect-timeout 30 --progress-bar "$url" -o "$output"
}

# Распаковка zip без зависимости от unzip: ditto и tar есть в любой macOS
extract_zip() {
    local zip="$1" dest="$2"
    if command -v ditto >/dev/null 2>&1; then
        ditto -x -k "$zip" "$dest" && return 0
    fi
    if command -v unzip >/dev/null 2>&1; then
        unzip -q -o "$zip" -d "$dest" && return 0
    fi
    tar -xf "$zip" -C "$dest" 2>/dev/null && return 0
    return 1
}

# Снять карантин Gatekeeper и подписать ad-hoc (обязательно для Apple Silicon)
fix_binary() {
    local f="$1"
    [ -f "$f" ] || return 0
    chmod 755 "$f" 2>/dev/null
    xattr -dr com.apple.quarantine "$f" 2>/dev/null
    xattr -dr com.apple.provenance "$f" 2>/dev/null
    if [ "$ARCH" = "arm64" ] && command -v codesign >/dev/null 2>&1; then
        if ! codesign -v "$f" >/dev/null 2>&1; then
            codesign --force --sign - "$f" >/dev/null 2>&1
        fi
    fi
}

# --------------------------------------------------------------------------
# Память и RAM-диск
# --------------------------------------------------------------------------
vm_stat_field() {
    # $1 — ключ вместе с двоеточием, например "Pages free:"
    vm_stat 2>/dev/null | awk -v key="$1" '
        index($0, key) == 1 { v = $NF; gsub(/[^0-9]/, "", v); print v; exit }'
}

get_page_size() {
    local ps
    # размер страницы берём из шапки vm_stat (4096 на Intel, 16384 на Apple Silicon)
    ps="$(vm_stat 2>/dev/null | awk -F'page size of ' 'NR==1 && NF>1 { split($2, a, " "); print a[1]; exit }')"
    ps="$(digits_only "$ps")"
    [ -n "$ps" ] || ps="$(digits_only "$(sysctl -n hw.pagesize 2>/dev/null)")"
    [ -n "$ps" ] || ps=4096
    printf '%s' "$ps"
}

check_available_memory() {
    local page_size free_p inactive_p purge_p spec_p total avail_bytes
    page_size="$(get_page_size)"
    free_p="$(vm_stat_field 'Pages free:')"
    inactive_p="$(vm_stat_field 'Pages inactive:')"
    purge_p="$(vm_stat_field 'Pages purgeable:')"
    spec_p="$(vm_stat_field 'Pages speculative:')"
    free_p=${free_p:-0}; inactive_p=${inactive_p:-0}
    purge_p=${purge_p:-0}; spec_p=${spec_p:-0}

    total=$(( free_p + inactive_p + purge_p + spec_p ))
    avail_bytes=$(( total * page_size ))
    printf '%s' $(( avail_bytes / 1073741824 ))
}

total_memory_gb() {
    local m
    m="$(digits_only "$(sysctl -n hw.memsize 2>/dev/null)")"
    [ -n "$m" ] || m=0
    printf '%s' $(( m / 1073741824 ))
}

# Результат кладём в глобальную переменную: вывод функции нельзя смешивать
# с интерактивными вопросами (иначе $(...) проглатывает весь диалог).
RAMDISK_SIZE_GB=""
setup_ramdisk() {
    RAMDISK_SIZE_GB=""
    local available_gb total_gb max_gb user_size
    available_gb="$(check_available_memory)"
    total_gb="$(total_memory_gb)"

    plain ""
    plain "=========================================="
    plain "  Настройка RAM-диска"
    plain "=========================================="
    info "Всего памяти: ${total_gb} GB, доступно (приблизительно): ${available_gb} GB"

    if [ "$available_gb" -lt 2 ]; then
        warn "Свободно менее 2 GB памяти. RAM-диск не будет создан."
        plain ""
        return 0
    fi

    max_gb=$(( available_gb - 1 ))
    # не отдаём под RAM-диск больше половины физической памяти
    if [ "$total_gb" -gt 0 ] && [ "$max_gb" -gt $(( total_gb / 2 )) ]; then
        max_gb=$(( total_gb / 2 ))
    fi
    [ "$max_gb" -ge 1 ] || max_gb=1

    warn "Вы можете указать размер RAM-диска от 1 до ${max_gb} GB."
    warn "(остальная память останется системе)"
    plain ""
    ask "Введите размер RAM-диска в GB (1-${max_gb}) или нажмите Enter чтобы пропустить: " user_size

    if [ -z "$user_size" ]; then
        warn "RAM-диск не будет создан"
        plain ""
        return 0
    fi
    case "$user_size" in
        ''|*[!0-9]*) err "Некорректный ввод. RAM-диск не будет создан."; plain ""; return 0 ;;
    esac
    if [ "$user_size" -lt 1 ] || [ "$user_size" -gt "$max_gb" ]; then
        err "Размер должен быть от 1 до ${max_gb} GB. RAM-диск не будет создан."
        plain ""
        return 0
    fi

    RAMDISK_SIZE_GB="$user_size"
    ok "RAM-диск будет создан размером: ${RAMDISK_SIZE_GB} GB"
    plain ""
    return 0
}

create_ramdisk() {
    local size_gb="$1" blocks device fmt created=0
    [ -n "$size_gb" ] || return 1

    if [ -d "$RAMDISK_PATH" ]; then
        warn "RAM-диск $RAMDISK_PATH уже существует"
        return 0
    fi

    blocks=$(( size_gb * 1024 * 1024 * 1024 / 512 ))
    info "Создание RAM-диска размером ${size_gb} GB..."

    device="$(hdiutil attach -nomount ram://$blocks 2>/dev/null | head -n 1 | tr -d '[:space:]')"
    if [ -z "$device" ]; then
        err "Ошибка создания RAM-диска"
        return 1
    fi

    # HFS+ работает везде; APFS — запасной вариант для новых систем
    for fmt in "HFS+" "JHFS+" "APFS"; do
        if diskutil erasevolume "$fmt" "$RAMDISK_NAME" "$device" >/dev/null 2>&1; then
            created=1
            break
        fi
    done

    if [ "$created" -eq 1 ] && [ -d "$RAMDISK_PATH" ]; then
        chmod 1777 "$RAMDISK_PATH" 2>/dev/null
        ok "RAM-диск успешно создан: $RAMDISK_PATH"
        return 0
    fi

    err "Ошибка форматирования RAM-диска"
    hdiutil detach "$device" -force >/dev/null 2>&1
    return 1
}

remove_ramdisk() {
    local device
    [ -d "$RAMDISK_PATH" ] || return 0
    warn "Удаление RAM-диска..."
    device="$(diskutil info "$RAMDISK_PATH" 2>/dev/null | awk -F': *' '/Device Node/ {print $2}' | tr -d '[:space:]')"
    diskutil unmount force "$RAMDISK_PATH" >/dev/null 2>&1
    if [ -n "$device" ]; then
        hdiutil detach "$device" -force >/dev/null 2>&1
    fi
    ok "RAM-диск удален"
}

create_ramdisk_script() {
    local size_gb="$1" blocks
    blocks=$(( size_gb * 1024 * 1024 * 1024 / 512 ))

    cat > "$RAMDISK_SH" << EOF
#!/bin/bash
# Скрипт создания RAM-диска для Vidaa (создаётся установщиком)
RAMDISK_NAME="$RAMDISK_NAME"
RAMDISK_PATH="$RAMDISK_PATH"
BLOCKS=$blocks

[ -d "\$RAMDISK_PATH" ] && exit 0

DEVICE=\$(hdiutil attach -nomount ram://\$BLOCKS 2>/dev/null | head -n 1 | tr -d '[:space:]')
[ -n "\$DEVICE" ] || exit 1

for FMT in "HFS+" "JHFS+" "APFS"; do
    if diskutil erasevolume "\$FMT" "\$RAMDISK_NAME" "\$DEVICE" >/dev/null 2>&1; then
        chmod 1777 "\$RAMDISK_PATH" 2>/dev/null
        exit 0
    fi
done

hdiutil detach "\$DEVICE" -force >/dev/null 2>&1
exit 1
EOF
    chmod 755 "$RAMDISK_SH"
}

# --------------------------------------------------------------------------
# Порты и сеть
# --------------------------------------------------------------------------
check_port() {
    local port="$1"
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        return 1   # занят
    fi
    return 0       # свободен
}

get_free_port() {
    local port=3000
    while ! check_port "$port"; do
        port=$(( port + 1 ))
        if [ "$port" -gt 65535 ]; then
            printf '%s' "0"
            return 1
        fi
    done
    printf '%s' "$port"
}

get_lan_ip() {
    local iface ip
    iface="$(route -n get default 2>/dev/null | awk '/interface:/ {print $2; exit}')"
    if [ -n "$iface" ]; then
        ip="$(ipconfig getifaddr "$iface" 2>/dev/null)"
        [ -n "$ip" ] && { printf '%s' "$ip"; return 0; }
    fi
    for iface in $(networksetup -listallhardwareports 2>/dev/null | awk '/Device:/ {print $2}'); do
        ip="$(ipconfig getifaddr "$iface" 2>/dev/null)"
        [ -n "$ip" ] && { printf '%s' "$ip"; return 0; }
    done
    ip="$(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2; exit}')"
    printf '%s' "${ip:-127.0.0.1}"
}

# --------------------------------------------------------------------------
# Firewall
# --------------------------------------------------------------------------
allow_app_firewall() {
    local fw="/usr/libexec/ApplicationFirewall/socketfilterfw"
    [ -x "$fw" ] || return 0
    if "$fw" --getglobalstate 2>/dev/null | grep -qi "enabled"; then
        "$fw" --add "$BIN_PATH" >/dev/null 2>&1
        "$fw" --unblockapp "$BIN_PATH" >/dev/null 2>&1
        ok "Приложение добавлено в исключения Application Firewall"
    fi
}

configure_firewall() {
    local port="$1" answer

    warn "Настройка пакетного фильтра (pf) для порта $port..."

    mkdir -p /etc/pf.anchors
    cat > "$PF_ANCHOR_FILE" << EOF
# Vidaa Server Rules (создано установщиком)
pass in quick proto tcp from any to any port $port
EOF
    chmod 644 "$PF_ANCHOR_FILE"

    if ! grep -q "anchor \"$PF_ANCHOR\"" "$PF_CONF" 2>/dev/null; then
        [ -f "$PF_CONF" ] || printf '%s\n' "# PF configuration file" > "$PF_CONF"
        cp "$PF_CONF" "${PF_CONF}.vidaa.bak" 2>/dev/null
        {
            printf '%s\n' "anchor \"$PF_ANCHOR\""
            printf '%s\n' "load anchor \"$PF_ANCHOR\" from \"$PF_ANCHOR_FILE\""
        } >> "$PF_CONF"
    fi

    if ! pfctl -s info 2>/dev/null | grep -q "Status: Enabled"; then
        warn "Пакетный фильтр (pf) сейчас выключен."
        ask "Включить pf и применить правила? (y/n): " answer
        if is_yes "$answer"; then
            pfctl -e >/dev/null 2>&1
        else
            warn "pf не включен. Правило записано и применится, если вы включите pf позже."
            allow_app_firewall
            return 0
        fi
    fi

    if pfctl -f "$PF_CONF" >/dev/null 2>&1; then
        ok "Firewall успешно настроен для порта $port"
        allow_app_firewall
        return 0
    fi

    err "Не удалось применить правила pf (проверьте: sudo pfctl -f $PF_CONF)"
    allow_app_firewall
    return 1
}

remove_firewall_rules() {
    local fw="/usr/libexec/ApplicationFirewall/socketfilterfw"
    warn "Удаление правил firewall для Vidaa..."
    pfctl -a "$PF_ANCHOR" -F all >/dev/null 2>&1
    if [ -f "$PF_CONF" ]; then
        sed -i '' "/anchor \"$PF_ANCHOR\"/d" "$PF_CONF" 2>/dev/null
        sed -i '' "/load anchor \"$PF_ANCHOR\"/d" "$PF_CONF" 2>/dev/null
        pfctl -f "$PF_CONF" >/dev/null 2>&1
    fi
    rm -f "$PF_ANCHOR_FILE"
    [ -x "$fw" ] && "$fw" --remove "$BIN_PATH" >/dev/null 2>&1
    ok "Правила firewall удалены"
}

# --------------------------------------------------------------------------
# launchd
# --------------------------------------------------------------------------
# launchctl load/unload объявлены устаревшими начиная с 10.10; на свежих
# системах используем современный синтаксис bootstrap/bootout с откатом.
svc_stop() {
    local label="$1" plist="$2"
    if os_at_least 1011; then
        launchctl bootout "system/$label" >/dev/null 2>&1
    fi
    launchctl unload -w "$plist" >/dev/null 2>&1
    return 0
}

svc_start() {
    local label="$1" plist="$2"
    [ -f "$plist" ] || return 1
    chown root:wheel "$plist" 2>/dev/null
    chmod 644 "$plist" 2>/dev/null
    if os_at_least 1011; then
        launchctl enable "system/$label" >/dev/null 2>&1
        launchctl bootstrap system "$plist" >/dev/null 2>&1 && return 0
    fi
    launchctl load -w "$plist" >/dev/null 2>&1 && return 0
    return 1
}

svc_running() {
    local label="$1"
    if os_at_least 1011; then
        launchctl print "system/$label" >/dev/null 2>&1 && return 0
    fi
    launchctl list 2>/dev/null | grep -q "$label" && return 0
    return 1
}

create_start_script() {
    cat > "$START_SH" << EOF
#!/bin/bash
# Обёртка запуска Vidaa (создаётся установщиком)
[ -x "$RAMDISK_SH" ] && "$RAMDISK_SH" >/dev/null 2>&1
exec "$BIN_PATH"
EOF
    chmod 755 "$START_SH"
}

create_launchd_service() {
    local port="$1"

    create_start_script

    cat > "$SERVER_PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$SERVER_LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$START_SH</string>
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
    <string>$INSTALL_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>/var/log/vidaa.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/vidaa.log</string>
</dict>
</plist>
EOF

    svc_stop "$SERVER_LABEL" "$SERVER_PLIST"
    svc_start "$SERVER_LABEL" "$SERVER_PLIST"
}

create_ramdisk_service() {
    cat > "$RAMDISK_PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$RAMDISK_LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$RAMDISK_SH</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>
EOF
    svc_stop "$RAMDISK_LABEL" "$RAMDISK_PLIST"
    svc_start "$RAMDISK_LABEL" "$RAMDISK_PLIST"
}

# Удаление LaunchAgent'ов от предыдущих версий установщика
remove_legacy_agents() {
    local d p
    for d in "$REAL_HOME" "/var/root" "/Users/$REAL_USER"; do
        p="$d/Library/LaunchAgents/com.vidaa.server.plist"
        [ -f "$p" ] || continue
        launchctl unload "$p" >/dev/null 2>&1
        rm -f "$p"
    done
}

read_installed_port() {
    local p=""
    if [ -f "$CONF_FILE" ]; then
        p="$(awk -F= '/^VIDAA_PORT=/ {print $2; exit}' "$CONF_FILE" | tr -cd '0-9')"
    fi
    if [ -z "$p" ] && [ -f "$SERVER_PLIST" ]; then
        p="$(/usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:PORT" "$SERVER_PLIST" 2>/dev/null | tr -cd '0-9')"
    fi
    printf '%s' "$p"
}

save_conf() {
    cat > "$CONF_FILE" << EOF
VIDAA_PORT=$1
VIDAA_RAMDISK_GB=$2
VIDAA_ARCH=$ARCH
VIDAA_OS=$OS_VER
EOF
    chmod 644 "$CONF_FILE"
}

# --------------------------------------------------------------------------
# Компоненты: приложение, ffmpeg, yt-dlp
# --------------------------------------------------------------------------
install_app_binary() {
    local app_file tmpdir
    if [ "$ARCH" = "x64" ]; then
        app_file="TorrStream-macos-x64"
    else
        app_file="TorrStream-macos-arm64"
    fi

    tmpdir="$INSTALL_DIR/.dl"
    rm -rf "$tmpdir"; mkdir -p "$tmpdir"

    plain "Скачивание архива приложения..."
    if ! download_file "$APP_ZIP_URL" "$tmpdir/TorrStream-macos.zip"; then
        err "Ошибка при скачивании архива"
        rm -rf "$tmpdir"
        return 1
    fi

    plain "Распаковка архива..."
    if ! extract_zip "$tmpdir/TorrStream-macos.zip" "$INSTALL_DIR"; then
        err "Ошибка при распаковке архива"
        rm -rf "$tmpdir"
        return 1
    fi
    rm -rf "$tmpdir"

    if [ ! -f "$INSTALL_DIR/$app_file" ]; then
        err "Бинарник $app_file не найден в архиве"
        warn "Доступные файлы:"
        ls -la "$INSTALL_DIR"
        return 1
    fi

    rm -f "$BIN_PATH"
    mv "$INSTALL_DIR/$app_file" "$BIN_PATH"
    # лишние бинарники другой архитектуры не нужны
    rm -f "$INSTALL_DIR/TorrStream-macos-x64" "$INSTALL_DIR/TorrStream-macos-arm64"
    fix_binary "$BIN_PATH"
    ok "Установлен бинарник: $app_file"
    return 0
}

install_ffmpeg() {
    local url tmpdir found
    mkdir -p "$INSTALL_DIR/ffmpeg"

    if [ "$ARCH" = "x64" ]; then
        url="https://github.com/jellyfin/jellyfin-ffmpeg/releases/download/${FFMPEG_TAG}/jellyfin-ffmpeg_${FFMPEG_VER}_portable_mac64-gpl.tar.xz"
    else
        url="https://github.com/jellyfin/jellyfin-ffmpeg/releases/download/${FFMPEG_TAG}/jellyfin-ffmpeg_${FFMPEG_VER}_portable_macarm64-gpl.tar.xz"
    fi

    # распаковываем во временный каталог, иначе find находит уже скопированные файлы
    tmpdir="$INSTALL_DIR/.ffmpeg-tmp"
    rm -rf "$tmpdir"; mkdir -p "$tmpdir"

    plain "Скачивание ffmpeg..."
    if ! download_file "$url" "$tmpdir/jellyfin-ffmpeg.tar.xz"; then
        err "Ошибка при скачивании ffmpeg"
        rm -rf "$tmpdir"
        return 1
    fi

    plain "Распаковка ffmpeg..."
    if ! tar -xf "$tmpdir/jellyfin-ffmpeg.tar.xz" -C "$tmpdir"; then
        err "Ошибка при распаковке ffmpeg"
        rm -rf "$tmpdir"
        return 1
    fi

    for found in ffmpeg ffprobe; do
        local src
        src="$(find "$tmpdir" -type f -name "$found" -perm -u+x 2>/dev/null | head -n 1)"
        [ -n "$src" ] || src="$(find "$tmpdir" -type f -name "$found" 2>/dev/null | head -n 1)"
        if [ -n "$src" ]; then
            cp -f "$src" "$INSTALL_DIR/ffmpeg/$found"
            fix_binary "$INSTALL_DIR/ffmpeg/$found"
        fi
    done
    rm -rf "$tmpdir"

    if [ ! -x "$INSTALL_DIR/ffmpeg/ffmpeg" ]; then
        err "ffmpeg не найден в архиве"
        return 1
    fi

    # проверяем, что сборка запускается на этой версии macOS
    if ! "$INSTALL_DIR/ffmpeg/ffmpeg" -version >/dev/null 2>&1; then
        warn "Скачанный ffmpeg не запускается на macOS $OS_VER."
        if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
            warn "Использую системный ffmpeg из PATH."
            cp -f "$(command -v ffmpeg)"  "$INSTALL_DIR/ffmpeg/ffmpeg"
            cp -f "$(command -v ffprobe)" "$INSTALL_DIR/ffmpeg/ffprobe"
            chmod 755 "$INSTALL_DIR/ffmpeg/ffmpeg" "$INSTALL_DIR/ffmpeg/ffprobe"
        else
            err "Установите ffmpeg вручную (например: brew install ffmpeg) и скопируйте"
            err "ffmpeg и ffprobe в $INSTALL_DIR/ffmpeg/"
            return 1
        fi
    fi

    ok "ffmpeg установлен"
    return 0
}

install_ytdlp() {
    local name url dest
    mkdir -p "$INSTALL_DIR/ffmpeg"
    dest="$INSTALL_DIR/ffmpeg/yt-dlp"

    # сборка yt-dlp_macos требует macOS 10.15+, для старых систем есть legacy
    if os_at_least 1015; then
        name="yt-dlp_macos"
    else
        name="yt-dlp_macos_legacy"
    fi

    plain "Скачивание yt-dlp ($name)..."
    url="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_TAG}/${name}"
    if ! download_file "$url" "$dest"; then
        warn "Не удалось скачать закреплённую версию, пробую latest..."
        url="https://github.com/yt-dlp/yt-dlp/releases/latest/download/${name}"
        if ! download_file "$url" "$dest"; then
            err "Ошибка при скачивании yt-dlp"
            return 1
        fi
    fi

    fix_binary "$dest"
    ok "yt-dlp установлен"
    return 0
}

print_service_hints() {
    plain ""
    warn "Управление сервисом:"
    if os_at_least 1011; then
        plain "  sudo launchctl bootout system/$SERVER_LABEL              # остановить"
        plain "  sudo launchctl bootstrap system $SERVER_PLIST            # запустить"
        plain "  sudo launchctl kickstart -k system/$SERVER_LABEL         # перезапустить"
    else
        plain "  sudo launchctl unload $SERVER_PLIST   # остановить"
        plain "  sudo launchctl load -w $SERVER_PLIST  # запустить"
    fi
    plain "  tail -f /var/log/vidaa.log                                   # логи"
}

# --------------------------------------------------------------------------
# Установка
# --------------------------------------------------------------------------
install_vidaa() {
    local selected_port user_port answer ip_addr

    ok "Начинаем установку Vidaa для macOS $OS_VER..."
    detect_architecture || exit 1
    ok "Обнаружена архитектура: $ARCH"

    mkdir -p "$INSTALL_DIR"
    cd "$INSTALL_DIR" || exit 1

    install_app_binary || exit 1
    install_ffmpeg     || exit 1
    install_ytdlp      || exit 1

    # RAM-диск (до выбора порта)
    setup_ramdisk
    if [ -n "$RAMDISK_SIZE_GB" ]; then
        if create_ramdisk "$RAMDISK_SIZE_GB"; then
            create_ramdisk_script "$RAMDISK_SIZE_GB"
            create_ramdisk_service
        else
            RAMDISK_SIZE_GB=""
        fi
    fi

    # Порт
    selected_port=""
    while true; do
        ask "${YELLOW}Введите порт для Vidaa сервера (Enter — выбрать автоматически): ${NC}" user_port
        if [ -z "$user_port" ]; then
            selected_port="$(get_free_port)"
            if [ -z "$selected_port" ] || [ "$selected_port" = "0" ]; then
                err "Нет свободных портов в диапазоне 3000-65535"
                exit 1
            fi
            ok "Выбран свободный порт: $selected_port"
            break
        fi
        case "$user_port" in
            ''|*[!0-9]*) err "Введите корректный номер порта (1-65535)"; continue ;;
        esac
        if [ "$user_port" -lt 1 ] || [ "$user_port" -gt 65535 ]; then
            err "Введите корректный номер порта (1-65535)"
            continue
        fi
        if check_port "$user_port"; then
            selected_port="$user_port"
            ok "Порт $selected_port доступен"
            break
        fi
        err "Порт $user_port уже занят. Выберите другой."
    done

    remove_legacy_agents
    if ! create_launchd_service "$selected_port"; then
        err "Ошибка при создании launchd сервиса"
        err "Подробности: launchctl print system/$SERVER_LABEL"
        exit 1
    fi
    save_conf "$selected_port" "$RAMDISK_SIZE_GB"

    ask "${YELLOW}Открыть порт $selected_port в firewall для доступа из сети? (y/n): ${NC}" answer
    if is_yes "$answer"; then
        configure_firewall "$selected_port"
    else
        warn "Firewall не настроен. Сервер будет доступен только локально."
        allow_app_firewall
    fi

    ip_addr="$(get_lan_ip)"
    plain ""
    ok "========================================"
    ok "Установка завершена успешно!"
    ok "Vidaa сервер доступен:"
    info "  Локально: http://localhost:$selected_port"
    info "  В сети:   http://$ip_addr:$selected_port"
    if [ -n "$RAMDISK_SIZE_GB" ]; then
        ok "RAM-диск (${RAMDISK_SIZE_GB} GB) создан и будет пересоздаваться при загрузке"
    fi
    ok "========================================"
    if ! svc_running "$SERVER_LABEL"; then
        warn "Сервис пока не отображается как запущенный — проверьте /var/log/vidaa.log"
    fi
    print_service_hints
}

# --------------------------------------------------------------------------
# Обновление
# --------------------------------------------------------------------------
update_vidaa() {
    local answer port ip_addr ramdisk_info

    ok "Начинаем обновление Vidaa..."
    if [ ! -d "$INSTALL_DIR" ]; then
        err "Директория $INSTALL_DIR не существует. Сначала выполните установку."
        exit 1
    fi

    detect_architecture || exit 1
    ok "Обнаружена архитектура: $ARCH"

    plain ""
    plain "=========================================="
    plain "  Проверка RAM-диска"
    plain "=========================================="
    RAMDISK_SIZE_GB=""
    if [ -d "$RAMDISK_PATH" ]; then
        ok "RAM-диск $RAMDISK_PATH уже существует"
        ramdisk_info="$(diskutil info "$RAMDISK_PATH" 2>/dev/null | awk -F': *' '/Total Space|Volume Total Space/ {print $2; exit}')"
        [ -n "$ramdisk_info" ] && info "Размер: $ramdisk_info"
    else
        warn "RAM-диск $RAMDISK_PATH не обнаружен"
        warn "RAM-диск ускоряет работу с HLS-сегментами и снижает износ SSD."
        ask "Создать RAM-диск? (y/n): " answer
        if is_yes "$answer"; then
            setup_ramdisk
            if [ -n "$RAMDISK_SIZE_GB" ]; then
                if create_ramdisk "$RAMDISK_SIZE_GB"; then
                    create_ramdisk_script "$RAMDISK_SIZE_GB"
                    create_ramdisk_service
                else
                    RAMDISK_SIZE_GB=""
                fi
            fi
        else
            warn "RAM-диск не будет создан"
        fi
    fi
    plain ""

    cd "$INSTALL_DIR" || exit 1

    plain "Остановка сервиса..."
    svc_stop "$SERVER_LABEL" "$SERVER_PLIST"

    rm -rf "$INSTALL_DIR/public"
    install_app_binary || exit 1
    install_ytdlp      || exit 1

    # ffmpeg переустанавливаем только если его нет или он не запускается
    if [ ! -x "$INSTALL_DIR/ffmpeg/ffmpeg" ] || ! "$INSTALL_DIR/ffmpeg/ffmpeg" -version >/dev/null 2>&1; then
        install_ffmpeg || exit 1
    else
        fix_binary "$INSTALL_DIR/ffmpeg/ffmpeg"
        fix_binary "$INSTALL_DIR/ffmpeg/ffprobe"
    fi

    port="$(read_installed_port)"
    if [ -z "$port" ]; then
        warn "Не удалось определить сохранённый порт, подбираю свободный..."
        port="$(get_free_port)"
    fi

    remove_legacy_agents
    plain "Перезапуск сервиса..."
    if ! create_launchd_service "$port"; then
        err "Ошибка при перезапуске сервиса"
        exit 1
    fi

    local saved_ramdisk="$RAMDISK_SIZE_GB"
    if [ -z "$saved_ramdisk" ] && [ -f "$CONF_FILE" ]; then
        saved_ramdisk="$(awk -F= '/^VIDAA_RAMDISK_GB=/ {print $2; exit}' "$CONF_FILE" | tr -cd '0-9')"
    fi
    save_conf "$port" "$saved_ramdisk"

    ip_addr="$(get_lan_ip)"
    ok "========================================"
    ok "Обновление завершено успешно!"
    info "  Локально: http://localhost:$port"
    info "  В сети:   http://$ip_addr:$port"
    if [ -d "$RAMDISK_PATH" ]; then
        ok "RAM-диск активен"
    fi
    ok "========================================"
    print_service_hints
}

# --------------------------------------------------------------------------
# Удаление
# --------------------------------------------------------------------------
uninstall_vidaa() {
    local confirm config_dir

    warn "Начинаем удаление Vidaa..."
    err "ВНИМАНИЕ: Это действие полностью удалит Vidaa и все его данные!"
    ask "Вы уверены, что хотите продолжить? (y/n): " confirm
    if ! is_yes "$confirm"; then
        warn "Удаление отменено."
        return 0
    fi

    plain "Остановка сервисов..."
    svc_stop "$SERVER_LABEL"  "$SERVER_PLIST"
    svc_stop "$RAMDISK_LABEL" "$RAMDISK_PLIST"
    rm -f "$SERVER_PLIST" "$RAMDISK_PLIST"
    remove_legacy_agents

    remove_ramdisk
    remove_firewall_rules

    if [ -d "$INSTALL_DIR" ]; then
        plain "Удаление $INSTALL_DIR..."
        rm -rf "$INSTALL_DIR"
    else
        warn "Директория $INSTALL_DIR не найдена"
    fi

    rm -f /var/log/vidaa.log /tmp/vidaa.log

    config_dir="$REAL_HOME/.videoloop-server"
    if [ -d "$config_dir" ]; then
        plain "Удаление $config_dir..."
        rm -rf "$config_dir"
    else
        warn "Директория $config_dir не найдена"
    fi

    ok "========================================"
    ok "Удаление Vidaa завершено успешно!"
    ok "========================================"
}

# --------------------------------------------------------------------------
# Проверка обязательных утилит
# --------------------------------------------------------------------------
MISSING=""
for cmd in curl tar lsof hdiutil diskutil launchctl sw_vers vm_stat sysctl awk sed; do
    command -v "$cmd" >/dev/null 2>&1 || MISSING="$MISSING $cmd"
done
if [ -n "$MISSING" ]; then
    err "Не найдены обязательные утилиты:$MISSING"
    exit 1
fi
if ! command -v ditto >/dev/null 2>&1 && ! command -v unzip >/dev/null 2>&1; then
    err "Нужен ditto или unzip для распаковки архива"
    exit 1
fi
command -v pfctl >/dev/null 2>&1 || warn "pfctl не найден — настройка firewall будет недоступна"

# --------------------------------------------------------------------------
# Главное меню
# --------------------------------------------------------------------------
ACTION="$1"
if [ -z "$ACTION" ]; then
    plain "macOS $OS_VER ($(uname -m))"
    plain "Выберите действие:"
    plain "1) Установка"
    plain "2) Обновление"
    plain "3) Удаление"
    ask "Введите номер (1, 2 или 3): " ACTION
fi

case "$ACTION" in
    1|install)   install_vidaa ;;
    2|update)    update_vidaa ;;
    3|uninstall) uninstall_vidaa ;;
    *)
        err "Неверный выбор. Запустите скрипт снова."
        exit 1
        ;;
esac
