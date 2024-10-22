//@ts-check
"use strict";

const fs = require("fs");
const https = require("https");
const readline = require("readline");
const { IncomingMessage } = require("http");

process.on("unhandledRejection", (reason, p) => {
  console.log("Unhandled Rejection at: Promise", p, "reason:", reason);
  process.exit(1);
});

let verbose = false;

/**
 * @param {number} b An amount of bytes
 * @returns {string} A human-readable size
 */
function formatSize(b) {
  let KiB = 1024;
  let MiB = 1024 * KiB;

  if (b > MiB) {
    return `${(b / MiB).toFixed(2)} MiB`;
  } else if (b > KiB) {
    return `${(b / KiB).toFixed(0)} KiB`;
  } else {
    return `${b} B`;
  }
}

/**
 * @param {number} x A number in the [0, 1] range
 * @returns {string} That number formatted as a percentage
 */
function formatPercent(x) {
  return `${(x * 100).toFixed(2)}%`;
}

/**
 * Returns the size of a file in bytes
 * @param {string} path The path of the file
 * @returns {number} The size of `path` in bytes
 */
function sizeof(path) {
  const { statSync } = require("fs");
  const stats = statSync(path);
  return stats.size;
}

/**
 * @param {string} line
 */
function info(line) {
  console.log(chalk.blue(`💡 ${line}`));
}

/**
 * @param {string} line
 */
function header(line) {
  let bar = "―".repeat(line.length + 2);

  console.log();
  console.log(chalk.blue(bar));
  console.log(chalk.blue(` ${line} `));
  console.log(chalk.blue(bar));
  console.log();
}

function debug() {
  if (!verbose) {
    return;
  }
  // @ts-ignore
  console.log.apply(console, arguments);
}

const chalk = {
  colors: {
    green: "\x1b[1;32;40m",
    yellow: "\x1b[1;33;40m",
    blue: "\x1b[1;34;40m",
    magenta: "\x1b[1;35;40m",
    cyan: "\x1b[1;36;40m",
    reset: "\x1b[0;0;0m",
  },
  /**
   * @param {any} s
   */
  green: function (s) {
    return `${chalk.colors.green}${s}${chalk.colors.reset}`;
  },
  /**
   * @param {any} s
   */
  yellow: function (s) {
    return `${chalk.colors.yellow}${s}${chalk.colors.reset}`;
  },
  /**
   * @param {any} s
   */
  blue: function (s) {
    return `${chalk.colors.blue}${s}${chalk.colors.reset}`;
  },
  /**
   * @param {any} s
   */
  magenta: function (s) {
    return `${chalk.colors.magenta}${s}${chalk.colors.reset}`;
  },
  /**
   * @param {any} s
   */
  cyan: function (s) {
    return `${chalk.colors.cyan}${s}${chalk.colors.reset}`;
  },
};

/**
 * Execute a command. If on Windows, run it through bash.
 * @param {string} cmd
 */
function $(cmd) {
  console.log(chalk.yellow(`📜 ${cmd}`));
  const cp = require("child_process");
  if (process.platform === "win32") {
    cp.execSync("bash", {
      stdio: ["pipe", "inherit", "inherit"],
      input: cmd,
    });
  } else {
    cp.execSync(cmd, {
      stdio: "inherit",
    });
  }
}

/**
 * @param {string} cmd
 * @param {{silent?: boolean}} [opts]
 * @returns {string} stdout
 */
function $$(cmd, opts) {
  if (!opts) {
    opts = {};
  }
  if (!opts.silent) {
    console.log(chalk.yellow(`📜 ${cmd}`));
  }
  const cp = require("child_process");

  if (process.platform === "win32") {
    return cp.execSync("bash", {
      stdio: ["pipe", "pipe", "inherit"],
      input: cmd,
      encoding: "utf8",
    });
  } else {
    return cp.execSync(cmd, {
      stdio: ["inherit", "pipe", "inherit"],
      encoding: "utf8",
    });
  }
}

/**
 * @returns {boolean}
 */
function isVerbose() {
  return verbose;
}

/**
 * @param {boolean} v
 */
function setVerbose(v) {
  verbose = v;
}

/**
 * @returns {"windows" | "darwin" | "linux"}
 */
function detectOS() {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    default:
      throw new Error(`Unsupported process.platform: ${process.platform}`);
  }
}

/**
 * @param {string} url
 * @param {fs.WriteStream} out
 * @returns {Promise<void>}
 */
async function downloadToStream(url, out) {
  /** @type {IncomingMessage} */
  let res = await new Promise((resolve, reject) => {
    let req = https.request(
      url,
      {
        method: "GET",
      },
      (res) => {
        resolve(res);
      }
    );

    req.on("error", (e) => {
      console.log(`Got error: ${e.stack}`);
      reject(e);
    });
    req.end();
  });

  let redirectURL = res.headers["location"];
  if (redirectURL) {
    let url = new URL(redirectURL);
    debug(`Redirected to ${chalk.yellow(url.hostname)}`);
    res.destroy();
    return await downloadToStream(redirectURL, out);
  }

  if (res.statusCode !== 200) {
    throw new Error(`Got HTTP ${res.statusCode} for ${url}`);
  }

  let contentLength = res.headers["content-length"] || "";
  let state = {
    doneSize: 0,
    totalSize: parseInt(contentLength, 10),
    currentDots: 0,
    totalDots: 100,
    prefix: ``,
  };

  let start = Date.now();

  let theme = {
    chunks: [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"],
    start: "▐",
    end: "▌",
    filler: " ",
  };

  const showProgress = () => {
    let suffix = `${formatSize(state.doneSize)} / ${formatSize(
      state.totalSize
    )}`;
    process.stdout.write(`\r${theme.start}`);

    let units = state.currentDots;
    let remainWidth = Math.ceil(state.totalDots / 8);
    while (units > 0) {
      let chunk = units % 8;
      if (units >= 8) {
        chunk = 8;
      }
      let char = theme.chunks[chunk];
      process.stdout.write(char);
      units -= chunk;
      remainWidth--;
    }
    while (remainWidth > 0) {
      process.stdout.write(theme.filler);
      remainWidth--;
    }
    process.stdout.write(`${theme.end} ${suffix}`);
  };
  showProgress();

  /**
   * @param {Buffer} data
   */
  let onData = (data) => {
    state.doneSize += data.byteLength;
    let currentDots = Math.floor(
      (state.doneSize / state.totalSize) * state.totalDots
    );
    while (state.currentDots != currentDots) {
      state.currentDots = currentDots;
      showProgress();
    }
    out.write(data);
  };
  res.on("data", onData);
  res.on("close", () => {
    out.close();
  });

  await new Promise((resolve, reject) => {
    out.on("close", () => {
      resolve();
    });
    out.on("error", (e) => {
      console.warn(`I/O error: ${e.stack}`);
      reject(e);
    });
    res.on("aborted", () => {
      console.warn("Request aborted!");
      reject(new Error("Request aborted"));
    });
  });

  process.stdout.write(
    "\r                                                       \r"
  );
  let end = Date.now();

  let elapsedMS = end - start;
  let elapsedSeconds = elapsedMS / 1000;
  let bytesPerSec = state.totalSize / elapsedSeconds;

  let doneIn = `${elapsedSeconds.toFixed(1)}s`;
  let avgSpeed = `${formatSize(bytesPerSec)}/s`;
  debug(
    `Downloaded ${chalk.yellow(formatSize(state.totalSize))} in ${chalk.yellow(
      doneIn
    )}, average DL speed ${chalk.yellow(avgSpeed)}`
  );
}

/**
 * Display a prompt
 * @param {string} msg Question to ask (prompt text)
 * @returns {Promise<string>}
 */
async function prompt(msg) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise((resolve, reject) => {
    rl.question(chalk.green(`${msg}: `), (line) => {
      resolve(line);
    });
  });

  rl.close();

  return answer;
}

/**
 * Ask a yes/no question
 * @param {string} msg Yes/no question to ask
 * @returns {Promise<boolean>}
 */
async function yesno(msg) {
  return "y" == (await prompt(`${msg} (y/N)`));
}

/**
 * Ask a yes/no question, bail out if no
 * @param {string} msg Yes/no question to ask
 */
async function confirm(msg) {
  if (await yesno(msg)) {
    return;
  }

  console.log("Bailing out");
  process.exit(1);
}

/**
 * @template T
 * @param {string} dir Directory to cd to.
 * @param {() => Promise<T>} f Function to run inside the directory.
 * @returns {Promise<T>}
 */
async function cd(dir, f) {
  const originalWd = process.cwd();
  console.log(chalk.magenta(`☞ entering ${dir}`));
  process.chdir(dir);
  try {
    return await f();
  } catch (err) {
    throw err;
  } finally {
    console.log(chalk.magenta(`☜ leaving ${dir}`));
    process.chdir(originalWd);
  }
}

/**
 * Exports an environment variable
 * @param {string} k
 * @param {string} v
 */
function setenv(k, v) {
  console.log(`export ${chalk.green(k)}=${chalk.yellow(v)}`);
  process.env[k] = v;
}

module.exports = {
  $,
  $$,
  formatSize,
  formatPercent,
  sizeof,
  info,
  header,
  debug,
  chalk,
  isVerbose,
  setVerbose,
  detectOS,
  downloadToStream,
  prompt,
  yesno,
  confirm,
  cd,
  setenv,
};