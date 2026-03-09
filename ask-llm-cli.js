#!/usr/bin/env node

// requires ASK_LLM_CLI_ANTHROPIC_API_KEY env var

const fs = require('fs');
const tty = require('tty');

const ANTHROPIC_API_KEY = process.env.ASK_LLM_CLI_ANTHROPIC_API_KEY;

// ANSI color codes
const colors = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
};

function clearLine() {
    process.stderr.write('\r\x1b[K');
}

function startSpinner(message) {
    const frames = [`${message}.`, `${message}..`, `${message}...`];
    let i = 0;
    process.stderr.write(frames[0]);
    const timer = setInterval(() => {
        i = (i + 1) % frames.length;
        clearLine();
        process.stderr.write(frames[i]);
    }, 400);
    return () => {
        clearInterval(timer);
        clearLine();
    };
}

async function callClaudeAPI(userRequest) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
        headers: {
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 512,
            messages: [{role: 'user', content: `You are a command line expert working on MacOS + zsh. The user wants: ${userRequest}`}],
            tool_choice: {type: 'tool', name: 'shell_command'},
            tools: [{
                name: 'shell_command',
                description: 'Provide the shell command and its safety classification',
                input_schema: {
                    type: 'object',
                    properties: {
                        command: {type: 'string', description: 'The shell command to execute'},
                        safety: {type: 'string', enum: ['SAFE', 'UNSAFE'], description: 'SAFE if the command is read-only or benign, UNSAFE if it modifies/deletes data or is destructive'},
                    },
                    required: ['command', 'safety'],
                },
            }],
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`API request failed (${response.status}): ${body}`);
    }

    return await response.json();
}

function parseResponse(response) {
    const toolUse = response?.content?.find((block) => block.type === 'tool_use');

    if (!toolUse) {
        const errorMsg = response?.error?.message || 'No tool_use block in response';
        throw new Error(`API Error: ${errorMsg}\nRaw response: ${JSON.stringify(response)}`);
    }

    const {command: cmd, safety} = toolUse.input;

    if (!cmd) {
        throw new Error(`Empty command in response\nRaw response: ${JSON.stringify(response)}`);
    }

    const isSafe = safety === 'SAFE';

    return {cmd, isSafe};
}

function prompt(question) {
    return new Promise((resolve, reject) => {
        process.stderr.write(question);

        // In command substitution (e.g. cmd=$(ask ...)), stdin is not a TTY.
        // Open /dev/tty directly so we can still read a keypress interactively.
        let inputStream;
        let shouldDestroy = false;

        if (process.stdin.isTTY) {
            inputStream = process.stdin;
        } else {
            try {
                const fd = fs.openSync('/dev/tty', 'r+');
                inputStream = new tty.ReadStream(fd);
                shouldDestroy = true;
            } catch (e) {
                reject(new Error('Cannot open /dev/tty for input'));
                return;
            }
        }

        inputStream.setRawMode(true);
        inputStream.resume();

        const onData = (buffer) => {
            const key = buffer.toString();

            inputStream.setRawMode(false);
            inputStream.pause();
            inputStream.removeListener('data', onData);
            if (shouldDestroy) inputStream.destroy();

            process.stderr.write(key + '\n');
            resolve(key);
        };

        inputStream.once('data', onData);
    });
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        process.stderr.write('Usage: ask <what you want to do>\n');
        process.exit(1);
    }

    if (!ANTHROPIC_API_KEY) {
        process.stderr.write('❌ ASK_LLM_CLI_ANTHROPIC_API_KEY environment variable is required\n');
        process.exit(1);
    }

    const userRequest = args.join(' ');
    const stopSpinner = startSpinner('⏳ Asking LLM');

    try {
        const response = await callClaudeAPI(userRequest);
        stopSpinner();

        let {cmd, isSafe} = parseResponse(response);

        if (isSafe) {
            process.stdout.write(cmd);
        } else {
            process.stderr.write(`⚠️  ${colors.bold}${colors.red}WARNING: This command may be dangerous!${colors.reset}\n`);
            process.stderr.write(`Command: ${colors.bold}${colors.green}${cmd}${colors.reset}\n`);

            const reply = await prompt('Edit/Cancel [e/C] ');

            if (reply.toLowerCase() === 'e') {
                process.stdout.write(cmd);
            } else {
                process.stderr.write('❌ Cancelled\n');
                process.exit(1);
            }
        }
    } catch (error) {
        stopSpinner();
        process.stderr.write(`❌ ${error.message}\n`);
        process.exit(1);
    }
}

main();
