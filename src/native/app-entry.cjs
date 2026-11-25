const { app } = require('electron');

if (app.commandLine.hasSwitch('uninstall-account-data')) {
  require('./account-uninstall').runAccountUninstall();
} else {
  require('../../main.js');
}
