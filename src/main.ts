import {
  BrowserWindow,
  shell,
  Session,
  OnBeforeSendHeadersListenerDetails,
  BeforeSendResponse,
  ipcMain,
  desktopCapturer,
  Menu,
  Tray,
  nativeImage
} from 'electron'
import * as path from 'path'
import { SlackyEvent } from './events'

const SLACK_APP_URL = 'https://app.slack.com/client'
const PROTOCOL = 'slack'

const defaultUserAgent =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

const enhanceSession = (session: Session) => {
  session.setUserAgent(defaultUserAgent)
  session.webRequest.onBeforeSendHeaders(
    (
      details: OnBeforeSendHeadersListenerDetails,
      callback: (beforeSendResponse: BeforeSendResponse) => void
    ) => {
      details.requestHeaders['User-Agent'] = defaultUserAgent
      details.requestHeaders['Referer'] = details.referrer
      callback({
        cancel: false,
        requestHeaders: details.requestHeaders
      })
    }
  )
}

/**
 * Huddle screen sharing goes through `navigator.mediaDevices.getDisplayMedia()`,
 * which Electron rejects unless the session provides a display media handler.
 * On macOS the system picker is used; on Linux the first screen is shared (on
 * Wayland, PipeWire capture shows the xdg-desktop-portal picker instead).
 */
const enableScreenSharing = (session: Session) => {
  session.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen', 'window'] })
        .catch(() => [] as Electron.DesktopCapturerSource[])
        .then((sources) => {
          const source = sources.find((s) => s.id.startsWith('screen:')) ?? sources[0]
          // Electron rejects the request when the callback gets null (an empty
          // object throws instead); its typings just don't list null.
          callback(source ? { video: source } : (null as unknown as Electron.Streams))
        })
    },
    { useSystemPicker: true }
  )
}

const findDeepLink = (argv: string[]): string | undefined =>
  argv.find((arg) => arg.startsWith(`${PROTOCOL}://`))

/**
 * Translate a Slack deep link (https://api.slack.com/reference/deep-linking)
 * into the web client URL that shows the same thing. Only links whose web
 * equivalent is unambiguous are mapped; anything else just opens Slack.
 *   slack://open?team=T123            -> /client/T123
 *   slack://channel?team=T123&id=C456 -> /client/T123/C456
 */
const deepLinkToUrl = (link: string): string => {
  const isSlackId = (value: string | null): value is string =>
    value !== null && /^[A-Z0-9]+$/.test(value)

  try {
    const url = new URL(link)
    const team = url.searchParams.get('team')
    const id = url.searchParams.get('id')
    if (url.hostname === 'channel' && isSlackId(team) && isSlackId(id))
      return `${SLACK_APP_URL}/${team}/${id}`
    if (url.hostname === 'open' && isSlackId(team)) return `${SLACK_APP_URL}/${team}`
  } catch {
    // Malformed link: fall through to the default view.
  }
  return SLACK_APP_URL
}

/**
 * A URL is "external" only when it is a real http(s) link that does not belong
 * to Slack or a supported authentication provider. Internal targets — most
 * importantly `about:blank`, which Slack uses when it pops a huddle out via
 * `window.open()` and then drives the returned window itself — must stay inside
 * Electron.
 */
const isExternalUrl = (url: string): boolean => {
  if (!/^https?:\/\//i.test(url)) return false

  try {
    const { hostname } = new URL(url)
    const isSlack = hostname === 'slack.com' || hostname.endsWith('.slack.com')
    const isGoogleAuth = hostname === 'accounts.google.com'
    return !isSlack && !isGoogleAuth
  } catch {
    return true
  }
}

/**
 * Route genuinely external links to the system browser while letting Slack's
 * own windows (slack.com pages and the `about:blank` huddle pop-out) open as
 * native Electron windows. Denying the pop-out used to make `window.open()`
 * return null, which Slack reported as "Unable to create window".
 */
const applyExternalLinkPolicy = (contents: Electron.WebContents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      shell.openExternal(url)
      return { action: 'deny' } // Deny Electron from opening new windows directly
    }
    return { action: 'allow' }
  })

  // Intercept in-page navigation; keep external links in the OS browser.
  contents.on('will-navigate', (event, url) => {
    if (isExternalUrl(url)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })
}

export default class Main {
  static mainWindow: Electron.BrowserWindow | null
  static application: Electron.App
  static BrowserWindow
  static tray: Electron.Tray | null = null
  static isQuitting = false

  private static onWindowAllClosed() {
    if (process.platform !== 'darwin') Main.application.quit()
  }

  private static onClose() {
    // Dereference the window object.
    Main.mainWindow = null
  }

  private static onReady() {
    Main.createTray()

    Main.mainWindow = new BrowserWindow({
      roundedCorners: true,
      width: 1920,
      height: 1080,
      title: 'Slacky',
      autoHideMenuBar: true,
      center: true,
      webPreferences: {
        // contextIsolation must be off so the preload can patch the same
        // `window.Notification` that Slack's page scripts use. nodeIntegration
        // stays off so the remote Slack code still gets no Node access; the
        // preload keeps Node/IPC privileges via its own closure.
        contextIsolation: false,
        nodeIntegration: false,
        sandbox: false,
        preload: path.join(__dirname, 'preload.js')
      }
    })

    // Keep external links in the OS browser; let Slack's own windows
    // (including the about:blank huddle pop-out) open natively.
    applyExternalLinkPolicy(Main.mainWindow.webContents)

    // Apply the same policy to windows Slack opens (e.g. the popped-out huddle)
    // so links clicked inside them still go to the OS browser.
    Main.mainWindow.webContents.on('did-create-window', (childWindow) => {
      childWindow.setMenuBarVisibility(false)
      applyExternalLinkPolicy(childWindow.webContents)
    })

    const deepLink = findDeepLink(process.argv)
    Main.mainWindow.loadURL(deepLink ? deepLinkToUrl(deepLink) : SLACK_APP_URL, {
      userAgent: defaultUserAgent
    })

    // Stop flashing the taskbar entry once the window is actually focused.
    Main.mainWindow.on('focus', () => Main.mainWindow?.flashFrame(false))

    // With a tray icon, closing the window only hides it so notifications keep
    // arriving; quit from the tray menu or with Ctrl+Q.
    Main.mainWindow.on('close', (event) => {
      if (Main.tray && !Main.isQuitting) {
        event.preventDefault()
        Main.mainWindow?.hide()
      }
    })

    Main.mainWindow.on('closed', Main.onClose)
  }

  /**
   * Add a tray (status notifier) icon to show the window again or quit. The
   * desktop needs a tray host for it to be visible (Cinnamon, KDE and XFCE have
   * one; GNOME needs the AppIndicator extension). Launching Slacky again always
   * brings a hidden window back.
   */
  private static createTray() {
    const icon = nativeImage
      .createFromPath(path.join(Main.application.getAppPath(), 'build/icons/icon.png'))
      .resize({ width: 32, height: 32 })

    try {
      Main.tray = new Tray(icon)
    } catch (error) {
      // Without a tray, closing the window quits as before.
      console.warn('Slacky: tray icon unavailable', error)
      return
    }
    Main.tray.setToolTip('Slacky')
    Main.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show Slacky', click: Main.showWindow },
        { type: 'separator' },
        { label: 'Quit', click: () => Main.application.quit() }
      ])
    )
    Main.tray.on('click', Main.showWindow)
  }

  /**
   * Another launch of Slacky (from the app menu, or the OS opening a slack://
   * link) hands its arguments to this instance instead of starting a second
   * copy.
   */
  private static onSecondInstance(_event: Electron.Event, argv: string[]) {
    const deepLink = findDeepLink(argv)
    if (deepLink) Main.mainWindow?.loadURL(deepLinkToUrl(deepLink), { userAgent: defaultUserAgent })
    Main.showWindow()
  }

  /**
   * Bring the Slacky window back to the foreground, e.g. when a Slack
   * notification is clicked or the tray icon is used. On Linux (especially Wayland) the
   * compositor may refuse to let an app raise itself, so we restore + show +
   * focus and fall back to flashing the taskbar entry as an urgency hint.
   */
  private static showWindow() {
    const win = Main.mainWindow
    if (!win) return

    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.flashFrame(true)
  }

  static main(app: Electron.App, browserWindow: typeof BrowserWindow) {
    Main.BrowserWindow = browserWindow
    Main.application = app

    // Only one Slacky may run; later launches are forwarded to this one.
    if (!Main.application.requestSingleInstanceLock()) {
      Main.application.quit()
      return
    }
    Main.application.on('second-instance', Main.onSecondInstance)
    Main.application.on('before-quit', () => {
      Main.isQuitting = true
    })

    Main.application.on('window-all-closed', Main.onWindowAllClosed)
    Main.application.on('ready', Main.onReady)

    ipcMain.on(SlackyEvent.NotificationClicked, Main.showWindow)

    Main.application.on('session-created', (session) => {
      enhanceSession(session)
      enableScreenSharing(session)
    })

    /**
     * Register as the slack:// handler. Deep linking works on packaged versions of the
     * application (deb/rpm/AppImage, Nix) only, as it needs the installed desktop entry.
     * The links are translated by `deepLinkToUrl`.
     * docs: https://api.slack.com/reference/deep-linking
     */
    if (!Main.application.isDefaultProtocolClient(PROTOCOL))
      Main.application.setAsDefaultProtocolClient(PROTOCOL)
  }
}
