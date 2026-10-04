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
  onNotificationClick: (cb) => {
    const fn = (_e, roomId) => cb(roomId);
    ipcRenderer.on('notification:click', fn);
    return () => ipcRenderer.removeListener('notification:click', fn);
  },
});
