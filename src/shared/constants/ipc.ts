/**
 * IPC 채널 상수
 */

export const IPC_CHANNELS = {
  // Profile channels
  PROFILE_CREATE: 'profile:create',
  PROFILE_UPDATE: 'profile:update',
  PROFILE_DELETE: 'profile:delete',
  PROFILE_GET: 'profile:get',
  PROFILE_LIST: 'profile:list',
  PROFILE_LAUNCH: 'profile:launch',
  
  // Version channels
  VERSION_LIST: 'version:list',
  VERSION_LATEST: 'version:latest',
  
  // Java channels
  JAVA_DETECT: 'java:detect',
  JAVA_GET_RECOMMENDED: 'java:get-recommended',
  JAVA_CHECK_COMPATIBILITY: 'java:check-compatibility',
  
  // Account channels
  ACCOUNT_LOGIN_MICROSOFT: 'account:login:microsoft',
  ACCOUNT_ADD_OFFLINE: 'account:add:offline',
  ACCOUNT_LIST: 'account:list',
  ACCOUNT_REMOVE: 'account:remove',
  ACCOUNT_GET_FOR_LAUNCH: 'account:get:for:launch',
  
  // Game download channels
  GAME_DOWNLOAD_VERSION: 'game:download-version',
  GAME_GET_VERSION_DETAILS: 'game:get-version-details',
  GAME_CHECK_INSTALLED: 'game:check-installed',
  
  // Game launch channels
  GAME_LAUNCH: 'game:launch',
  GAME_STOP: 'game:stop',
  GAME_GET_ACTIVE: 'game:get-active',
  GAME_IS_RUNNING: 'game:is-running',
  
  MOD_SEARCH: 'mod:search',
  MOD_GET_DETAILS: 'mod:get-details',
  MOD_GET_VERSIONS: 'mod:get-versions',
  MOD_INSTALL: 'mod:install',
  MOD_REMOVE: 'mod:remove',
  MOD_TOGGLE: 'mod:toggle',
  MOD_CHECK_UPDATES: 'mod:check-updates',
  MOD_UPDATE: 'mod:update',
  MOD_UPDATE_ALL: 'mod:update-all',
  MOD_CHECK_DEPENDENCIES: 'mod:check-dependencies',
  MOD_INSTALL_DEPENDENCIES: 'mod:install-dependencies',
  
  // Modpack
  MODPACK_SEARCH: 'modpack:search',
  MODPACK_GET: 'modpack:get',
  MODPACK_GET_VERSIONS: 'modpack:get-versions',
  MODPACK_INSTALL: 'modpack:install',
  MODPACK_CHECK_UPDATE: 'modpack:check-update',
  MODPACK_UPDATE: 'modpack:update',
  MODPACK_IMPORT_FILE: 'modpack:import-file',
  MODPACK_IMPORT_URL: 'modpack:import-url',
  
  // Version
  VERSION_MINECRAFT_LIST: 'version:minecraft-list',
  VERSION_LOADER_LIST: 'version:loader-list',
  VERSION_CHECK_COMPATIBILITY: 'version:check-compatibility',
  
  // Loader channels
  LOADER_GET_VERSIONS: 'loader:get-versions',
  LOADER_GET_RECOMMENDED: 'loader:get-recommended',
  LOADER_INSTALL: 'loader:install',
  LOADER_CHECK_INSTALLED: 'loader:check-installed',
  
  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  SETTINGS_DETECT_JAVA: 'settings:detect-java',
  SETTINGS_SELECT_DIRECTORY: 'settings:select-directory',
  SETTINGS_SELECT_FILE: 'settings:select-file',
  
  // Instance
  INSTANCE_GET_LOGS: 'instance:get-logs',
  INSTANCE_EXPORT_LOGS: 'instance:export-logs',
  INSTANCE_GET_ACTIVE: 'instance:get-active',
  
  // Download
  DOWNLOAD_GET_TASKS: 'download:get-tasks',
  DOWNLOAD_PAUSE: 'download:pause',
  DOWNLOAD_RESUME: 'download:resume',
  DOWNLOAD_CANCEL: 'download:cancel',
  DOWNLOAD_RETRY: 'download:retry',
} as const;

export const IPC_EVENTS = {
  // Download Events
  DOWNLOAD_PROGRESS: 'download:progress',
  DOWNLOAD_COMPLETE: 'download:complete',
  DOWNLOAD_ERROR: 'download:error',
  DOWNLOAD_FILE_PROGRESS: 'download:file-progress',
  
  // Game Events
  GAME_LOG: 'game:log',
  GAME_STARTED: 'game:started',
  GAME_STOPPED: 'game:stopped',
  GAME_CRASHED: 'game:crashed',
  GAME_DOWNLOAD_PROGRESS: 'game:download-progress',
  
  // Mod Events
  MOD_UPDATES_AVAILABLE: 'mod:updates-available',
  
  // Modpack Events
  MODPACK_INSTALL_PROGRESS: 'modpack:install-progress',
  
  // System Events
  SYSTEM_ERROR: 'system:error',
  SYSTEM_WARNING: 'system:warning',
  SYSTEM_INFO: 'system:info',
} as const;
