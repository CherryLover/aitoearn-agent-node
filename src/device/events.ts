/** 设备这条线的状态变了就喊一声，侧边栏开着的话会重新拉一份快照 */
export function notifyDeviceChanged(): void {
  chrome.runtime.sendMessage({ type: "device:changed" }).catch(() => {
    /* 侧边栏关着的时候没人收，忽略 */
  });
}
