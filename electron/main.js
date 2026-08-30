"use strict";

/**
 * The desktop shell.
 *
 * Three jobs, in order:
 *
 *   1. Own the durable state — the database directory and the two secrets — so they
 *      survive across launches and app updates.
 *   2. Run the Next.js server as a child process, bound to 0.0.0.0 so phones on the
 *      venue LAN can reach it.
 *   3. Show the organiser dashboard in a window, holding the admin token that nothing
 *      on the network has.
 *
 * The server is a *child process* rather than something required into this one. PGlite
 * allows a single connection to its data directory, so exactly one process may own it,
 * and that has to be the process running the queries.
 */

const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const { app, BrowserWindow, Menu, dialog, shell, session } = require("electron");

const ADMIN_COOKIE = "pj_admin";
const HOST = "127.0.0.1";

let serverProcess = null;
let mainWindow = null;
let shuttingDown = false;

// ---------------------------------------------------------------------------
// Durable state
// ---------------------------------------------------------------------------

function dataDir() {
  return path.join(app.getPath("userData"), "pgdata");
}

/**
 * The judge session secret and the code pepper, generated once and then never changed.
 *
 * **Changing the pepper invalidates every access code that has ever been issued**, so
 * these are written on first launch and read verbatim afterwards. Losing this file
 * mid-event would lock every judge out with no way to recover short of reprinting all
 * the cards.
 */
function loadSecrets() {
  const file = path.join(app.getPath("userData"), "secrets.json");

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    const secrets = {
      JUDGE_SESSION_SECRET: crypto.randomBytes(48).toString("base64"),
      JUDGE_CODE_PEPPER: crypto.randomBytes(32).toString("base64"),
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
    return secrets;
  }
}

// ---------------------------------------------------------------------------
// Server child process
// ---------------------------------------------------------------------------

/** An OS-assigned free port, so a second copy of the app cannot collide with the first. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, HOST, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Resolves once the server answers, or rejects after `timeoutMs`. */
function waitForServer(port, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (shuttingDown) return reject(new Error("shutting down"));

      const socket = net.connect(port, HOST);
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Server did not start within ${timeoutMs / 1000}s`));
        } else {
          setTimeout(attempt, 250);
        }
      });
    };
    attempt();
  });
}

function startServer(port, adminToken) {
  const secrets = loadSecrets();

  // In a packaged build the standalone server and the migrations sit next to the app's
  // resources; in development we drive `next dev` from the repo instead.
  const packaged = app.isPackaged;
  const root = packaged ? process.resourcesPath : app.getAppPath();

  const script = packaged
    ? path.join(root, "app", "server.js")
    : path.join(root, "node_modules", "next", "dist", "bin", "next");

  const args = packaged ? [] : ["dev", "--hostname", "0.0.0.0", "--port", String(port)];

  const env = {
    ...process.env,
    // Run the child as plain Node rather than a second Electron instance.
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: packaged ? "production" : "development",
    PORT: String(port),
    // 0.0.0.0 is the whole point: judges reach this from their phones.
    HOSTNAME: "0.0.0.0",
    PJ_ADMIN_TOKEN: adminToken,
    PJ_DATA_DIR: dataDir(),
    PJ_MIGRATIONS_DIR: packaged
      ? path.join(root, "app", "db", "migrations")
      : path.join(root, "db", "migrations"),
    JUDGE_SESSION_SECRET: secrets.JUDGE_SESSION_SECRET,
    JUDGE_CODE_PEPPER: secrets.JUDGE_CODE_PEPPER,
  };

  serverProcess = spawn(process.execPath, [script, ...args], {
    cwd: packaged ? path.join(root, "app") : root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  serverProcess.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

  serverProcess.on("exit", (code) => {
    serverProcess = null;
    if (shuttingDown) return;

    // The server dying mid-event is not something to fail silently about: without it
    // every judge's phone stops working at once.
    dialog.showErrorBox(
      "The judging server stopped",
      `The background server exited unexpectedly (code ${code}).\n\n` +
        "Scores already submitted are safe on disk. Quit and reopen the app to " +
        "restart it.",
    );
  });

  return serverProcess;
}

function stopServer() {
  shuttingDown = true;
  if (!serverProcess) return;

  // SIGTERM lets the server close the database cleanly. Leaving it running would hold
  // the PGlite data directory and stop the next launch from opening it.
  serverProcess.kill("SIGTERM");
  serverProcess = null;
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

const SPLASH = `data:text/html,${encodeURIComponent(`
  <html><body style="margin:0;display:grid;place-items:center;height:100vh;
    font:15px system-ui;background:#0b0d10;color:#9aa4b2">
    <div style="text-align:center">
      <div style="font-size:17px;color:#e6eaf0;margin-bottom:6px">Poster Judging</div>
      Starting the judging server…
    </div>
  </body></html>`)}`;

async function createWindow(port, adminToken) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    backgroundColor: "#0b0d10",
    title: "Poster Judging",
    webPreferences: {
      // The page is ordinary web content served over localhost; it needs no Node access.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(SPLASH);

  // The admin token is what makes this window an organiser. It is scoped to `localhost`
  // and httpOnly, so it is never sent to the LAN address judges use and no page can
  // read it — see lib/auth/admin.ts.
  await session.defaultSession.cookies.set({
    url: `http://localhost:${port}`,
    name: ADMIN_COOKIE,
    value: adminToken,
    httpOnly: true,
    sameSite: "lax",
  });

  // Links to anywhere else belong in the real browser, not in this window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

function buildMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "Event",
      submenu: [
        {
          label: "Reveal Data Folder",
          click: () => shell.openPath(app.getPath("userData")),
        },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
      ],
    },
    { role: "editMenu" },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

// A second instance would try to open the same PGlite directory and fail. Focus the
// window that is already running instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();

    const port = await freePort();
    const adminToken = crypto.randomBytes(32).toString("hex");

    const window = await createWindow(port, adminToken);
    startServer(port, adminToken);

    try {
      await waitForServer(port);
      await window.loadURL(`http://localhost:${port}/admin`);
    } catch (error) {
      if (shuttingDown) return;
      dialog.showErrorBox(
        "Could not start the judging server",
        `${error.message}\n\nCheck the terminal output for details.`,
      );
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    // Quitting on macOS too: with the window closed the server would keep serving the
    // LAN from a dock icon nobody is watching.
    app.quit();
  });

  app.on("before-quit", stopServer);
  process.on("SIGINT", () => {
    stopServer();
    app.quit();
  });
}
