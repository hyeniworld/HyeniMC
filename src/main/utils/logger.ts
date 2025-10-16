/**
 * Logger Utility
 * 
 * Configures electron-log for comprehensive logging of all stdout/stderr output
 */

import log from 'electron-log';
import { app } from 'electron';
import * as path from 'path';

/**
 * Initialize logger with comprehensive settings
 */
export function initializeLogger() {
  // Set log level
  log.transports.file.level = 'info';
  log.transports.console.level = 'debug';
  
  // Configure file transport
  const isDevelopment = process.env.NODE_ENV === 'development' || !app.isPackaged;
  const logPath = isDevelopment 
    ? path.join(process.cwd(), 'logs')
    : path.join(app.getPath('userData'), 'logs');
  
  log.transports.file.resolvePathFn = () => path.join(logPath, 'main.log');
  
  // Set maximum file size (10MB) and keep 3 old log files
  log.transports.file.maxSize = 10 * 1024 * 1024;
  
  // Format log messages with timestamp
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
  log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}';
  
  // Redirect console methods to electron-log
  console.log = log.log.bind(log);
  console.info = log.info.bind(log);
  console.warn = log.warn.bind(log);
  console.error = log.error.bind(log);
  console.debug = log.debug.bind(log);
  
  // Log startup information
  log.info('='.repeat(80));
  log.info('HyeniMC Logger Initialized');
  log.info(`Version: ${app.getVersion()}`);
  log.info(`Mode: ${isDevelopment ? 'Development' : 'Production'}`);
  log.info(`Platform: ${process.platform} ${process.arch}`);
  log.info(`Electron: ${process.versions.electron}`);
  log.info(`Node: ${process.versions.node}`);
  log.info(`Log path: ${log.transports.file.getFile().path}`);
  log.info('='.repeat(80));
}

/**
 * Get the logger instance
 */
export function getLogger() {
  return log;
}

/**
 * Get current log file path
 */
export function getLogPath(): string {
  return log.transports.file.getFile().path;
}

export default log;
