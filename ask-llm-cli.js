#!/usr/bin/env node

// requires ANTHROPIC_API_KEY env var

const readline = require('readline');
const { spawn } = require('child_process');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
};

function clearLine(stream = process.stdout) {
  stream.write('\r\x1b[K');
}

async function callClaudeAPI(userRequest) {
  const prompt = `You are a command line expert working on MacOS + zsh.
Output exactly two lines, nothing else:
Line 1: the shell command (raw, no escaping needed)
Line 2: SAFE or UNSAFE
Request: ${userRequest}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  return response.json();
}

function parseResponse(response) {
  const text = response?.content?.[0]?.text;

  if (!text) {
    const errorMsg = response?.error?.message || 'Unknown error';
    throw new Error(`API Error: ${errorMsg}\nRaw response: ${JSON.stringify(response)}`);
  }

  const lines = text.trim().split('\n');
  const cmd = lines[0];
  const safetyLine = lines[lines.length - 1];
  const isSafe = safetyLine !== 'UNSAFE';

  if (!cmd) {
    throw new Error(`Failed to parse command from response\nRaw response: ${JSON.stringify(response)}`);
  }

  return { cmd, isSafe };
}

function prompt(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);

    // Enable raw mode to capture single keypress
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onData = (buffer) => {
      const key = buffer.toString();

      // Cleanup listeners and restore terminal
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);

      // Echo the character and newline
      process.stdout.write(key + '\n');

      resolve(key);
    };

    process.stdin.once('data', onData);
  });
}

function promptWithDefault(question, defaultValue) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    // Pre-fill the input with default value
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer || defaultValue);
    });
    rl.write(defaultValue);
  });
}

function executeCommand(cmd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, {
      shell: true,
      stdio: 'inherit',
      cwd: process.cwd(),
    });

    child.on('close', (code) => {
      resolve(code);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const printMode = args.includes('--print');
  const filteredArgs = args.filter((a) => a !== '--print');

  if (filteredArgs.length === 0) {
    console.log('Usage: ask <what you want to do>');
    console.log('       ask --print <what you want to do>  (output command only, for shell integration)');
    process.exit(1);
  }

  if (!ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  const userRequest = filteredArgs.join(' ');

  if (printMode) {
    // Print mode: spinner on stderr, command on stdout
    process.stderr.write('⏳ Asking Claude Sonnet 4.5...');

    try {
      const response = await callClaudeAPI(userRequest);
      clearLine(process.stderr);

      const { cmd, isSafe } = parseResponse(response);

      if (!isSafe) {
        process.stderr.write(`⚠️  ${colors.bold}${colors.red}WARNING: This command may be dangerous!${colors.reset}\n`);
      }

      // Output only the command to stdout
      process.stdout.write(cmd);
    } catch (error) {
      clearLine(process.stderr);
      process.stderr.write(`❌ ${error.message}\n`);
      process.exit(1);
    }
    return;
  }

  // Interactive mode (original behavior)
  process.stdout.write('⏳ Asking Claude Sonnet 4.5...');

  try {
    const response = await callClaudeAPI(userRequest);
    clearLine();

    let { cmd, isSafe } = parseResponse(response);

    // Display with safety warning
    if (!isSafe) {
      console.log(`⚠️  ${colors.bold}${colors.red}WARNING: This command may be dangerous!${colors.reset}`);
    }
    console.log(`Command: ${colors.bold}${colors.green}${cmd}${colors.reset}`);

    // Get user confirmation
    const reply = await prompt('Execute? [y/e/N] ');

    if (reply.toLowerCase() === 'e') {
      // Edit mode
      cmd = await promptWithDefault('Edit command: ', cmd);

      if (cmd.trim()) {
        await executeCommand(cmd);
      } else {
        console.log('❌ Cancelled (empty command)');
      }
    } else if (reply.toLowerCase() === 'y') {
      await executeCommand(cmd);
    } else {
      console.log('❌ Cancelled');
    }
  } catch (error) {
    clearLine();
    console.log(`❌ ${error.message}`);
    process.exit(1);
  }
}

main();