#!/usr/bin/env sh
# Builds Agent of Empires and installs it for the current user: the binary, the launcher icons and
# a menu entry. Nothing goes outside your home folder and nothing needs sudo.
#
#   ./scripts/install.sh              build and install
#   ./scripts/install.sh --uninstall  remove what the install added (your settings stay)
#
# BIN_DIR (default ~/.local/bin) and XDG_DATA_HOME (default ~/.local/share) change where it goes.
set -eu

APP=agent-of-empires
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BIN_DIR=${BIN_DIR:-$HOME/.local/bin}
DATA_DIR=${XDG_DATA_HOME:-$HOME/.local/share}
DESKTOP_FILE="$DATA_DIR/applications/$APP.desktop"
ICON_SIZES="32 64 128 256 512"

uninstall() {
  rm -f "$BIN_DIR/$APP" "$DESKTOP_FILE"
  for size in $ICON_SIZES; do
    rm -f "$DATA_DIR/icons/hicolor/${size}x${size}/apps/$APP.png"
  done
  echo "Removed. Your map layout and choices stay in ~/.config/dev.fontenele.agent-of-empires and"
  echo "~/.local/share/dev.fontenele.agent-of-empires. If you turned on \"Aprovar pelo painel\", remove the"
  echo "PermissionRequest hook ending in --permission-hook from ~/.claude/settings.json."
}

check_build_deps() {
  if ! command -v cargo >/dev/null 2>&1; then
    echo "Rust is missing: install it from https://rustup.rs and run this again." >&2
    exit 1
  fi
  if command -v pkg-config >/dev/null 2>&1 && ! pkg-config --exists webkit2gtk-4.1; then
    echo "The WebKitGTK headers Tauri builds against are missing. Install them first:" >&2
    echo "  Debian/Ubuntu: sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev build-essential" >&2
    echo "  Fedora:        sudo dnf install webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel" >&2
    echo "  Arch:          sudo pacman -S webkit2gtk-4.1 libappindicator-gtk3 librsvg base-devel" >&2
    exit 1
  fi
}

install_app() {
  check_build_deps
  echo "Building (the first build takes a few minutes)…"
  (cd "$ROOT/src-tauri" && cargo build --release)

  mkdir -p "$BIN_DIR" "$DATA_DIR/applications"
  # Copy to a temp name and rename: replacing a binary that is running would fail otherwise.
  cp "$ROOT/src-tauri/target/release/$APP" "$BIN_DIR/$APP.new"
  chmod 755 "$BIN_DIR/$APP.new"
  mv -f "$BIN_DIR/$APP.new" "$BIN_DIR/$APP"

  for size in $ICON_SIZES; do
    mkdir -p "$DATA_DIR/icons/hicolor/${size}x${size}/apps"
    cp "$ROOT/icons/${size}x${size}/$APP.png" "$DATA_DIR/icons/hicolor/${size}x${size}/apps/$APP.png"
  done

  cat >"$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Agent of Empires
GenericName=Claude Code sessions on an Age of Empires style map
Comment=See what each Claude Code session is doing and jump to it
Exec="$BIN_DIR/$APP"
Icon=$APP
Terminal=false
Categories=Development;
Keywords=claude;agent;empires;pixel;map;sessions;
StartupWMClass=$APP
StartupNotify=true
EOF

  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DATA_DIR/applications" >/dev/null 2>&1 || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$DATA_DIR/icons/hicolor" >/dev/null 2>&1 || true

  echo "Installed $BIN_DIR/$APP. Open \"Agent of Empires\" from your app menu, or run $APP."
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) echo "Note: $BIN_DIR is not on your PATH; the menu entry works anyway." ;;
  esac
}

case "${1:-}" in
  --uninstall) uninstall ;;
  "") install_app ;;
  *)
    echo "Usage: $0 [--uninstall]" >&2
    exit 2
    ;;
esac
