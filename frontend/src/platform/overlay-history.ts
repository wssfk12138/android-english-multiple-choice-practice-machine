// 自有弹层的返回键/历史协调：打开时压入一条历史记录，
// 系统/浏览器返回键触发 popstate 时关闭弹层而不是离开页面；
// 通过界面按钮关闭时消费掉这条历史记录，保持历史栈干净。
let sequence = 0

export type OverlayHistoryHandle = {
  /** 用户用返回键关闭时由 popstate 触发，界面侧不必再调用。 */
  close: () => void
  /** 界面主动关闭（取消/确认/×）时调用，撤销压入的历史记录。 */
  dispose: () => void
}

export function pushOverlayHistory(onClose: () => void): OverlayHistoryHandle {
  const marker = { linjianOverlay: ++sequence }
  try {
    window.history.pushState(marker, '')
  } catch {
    // 历史不可用时（如嵌入式环境）退化为仅界面按钮可关闭。
    return { close: onClose, dispose: () => {} }
  }
  let closed = false
  const handle = {
    close: () => {
      if (closed) return
      closed = true
      window.removeEventListener('popstate', onPop)
      onClose()
    },
    dispose: () => {
      if (closed) return
      closed = true
      window.removeEventListener('popstate', onPop)
      // 只在栈顶仍是本弹层记录时回退，避免吞掉用户自己的导航。
      if (window.history.state && window.history.state.linjianOverlay === marker.linjianOverlay) {
        window.history.back()
      }
    },
  }
  function onPop() {
    closed = true
    window.removeEventListener('popstate', onPop)
    onClose()
  }
  window.addEventListener('popstate', onPop)
  return handle
}
