#!/usr/bin/env node

// requires ASK_LLM_CLI_ANTHROPIC_API_KEY env var

const readline = require('readline');
const {spawn} = require('child_process');
const fs = require('fs');
const tty = require('tty');

const ANTHROPIC_API_KEY = process.env.ASK_LLM_CLI_ANTHROPIC_API_KEY;

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

function startSpinner(message, stream = process.stdout) {
    const frames = [`${message}.`, `${message}..`, `${message}...`];
    let i = 0;
    stream.write(frames[0]);
    const timer = setInterval(() => {
        i = (i + 1) % frames.length;
        clearLine(stream);
        stream.write(frames[i]);
    }, 400);
    return () => {
        clearInterval(timer);
        clearLine(stream);
    };
}

async function callClaudeAPI(userRequest) {
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

    return response.json();
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

function prompt(question, outStream = process.stdout) {
    return new Promise((resolve, reject) => {
        outStream.write(question);

        // In command substitution (e.g. cmd=$(ask --print ...)), stdin is not a TTY.
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

            outStream.write(key + '\n');
            resolve(key);
        };

        inputStream.once('data', onData);
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
        console.error('❌ ASK_LLM_CLI_ANTHROPIC_API_KEY environment variable is required');
        process.exit(1);
    }

    const userRequest = filteredArgs.join(' ');

    if (printMode) {
        // Print mode: spinner on stderr, command on stdout
        const stopSpinner = startSpinner('⏳ Asking LLM', process.stderr);

        try {
            const response = await callClaudeAPI(userRequest);
            stopSpinner();

            let {cmd, isSafe} = parseResponse(response);

            if (isSafe) {
                // Safe command: output directly for shell replacement
                process.stdout.write(cmd);
            } else {
                // Unsafe command: warn and ask to edit or cancel
                process.stderr.write(`⚠️  ${colors.bold}${colors.red}WARNING: This command may be dangerous!${colors.reset}\n`);
                process.stderr.write(`Command: ${colors.bold}${colors.green}${cmd}${colors.reset}\n`);

                const reply = await prompt('Edit/No, don\'t execute [e/N] ', process.stderr);

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
    } else {

        // Interactive mode (original behavior)
        const stopSpinner = startSpinner('⏳ Asking LLM');

        try {
            const response = await callClaudeAPI(userRequest);
            stopSpinner();

            let {cmd, isSafe} = parseResponse(response);

            // Display with safety warning
            if (!isSafe) {
                console.log(`⚠️  ${colors.bold}${colors.red}WARNING: This command may be dangerous!${colors.reset}`);
            }
            console.log(`Command: ${colors.bold}${colors.green}${cmd}${colors.reset}`);

            const reply = await prompt('Yes execute/Edit/No, don\'t execute [y/e/N] ');
            if (reply.toLowerCase() === 'e') {
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
            stopSpinner();
            console.log(`❌ ${error.message}`);
            process.exit(1);
        }
    }
}

main();