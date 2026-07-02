#!/bin/bash

# =============================================
# ScrapMap - Ubuntu VPS Deployment Script
# =============================================
# Usage: chmod +x deploy.sh && ./deploy.sh
# =============================================

set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   🗺️  ScrapMap - Deployment Script       ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# Step 1: Update system
echo -e "${BLUE}[1/7]${NC} Updating system packages..."
sudo apt update -y && sudo apt upgrade -y

# Step 2: Install Node.js 20 LTS
echo -e "${BLUE}[2/7]${NC} Installing Node.js 20 LTS..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi
echo "  Node.js: $(node --version)"
echo "  npm: $(npm --version)"

# Step 3: Install PM2
echo -e "${BLUE}[3/7]${NC} Installing PM2..."
sudo npm install -g pm2

# Step 4: Install project dependencies
echo -e "${BLUE}[4/7]${NC} Installing project dependencies..."
npm install --production

# Step 5: Install Playwright Chromium + system dependencies
echo -e "${BLUE}[5/7]${NC} Installing Playwright Chromium browser..."
npx playwright install chromium --with-deps

# Step 6: Create logs directory
echo -e "${BLUE}[6/7]${NC} Setting up directories..."
mkdir -p logs

# Step 7: Start/restart with PM2
echo -e "${BLUE}[7/7]${NC} Starting ScrapMap with PM2..."
pm2 delete scrapmap 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup | tail -1 | bash 2>/dev/null || true

echo ""
echo -e "${GREEN}✅ ScrapMap deployed successfully!${NC}"
echo ""
echo "  📍 App running at: http://$(hostname -I | awk '{print $1}'):3000"
echo "  📋 PM2 status:     pm2 status"
echo "  📜 View logs:      pm2 logs scrapmap"
echo "  🔄 Restart:        pm2 restart scrapmap"
echo ""

# Optional: Setup Nginx reverse proxy
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Optional: Setup Nginx reverse proxy?"
echo "Run this manually if you want to serve on port 80:"
echo ""
echo "  sudo apt install -y nginx"
echo "  sudo tee /etc/nginx/sites-available/scrapmap <<'EOF'"
echo "  server {"
echo "      listen 80;"
echo "      server_name your-domain.com;"
echo ""
echo "      location / {"
echo "          proxy_pass http://127.0.0.1:3000;"
echo "          proxy_http_version 1.1;"
echo "          proxy_set_header Upgrade \$http_upgrade;"
echo "          proxy_set_header Connection 'upgrade';"
echo "          proxy_set_header Host \$host;"
echo "          proxy_cache_bypass \$http_upgrade;"
echo "          proxy_set_header X-Real-IP \$remote_addr;"
echo "          proxy_buffering off;"
echo "      }"
echo "  }"
echo "  EOF"
echo ""
echo "  sudo ln -sf /etc/nginx/sites-available/scrapmap /etc/nginx/sites-enabled/"
echo "  sudo nginx -t && sudo systemctl restart nginx"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
