import { chromium } from '/workspace/pi-desktop-gui/node_modules/playwright/index.mjs';
const launch = chromium.launch.bind(chromium);
chromium.launch = (options) => launch({ ...options, executablePath: '/usr/bin/chromium' });
