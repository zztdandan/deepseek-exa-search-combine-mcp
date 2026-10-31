/**
 * stdio transport: newline-delimited JSON-RPC 2.0.
 *
 * Two rules this module exists to enforce:
 *   1. stdout carries protocol frames and nothing else — all logging goes to
 *      stderr, or the client's parser dies.
 *   2. On stdin close, in-flight calls are allowed to finish so the final
 *      response is not truncated.
 */

import { createInterface } from 'node:readline';

/**
 * @param {object} options
 * @param {(msg:any)=>Promise<object|null>} options.dispatch
 * @param {NodeJS.ReadableStream} [options.input]
 * @param {NodeJS.WritableStream} [options.output]
 * @param {(line:string)=>void} [options.log]
 * @param {boolean} [options.exitOnClose]  call process.exit(0) after draining
 * @returns {Promise<void>}
 */
export function serveStdio(options) {
  const {
    dispatch,
    input = process.stdin,
    output = process.stdout,
    log = () => {},
    exitOnClose = true,
  } = options;

  let inflight = 0;
  let stdinClosed = false;
  let finished = false;

  return new Promise((resolve) => {
    const write = (frame) => {
      if (!frame) return;
      output.write(`${JSON.stringify(frame)}\n`);
    };

    const shutdown = () => {
      if (finished) return;
      finished = true;
      if (exitOnClose) {
        // Give stdout a tick to flush before the process goes away.
        setTimeout(() => process.exit(0), 15);
      } else {
        resolve();
      }
    };

    const maybeFinish = () => {
      if (stdinClosed && inflight === 0) shutdown();
    };

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let message;
      try {
        message = JSON.parse(trimmed);
      } catch {
        log(`dropping unparsable line: ${trimmed.slice(0, 120)}`);
        write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
      }

      const messages = Array.isArray(message) ? message : [message];
      for (const item of messages) {
        inflight += 1;
        Promise.resolve()
          .then(() => dispatch(item))
          .then(write)
          .catch((err) => log(`dispatch crashed: ${err?.stack || err?.message}`))
          .finally(() => {
            inflight -= 1;
            maybeFinish();
          });
      }
    };

    const rl = createInterface({ input, crlfDelay: Infinity });
    rl.on('line', handleLine);
    rl.on('close', () => {
      stdinClosed = true;
      maybeFinish();
    });

    input.on?.('error', (err) => {
      log(`stdin error: ${err?.message}`);
      stdinClosed = true;
      maybeFinish();
    });

    if (exitOnClose) {
      const bail = () => {
        stdinClosed = true;
        if (inflight === 0) process.exit(0);
        // otherwise let the drain path handle it
        else shutdown();
      };
      process.on('SIGINT', bail);
      process.on('SIGTERM', bail);
    }
  });
}
