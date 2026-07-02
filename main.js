const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const net = require('net');

let mainWindow = null;
let serverInstance = null;

// Find a free port dynamically starting from 3000
function getFreePort(startingPort = 3000) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(getFreePort(startingPort + 1));
      } else {
        reject(err);
      }
    });
    server.listen(startingPort, () => {
      const { port } = server.address();
      server.close(() => {
        resolve(port);
      });
    });
  });
}

async function startApp() {
  try {
    // 1. Find a free port dynamically
    const port = await getFreePort(3000);
    console.log(`Starting local Express backend on port ${port}...`);

    // 2. Set port and host env variables (binding to 127.0.0.1 avoids firewall popups)
    process.env.PORT = port;
    process.env.HOST = '127.0.0.1';
    process.env.ELECTRON_RUNNING = 'true';

    // 3. Require the Express server to start it
    // Note: server.js will run app.listen using our process.env variables
    require('./server.js');

    // 4. Create Electron Window
    createWindow(port);
  } catch (err) {
    console.error('Failed to start application:', err);
    app.quit();
  }
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Scraperis - Scraper & Leads Extractor',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    // Simple sleek icon if present, otherwise default
    icon: path.join(__dirname, 'public', 'images', 'logo.png'),
  });

  // Remove default menus for a premium desktop app look
  Menu.setApplicationMenu(null);

  // Load the running express server URL
  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Electron lifecycle hooks
app.whenReady().then(() => {
  startApp();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      startApp();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
