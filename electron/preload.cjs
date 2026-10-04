const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('relay', {
  platform: process.platform,
  getSession: () => ipcRenderer.invoke('session:get'),
  setSession: (data) => ipcRenderer.invoke('session:set', data),
  clearSession: () => ipcRenderer.invoke('session:clear'),
  isFocused: () => ipcRenderer.invoke('app:focused'),
  notify: (opts) => ipcRenderer.send('notify', opts),
  clearNotifications: (roomId) => ipcRenderer.send('notify:clear', roomId),
  notificationsBlocked: () => ipcRenderer.invoke('notify:blocked'),
  openNotificationSettings: () => ipcRenderer.send('notify:openSettings'),
  testNotification: () => ipcRenderer.send('notify:test'),
  setBadge: (count) => ipcRenderer.send('badge', count),
  onFocusChange: (cb) => {
    const fn = (_e, focused) => cb(focused);
    ipcRenderer.on('window:focus', fn);
    return () => ipcRenderer.removeListener('window:focus', fn);
  },
  canMakeOgg: () => ipcRenderer.invoke('media:canMakeOgg'),
  toOgg: (bytes) => ipcRenderer.invoke('media:toOgg', bytes),
  askMic: () => ipcRenderer.invoke('media:askMic'),
  canTranscribe: () => ipcRenderer.invoke('media:canTranscribe'),
  transcribe: (bytes) => ipcRenderer.invoke('media:transcribe', bytes),
  setTheme: (theme) => ipcRenderer.send('app:setTheme', theme),
  version: () => ipcRenderer.invoke('app:version'),
  customSounds: () => ipcRenderer.invoke('app:customSounds'),
  auto: { webhook: (url, payload) => ipcRenderer.invoke('auto:webhook', url, payload) },
  wallpaper: {
    list: () => ipcRenderer.invoke('wallpaper:list'),
    pick: () => ipcRenderer.invoke('wallpaper:pick'),
    remove: (id) => ipcRenderer.invoke('wallpaper:remove', id),
  },
  smart: { geocode: (q) => ipcRenderer.invoke('smart:geocode', q) },
  // App lock (electron/applock.cjs).
  lock: {
    state: () => ipcRenderer.invoke('lock:state'),
    lock: () => ipcRenderer.invoke('lock:lock'),
    unlock: (password) => ipcRenderer.invoke('lock:unlock', password),
    fingerprint: () => ipcRenderer.invoke('lock:fingerprint'),
    cancelFingerprint: () => ipcRenderer.invoke('lock:cancelFingerprint'),
    enable: (password, minutes) => ipcRenderer.invoke('lock:enable', password, minutes),
    change: (oldPassword, password) => ipcRenderer.invoke('lock:change', oldPassword, password),
    disable: (password) => ipcRenderer.invoke('lock:disable', password),
    setOptions: (opts) => ipcRenderer.invoke('lock:setOptions', opts),
    activity: () => ipcRenderer.send('lock:activity'),
    onState: (cb) => { const fn = (_e, s) => cb(s); ipcRenderer.on('lock:state', fn); return () => ipcRenderer.removeListener('lock:state', fn); },
  },
  update: {
    state: () => ipcRenderer.invoke('update:state'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: (cb) => {
      const fn = (_e, s) => cb(s);
      ipcRenderer.on('update:state', fn);
      return () => ipcRenderer.removeListener('update:state', fn);
    },
  },
  getOpenAtLogin: () => ipcRenderer.invoke('app:getOpenAtLogin'),
  setOpenAtLogin: (on) => ipcRenderer.invoke('app:setOpenAtLogin', on),
  local: {
    status: () => ipcRenderer.invoke('local:status'),
    install: () => ipcRenderer.invoke('local:install'),
    start: () => ipcRenderer.invoke('local:start'),
    credentials: () => ipcRenderer.invoke('local:credentials'),
    favoriteStickers: () => ipcRenderer.invoke('local:favoriteStickers'),
    createGroup: (bridge, loginId, params) => ipcRenderer.invoke('local:createGroup', bridge, loginId, params),
    viewing: (roomId, active) => ipcRenderer.send('local:viewing', roomId, active),
    recording: (roomId) => ipcRenderer.invoke('local:recording', roomId),
    loginStart: (name, flowId) => ipcRenderer.invoke('local:loginStart', name, flowId),
    loginStep: (name, processId, stepId, type, data) => ipcRenderer.invoke('local:loginStep', name, processId, stepId, type, data),
    loginCancel: (name, processId) => ipcRenderer.invoke('local:loginCancel', name, processId),
    logout: (name, loginId) => ipcRenderer.invoke('local:logout', name, loginId),
    setTelegramKeys: (apiId, apiHash) => ipcRenderer.invoke('local:setTelegramKeys', apiId, apiHash),
    cookieLogin: (params) => ipcRenderer.invoke('local:cookieLogin', params),
    addNetwork: (name) => ipcRenderer.invoke('local:addNetwork', name),
    openDirectChat: (userId, loginId) => ipcRenderer.invoke('local:openDirectChat', userId, loginId),
    bridgeCommand: (name, command) => ipcRenderer.invoke('local:bridgeCommand', name, command),
    restartBridge: (name) => ipcRenderer.invoke('local:restartBridge', name),
    openLogs: () => ipcRenderer.invoke('local:openLogs'),
    discordLogin: () => ipcRenderer.send('local:discordLogin'),
    discordCancel: () => ipcRenderer.send('local:discordCancel'),
    on: (channel, cb) => {
      const fn = (_e, payload) => cb(payload);
      ipcRenderer.on(`local:${channel}`, fn);
      return () => ipcRenderer.removeListener(`local:${channel}`, fn);
    },
  },
  reminders: {
    list: () => ipcRenderer.invoke('reminders:list'),
    add: (item) => ipcRenderer.invoke('reminders:add', item),
    update: (id, patch) => ipcRenderer.invoke('reminders:update', id, patch),
    remove: (id) => ipcRenderer.invoke('reminders:remove', id),
    onChange: (cb) => {
      const fn = (_e, list) => cb(list);
      ipcRenderer.on('reminders:changed', fn);
      return () => ipcRenderer.removeListener('reminders:changed', fn);
    },
  },
  scheduled: {
    list: () => ipcRenderer.invoke('scheduled:list'),
    add: (item) => ipcRenderer.invoke('scheduled:add', item),
    update: (id, patch) => ipcRenderer.invoke('scheduled:update', id, patch),
    cancel: (id) => ipcRenderer.invoke('scheduled:cancel', id),
    sendNow: (id) => ipcRenderer.invoke('scheduled:sendNow', id),
    onChange: (cb) => {
      const fn = (_e, list) => cb(list);
      ipcRenderer.on('scheduled:changed', fn);
      return () => ipcRenderer.removeListener('scheduled:changed', fn);
    },
  },
  // Settings → Health / Backup (electron/reliability.cjs).
  health: {
    get: () => ipcRenderer.invoke('health:get'),
    summary: () => ipcRenderer.invoke('health:summary'),
    disk: () => ipcRenderer.invoke('health:disk'),
    fix: () => ipcRenderer.invoke('health:fix'),
    cleanLogs: () => ipcRenderer.invoke('health:cleanLogs'),
    diagnostics: () => ipcRenderer.invoke('health:diagnostics'),
    openLogs: () => ipcRenderer.invoke('health:openLogs'),
    onFixProgress: (cb) => {
      const fn = (_e, p) => cb(p);
      ipcRenderer.on('health:fixProgress', fn);
      return () => ipcRenderer.removeListener('health:fixProgress', fn);
    },
  },
  backup: {
    info: () => ipcRenderer.invoke('backup:info'),
    create: (opts) => ipcRenderer.invoke('backup:create', opts),
    cancel: () => ipcRenderer.invoke('backup:cancel'),
    pick: () => ipcRenderer.invoke('backup:pick'),
    inspect: (file, passphrase) => ipcRenderer.invoke('backup:inspect', file, passphrase),
    restore: (file, passphrase) => ipcRenderer.invoke('backup:restore', file, passphrase),
    showFile: (file) => ipcRenderer.invoke('backup:showFile', file),
    onProgress: (cb) => {
      const fn = (_e, p) => cb(p);
      ipcRenderer.on('backup:progress', fn);
      return () => ipcRenderer.removeListener('backup:progress', fn);
    },
  },
  imports: {
    info: () => ipcRenderer.invoke('import:info'),
    finderBackups: () => ipcRenderer.invoke('import:finderBackups'),
    openFullDiskAccess: () => ipcRenderer.invoke('import:openFullDiskAccess'),
    devices: () => ipcRenderer.invoke('import:devices'),
    pair: (udid) => ipcRenderer.invoke('import:pair', udid),
    backup: (udid) => ipcRenderer.invoke('import:backup', udid),
    cancelBackup: () => ipcRenderer.invoke('import:cancelBackup'),
    deleteBackup: () => ipcRenderer.invoke('import:deleteBackup'),
    scan: (opts) => ipcRenderer.invoke('import:scan', opts),
    extract: (opts) => ipcRenderer.invoke('import:extract', opts),
    zipPick: () => ipcRenderer.invoke('import:zipPick'),
    zipImport: (opts) => ipcRenderer.invoke('import:zipImport', opts),
    list: () => ipcRenderer.invoke('import:list'),
    page: (opts) => ipcRenderer.invoke('import:page', opts),
    media: (rel) => ipcRenderer.invoke('import:media', rel),
    link: (key, roomId) => ipcRenderer.invoke('import:link', key, roomId),
    remove: (key) => ipcRenderer.invoke('import:remove', key),
    lidmap: () => ipcRenderer.invoke('import:lidmap'),
    onProgress: (cb) => {
      const fn = (_e, p) => cb(p);
      ipcRenderer.on('import:progress', fn);
      return () => ipcRenderer.removeListener('import:progress', fn);
    },
    onChanged: (cb) => {
      const fn = (_e, l) => cb(l);
      ipcRenderer.on('import:changed', fn);
      return () => ipcRenderer.removeListener('import:changed', fn);
    },
  },
  // Local AI (LM Studio). Requests run in the main process; answers stream over ai:chunk.
  ai: {
    status: (host) => ipcRenderer.invoke('ai:status', host),
    complete: (opts) => ipcRenderer.invoke('ai:complete', opts), // { id, host, model, messages, task?, maxTokens?, temperature?, responseFormat? }
    cancel: (id) => ipcRenderer.send('ai:cancel', id),
    onChunk: (cb) => {
      const fn = (_e, chunk) => cb(chunk);
      ipcRenderer.on('ai:chunk', fn);
      return () => ipcRenderer.removeListener('ai:chunk', fn);
    },
  },
  // Ask Relay: the search index lives in the main process (electron/semantic.cjs).
  ask: {
    status: () => ipcRenderer.invoke('ask:status'),
    rooms: () => ipcRenderer.invoke('ask:rooms'),
    add: (batch) => ipcRenderer.invoke('ask:add', batch), // { roomId, room, messages: [{ id, ts, line }], newest }
    embed: (opts) => ipcRenderer.invoke('ask:embed', opts), // { host, model }
    search: (opts) => ipcRenderer.invoke('ask:search', opts), // { query, host, model, k }
    models: (host) => ipcRenderer.invoke('ask:models', host),
    stop: () => ipcRenderer.invoke('ask:stop'),
    clear: () => ipcRenderer.invoke('ask:clear'),
    onProgress: (cb) => {
      const fn = (_e, s) => cb(s);
      ipcRenderer.on('ask:progress', fn);
      return () => ipcRenderer.removeListener('ask:progress', fn);
    },
  },
  onNotificationClick: (cb) => {
    const fn = (_e, roomId) => cb(roomId);
    ipcRenderer.on('notification:click', fn);
    return () => ipcRenderer.removeListener('notification:click', fn);
  },
});
