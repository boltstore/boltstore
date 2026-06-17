/**
 * Minimal terminal prompt utility for CLI commands.
 * Uses process.stdin/stdout — no third-party dependencies.
 *
 * @module boltstore/prompt
 */

/**
 * Ask the user a question and return their response.
 * Works in TTY mode and with piped stdin.
 */
export async function prompt(question: string): Promise<string> {
  process.stdout.write(question);

  return new Promise((resolve) => {
    const stdin = process.stdin;
    let buffer = "";

    function onData(chunk: Buffer) {
      buffer += chunk.toString();
      if (buffer.includes("\n")) {
        stdin.removeListener("data", onData);
        stdin.pause();
        resolve(buffer.replace(/\r?\n$/, "").trim());
      }
    }

    stdin.resume();
    stdin.on("data", onData);
  });
}

/**
 * Ask for a password. Input is hidden (no echo).
 * Requires a TTY terminal.
 */
export async function promptPassword(question: string): Promise<string> {
  const stdin = process.stdin as any;
  const wasRaw = stdin.isRaw || false;

  // If not a TTY, fall back to visible prompt
  if (!stdin.isTTY) {
    return prompt(question);
  }

  process.stdout.write(question);

  return new Promise((resolve) => {
    let buffer = "";

    try {
      stdin.setRawMode(true);
    } catch {
      // Raw mode not supported — fall back to visible
      stdin.setRawMode(false);
      return prompt(question).then(resolve);
    }

    stdin.resume();

    function onData(chunk: Buffer) {
      for (const byte of chunk) {
        const char = String.fromCharCode(byte);

        // Enter / Return
        if (char === "\r" || char === "\n") {
          process.stdout.write("\n");
          stdin.removeListener("data", onData);
          try { stdin.setRawMode(wasRaw); } catch {}
          stdin.pause();
          resolve(buffer.trim());
          return;
        }

        // Backspace / Delete
        if (char === "\x7f" || char === "\b") {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }

        // Ctrl+C
        if (char === "\x03") {
          process.stdout.write("\n");
          stdin.removeListener("data", onData);
          try { stdin.setRawMode(wasRaw); } catch {}
          stdin.pause();
          process.exit(1);
        }

        // Printable characters
        if (byte >= 32 && byte <= 126) {
          buffer += char;
          process.stdout.write("*");
        }
      }
    }

    stdin.on("data", onData);
  });
}