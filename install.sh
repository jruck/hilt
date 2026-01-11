#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_step() {
  echo -e "${BLUE}==>${NC} $1"
}

print_success() {
  echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}!${NC} $1"
}

print_error() {
  echo -e "${RED}✗${NC} $1"
}

# Header
echo ""
echo -e "${BLUE}┌─────────────────────────────────────┐${NC}"
echo -e "${BLUE}│${NC}         ${GREEN}Hilt Installation${NC}           ${BLUE}│${NC}"
echo -e "${BLUE}│${NC}   Claude Code Session Manager      ${BLUE}│${NC}"
echo -e "${BLUE}└─────────────────────────────────────┘${NC}"
echo ""

# Detect OS
OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM="macos" ;;
  Linux)  PLATFORM="linux" ;;
  *)      print_error "Unsupported OS: $OS"; exit 1 ;;
esac

print_step "Detected platform: $PLATFORM"

# Check Node.js
print_step "Checking Node.js..."
if ! command -v node &> /dev/null; then
  print_error "Node.js is not installed"
  echo ""
  echo "Please install Node.js 18.18 or later:"
  if [ "$PLATFORM" = "macos" ]; then
    echo "  brew install node"
  else
    echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    echo "  sudo apt-get install -y nodejs"
  fi
  echo ""
  echo "Or use nvm: https://github.com/nvm-sh/nvm"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2)
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)

if [ "$NODE_MAJOR" -lt 18 ]; then
  print_error "Node.js version $NODE_VERSION is too old"
  echo "Hilt requires Node.js 18.18 or later"
  exit 1
fi

print_success "Node.js $NODE_VERSION"

# Check npm
print_step "Checking npm..."
if ! command -v npm &> /dev/null; then
  print_error "npm is not installed"
  exit 1
fi
print_success "npm $(npm -v)"

# Check build tools (required for node-pty)
print_step "Checking build tools..."

if [ "$PLATFORM" = "macos" ]; then
  if ! xcode-select -p &> /dev/null; then
    print_warning "Xcode Command Line Tools not found"
    echo ""
    echo "Installing Xcode Command Line Tools..."
    echo "A dialog may appear - click 'Install' to continue."
    echo ""
    xcode-select --install 2>/dev/null || true

    # Wait for installation
    echo "Waiting for Xcode CLI tools installation..."
    until xcode-select -p &> /dev/null; do
      sleep 5
    done
    print_success "Xcode Command Line Tools installed"
  else
    print_success "Xcode Command Line Tools"
  fi
else
  # Linux - check for build-essential
  if ! command -v gcc &> /dev/null; then
    print_warning "Build tools not found"
    echo ""
    echo "Installing build-essential..."
    sudo apt-get update && sudo apt-get install -y build-essential python3
    print_success "Build tools installed"
  else
    print_success "Build tools (gcc)"
  fi
fi

# Get script directory (works for both direct run and curl | bash)
if [ -f "package.json" ] && grep -q '"name": "hilt"' package.json 2>/dev/null; then
  HILT_DIR="$(pwd)"
  print_step "Using current directory: $HILT_DIR"
else
  # Check if we're in the hilt directory but package.json check failed
  print_error "Please run this script from the hilt directory"
  echo ""
  echo "  cd /path/to/hilt"
  echo "  ./install.sh"
  echo ""
  exit 1
fi

# Install dependencies
print_step "Installing dependencies..."
echo ""

# Set environment variables for node-pty compilation on macOS
if [ "$PLATFORM" = "macos" ]; then
  export SDKROOT=$(xcrun --show-sdk-path 2>/dev/null || echo "")
  if [ -n "$SDKROOT" ]; then
    export CXXFLAGS="-isysroot $SDKROOT -I$SDKROOT/usr/include/c++/v1"
  fi
fi

if npm install; then
  print_success "Dependencies installed"
else
  print_error "Failed to install dependencies"
  echo ""
  echo "Common fixes:"
  echo "  1. Delete node_modules and try again:"
  echo "     rm -rf node_modules && ./install.sh"
  echo ""
  echo "  2. Clear npm cache:"
  echo "     npm cache clean --force"
  echo ""
  if [ "$PLATFORM" = "macos" ]; then
    echo "  3. Ensure Xcode CLI tools are up to date:"
    echo "     sudo rm -rf /Library/Developer/CommandLineTools"
    echo "     xcode-select --install"
  fi
  exit 1
fi

# Create data directory
print_step "Creating data directory..."
mkdir -p "$HOME/.hilt/data"
print_success "Created ~/.hilt/data"

# Create start script if it doesn't exist
if [ ! -f "scripts/start.sh" ]; then
  print_step "Creating start script..."
  mkdir -p scripts
  cat > scripts/start.sh << 'STARTSCRIPT'
#!/bin/bash
# Hilt start script - handles port detection and clean startup

cd "$(dirname "$0")/.."

# Kill any existing Hilt processes
pkill -f "next dev.*hilt" 2>/dev/null || true
pkill -f "ws-server" 2>/dev/null || true
pkill -f "event-server" 2>/dev/null || true
sleep 1

# Start the servers
echo "Starting Hilt..."
npm run dev:all
STARTSCRIPT
  chmod +x scripts/start.sh
  print_success "Created scripts/start.sh"
fi

# Verify installation
print_step "Verifying installation..."
if [ -d "node_modules" ] && [ -d "node_modules/node-pty" ]; then
  print_success "Installation verified"
else
  print_error "Installation may be incomplete"
  exit 1
fi

# Shell alias setup
echo ""
print_step "Shell configuration"
echo ""

SHELL_NAME=$(basename "$SHELL")
case "$SHELL_NAME" in
  zsh)  RC_FILE="$HOME/.zshrc" ;;
  bash) RC_FILE="$HOME/.bashrc" ;;
  *)    RC_FILE="" ;;
esac

ALIAS_LINE="alias hilt='cd \"$HILT_DIR\" && npm run dev:all'"

if [ -n "$RC_FILE" ]; then
  if grep -q "alias hilt=" "$RC_FILE" 2>/dev/null; then
    print_success "Shell alias already configured"
  else
    echo "Would you like to add a 'hilt' command to your shell?"
    echo ""
    echo "  This adds to $RC_FILE:"
    echo "  $ALIAS_LINE"
    echo ""
    read -p "Add alias? [y/N] " -n 1 -r
    echo ""

    if [[ $REPLY =~ ^[Yy]$ ]]; then
      echo "" >> "$RC_FILE"
      echo "# Hilt - Claude Code Session Manager" >> "$RC_FILE"
      echo "$ALIAS_LINE" >> "$RC_FILE"
      print_success "Added 'hilt' alias to $RC_FILE"
      echo ""
      echo "Run 'source $RC_FILE' or open a new terminal to use it."
    fi
  fi
fi

# Done!
echo ""
echo -e "${GREEN}┌─────────────────────────────────────┐${NC}"
echo -e "${GREEN}│${NC}     Installation complete!          ${GREEN}│${NC}"
echo -e "${GREEN}└─────────────────────────────────────┘${NC}"
echo ""
echo "To start Hilt:"
echo ""
echo "  cd $HILT_DIR"
echo "  npm run dev:all"
echo ""
if [ -n "$RC_FILE" ] && grep -q "alias hilt=" "$RC_FILE" 2>/dev/null; then
  echo "Or simply run: hilt"
  echo ""
fi
echo "Then open http://localhost:3000 in your browser"
echo "(If port 3000 is busy, check the terminal for the actual port)"
echo ""
